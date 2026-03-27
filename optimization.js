const { GoogleAuth } = require('google-auth-library');
const { getField, safeJsonParse, incrementApiUsage, getDistMi } = require('./helpers');

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

async function generateRoute(payload, res, db) {
    const driverRef = db.collection('Users').doc(String(payload.driverId));
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

    const compId = getField(driverDoc.data(), ['Company ID', 'companyId']);
    const compRef = db.collection('Companies').doc(String(compId));
    const compDoc = await compRef.get();
    const serviceDelay = compDoc.exists ? (parseInt(getField(compDoc.data(), ['serviceDelayMins', 'Service Delay'])) || 0) : 0;
    const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

    let stagingBay = [];
    if (driverDoc.data().activeStaging?.orders) {
        stagingBay = safeJsonParse(driverDoc.data().activeStaging.orders, []);
    }
    
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
    let bayToSave = JSON.stringify(finalStops);

    batch.update(driverRef, { 
        'activeStaging.orders': bayToSave, 
        'activeStaging.status': 'Ready' 
    });
    incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
    incrementApiUsage(batch, driverRef, compRef, 'apiUsage_EnterpriseRouting', entCalls);
    
    await batch.commit();
    return res.status(200).json({ success: true, updatedStops: finalStops });
}

async function calculate(payload, res, db) {
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

    let stagingBay = [];
    if (driverDoc.data().activeStaging?.orders) {
        stagingBay = safeJsonParse(driverDoc.data().activeStaging.orders, []);
    }

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
    let bayToSave = JSON.stringify(finalStops);

    batch.update(driverRef, { 
        'activeStaging.orders': bayToSave, 
        'activeStaging.status': 'Ready' 
    });
    incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
    
    await batch.commit();
    return res.status(200).json({ success: true, updatedStops: finalStops });
}

module.exports = { generateRoute, calculate };
