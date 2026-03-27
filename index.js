/**
 * SPROUTE BACKEND - NODE.JS CLOUD FUNCTION
 * VERSION: V1.27
 * * CHANGES:
 * V1.27 - Relaxed JSON Parsing. Updated `express.json({ type: '*/*' })` to parse all 
 * incoming requests as JSON regardless of the Content-Type header. This allows the 
 * backend to natively accept the `text/plain` webhook payloads sent from the frontend 
 * without requiring any CORS-breaking changes to `app.js`.
 * V1.26 - Payload Variable Alignment.
 * V1.25 - Expanded Webhook Auto-Detection. 
 */

const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { parse } = require('csv-parse/sync');
const { GoogleAuth } = require('google-auth-library');

// Explicitly bind to the Project ID from the environment
const firebaseApp = admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT
});

// Explicitly target the named database
const db = getFirestore(firebaseApp, 'sproute');

const app = express();

// Parse all incoming payloads as JSON to accept text/plain from the frontend
app.use(express.json({ type: '*/*' }));

app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    next();
});

// --- HELPER FUNCTIONS ---
function getDistMi(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function colIdx(c) {
    if (!c || c === "(None)" || c === "") return -1;
    let idx = 0;
    for (let i = 0; i < c.length; i++) idx = idx * 26 + (c.charCodeAt(i) - 64);
    return idx - 1;
}

function incrementApiUsage(batch, driverRef, compRef, field, count) {
    if (count <= 0) return;
    batch.update(driverRef, { [field]: admin.firestore.FieldValue.increment(count) });
    batch.update(compRef, { [field]: admin.firestore.FieldValue.increment(count) });
}

function getField(data, keys) {
    for (let k of keys) {
        if (data[k] !== undefined) return data[k];
    }
    return undefined;
}

function safeJsonParse(dataStr, fallback = []) {
    if (!dataStr) return fallback;
    if (typeof dataStr === 'object') return dataStr;
    try {
        return JSON.parse(dataStr);
    } catch (e) {
        return fallback;
    }
}

function parseCoordsString(coordsStr) {
    if (!coordsStr || typeof coordsStr !== 'string') return null;
    let parts = coordsStr.split(',');
    if (parts.length >= 2) {
        let lat = parseFloat(parts[0].trim());
        let lng = parseFloat(parts[1].trim());
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    return null;
}

function formatStopForManager(obj, driverId, companyId, routeState) {
    let sId = Array.isArray(obj) ? obj[0] : (obj.r || obj.rowId);
    let sLat = Array.isArray(obj) ? obj[9] : (obj.l || obj.lat || obj[5]);
    let sLng = Array.isArray(obj) ? obj[10] : (obj.g || obj.lng || obj[6]);
    let sStat = Array.isArray(obj) ? obj[11] : (obj.s || obj.status || obj[7]);
    let sAddr = Array.isArray(obj) ? obj[2] : (obj.address || obj.a || obj[0]);
    let sClient = Array.isArray(obj) ? obj[3] : (obj.client || obj.c || obj[1]);
    let sApp = Array.isArray(obj) ? obj[4] : (obj.app || obj.p || obj[2]);
    let sDue = Array.isArray(obj) ? obj[5] : (obj.dueDate || obj.d || obj[3]);
    let sType = Array.isArray(obj) ? obj[6] : (obj.type || obj.t || obj[4]);

    return {
        rowId: sId, lat: sLat, lng: sLng, status: sStat,
        address: sAddr, client: sClient, app: sApp, dueDate: sDue, type: sType,
        driverId: driverId, companyId: companyId,
        routeState: routeState, routeTargetId: driverId,
        rawTuple: Array.isArray(obj) ? obj : null
    };
}

async function callStandardRoutingAPI(startGeo, stopsGeo, endGeo, preserveSequence, apiKey) {
    try {
        const waypoints = stopsGeo.map(s => `${s.lat},${s.lng}`).join('|');
        const opt = preserveSequence ? '' : 'optimize:true|';
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startGeo.lat},${startGeo.lng}&destination=${endGeo.lat},${endGeo.lng}&waypoints=${opt}${waypoints}&units=imperial&key=${apiKey}`;
        
        const res = await fetch(encodeURI(url));
        const data = await res.json();
        
        if (data.status !== "OK" || !data.routes || data.routes.length === 0) return null;
        const waypointOrder = (data.routes[0].waypoint_order && data.routes[0].waypoint_order.length > 0) ? data.routes[0].waypoint_order : stopsGeo.map((_, i) => i);
        
        return waypointOrder.map((origIdx, i) => ({
            index: origIdx,
            distance: ((data.routes[0].legs[i].distance.value || 0) * 0.000621371).toFixed(1) + " mi",
            durationSecs: data.routes[0].legs[i].duration.value
        }));
    } catch (e) {
        console.error(`Standard API Error: ${e.message}`);
        return null;
    }
}

async function callEnterpriseRoutingAPI(startGeo, stopsGeo, endGeo, preserveSequence, projectId) {
    try {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        
        const payload = {
            model: {
                shipments: stopsGeo.map((s, i) => ({ deliveries: [{ arrivalLocation: { latitude: s.lat, longitude: s.lng } }], label: i.toString() })),
                vehicles: [{
                    startLocation: { latitude: startGeo.lat, longitude: startGeo.lng },
                    endLocation: { latitude: endGeo.lat, longitude: endGeo.lng },
                    label: "primary_vehicle"
                }]
            }
        };
        
        if (preserveSequence) {
            payload.injectedFirstSolutionRoutes = [{ vehicleIndex: 0, visits: stopsGeo.map((s, i) => ({ shipmentIndex: i })) }];
        }

        const res = await fetch(`https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.error || !data.routes || data.routes.length === 0) return null;

        return data.routes[0].visits.map((v, i) => ({
            index: parseInt(v.shipmentLabel),
            distance: ((data.routes[0].transitions[i]?.travelDistanceMeters || 0) * 0.000621371).toFixed(1) + " mi",
            durationSecs: parseFloat((data.routes[0].transitions[i]?.travelDuration || "0s").replace('s', ''))
        }));
    } catch (e) {
        console.error(`Enterprise API Error: ${e.message}`);
        return null;
    }
}

// ==========================================
// ENDPOINT: DASHBOARD INITIALIZATION (GET)
// ==========================================
app.get('/', async (req, res) => {
    try {
        let explicitCompanyId = req.query.companyId || req.query.company;
        if (Array.isArray(explicitCompanyId)) explicitCompanyId = explicitCompanyId[0];
        
        const driverId = req.query.driverId || req.query.driver;
        const adminId = req.query.adminId || req.query.admin;
        const isManager = req.query.isManager === 'true';
        
        let resolvedCompanyId = explicitCompanyId ? String(explicitCompanyId).trim() : null;
        let activeStops = [];

        if (!resolvedCompanyId) {
            let lookupId = adminId || driverId; 
            if (lookupId) {
                const userDoc = await db.collection('Users').doc(String(lookupId)).get();
                if (userDoc.exists) {
                    resolvedCompanyId = getField(userDoc.data(), ['Company ID', 'companyId', 'CompanyId']);
                }
            }
        }

        if (!resolvedCompanyId) {
            return res.status(400).json({ error: "Could not resolve Company ID from provided parameters." });
        }

        let compDoc = null;
        let companyData = {};
        
        const compRef = db.collection('Companies').doc(String(resolvedCompanyId));
        let directDoc = await compRef.get();
        
        if (directDoc.exists) {
            compDoc = directDoc;
        } else {
            const compQuery = await db.collection('Companies').where('Company ID', '==', String(resolvedCompanyId)).limit(1).get();
            if (!compQuery.empty) {
                compDoc = compQuery.docs[0];
            } else {
                const compQuery2 = await db.collection('Companies').where('Row ID', '==', String(resolvedCompanyId)).limit(1).get();
                if (!compQuery2.empty) compDoc = compQuery2.docs[0];
            }
        }

        if (compDoc && compDoc.exists) {
            companyData = compDoc.data();
        }

        let rawAccountType = String(companyData['Subscription Status'] || companyData['Account Type'] || companyData.accountType || "Individual").trim();
        let accountType = rawAccountType.charAt(0).toUpperCase() + rawAccountType.slice(1).toLowerCase();
        let displayName = String(companyData.name || companyData['Company Name'] || "Dashboard").trim();
        
        let permissions = { modify: true, reoptimize: true }; 
        if (companyData.useExactApi !== undefined) permissions.useExactApi = companyData.useExactApi;
        
        let companyEmail = companyData.email || companyData['Company Email'] || "";
        let defaultEmailMessage = companyData.defaultEmailMessage || companyData['Default Email Message'] || "";
        let serviceDelay = parseInt(companyData.serviceDelayMins || companyData['Service Delay']) || 0;
        let companyAddress = companyData.address || companyData['Company Address'] || "";
        let companyLogo = companyData.logoUrl || companyData['Company Logo'] || "";
        
        let rawCc = companyData.ccCompanyDefault;
        let ccCompanyDefault = rawCc === undefined ? false : (String(rawCc).toLowerCase() === 'true' || rawCc === true);

        let queryField = companyData['Company ID'] !== undefined ? 'Company ID' : 'companyId';
        const usersSnap = await db.collection('Users').where(queryField, '==', String(resolvedCompanyId)).get();
        
        const inspectors = [];
        let globalRouteStart = null, globalRouteEnd = null, globalRouteState = 'Pending', foundDriverName = '';
        
        usersSnap.forEach(doc => {
            const uData = doc.data();
            
            const rawIsInsp = getField(uData, ['Is Inspector', 'isInspector', 'IsInspector']);
            const isInsp = rawIsInsp === true || String(rawIsInsp).toLowerCase() === 'true';
            
            let startAddr = getField(uData, ['Start Address', 'startAddress']) || "";
            let startLat = getField(uData, ['Start Lat', 'startLat']) || null;
            let startLng = getField(uData, ['Start Lng', 'startLng']) || null;

            let endAddr = getField(uData, ['End Address', 'endAddress']) || "";
            let endLat = getField(uData, ['End Lat', 'endLat']) || null;
            let endLng = getField(uData, ['End Lng', 'endLng']) || null;
            
            const driverName = getField(uData, ['Name', 'name']) || "Inspector";
            const driverEmail = getField(uData, ['Email', 'email']) || "";
            
            let rawBay = getField(uData, ['JSON', 'stagingBay', 'Staging Bay']);
            let stagingBay = [];
            if (rawBay) stagingBay = safeJsonParse(rawBay, []);
            else if (uData.activeStaging?.orders) stagingBay = uData.activeStaging.orders;
            
            let rState = getField(uData, ['Route State', 'routeState', 'Status']);
            if (rState === undefined) rState = uData.activeStaging?.status || 'Pending';

            inspectors.push({ 
                id: doc.id, name: driverName, email: driverEmail, isInspector: isInsp,
                startAddress: startAddr, startLat: startLat, startLng: startLng,
                endAddress: endAddr, endLat: endLat, endLng: endLng
            });

            if (isManager) {
                stagingBay.forEach(stopTuple => {
                    activeStops.push(formatStopForManager(stopTuple, doc.id, resolvedCompanyId, rState));
                });
            } else {
                if (driverId && doc.id === String(driverId)) {
                    activeStops = stagingBay;
                    globalRouteState = rState;
                    foundDriverName = driverName;
                    
                    globalRouteStart = null;
                    globalRouteEnd = null;
                    
                    if (startAddr || (startLat && startLng)) {
                        globalRouteStart = { address: startAddr, lat: startLat, lng: startLng };
                    }
                    if (endAddr || (endLat && endLng)) {
                        globalRouteEnd = { address: endAddr, lat: endLat, lng: endLng };
                    }
                }
            }
        });

        let csvSettingsSnap = await db.collection('CSV_Settings').where(queryField, '==', String(resolvedCompanyId)).get();
        if (csvSettingsSnap.empty && queryField === 'Company ID') {
            csvSettingsSnap = await db.collection('CSV_Settings').where('companyId', '==', String(resolvedCompanyId)).get();
        }

        const csvTypes = [];
        csvSettingsSnap.forEach(doc => {
            let t = doc.data().csvType || doc.data().Type || doc.data().type;
            if (t) csvTypes.push(t);
        });

        const responseObj = {
            stops: activeStops,
            routeStart: globalRouteStart || null,
            routeEnd: globalRouteEnd || null,
            inspectors: inspectors,
            serviceDelay: serviceDelay,
            companyLogo: companyLogo,
            tier: accountType,
            companyAddress: companyAddress,
            companyEmail: companyEmail,
            defaultEmailMessage: defaultEmailMessage,
            permissions: permissions,
            displayName: displayName,
            adminEmail: "",
            csvTypes: csvTypes,
            accountType: accountType,
            ccCompanyDefault: ccCompanyDefault
        };
        
        if (!isManager && driverId) {
            responseObj.routeState = globalRouteState;
            responseObj.driverId = driverId;
            if (foundDriverName) responseObj.driverName = foundDriverName;
        }

        if (adminId) {
            const adminDoc = await db.collection('Users').doc(String(adminId)).get();
            if (adminDoc.exists) {
                let aEmail = getField(adminDoc.data(), ['Email', 'email']);
                if (aEmail) responseObj.adminEmail = aEmail;
            }
        }

        return res.status(200).json(responseObj);

    } catch (error) {
        console.error(`[GET INIT ERROR] ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ENDPOINT: WEBHOOK ACTIONS (POST)
// ==========================================
app.post('/', async (req, res) => {
    try {
        const payload = req.body;
        let action = payload.action;

        if (!action) {
            if (payload._collection === "Users" && payload.driverId) {
                action = 'updateUserFromGlide';
            } else if (payload._collection === "Companies" && payload.companyId) {
                action = 'updateCompanyFromGlide';
            } else if (payload._collection === "CSV_Settings" && payload.rowId) {
                action = 'updateCsvSettingsFromGlide';
            }
        }

        // --- 1. GLIDE WEBHOOK INGESTION (USERS) ---
        if (action === 'updateUserFromGlide') {
            const { driverId, companyId, name, email, startAddress, endAddress, startCoords, endCoords, isInspector, modifyRoutes, reoptimize } = payload;
            if (!driverId) return res.status(400).json({ error: "Missing driverId." });

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();

            let sGeo = parseCoordsString(startCoords);
            let eGeo = parseCoordsString(endCoords);

            if (!driverDoc.exists) {
                const newUser = {
                    'Company ID': companyId || "",
                    'Name': name || "New User",
                    'Email': email || "",
                    'Is Inspector': isInspector === true,
                    'Start Address': startAddress || "",
                    'End Address': endAddress || "",
                    'Start Lat': sGeo ? sGeo.lat : null,
                    'Start Lng': sGeo ? sGeo.lng : null,
                    'End Lat': eGeo ? eGeo.lat : null,
                    'End Lng': eGeo ? eGeo.lng : null,
                    'JSON': "[]",
                    'Route State': "Pending"
                };
                await driverRef.set(newUser);
            } else {
                let updates = {};
                
                if (name !== undefined) updates['Name'] = name;
                if (email !== undefined) updates['Email'] = email;
                if (companyId !== undefined) updates['Company ID'] = companyId;
                if (isInspector !== undefined) updates['Is Inspector'] = isInspector === true;

                if (startAddress !== undefined) updates['Start Address'] = startAddress;
                if (sGeo) {
                    updates['Start Lat'] = sGeo.lat;
                    updates['Start Lng'] = sGeo.lng;
                }

                if (endAddress !== undefined) updates['End Address'] = endAddress;
                if (eGeo) {
                    updates['End Lat'] = eGeo.lat;
                    updates['End Lng'] = eGeo.lng;
                }

                if (Object.keys(updates).length > 0) {
                    await driverRef.update(updates);
                }
            }
            return res.status(200).json({ success: true });
        }

        // --- 2. GLIDE WEBHOOK INGESTION (COMPANIES) ---
        if (action === 'updateCompanyFromGlide') {
            const { companyId, name, address, email, logoUrl, startHour, serviceDelayMins, defaultEmailMessage, ccCompanyDefault, useExactApi } = payload;
            const subStatus = payload['Subscription Status'];
            
            if (!companyId) return res.status(400).json({ error: "Missing companyId." });

            const compRef = db.collection('Companies').doc(String(companyId));
            
            let updates = {};
            if (name !== undefined) updates.name = name;
            if (address !== undefined) updates.address = address;
            if (email !== undefined) updates.email = email;
            if (logoUrl !== undefined) updates.logoUrl = logoUrl;
            if (startHour !== undefined) updates.startHour = startHour;
            if (serviceDelayMins !== undefined) updates.serviceDelayMins = serviceDelayMins;
            if (defaultEmailMessage !== undefined) updates.defaultEmailMessage = defaultEmailMessage;
            if (ccCompanyDefault !== undefined) updates.ccCompanyDefault = ccCompanyDefault;
            if (useExactApi !== undefined) updates.useExactApi = useExactApi;
            if (subStatus !== undefined) updates['Subscription Status'] = subStatus;
            
            updates['Company ID'] = companyId;
            updates.companyId = companyId;

            await compRef.set(updates, { merge: true });
            return res.status(200).json({ success: true });
        }

        // --- 3. GLIDE WEBHOOK INGESTION (CSV SETTINGS) ---
        if (action === 'updateCsvSettingsFromGlide') {
            const { rowId, companyId, csvType, address, zip, client, dueDate, orderType, lat, lng, city, state } = payload;
            
            if (!rowId) return res.status(400).json({ error: "Missing rowId." });

            const csvRef = db.collection('CSV_Settings').doc(String(rowId));
            
            let updates = {};
            if (csvType !== undefined) updates.csvType = csvType;
            if (address !== undefined) updates.address = address;
            if (zip !== undefined) updates.zip = zip;
            if (client !== undefined) updates.client = client;
            if (dueDate !== undefined) updates.dueDate = dueDate;
            if (orderType !== undefined) updates.orderType = orderType;
            if (lat !== undefined) updates.lat = lat;
            if (lng !== undefined) updates.lng = lng;
            if (city !== undefined) updates.city = city;
            if (state !== undefined) updates.state = state;
            
            updates['Row ID'] = rowId;
            updates.rowId = rowId;
            
            if (companyId) {
                updates['Company ID'] = companyId;
                updates.companyId = companyId;
            }

            await csvRef.set(updates, { merge: true });
            return res.status(200).json({ success: true });
        }

        // --- 4. DASHBOARD UI ENDPOINT UPDATE ---
        if (action === 'updateEndpoint') {
            const { driverId, type, address, lat, lng } = payload;
            if (!driverId || !type) return res.status(400).json({ error: "Missing parameters." });

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

            let pLat = parseFloat(lat);
            let pLng = parseFloat(lng);
            let pAddr = address || "";

            let updates = {};
            if (type === 'start') {
                updates['Start Address'] = pAddr;
                updates['Start Lat'] = pLat;
                updates['Start Lng'] = pLng;
            } else {
                updates['End Address'] = pAddr;
                updates['End Lat'] = pLat;
                updates['End Lng'] = pLng;
            }

            await driverRef.update(updates);
            return res.status(200).json({ success: true, endpoint: { lat: pLat, lng: pLng, address: pAddr } });
        }

        // --- 5. CSV INGESTION ENGINE ---
        if (action === 'uploadCsv') {
            const { csvData, driverId, companyId, csvType, adminId, overrideLock } = payload;
            if (!csvData || !driverId || !companyId || !csvType) return res.status(400).json({ error: "Missing required upload parameters." });

            let settingsSnapshot = await db.collection('CSV_Settings').where('Company ID', '==', String(companyId)).where('csvType', '==', String(csvType)).limit(1).get();
            if (settingsSnapshot.empty) {
                settingsSnapshot = await db.collection('CSV_Settings').where('companyId', '==', String(companyId)).where('csvType', '==', String(csvType)).limit(1).get();
            }
            if (settingsSnapshot.empty) {
                settingsSnapshot = await db.collection('CSV_Settings').where('Company ID', '==', String(companyId)).where('Type', '==', String(csvType)).limit(1).get();
            }
            if (settingsSnapshot.empty) return res.status(404).json({ error: `CSV Settings not found for Type: '${csvType}'` });
            
            const sData = settingsSnapshot.docs[0].data();
            
            const settingsMap = {
                address: colIdx(sData.address),
                city: colIdx(sData.city),
                state: colIdx(sData.state),
                zip: colIdx(sData.zip),
                client: colIdx(sData.client),
                dueDate: colIdx(sData.dueDate),
                orderType: colIdx(sData.orderType),
                lat: colIdx(sData.lat),
                lng: colIdx(sData.lng)
            };

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: `Driver ID ${driverId} not found.` });

            const currentLock = getField(driverDoc.data(), ['Locked By', 'lockedBy']) || "";
            const uId = String(adminId || "").trim();

            if (!overrideLock && currentLock !== "" && currentLock !== uId) {
                return res.status(200).json({ success: false, status: 'confirm_hijack', driverId: driverId });
            }

            const rawBay = getField(driverDoc.data(), ['JSON', 'stagingBay']) || [];
            let existingBay = [];
            if (rawBay) existingBay = safeJsonParse(rawBay, []);
            else if (driverDoc.data().activeStaging?.orders) existingBay = driverDoc.data().activeStaging.orders;
            
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
            
            let newOrders = [], geocodeCallCount = 0;

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
                    if (hasCsvCoords) {
                        lat = parsedCsvLat; lng = parsedCsvLng;
                    } else {
                        const cacheRef = db.collection('GeocodeCache').doc(fullAddr.replace(/\//g, ''));
                        const cacheDoc = await cacheRef.get();

                        if (cacheDoc.exists) {
                            lat = cacheDoc.data().lat; lng = cacheDoc.data().lng;
                        } else if (mapsApiKey) {
                            const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddr)}&key=${mapsApiKey}`);
                            const geoData = await geoRes.json();
                            geocodeCallCount++;
                            if (geoData.status === "OK" && geoData.results.length > 0) {
                                lat = geoData.results[0].geometry.location.lat; lng = geoData.results[0].geometry.location.lng;
                                await cacheRef.set({ lat: lat, lng: lng, timestamp: admin.firestore.FieldValue.serverTimestamp() });
                            }
                        }
                    }

                    let initialStatus = (!lat || !lng || (lat === 32.776 && lng === -96.797)) ? "V" : "P"; 
                    if (initialStatus === "V") { lat = 32.776; lng = -96.797; } 
                    else { lat = Number(parseFloat(lat).toFixed(5)); lng = Number(parseFloat(lng).toFixed(5)); }

                    maxSeq++;
                    let displayAddress = street.split(',')[0].trim(); if (zip) displayAddress += ", " + zip.trim();
                    let clientVal = settingsMap.client > -1 ? row[settingsMap.client] : "";
                    let displayClient = String(clientVal).substring(0, 3);
                    let dueDateRaw = settingsMap.dueDate > -1 ? row[settingsMap.dueDate] : "";
                    let shortDate = dueDateRaw ? String(dueDateRaw).substring(0,8) : "";
                    let orderTypeVal = settingsMap.orderType > -1 ? row[settingsMap.orderType] : "";

                    newOrders.push([ `${driverId}-${maxSeq}`, 1, displayAddress, displayClient, csvType, shortDate, orderTypeVal, "", 0, lat, lng, initialStatus, 0 ]);
                }
            }

            if (newOrders.length === 0) return res.status(200).json({ success: true, message: "No valid orders found." });

            const batch = db.batch();
            const compRef = db.collection('Companies').doc(String(companyId));
            
            const updatedBay = existingBay.concat(newOrders);
            
            let jsonFieldKey = driverDoc.data().JSON !== undefined ? 'JSON' : (driverDoc.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
            let rStateFieldKey = driverDoc.data()['Route State'] !== undefined ? 'Route State' : (driverDoc.data().activeStaging ? 'activeStaging.status' : 'routeState');
            let lockedFieldKey = driverDoc.data()['Locked By'] !== undefined ? 'Locked By' : 'lockedBy';

            let bayToSave = jsonFieldKey === 'JSON' ? JSON.stringify(updatedBay) : updatedBay;

            batch.update(driverRef, {
                [jsonFieldKey]: bayToSave,
                [rStateFieldKey]: 'Pending',
                [lockedFieldKey]: uId
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_Geocode', geocodeCallCount);
            
            await batch.commit();
            return res.status(200).json({ success: true, count: newOrders.length });
        }

        // --- 6. OPTIMIZATION ENGINE (generateRoute) ---
        if (action === 'generateRoute') {
            const driverRef = db.collection('Users').doc(String(payload.driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

            const compId = getField(driverDoc.data(), ['Company ID', 'companyId']);
            const compRef = db.collection('Companies').doc(String(compId));
            const compDoc = await compRef.get();
            const serviceDelay = compDoc.exists ? (parseInt(getField(compDoc.data(), ['serviceDelayMins', 'Service Delay'])) || 0) : 0;
            const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

            const rawBay = getField(driverDoc.data(), ['JSON', 'stagingBay']) || [];
            let stagingBay = [];
            if (rawBay) stagingBay = safeJsonParse(rawBay, []);
            else if (driverDoc.data().activeStaging?.orders) stagingBay = driverDoc.data().activeStaging.orders;
            
            let endpoints = { start: { lat: 32.776, lng: -96.797 }, end: { lat: 32.776, lng: -96.797 } };
            let sLat = getField(driverDoc.data(), ['Start Lat', 'startLat']);
            let sLng = getField(driverDoc.data(), ['Start Lng', 'startLng']);
            let eLat = getField(driverDoc.data(), ['End Lat', 'endLat']);
            let eLng = getField(driverDoc.data(), ['End Lng', 'endLng']);
            
            if (sLat && sLng) endpoints.start = { lat: sLat, lng: sLng };
            if (eLat && eLng) endpoints.end = { lat: eLat, lng: eLng };
            
            let clusters = {};
            stagingBay.forEach(s => {
                let rLabel = Array.isArray(s) ? s[1] : (s.R || s.routeNum || 1);
                if (!clusters[rLabel]) clusters[rLabel] = [];
                clusters[rLabel].push({ orig: s, lat: parseFloat(Array.isArray(s) ? s[9] : s.lat), lng: parseFloat(Array.isArray(s) ? s[10] : s.lng) });
            });

            let finalStops = [];
            let stdCalls = 0, entCalls = 0;
            const mapsApiKey = process.env.MAPS_API_KEY;
            const projectId = process.env.GOOGLE_CLOUD_PROJECT;

            for (let routeNum in clusters) {
                let cStops = clusters[routeNum].filter(s => s && s.lat && s.lng);
                if (cStops.length === 0) continue;

                const routeInput = cStops.map(s => ({ lat: s.lat, lng: s.lng }));
                let optimized = null;
                let time = new Date(); time.setHours(startHour, 0, 0, 0);

                if (routeInput.length <= 25) {
                    optimized = await callStandardRoutingAPI(endpoints.start, routeInput, endpoints.end, false, mapsApiKey);
                    if (optimized) stdCalls++;
                } else {
                    optimized = await callEnterpriseRoutingAPI(endpoints.start, routeInput, endpoints.end, false, projectId);
                    if (optimized) entCalls += routeInput.length;
                }

                if (optimized) {
                    optimized.forEach((visit) => {
                        let s = cStops[visit.index].orig;
                        time = new Date(time.getTime() + (visit.durationSecs * 1000));
                        let etaTimeOnly = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
                        time = new Date(time.getTime() + (serviceDelay * 60 * 1000));

                        let numDist = Number(parseFloat(visit.distance).toFixed(1));
                        let isTuple = Array.isArray(s);
                        finalStops.push([
                            isTuple ? s[0] : (s.rowId || s.r), parseInt(routeNum), 
                            isTuple ? s[2] : s.address, isTuple ? s[3] : s.client, 
                            isTuple ? s[4] : s.app, isTuple ? s[5] : s.dueDate, 
                            isTuple ? s[6] : s.type, etaTimeOnly, numDist, 
                            isTuple ? s[9] : s.lat, isTuple ? s[10] : s.lng, "R", visit.durationSecs
                        ]);
                    });
                } else {
                    cStops.forEach(s => finalStops.push(s.orig));
                }
            }

            const batch = db.batch();
            let jsonFieldKey = driverDoc.data().JSON !== undefined ? 'JSON' : (driverDoc.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
            let rStateFieldKey = driverDoc.data()['Route State'] !== undefined ? 'Route State' : (driverDoc.data().activeStaging ? 'activeStaging.status' : 'routeState');

            let bayToSave = jsonFieldKey === 'JSON' ? JSON.stringify(finalStops) : finalStops;

            batch.update(driverRef, { 
                [jsonFieldKey]: bayToSave, 
                [rStateFieldKey]: 'Ready' 
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_EnterpriseRouting', entCalls);
            
            await batch.commit();
            return res.status(200).json({ success: true, updatedStops: finalStops });
        }

        // --- 7. RECALCULATION ENGINE (calculate) ---
        if (action === 'calculate') {
            const driverRef = db.collection('Users').doc(String(payload.driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

            const compId = getField(driverDoc.data(), ['Company ID', 'companyId']);
            const compRef = db.collection('Companies').doc(String(compId));
            const compDoc = await compRef.get();
            
            const serviceDelay = compDoc.exists ? (parseInt(getField(compDoc.data(), ['serviceDelayMins', 'Service Delay'])) || 0) : 0;
            
            let rawExact = getField(compDoc.data(), ['useExactApi', 'Use Exact API']);
            const useExactApi = rawExact === undefined ? false : (String(rawExact).toUpperCase() === 'TRUE' || rawExact === true);
            const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

            const rawBay = getField(driverDoc.data(), ['JSON', 'stagingBay']) || [];
            let stagingBay = [];
            if (rawBay) stagingBay = safeJsonParse(rawBay, []);
            else if (driverDoc.data().activeStaging?.orders) stagingBay = driverDoc.data().activeStaging.orders;

            let endpoints = { start: { lat: 32.776, lng: -96.797 }, end: { lat: 32.776, lng: -96.797 } };
            let sLat = getField(driverDoc.data(), ['Start Lat', 'startLat']);
            let sLng = getField(driverDoc.data(), ['Start Lng', 'startLng']);
            let eLat = getField(driverDoc.data(), ['End Lat', 'endLat']);
            let eLng = getField(driverDoc.data(), ['End Lng', 'endLng']);
            
            if (sLat && sLng) endpoints.start = { lat: sLat, lng: sLng };
            if (eLat && eLng) endpoints.end = { lat: eLat, lng: eLng };

            const mapsApiKey = process.env.MAPS_API_KEY;

            let clusters = {};
            stagingBay.forEach(s => {
                let rLabel = Array.isArray(s) ? s[1] : (s.R || s.routeNum || 1);
                if (!clusters[rLabel]) clusters[rLabel] = [];
                clusters[rLabel].push({ orig: s, lat: parseFloat(Array.isArray(s) ? s[9] : s.lat), lng: parseFloat(Array.isArray(s) ? s[10] : s.lng) });
            });

            let finalStops = [];
            let stdCalls = 0;

            for (let routeNum in clusters) {
                let routeStops = clusters[routeNum].filter(s => s && s.lat && s.lng);
                if (routeStops.length === 0) continue;

                let baseTime = new Date(); baseTime.setHours(startHour, 0, 0, 0);
                let finalResults = [];
                let apiSuccess = false;

                if (useExactApi) {
                    apiSuccess = true;
                    let currentStart = endpoints.start;
                    let chunkSize = 25;

                    for (let i = 0; i < routeStops.length; i += chunkSize) {
                        let chunkStops = routeStops.slice(i, i + chunkSize);
                        let currentEnd = (i + chunkSize < routeStops.length) ? routeStops[i + chunkSize] : endpoints.end;
                        
                        let chunkOptimized = await callStandardRoutingAPI(currentStart, chunkStops, currentEnd, true, mapsApiKey);
                        if (!chunkOptimized) { apiSuccess = false; break; }

                        stdCalls++;
                        finalResults = finalResults.concat(chunkOptimized);
                        currentStart = chunkStops[chunkStops.length - 1]; 
                    }
                }

                if (!useExactApi || !apiSuccess) {
                    finalResults = [];
                    let prevGeo = endpoints.start;
                    for (let i = 0; i < routeStops.length; i++) {
                        let d = getDistMi(prevGeo.lat, prevGeo.lng, routeStops[i].lat, routeStops[i].lng);
                        finalResults.push({ distance: d.toFixed(1) + " mi", durationSecs: (d / 25) * 3600 });
                        prevGeo = routeStops[i];
                    }
                }

                finalResults.forEach((res, i) => {
                    baseTime = new Date(baseTime.getTime() + (res.durationSecs * 1000));
                    let etaTimeOnly = baseTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
                    baseTime = new Date(baseTime.getTime() + (serviceDelay * 60 * 1000));

                    let s = routeStops[i].orig;
                    let numDist = Number(parseFloat(res.distance).toFixed(1));
                    let isTuple = Array.isArray(s);

                    finalStops.push([
                        isTuple ? s[0] : (s.rowId || s.r), parseInt(routeNum), 
                        isTuple ? s[2] : s.address, isTuple ? s[3] : s.client, 
                        isTuple ? s[4] : s.app, isTuple ? s[5] : s.dueDate, 
                        isTuple ? s[6] : s.type, etaTimeOnly, numDist, 
                        isTuple ? s[9] : s.lat, isTuple ? s[10] : s.lng, "R", res.durationSecs
                    ]);
                });
            }

            const batch = db.batch();
            let jsonFieldKey = driverDoc.data().JSON !== undefined ? 'JSON' : (driverDoc.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
            let rStateFieldKey = driverDoc.data()['Route State'] !== undefined ? 'Route State' : (driverDoc.data().activeStaging ? 'activeStaging.status' : 'routeState');

            let bayToSave = jsonFieldKey === 'JSON' ? JSON.stringify(finalStops) : finalStops;

            batch.update(driverRef, { 
                [jsonFieldKey]: bayToSave, 
                [rStateFieldKey]: 'Ready' 
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
            
            await batch.commit();
            return res.status(200).json({ success: true, updatedStops: finalStops });
        }

        // --- 8. PRE-ROUTE STAGING & CRUD (Phase 1) ---

        if (action === 'updateOrder') {
            const { rowId, driverId, updates } = payload;
            if (!rowId || !driverId || !updates) return res.status(400).json({error: "Missing parameters"});

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({error: "Driver not found"});

            const rawBay = getField(driverDoc.data(), ['JSON', 'stagingBay']) || [];
            let bay = [];
            if (rawBay) bay = safeJsonParse(rawBay, []);
            else if (driverDoc.data().activeStaging?.orders) bay = driverDoc.data().activeStaging.orders;
            
            let changed = false;

            for (let i = 0; i < bay.length; i++) {
                let s = bay[i];
                if (String(Array.isArray(s) ? s[0] : s.rowId) === String(rowId)) {
                    if (updates.status !== undefined) bay[i][11] = updates.status;
                    if (updates.eta !== undefined) bay[i][7] = updates.eta;
                    if (updates.dist !== undefined) bay[i][8] = updates.dist;
                    if (updates.routeNum !== undefined) bay[i][1] = updates.routeNum;
                    changed = true;
                    break;
                }
            }

            if (changed) {
                let jsonFieldKey = driverDoc.data().JSON !== undefined ? 'JSON' : (driverDoc.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
                let bayToSave = jsonFieldKey === 'JSON' ? JSON.stringify(bay) : bay;
                await driverRef.update({ [jsonFieldKey]: bayToSave });
                return res.status(200).json({ success: true });
            } else {
                return res.status(404).json({ error: "Order not found in staging bay" });
            }
        }

        if (action === 'updateMultipleOrders') {
            const { updatesList, sharedUpdates } = payload;
            if (!updatesList || !Array.isArray(updatesList)) return res.status(400).json({error: "Missing updatesList"});

            const batch = db.batch();
            const usersSnap = await db.collection('Users').get();
            let usersData = {};
            
            usersSnap.forEach(d => {
                let rawBay = getField(d.data(), ['JSON', 'stagingBay']);
                let bay = [];
                let jsonFieldKey = d.data().JSON !== undefined ? 'JSON' : (d.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
                
                if (rawBay) bay = safeJsonParse(rawBay, []);
                else if (d.data().activeStaging?.orders) bay = d.data().activeStaging.orders;
                
                usersData[d.id] = { ref: d.ref, bay: bay, changed: false, fieldKey: jsonFieldKey };
            });

            const newDriverId = sharedUpdates && sharedUpdates.driverId ? String(sharedUpdates.driverId) : null;

            updatesList.forEach(updateReq => {
                let targetRowId = String(updateReq.rowId);
                let currentDriverId = updateReq.driverId ? String(updateReq.driverId) : null;

                let foundSourceId = null;
                let orderTuple = null;

                if (currentDriverId && usersData[currentDriverId]) {
                    let idx = usersData[currentDriverId].bay.findIndex(s => String(Array.isArray(s) ? s[0] : s.rowId) === targetRowId);
                    if (idx > -1) {
                        foundSourceId = currentDriverId;
                        orderTuple = usersData[currentDriverId].bay[idx];
                        usersData[currentDriverId].bay.splice(idx, 1);
                        usersData[currentDriverId].changed = true;
                    }
                } else {
                    for (let uid in usersData) {
                        let idx = usersData[uid].bay.findIndex(s => String(Array.isArray(s) ? s[0] : s.rowId) === targetRowId);
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
                        if (sharedUpdates.routeNum !== undefined || sharedUpdates.cluster !== undefined) orderTuple[1] = sharedUpdates.routeNum || sharedUpdates.cluster;
                        if (sharedUpdates.eta !== undefined) orderTuple[7] = sharedUpdates.eta;
                        if (sharedUpdates.dist !== undefined) orderTuple[8] = sharedUpdates.dist;
                        if (sharedUpdates.status !== undefined) orderTuple[11] = sharedUpdates.status;
                        if (sharedUpdates.durationSecs !== undefined) orderTuple[12] = sharedUpdates.durationSecs;
                    }

                    let destDriverId = newDriverId || foundSourceId;
                    if (destDriverId && usersData[destDriverId]) {
                        usersData[destDriverId].bay.push(orderTuple);
                        usersData[destDriverId].changed = true;
                    }
                }
            });

            for (let uid in usersData) {
                if (usersData[uid].changed) {
                    let bayToSave = usersData[uid].fieldKey === 'JSON' ? JSON.stringify(usersData[uid].bay) : usersData[uid].bay;
                    batch.update(usersData[uid].ref, { [usersData[uid].fieldKey]: bayToSave });
                }
            }

            await batch.commit();
            return res.status(200).json({ success: true });
        }

        if (action === 'deleteMultipleOrders') {
            const { rowIds } = payload;
            if (!rowIds || !Array.isArray(rowIds)) return res.status(400).json({ error: "Missing rowIds payload" });

            const batch = db.batch();
            const usersSnap = await db.collection('Users').get();
            let deletedCount = 0;

            usersSnap.forEach(doc => {
                let rawBay = getField(doc.data(), ['JSON', 'stagingBay']);
                let bay = [];
                let jsonFieldKey = doc.data().JSON !== undefined ? 'JSON' : (doc.data().activeStaging ? 'activeStaging.orders' : 'stagingBay');
                
                if (rawBay) bay = safeJsonParse(rawBay, []);
                else if (doc.data().activeStaging?.orders) bay = doc.data().activeStaging.orders;
                
                let originalLength = bay.length;
                
                let newBay = bay.filter(s => {
                    let id = Array.isArray(s) ? s[0] : (s.rowId || s.id);
                    return !rowIds.includes(String(id));
                });
                
                if (newBay.length !== originalLength) {
                    let bayToSave = jsonFieldKey === 'JSON' ? JSON.stringify(newBay) : newBay;
                    batch.update(doc.ref, { [jsonFieldKey]: bayToSave });
                    deletedCount += (originalLength - newBay.length);
                }
            });
            
            await batch.commit();
            return res.status(200).json({ success: true, deleted: deletedCount });
        }

        return res.status(400).json({ error: "Invalid action provided." });

    } catch (error) {
        console.error(`[POST ERROR] ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

app.all('*', (req, res) => {
    res.status(405).json({ error: 'Method Not Allowed' });
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => {
    console.log(`[SERVER BOOT] Sproute Backend (V1.27) listening on port ${port}`);
});
