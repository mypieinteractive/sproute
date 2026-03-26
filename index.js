/**
 * SPROUTE BACKEND - NODE.JS CLOUD FUNCTION
 * VERSION: V1.19
 * * CHANGES:
 * V1.19 - Deep Schema Alignment. Removed flat-field and stringified JSON logic. 
 * Updated all extractors and update methods to traverse the actual nested NoSQL 
 * schema (e.g., `settings.accountType`, `roles.isInspector`, `defaultEndpoints.start`, 
 * and `activeStaging.orders`). Updated nested field mutations using dot-notation.
 * V1.18 - Schema Alignment (Deprecated).
 * V1.17 - Payload Parity & Query Expansion.
 * V1.16 - Schema Extractor Update.
 * V1.15 - Payload Parity Fix.
 * V1.14 - GET / Initialization Overhaul. 
 * V1.13 - Phase 1 CRUD Migration. 
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
app.use(express.json());

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

        // Resolve Company ID via Users collection if missing
        if (!resolvedCompanyId) {
            let lookupId = adminId || driverId; 
            if (lookupId) {
                const userDoc = await db.collection('Users').doc(String(lookupId)).get();
                if (userDoc.exists) {
                    resolvedCompanyId = userDoc.data().companyId;
                }
            }
        }

        if (!resolvedCompanyId) {
            return res.status(400).json({ error: "Could not resolve Company ID from provided parameters." });
        }

        // Fetch Company Data
        const compRef = db.collection('Companies').doc(String(resolvedCompanyId));
        const compDoc = await compRef.get();
        let companyData = compDoc.exists ? compDoc.data() : {};

        let accountType = companyData.settings?.accountType || "Company";
        let displayName = companyData.name || "Dashboard";
        let permissions = { 
            modify: companyData.permissions?.modifyRoutes ?? true, 
            reoptimize: companyData.permissions?.reoptimize ?? true 
        };
        let companyEmail = companyData.email || "";
        let defaultEmailMessage = companyData.settings?.defaultEmailMessage || "";
        let serviceDelay = parseInt(companyData.settings?.serviceDelayMins || 0);
        let companyAddress = companyData.address || "";
        let companyLogo = companyData.logoUrl || "";
        let ccCompanyDefault = companyData.settings?.ccCompanyDefault !== false;

        // Fetch Users Data
        const usersSnap = await db.collection('Users').where('companyId', '==', String(resolvedCompanyId)).get();
        
        const inspectors = [];
        let globalRouteStart = null, globalRouteEnd = null, globalRouteState = 'Pending', foundDriverName = '';
        
        usersSnap.forEach(doc => {
            const uData = doc.data();
            const isInsp = uData.roles?.isInspector === true;
            
            let startAddr = uData.defaultEndpoints?.start?.address || "";
            let startLat = uData.defaultEndpoints?.start?.lat || null;
            let startLng = uData.defaultEndpoints?.start?.lng || null;

            let endAddr = uData.defaultEndpoints?.end?.address || "";
            let endLat = uData.defaultEndpoints?.end?.lat || null;
            let endLng = uData.defaultEndpoints?.end?.lng || null;
            
            const driverName = uData.name || "Inspector";
            const driverEmail = uData.email || "";
            const stagingBay = uData.activeStaging?.orders || [];
            const rState = uData.activeStaging?.status || 'Pending';

            // Push ALL users into the inspectors dictionary to retain color coding for Edge Cases, 
            // but pass the isInspector flag so app.js can filter them out of the UI dropdowns
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
                    if (uData.defaultEndpoints) {
                        globalRouteStart = uData.defaultEndpoints.start || null;
                        globalRouteEnd = uData.defaultEndpoints.end || null;
                    }
                }
            }
        });

        // Fetch CSV Settings (Using exact schema fields)
        const csvSettingsSnap = await db.collection('CSV_Settings').where('companyId', '==', String(resolvedCompanyId)).get();
        const csvTypes = [];
        csvSettingsSnap.forEach(doc => {
            if (doc.data().csvType) csvTypes.push(doc.data().csvType);
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
            if (adminDoc.exists && adminDoc.data().email) {
                responseObj.adminEmail = adminDoc.data().email;
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
        const action = payload.action;

        // --- 1. CSV INGESTION ENGINE ---
        if (action === 'uploadCsv') {
            const { csvData, driverId, companyId, type, adminId, overrideLock } = payload;
            if (!csvData || !driverId || !companyId || !type) return res.status(400).json({ error: "Missing required upload parameters." });

            const settingsSnapshot = await db.collection('CSV_Settings').where('companyId', '==', String(companyId)).where('csvType', '==', String(type)).limit(1).get();
            if (settingsSnapshot.empty) return res.status(404).json({ error: `CSV Settings not found for Type: '${type}'` });
            
            const settings = settingsSnapshot.docs[0].data().mappingArray || []; 

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: `Driver ID ${driverId} not found.` });

            const currentLock = driverDoc.data().lockedBy || "";
            const uId = String(adminId || "").trim();

            if (!overrideLock && currentLock !== "" && currentLock !== uId) {
                return res.status(200).json({ success: false, status: 'confirm_hijack', driverId: driverId });
            }

            const existingBay = driverDoc.data().activeStaging?.orders || [];
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
                let street = colIdx(settings[2]) > -1 ? row[colIdx(settings[2])] : "";
                let city = colIdx(settings[9]) > -1 ? row[colIdx(settings[9])] : "";
                let state = colIdx(settings[10]) > -1 ? row[colIdx(settings[10])] : fallbackState;
                let zip = colIdx(settings[3]) > -1 ? row[colIdx(settings[3])] : "";

                if (street) {
                    let fullAddr = `${street}, ${city}, ${state} ${zip}`.replace(/,,/g, ",").trim();
                    let csvLatRaw = colIdx(settings[7]) > -1 ? row[colIdx(settings[7])] : "";
                    let csvLngRaw = colIdx(settings[8]) > -1 ? row[colIdx(settings[8])] : "";
                    
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
                    let clientVal = row[colIdx(settings[4])] || "", displayClient = String(clientVal).substring(0, 3);
                    let dueDateRaw = row[colIdx(settings[5])] || "", shortDate = dueDateRaw ? String(dueDateRaw).substring(0,8) : "";
                    let orderTypeVal = row[colIdx(settings[6])] || "";

                    newOrders.push([ `${driverId}-${maxSeq}`, 1, displayAddress, displayClient, type, shortDate, orderTypeVal, "", 0, lat, lng, initialStatus, 0 ]);
                }
            }

            if (newOrders.length === 0) return res.status(200).json({ success: true, message: "No valid orders found." });

            const batch = db.batch();
            const compRef = db.collection('Companies').doc(String(companyId));
            
            const updatedBay = existingBay.concat(newOrders);

            batch.update(driverRef, {
                'activeStaging.orders': updatedBay,
                'activeStaging.status': 'Pending',
                'lockedBy': uId
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_Geocode', geocodeCallCount);
            
            await batch.commit();
            return res.status(200).json({ success: true, count: newOrders.length });
        }

        // --- 2. OPTIMIZATION ENGINE (generateRoute) ---
        if (action === 'generateRoute') {
            const driverRef = db.collection('Users').doc(String(payload.driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

            const compId = driverDoc.data().companyId;
            const compRef = db.collection('Companies').doc(String(compId));
            const compDoc = await compRef.get();
            const serviceDelay = compDoc.exists ? (parseInt(compDoc.data().settings?.serviceDelayMins) || 0) : 0;
            const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

            let stagingBay = driverDoc.data().activeStaging?.orders || [];
            let endpoints = driverDoc.data().defaultEndpoints || { start: { lat: 32.776, lng: -96.797 }, end: { lat: 32.776, lng: -96.797 } };
            
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
            batch.update(driverRef, { 
                'activeStaging.orders': finalStops, 
                'activeStaging.status': 'Ready' 
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_EnterpriseRouting', entCalls);
            
            await batch.commit();
            return res.status(200).json({ success: true, updatedStops: finalStops });
        }

        // --- 3. RECALCULATION ENGINE (calculate) ---
        if (action === 'calculate') {
            const driverRef = db.collection('Users').doc(String(payload.driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

            const compId = driverDoc.data().companyId;
            const compRef = db.collection('Companies').doc(String(compId));
            const compDoc = await compRef.get();
            
            const serviceDelay = compDoc.exists ? (parseInt(compDoc.data().settings?.serviceDelayMins) || 0) : 0;
            const useExactApi = compDoc.exists ? (compDoc.data().settings?.useExactApi === true) : false;
            const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

            let stagingBay = driverDoc.data().activeStaging?.orders || [];
            let endpoints = driverDoc.data().defaultEndpoints || { start: { lat: 32.776, lng: -96.797 }, end: { lat: 32.776, lng: -96.797 } };
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
            batch.update(driverRef, { 
                'activeStaging.orders': finalStops, 
                'activeStaging.status': 'Ready' 
            });
            incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
            
            await batch.commit();
            return res.status(200).json({ success: true, updatedStops: finalStops });
        }

        // --- 4. PRE-ROUTE STAGING & CRUD (Phase 1) ---

        if (action === 'updateOrder') {
            const { rowId, driverId, updates } = payload;
            if (!rowId || !driverId || !updates) return res.status(400).json({error: "Missing parameters"});

            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) return res.status(404).json({error: "Driver not found"});

            let bay = driverDoc.data().activeStaging?.orders || [];
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
                await driverRef.update({ 'activeStaging.orders': bay });
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
                usersData[d.id] = { ref: d.ref, bay: d.data().activeStaging?.orders || [], changed: false };
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
                    batch.update(usersData[uid].ref, { 'activeStaging.orders': usersData[uid].bay });
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
                let bay = doc.data().activeStaging?.orders || [];
                let originalLength = bay.length;
                
                let newBay = bay.filter(s => {
                    let id = Array.isArray(s) ? s[0] : (s.rowId || s.id);
                    return !rowIds.includes(String(id));
                });
                
                if (newBay.length !== originalLength) {
                    batch.update(doc.ref, { 'activeStaging.orders': newBay });
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
    console.log(`[SERVER BOOT] Sproute Backend (V1.19) listening on port ${port}`);
});
