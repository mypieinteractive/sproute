/**
 * preOptimization.js
 * VERSION: V1.40
 * * CHANGES:
 * V1.40 - Macro State Desync Fix. Injected the evaluateRouteState helper. 
 * updateOrder, updateMultipleOrders, deleteMultipleOrders, and resolveUnmatchedAddress 
 * now actively re-evaluate the driver's overarching activeStaging.status based on 
 * the presence of 'R' (Routed) flags. If all routed orders are removed, unrouted, 
 * or reassigned, the driver's board correctly reverts to "Pending".
 * V1.39 - Live Route & Cross-Driver ID Fix.
 */

const { parse } = require('csv-parse/sync');
const { colIdx, safeJsonParse, incrementApiUsage } = require('./helpers');

// --- NEW HELPER: State Evaluator ---
function evaluateRouteState(arr, currState) {
    if (!arr || arr.length === 0) return "Pending";
    const hasRouted = arr.some(s => {
        let stat = Array.isArray(s) ? s[11] : (s.status || s.s);
        return String(stat).trim() === 'R';
    });
    if (!hasRouted) return "Pending";
    return currState === "Ready" ? "Staging" : currState;
}

async function performGeocodingWaterfall(address, db, mapsApiKey) {
    const cleanAddr = address.replace(/\//g, '');
    const cacheRef = db.collection('GeocodeCache').doc(cleanAddr);
    const cacheDoc = await cacheRef.get();

    if (cacheDoc.exists) {
        return { lat: cacheDoc.data().lat, lng: cacheDoc.data().lng, cached: true };
    }

    if (!mapsApiKey) return null;

    try {
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsApiKey}`);
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results.length > 0) {
            return { lat: geoData.results[0].geometry.location.lat, lng: geoData.results[0].geometry.location.lng, cached: false };
        }
    } catch(e) { console.error("Standard Geocode Error:", e.message); }

    try {
        const valRes = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${mapsApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: { addressLines: [address] } })
        });
        const valData = await valRes.json();
        if (valData.result && valData.result.geocode && valData.result.geocode.location) {
            return { lat: valData.result.geocode.location.latitude, lng: valData.result.geocode.location.longitude, cached: false };
        }
    } catch(e) { console.error("Validation API Error:", e.message); }

    return null;
}

async function uploadCsv(payload, res, db, admin) {
    const { csvData, driverId, companyId, csvType, adminId, overrideLock } = payload;
    if (!csvData || !driverId || !companyId || !csvType) return res.status(400).json({ error: "Missing required upload parameters." });

    const settingsSnapshot = await db.collection('CSV_Settings')
        .where('companyId', '==', String(companyId))
        .where('csvType', '==', String(csvType))
        .limit(1)
        .get();

    if (settingsSnapshot.empty) return res.status(404).json({ error: `CSV Settings not found for Type: '${csvType}'` });
    
    const sData = settingsSnapshot.docs[0].data();
    const settingsMap = {
        address: colIdx(sData.address), city: colIdx(sData.city), state: colIdx(sData.state),
        zip: colIdx(sData.zip), client: colIdx(sData.client), dueDate: colIdx(sData.dueDate),
        orderType: colIdx(sData.orderType), lat: colIdx(sData.lat), lng: colIdx(sData.lng)
    };

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) return res.status(404).json({ error: `Driver ID ${driverId} not found.` });

    const currentLock = driverDoc.data().lockedBy;
    const uId = String(adminId || "").trim();

    if (!overrideLock && currentLock && currentLock !== uId) {
        return res.status(200).json({ success: false, status: 'confirm_hijack', driverId: driverId });
    }

    let existingBay = [];
    if (driverDoc.data().activeStaging?.orders) {
        existingBay = safeJsonParse(driverDoc.data().activeStaging.orders, []);
    }

    if (overrideLock) existingBay = []; 

    let maxSeq = 0;
    existingBay.forEach(s => {
        let idStr = String(Array.isArray(s) ? s[0] : (s.rowId || ""));
        let parts = idStr.split('-');
        if (parts.length === 2) {
            let seqNum = parseInt(parts[1]);
            if (!isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
        }
    });

    const records = parse(csvData, { skip_empty_lines: true, relax_column_count: true });
    const fallbackState = 'TX';
    const mapsApiKey = process.env.MAPS_API_KEY;
    
    const batch = db.batch();
    let newOrders = [], unmatchedList = [], geocodeCallCount = 0;

    for (let j = 1; j < records.length; j++) {
        const row = records[j];
        let street = settingsMap.address > -1 ? row[settingsMap.address] : "";
        let city = settingsMap.city > -1 ? row[settingsMap.city] : "";
        let state = settingsMap.state > -1 ? row[settingsMap.state] : fallbackState;
        let zip = settingsMap.zip > -1 ? row[settingsMap.zip] : "";

        if (street) {
            let fullAddr = `${street}, ${city}, ${state} ${zip}`.replace(/,,/g, ",").trim();
            let csvLatRaw = settingsMap.lat > -1 ? row[settingsMap.lat] : "";
            let csvLngRaw = settingsMap.lng > -1 ? row[settingsMap.lng] : "";
            
            let parsedCsvLat = parseFloat(csvLatRaw), parsedCsvLng = parseFloat(csvLngRaw);
            let hasCsvCoords = !isNaN(parsedCsvLat) && !isNaN(parsedCsvLng) && parsedCsvLat !== 0 && parsedCsvLng !== 0;
            
            let lat = null, lng = null;
            let isUnmatched = false;

            if (hasCsvCoords) {
                lat = parsedCsvLat; lng = parsedCsvLng;
            } else {
                let geoResult = await performGeocodingWaterfall(fullAddr, db, mapsApiKey);
                if (geoResult) {
                    lat = geoResult.lat; lng = geoResult.lng;
                    if (!geoResult.cached) {
                        const cacheRef = db.collection('GeocodeCache').doc(fullAddr.replace(/\//g, ''));
                        batch.set(cacheRef, { lat: lat, lng: lng, timestamp: admin.firestore.FieldValue.serverTimestamp() });
                        geocodeCallCount++;
                    }
                } else {
                    isUnmatched = true;
                }
            }

            let initialStatus = isUnmatched ? "V" : "P"; 
            if (isUnmatched) { 
                lat = 0; lng = 0; 
                unmatchedList.push(fullAddr);
                const unRef = db.collection('Unmatched').doc(fullAddr.replace(/\//g, ''));
                batch.set(unRef, { originalAddress: fullAddr, lat: null, lng: null, correctedAddress: "", timestamp: admin.firestore.FieldValue.serverTimestamp() });
            } else { 
                lat = Number(parseFloat(lat).toFixed(5)); lng = Number(parseFloat(lng).toFixed(5)); 
            }

            maxSeq++;
            let displayAddress = street.split(',')[0].trim(); if (zip) displayAddress += ", " + zip.trim();
            let clientVal = settingsMap.client > -1 ? row[settingsMap.client] : "";
            let displayClient = String(clientVal).substring(0, 3);
            let dueDateRaw = settingsMap.dueDate > -1 ? row[settingsMap.dueDate] : "";
            let shortDate = dueDateRaw ? String(dueDateRaw).substring(0,10) : "";
            let orderTypeVal = settingsMap.orderType > -1 ? row[settingsMap.orderType] : "";

            newOrders.push([ `${driverId}-${maxSeq}`, 1, displayAddress, displayClient, csvType, shortDate, orderTypeVal, "", 0, lat, lng, initialStatus, 0 ]);
        }
    }

    if (newOrders.length === 0) return res.status(200).json({ success: true, message: "No valid orders found." });

    const compRef = db.collection('Companies').doc(String(companyId));
    const updatedBay = existingBay.concat(newOrders);
    let bayToSave = JSON.stringify(updatedBay);

    let updates = {
        'activeStaging.orders': bayToSave,
        'activeStaging.status': 'Pending' // Uploads always reset to Pending
    };

    if (updatedBay.length === 0) updates['lockedBy'] = null;
    else if (uId) updates['lockedBy'] = uId;

    batch.update(driverRef, updates);
    if (geocodeCallCount > 0) incrementApiUsage(batch, driverRef, compRef, 'apiUsage_Geocode', geocodeCallCount);
    
    await batch.commit();
    
    let responsePayload = { success: true, count: newOrders.length };
    if (unmatchedList.length > 0) responsePayload.unmatchedAddresses = [...new Set(unmatchedList)];
    
    return res.status(200).json(responsePayload);
}

async function resolveUnmatchedAddress(payload, res, db, admin) {
    const { driverId, companyId, originalAddress, lat, lng, correctedAddress, skip } = payload;
    if (!originalAddress || !driverId) return res.status(400).json({ error: "Missing parameters" });

    const batch = db.batch();
    const cleanOrigAddr = originalAddress.replace(/\//g, '');

    if (skip) {
        const unmatchedRef = db.collection('Unmatched').doc(cleanOrigAddr);
        batch.delete(unmatchedRef);

        const driverRef = db.collection('Users').doc(String(driverId));
        const driverDoc = await driverRef.get();
        if (driverDoc.exists) {
            let bay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
            let changed = false;
            let newBay = bay.filter(s => {
                let isTuple = Array.isArray(s);
                let sStat = isTuple ? s[11] : (s.status || s.s);
                let sAddr = isTuple ? s[2] : (s.address || s.a);
                let tupleDisplayAddr = String(sAddr).split(',')[0].trim().toLowerCase();
                
                if (sStat === 'V' && originalAddress.toLowerCase().includes(tupleDisplayAddr)) {
                    changed = true;
                    return false; 
                }
                return true;
            });
            if (changed) {
                // RE-EVALUATE STATE
                let currState = driverDoc.data().activeStaging?.status || 'Pending';
                let nextState = evaluateRouteState(newBay, currState);
                batch.update(driverRef, { 
                    'activeStaging.orders': JSON.stringify(newBay),
                    'activeStaging.status': nextState
                });
            }
        }
        await batch.commit();
        return res.status(200).json({ success: true, skipped: true });
    }

    const mapsApiKey = process.env.MAPS_API_KEY;
    let finalLat = parseFloat(lat);
    let finalLng = parseFloat(lng);
    let geocodeCallCount = 0;

    if (correctedAddress && (isNaN(finalLat) || isNaN(finalLng))) {
        let geoResult = await performGeocodingWaterfall(correctedAddress, db, mapsApiKey);
        if (geoResult) {
            finalLat = geoResult.lat;
            finalLng = geoResult.lng;
            if (!geoResult.cached) geocodeCallCount++;
        } else {
            return res.status(400).json({ error: "Address not found.", unresolvable: true });
        }
    }

    if (isNaN(finalLat) || isNaN(finalLng) || (finalLat === 0 && finalLng === 0)) {
        return res.status(400).json({ error: "Valid coordinates or a verifiable address are required." });
    }

    finalLat = Number(finalLat.toFixed(5));
    finalLng = Number(finalLng.toFixed(5));

    const cacheRef = db.collection('GeocodeCache').doc(cleanOrigAddr);
    batch.set(cacheRef, { lat: finalLat, lng: finalLng, timestamp: admin.firestore.FieldValue.serverTimestamp() });

    const unmatchedRef = db.collection('Unmatched').doc(cleanOrigAddr);
    batch.delete(unmatchedRef);

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();
    if (driverDoc.exists) {
        let bay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
        let changed = false;
        
        for (let i = 0; i < bay.length; i++) {
            let s = bay[i];
            let isTuple = Array.isArray(s);
            let sStat = isTuple ? s[11] : (s.status || s.s);
            let sAddr = isTuple ? s[2] : (s.address || s.a);
            
            let tupleDisplayAddr = String(sAddr).split(',')[0].trim().toLowerCase();
            if (sStat === 'V' && originalAddress.toLowerCase().includes(tupleDisplayAddr)) {
                if (isTuple) {
                    bay[i][9] = finalLat;
                    bay[i][10] = finalLng;
                    bay[i][11] = "P";
                } else {
                    bay[i].lat = finalLat;
                    bay[i].lng = finalLng;
                    bay[i].status = "P";
                }
                changed = true;
            }
        }
        if (changed) {
            // RE-EVALUATE STATE
            let currState = driverDoc.data().activeStaging?.status || 'Pending';
            let nextState = evaluateRouteState(bay, currState);
            batch.update(driverRef, { 
                'activeStaging.orders': JSON.stringify(bay),
                'activeStaging.status': nextState 
            });
        }
    }

    if (geocodeCallCount > 0 && companyId) {
        const compRef = db.collection('Companies').doc(String(companyId));
        incrementApiUsage(batch, driverRef, compRef, 'apiUsage_Geocode', geocodeCallCount);
    }

    await batch.commit();
    return res.status(200).json({ success: true, lat: finalLat, lng: finalLng });
}

async function updateOrder(payload, res, db) {
    const { rowId, driverId, updates, routeId } = payload;
    if (!rowId || !updates) return res.status(400).json({error: "Missing parameters"});

    if (routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(routeId));
        const dispatchDoc = await dispatchRef.get();
        if (!dispatchDoc.exists) return res.status(404).json({error: "Dispatch record not found"});

        let currentRoute = safeJsonParse(dispatchDoc.data().currentRoute, []);
        let originalRoute = safeJsonParse(dispatchDoc.data().originalRoute, []);
        let changed = false;
        let syncToMaster = false;

        for (let i = 0; i < currentRoute.length; i++) {
            let s = currentRoute[i];
            if (String(Array.isArray(s) ? s[0] : (s.rowId || s.id)) === String(rowId)) {
                if (updates.status !== undefined) {
                    let stat = String(updates.status).substring(0,1).toUpperCase();
                    if (Array.isArray(s)) currentRoute[i][11] = stat;
                    else { currentRoute[i].status = stat; currentRoute[i].s = stat; }
                    if (stat === 'C') syncToMaster = true;
                }
                if (updates.eta !== undefined) {
                    if (Array.isArray(s)) currentRoute[i][7] = updates.eta; else currentRoute[i].eta = updates.eta;
                }
                if (updates.dist !== undefined) {
                    if (Array.isArray(s)) currentRoute[i][8] = updates.dist; else currentRoute[i].dist = updates.dist;
                }
                if (updates.routeNum !== undefined) {
                    if (Array.isArray(s)) currentRoute[i][1] = updates.routeNum; else { currentRoute[i].R = updates.routeNum; currentRoute[i].routeNum = updates.routeNum; }
                }
                changed = true;
                break;
            }
        }

        if (changed) {
            let dispatchUpdates = { currentRoute: JSON.stringify(currentRoute) };
            if (syncToMaster) {
                for (let i = 0; i < originalRoute.length; i++) {
                    let s = originalRoute[i];
                    if (String(Array.isArray(s) ? s[0] : (s.rowId || s.id)) === String(rowId)) {
                        if (Array.isArray(s)) originalRoute[i][11] = 'C';
                        else { originalRoute[i].status = 'C'; originalRoute[i].s = 'C'; }
                        break;
                    }
                }
                dispatchUpdates.originalRoute = JSON.stringify(originalRoute);
            }
            await dispatchRef.update(dispatchUpdates);
            return res.status(200).json({ success: true });
        }
        return res.status(404).json({ error: "Order not found in dispatched route" });
    }

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) return res.status(404).json({error: "Driver not found"});

    let bay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
    let changed = false;

    for (let i = 0; i < bay.length; i++) {
        let s = bay[i];
        if (String(Array.isArray(s) ? s[0] : (s.rowId || s.id)) === String(rowId)) {
            if (updates.status !== undefined) {
                let stat = String(updates.status).substring(0,1).toUpperCase();
                if (Array.isArray(s)) bay[i][11] = stat; else { bay[i].status = stat; bay[i].s = stat; }
            }
            if (updates.eta !== undefined) {
                if (Array.isArray(s)) bay[i][7] = updates.eta; else bay[i].eta = updates.eta;
            }
            if (updates.dist !== undefined) {
                if (Array.isArray(s)) bay[i][8] = updates.dist; else bay[i].dist = updates.dist;
            }
            if (updates.routeNum !== undefined) {
                if (Array.isArray(s)) bay[i][1] = updates.routeNum; else { bay[i].R = updates.routeNum; bay[i].routeNum = updates.routeNum; }
            }
            changed = true;
            break;
        }
    }

    if (changed) {
        // RE-EVALUATE STATE
        let currState = driverDoc.data().activeStaging?.status || 'Pending';
        let nextState = evaluateRouteState(bay, currState);

        await driverRef.update({ 
            'activeStaging.orders': JSON.stringify(bay),
            'activeStaging.status': nextState
        });
        return res.status(200).json({ success: true });
    } else {
        return res.status(404).json({ error: "Order not found in staging bay" });
    }
}

async function updateMultipleOrders(payload, res, db) {
    const { updatesList, sharedUpdates, routeId } = payload;
    if (!updatesList || !Array.isArray(updatesList)) return res.status(400).json({error: "Missing updatesList"});

    if (routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(routeId));
        const dispatchDoc = await dispatchRef.get();
        if (!dispatchDoc.exists) return res.status(404).json({error: "Dispatch record not found"});

        let currentRoute = safeJsonParse(dispatchDoc.data().currentRoute, []);
        let originalRoute = safeJsonParse(dispatchDoc.data().originalRoute, []);
        let changed = false;
        let syncToMaster = (sharedUpdates && sharedUpdates.status && String(sharedUpdates.status).substring(0,1).toUpperCase() === 'C');

        const updateMap = new Map();
        updatesList.forEach(u => updateMap.set(String(u.rowId), u));

        for (let i = 0; i < currentRoute.length; i++) {
            let s = currentRoute[i];
            let sId = String(Array.isArray(s) ? s[0] : (s.rowId || s.id));
            if (updateMap.has(sId)) {
                if (sharedUpdates.routeNum !== undefined || sharedUpdates.cluster !== undefined) {
                    if (Array.isArray(s)) s[1] = sharedUpdates.routeNum || sharedUpdates.cluster;
                    else { s.R = sharedUpdates.routeNum || sharedUpdates.cluster; s.routeNum = sharedUpdates.routeNum || sharedUpdates.cluster; }
                }
                if (sharedUpdates.eta !== undefined) {
                    if (Array.isArray(s)) s[7] = sharedUpdates.eta; else s.eta = sharedUpdates.eta;
                }
                if (sharedUpdates.dist !== undefined) {
                    if (Array.isArray(s)) s[8] = sharedUpdates.dist; else s.dist = sharedUpdates.dist;
                }
                if (sharedUpdates.status !== undefined) {
                    let stat = String(sharedUpdates.status).substring(0,1).toUpperCase();
                    if (Array.isArray(s)) s[11] = stat; else { s.status = stat; s.s = stat; }
                }
                if (sharedUpdates.durationSecs !== undefined) {
                    if (Array.isArray(s)) s[12] = sharedUpdates.durationSecs; else s.durationSecs = sharedUpdates.durationSecs;
                }
                changed = true;
            }
        }

        if (changed) {
            let dispatchUpdates = { currentRoute: JSON.stringify(currentRoute) };
            if (syncToMaster) {
                for (let i = 0; i < originalRoute.length; i++) {
                    let s = originalRoute[i];
                    let sId = String(Array.isArray(s) ? s[0] : (s.rowId || s.id));
                    if (updateMap.has(sId)) {
                        if (Array.isArray(s)) s[11] = 'C';
                        else { s.status = 'C'; s.s = 'C'; }
                    }
                }
                dispatchUpdates.originalRoute = JSON.stringify(originalRoute);
            }
            await dispatchRef.update(dispatchUpdates);
        }
        return res.status(200).json({ success: true });
    }

    const batch = db.batch();
    const usersSnap = await db.collection('Users').get();
    let usersData = {};
    
    usersSnap.forEach(d => {
        let bay = safeJsonParse(d.data().activeStaging?.orders, []);
        usersData[d.id] = { 
            ref: d.ref, 
            bay: bay, 
            changed: false,
            currState: d.data().activeStaging?.status || 'Pending'
        };
    });

    const newDriverId = sharedUpdates && sharedUpdates.driverId ? String(sharedUpdates.driverId) : null;

    updatesList.forEach(updateReq => {
        let targetRowId = String(updateReq.rowId);
        let currentDriverId = updateReq.driverId ? String(updateReq.driverId) : null;
        let foundSourceId = null;
        let orderTuple = null;

        if (currentDriverId && usersData[currentDriverId]) {
            let idx = usersData[currentDriverId].bay.findIndex(s => String(Array.isArray(s) ? s[0] : (s.rowId || s.id)) === targetRowId);
            if (idx > -1) {
                foundSourceId = currentDriverId;
                orderTuple = usersData[currentDriverId].bay[idx];
                usersData[currentDriverId].bay.splice(idx, 1);
                usersData[currentDriverId].changed = true;
            }
        } else {
            for (let uid in usersData) {
                let idx = usersData[uid].bay.findIndex(s => String(Array.isArray(s) ? s[0] : (s.rowId || s.id)) === targetRowId);
                if (idx > -1) {
                    foundSourceId = uid;
                    orderTuple = usersData[uid].bay[idx];
                    usersData[uid].bay.splice(idx, 1);
                    usersData[uid].changed = true;
                    break;
                }
            }
        }

        if (orderTuple) {
            if (sharedUpdates) {
                if (sharedUpdates.routeNum !== undefined || sharedUpdates.cluster !== undefined) {
                    if (Array.isArray(orderTuple)) orderTuple[1] = sharedUpdates.routeNum || sharedUpdates.cluster;
                    else { orderTuple.R = sharedUpdates.routeNum || sharedUpdates.cluster; orderTuple.routeNum = sharedUpdates.routeNum || sharedUpdates.cluster; }
                }
                if (sharedUpdates.eta !== undefined) {
                    if (Array.isArray(orderTuple)) orderTuple[7] = sharedUpdates.eta; else orderTuple.eta = sharedUpdates.eta;
                }
                if (sharedUpdates.dist !== undefined) {
                    if (Array.isArray(orderTuple)) orderTuple[8] = sharedUpdates.dist; else orderTuple.dist = sharedUpdates.dist;
                }
                if (sharedUpdates.status !== undefined) {
                    let stat = String(sharedUpdates.status).substring(0,1).toUpperCase();
                    if (Array.isArray(orderTuple)) orderTuple[11] = stat; else { orderTuple.status = stat; orderTuple.s = stat; }
                }
                if (sharedUpdates.durationSecs !== undefined) {
                    if (Array.isArray(orderTuple)) orderTuple[12] = sharedUpdates.durationSecs; else orderTuple.durationSecs = sharedUpdates.durationSecs;
                }
            }

            let destDriverId = newDriverId || foundSourceId;
            if (destDriverId && usersData[destDriverId]) {
                if (destDriverId !== foundSourceId) {
                    let maxSeq = 0;
                    usersData[destDriverId].bay.forEach(s => {
                        let idStr = String(Array.isArray(s) ? s[0] : (s.rowId || s.id));
                        let parts = idStr.split('-');
                        if(parts.length === 2) {
                            let seq = parseInt(parts[1]);
                            if(!isNaN(seq) && seq > maxSeq) maxSeq = seq;
                        }
                    });
                    let newRowId = `${destDriverId}-${maxSeq + 1}`;
                    if (Array.isArray(orderTuple)) orderTuple[0] = newRowId;
                    else { orderTuple.rowId = newRowId; orderTuple.r = newRowId; orderTuple.id = newRowId; }
                }
                
                usersData[destDriverId].bay.push(orderTuple);
                usersData[destDriverId].changed = true;
            }
        }
    });

    for (let uid in usersData) {
        if (usersData[uid].changed) {
            let bayToSave = JSON.stringify(usersData[uid].bay);
            // RE-EVALUATE STATE
            let nextState = evaluateRouteState(usersData[uid].bay, usersData[uid].currState);
            
            let updates = { 
                'activeStaging.orders': bayToSave,
                'activeStaging.status': nextState
            };
            
            if (usersData[uid].bay.length === 0) {
                updates['lockedBy'] = null;
            }
            
            batch.update(usersData[uid].ref, updates);
        }
    }

    await batch.commit();
    return res.status(200).json({ success: true });
}

async function deleteMultipleOrders(payload, res, db) {
    const { rowIds, routeId } = payload;
    if (!rowIds || !Array.isArray(rowIds)) return res.status(400).json({ error: "Missing rowIds payload" });

    if (routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(routeId));
        const dispatchDoc = await dispatchRef.get();
        if (!dispatchDoc.exists) return res.status(404).json({error: "Dispatch record not found"});

        let currentRoute = safeJsonParse(dispatchDoc.data().currentRoute, []);
        let originalRoute = safeJsonParse(dispatchDoc.data().originalRoute, []);

        let newCurrent = currentRoute.filter(s => !rowIds.includes(String(Array.isArray(s) ? s[0] : (s.rowId || s.id))));
        let newOriginal = originalRoute.filter(s => !rowIds.includes(String(Array.isArray(s) ? s[0] : (s.rowId || s.id))));

        await dispatchRef.update({
            currentRoute: JSON.stringify(newCurrent),
            originalRoute: JSON.stringify(newOriginal)
        });
        
        return res.status(200).json({ success: true, deleted: currentRoute.length - newCurrent.length });
    }

    const batch = db.batch();
    const usersSnap = await db.collection('Users').get();
    let deletedCount = 0;

    usersSnap.forEach(doc => {
        let bay = safeJsonParse(doc.data().activeStaging?.orders, []);
        let originalLength = bay.length;
        
        let newBay = bay.filter(s => {
            let id = Array.isArray(s) ? s[0] : (s.rowId || s.id);
            return !rowIds.includes(String(id));
        });
        
        if (newBay.length !== originalLength) {
            let bayToSave = JSON.stringify(newBay);
            
            // RE-EVALUATE STATE
            let currState = doc.data().activeStaging?.status || 'Pending';
            let nextState = evaluateRouteState(newBay, currState);

            let updates = { 
                'activeStaging.orders': bayToSave,
                'activeStaging.status': nextState
            };
            
            if (newBay.length === 0) {
                updates['lockedBy'] = null;
            }

            batch.update(doc.ref, updates);
            deletedCount += (originalLength - newBay.length);
        }
    });
    
    await batch.commit();
    return res.status(200).json({ success: true, deleted: deletedCount });
}

module.exports = {
    uploadCsv, updateOrder, updateMultipleOrders, deleteMultipleOrders, resolveUnmatchedAddress
};
