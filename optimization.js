/**
 * optimization.js
 * VERSION: V1.44
 * * CHANGES:
 * V1.44 - Polling Restoration. Reverted the generateRoute response back to returning 
 * 'status: "queued"'. The frontend's handleGenerateRoute function strictly requires this 
 * keyword to correctly execute its polling loop and clear the "Processing..." overlay.
 * V1.43 - Clean Route Preservation & Array Merging.
 */

const { GoogleAuth } = require('google-auth-library');
const { getField, safeJsonParse, incrementApiUsage, getDistMi } = require('./helpers');

async function geocodeEndpoint(address, apiKey) {
    if (!address || !apiKey) return null;
    try {
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`);
        const data = await res.json();
        if (data.status === "OK" && data.results.length > 0) {
            return { lat: data.results[0].geometry.location.lat, lng: data.results[0].geometry.location.lng };
        }
    } catch(e) { console.error(`Endpoint Geocode Error: ${e.message}`); }
    return null;
}

async function callStandardRoutingAPI(startGeo, stopsGeo, endGeo, preserveSequence, apiKey) {
    if (!apiKey) {
        console.error("[GOOGLE MAPS REJECTION] MAPS_API_KEY environment variable is missing.");
        return null;
    }
    try {
        const waypoints = stopsGeo.map(s => `${s.lat},${s.lng}`).join('|');
        const opt = preserveSequence ? '' : 'optimize:true|';
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startGeo.lat},${startGeo.lng}&destination=${endGeo.lat},${endGeo.lng}&waypoints=${opt}${waypoints}&units=imperial&key=${apiKey}`;
        
        const res = await fetch(encodeURI(url));
        const data = await res.json();
        
        if (data.status !== "OK" || !data.routes || data.routes.length === 0) {
            console.error(`[GOOGLE MAPS REJECTION] Status: ${data.status || 'UNKNOWN'}, Error: ${data.error_message || 'No specific error message provided by Google.'}`);
            return null;
        }

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
    if (!projectId) {
        console.error("[ENTERPRISE REJECTION] GOOGLE_CLOUD_PROJECT environment variable is missing.");
        return null; 
    }
    try {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        
        const payload = {
            model: {
                shipments: stopsGeo.map((s, i) => ({ deliveries: [{ arrivalLocation: { latitude: s.lat, longitude: s.lng } }], label: i.toString() }))
            }
        };

        if (startGeo && endGeo) {
            payload.model.vehicles = [{
                startLocation: { latitude: startGeo.lat, longitude: startGeo.lng },
                endLocation: { latitude: endGeo.lat, longitude: endGeo.lng },
                label: "primary_vehicle"
            }];
        }
        
        if (preserveSequence) {
            payload.injectedFirstSolutionRoutes = [{ vehicleIndex: 0, visits: stopsGeo.map((s, i) => ({ shipmentIndex: i })) }];
        }

        const res = await fetch(`https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();

        if (data.error || !data.routes || data.routes.length === 0) {
            console.error(`[ENTERPRISE REJECTION] Error: ${JSON.stringify(data.error || data)}`);
            return null;
        }

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

    const compId = driverDoc.data().companyId;
    const compRef = db.collection('Companies').doc(String(compId));
    const compDoc = await compRef.get();
    const serviceDelay = compDoc.exists ? (parseInt(getField(compDoc.data(), ['serviceDelayMins', 'Service Delay'])) || 0) : 0;
    const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

    const mapsApiKey = process.env.MAPS_API_KEY;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;

    let sLat = parseFloat(getField(driverDoc.data(), ['Start Lat', 'startLat']));
    let sLng = parseFloat(getField(driverDoc.data(), ['Start Lng', 'startLng']));
    let eLat = parseFloat(getField(driverDoc.data(), ['End Lat', 'endLat']));
    let eLng = parseFloat(getField(driverDoc.data(), ['End Lng', 'endLng']));

    if (isNaN(sLat) || isNaN(sLng)) {
        let sAddr = payload.startAddr || getField(driverDoc.data(), ['Start Address', 'startAddress', 'start']);
        let geo = await geocodeEndpoint(sAddr, mapsApiKey);
        if (geo) { sLat = geo.lat; sLng = geo.lng; }
    }

    if (isNaN(eLat) || isNaN(eLng)) {
        let eAddr = payload.endAddr || getField(driverDoc.data(), ['End Address', 'endAddress', 'end']);
        let geo = await geocodeEndpoint(eAddr, mapsApiKey);
        if (geo) { eLat = geo.lat; eLng = geo.lng; }
    }

    let endpoints = { 
        start: { lat: isNaN(sLat) ? 32.776 : sLat, lng: isNaN(sLng) ? -96.797 : sLng }, 
        end: { lat: isNaN(eLat) ? 32.776 : eLat, lng: isNaN(eLng) ? -96.797 : eLng } 
    };

    const inputStops = payload.stops || [];
    if (inputStops.length === 0) return res.status(400).json({error: "No stops provided to optimize."});

    let recalculatedRouteIds = new Set();
    let clusters = {};
    let unroutedStops = [];

    inputStops.forEach(s => {
        let rLabel = Array.isArray(s) ? s[1] : (s.R || s.routeNum || s.cluster || 'X');
        recalculatedRouteIds.add(String(rLabel));
        
        if (String(rLabel) === 'X') {
            unroutedStops.push(s);
        } else {
            if (!clusters[rLabel]) clusters[rLabel] = [];
            clusters[rLabel].push({ orig: s, lat: parseFloat(Array.isArray(s) ? s[9] : (s.lat || s.l)), lng: parseFloat(Array.isArray(s) ? s[10] : (s.lng || s.g)) });
        }
    });

    let finalRoutedStops = [];
    let stdCalls = 0, entCalls = 0;
    
    let time = new Date(); 
    time.setHours(startHour, 0, 0, 0);

    for (let routeNum in clusters) {
        let cStops = clusters[routeNum].filter(s => s && !isNaN(s.lat) && !isNaN(s.lng));
        if (cStops.length === 0) {
            clusters[routeNum].forEach(s => unroutedStops.push(s.orig));
            continue;
        }

        const routeInput = cStops.map(s => ({ lat: s.lat, lng: s.lng }));
        let optimized = null;

        if (routeInput.length <= 25) {
            optimized = await callStandardRoutingAPI(endpoints.start, routeInput, endpoints.end, false, mapsApiKey);
            if (optimized) stdCalls++;
        } else {
            optimized = await callEnterpriseRoutingAPI(endpoints.start, routeInput, endpoints.end, false, projectId);
            if (optimized) entCalls += routeInput.length;
        }

        if (!optimized) {
            console.error(`[OPTIMIZATION FAILED] Google API returned null for Route ${routeNum}`);
            return res.status(500).json({ error: "Routing APIs failed to return a sequence. Please check your Google Cloud API keys and Environment Variables." });
        }

        optimized.forEach((visit) => {
            let s = cStops[visit.index].orig;
            time = new Date(time.getTime() + (visit.durationSecs * 1000));
            let etaTimeOnly = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
            time = new Date(time.getTime() + (serviceDelay * 60 * 1000));

            let numDist = Number(parseFloat(visit.distance).toFixed(1));
            let isTuple = Array.isArray(s);
            
            finalRoutedStops.push([
                isTuple ? s[0] : (s.rowId || s.r), parseInt(routeNum), 
                isTuple ? s[2] : (s.address || s.a), isTuple ? s[3] : (s.client || s.c), 
                isTuple ? s[4] : (s.app || s.p), isTuple ? s[5] : (s.dueDate || s.d), 
                isTuple ? s[6] : (s.type || s.t), etaTimeOnly, numDist, 
                isTuple ? s[9] : (s.lat || s.l), isTuple ? s[10] : (s.lng || s.g), "R", visit.durationSecs
            ]);
        });
        
        time.setDate(time.getDate() + 1);
        time.setHours(startHour, 0, 0, 0);
    }

    let cleanedUnrouted = unroutedStops.map(s => {
        let isTuple = Array.isArray(s);
        let sId = isTuple ? s[0] : (s.rowId || s.r);
        return [
            sId, 'X', 
            isTuple ? s[2] : (s.address || s.a), isTuple ? s[3] : (s.client || s.c), 
            isTuple ? s[4] : (s.app || s.p), isTuple ? s[5] : (s.dueDate || s.d), 
            isTuple ? s[6] : (s.type || s.t), "", 0, 
            isTuple ? s[9] : (s.lat || s.l), isTuple ? s[10] : (s.lng || s.g), "P", 0
        ];
    });

    let existingBay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
    let preservedStops = existingBay.filter(s => {
        let sRoute = String(Array.isArray(s) ? s[1] : (s.R || s.routeNum || s.cluster || 1));
        return !recalculatedRouteIds.has(sRoute);
    });

    let finalBay = preservedStops.concat(finalRoutedStops).concat(cleanedUnrouted);
    
    let hasRouted = finalBay.some(s => {
        let stat = Array.isArray(s) ? s[11] : (s.status || s.s);
        return String(stat).trim() === 'R';
    });
    let nextState = hasRouted ? 'Ready' : 'Pending';

    const batch = db.batch();
    batch.update(driverRef, { 
        'activeStaging.orders': JSON.stringify(finalBay), 
        'activeStaging.status': nextState 
    });
    
    if (stdCalls > 0) incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
    if (entCalls > 0) incrementApiUsage(batch, driverRef, compRef, 'apiUsage_EnterpriseRouting', entCalls);
    
    await batch.commit();

    let routingMethod = entCalls > 0 ? `Enterprise Route Optimization API (${entCalls} calls)` : `Standard Directions API (${stdCalls} calls)`;

    // V1.44 FIX: Restored status: 'queued' so the frontend polling loop resolves.
    return res.status(200).json({ 
        success: true, 
        status: 'queued',
        processUsed: routingMethod,
        backendVersion: 'V1.44'
    });
}

async function calculate(payload, res, db) {
    const driverRef = db.collection('Users').doc(String(payload.driverId));
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

    const compId = driverDoc.data().companyId;
    const compRef = db.collection('Companies').doc(String(compId));
    const compDoc = await compRef.get();
    
    const serviceDelay = compDoc.exists ? (parseInt(getField(compDoc.data(), ['serviceDelayMins', 'Service Delay'])) || 0) : 0;
    let rawExact = getField(compDoc.data(), ['useExactApi', 'Use Exact API']);
    const useExactApi = rawExact === undefined ? false : (String(rawExact).toUpperCase() === 'TRUE' || rawExact === true);
    const startHour = payload.startTime ? parseInt(payload.startTime.split(':')[0]) : 8;

    const mapsApiKey = process.env.MAPS_API_KEY;

    let sLat = parseFloat(getField(driverDoc.data(), ['Start Lat', 'startLat']));
    let sLng = parseFloat(getField(driverDoc.data(), ['Start Lng', 'startLng']));
    let eLat = parseFloat(getField(driverDoc.data(), ['End Lat', 'endLat']));
    let eLng = parseFloat(getField(driverDoc.data(), ['End Lng', 'endLng']));

    if (isNaN(sLat) || isNaN(sLng)) {
        let sAddr = payload.startAddr || getField(driverDoc.data(), ['Start Address', 'startAddress', 'start']);
        let geo = await geocodeEndpoint(sAddr, mapsApiKey);
        if (geo) { sLat = geo.lat; sLng = geo.lng; }
    }

    if (isNaN(eLat) || isNaN(eLng)) {
        let eAddr = payload.endAddr || getField(driverDoc.data(), ['End Address', 'endAddress', 'end']);
        let geo = await geocodeEndpoint(eAddr, mapsApiKey);
        if (geo) { eLat = geo.lat; eLng = geo.lng; }
    }

    let endpoints = { 
        start: { lat: isNaN(sLat) ? 32.776 : sLat, lng: isNaN(sLng) ? -96.797 : sLng }, 
        end: { lat: isNaN(eLat) ? 32.776 : eLat, lng: isNaN(eLng) ? -96.797 : eLng } 
    };

    const inputStops = payload.stops || [];
    if (inputStops.length === 0) return res.status(400).json({error: "No stops provided to calculate."});

    let recalculatedRouteIds = new Set();
    let clusters = {};
    let unroutedStops = [];

    inputStops.forEach(s => {
        let rLabel = Array.isArray(s) ? s[1] : (s.R || s.routeNum || s.cluster || 'X');
        recalculatedRouteIds.add(String(rLabel));

        if (String(rLabel) === 'X') {
            unroutedStops.push(s);
        } else {
            if (!clusters[rLabel]) clusters[rLabel] = [];
            clusters[rLabel].push({ orig: s, lat: parseFloat(Array.isArray(s) ? s[9] : (s.lat || s.l)), lng: parseFloat(Array.isArray(s) ? s[10] : (s.lng || s.g)) });
        }
    });

    let finalRoutedStops = [];
    let stdCalls = 0;

    let baseTime = new Date(); 
    baseTime.setHours(startHour, 0, 0, 0);

    for (let routeNum in clusters) {
        let routeStops = clusters[routeNum].filter(s => s && !isNaN(s.lat) && !isNaN(s.lng));
        if (routeStops.length === 0) {
            clusters[routeNum].forEach(s => unroutedStops.push(s.orig));
            continue;
        }

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

        if (useExactApi && !apiSuccess) {
            console.error(`[CALCULATE FAILED] Standard API Exact Match failed for Route ${routeNum}`);
            return res.status(500).json({ error: "Routing APIs failed to calculate sequence. Please check your Maps API Key." });
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

            finalRoutedStops.push([
                isTuple ? s[0] : (s.rowId || s.r), parseInt(routeNum), 
                isTuple ? s[2] : (s.address || s.a), isTuple ? s[3] : (s.client || s.c), 
                isTuple ? s[4] : (s.app || s.p), isTuple ? s[5] : (s.dueDate || s.d), 
                isTuple ? s[6] : (s.type || s.t), etaTimeOnly, numDist, 
                isTuple ? s[9] : (s.lat || s.l), isTuple ? s[10] : (s.lng || s.g), "R", res.durationSecs
            ]);
        });
        
        baseTime.setDate(baseTime.getDate() + 1);
        baseTime.setHours(startHour, 0, 0, 0);
    }

    let cleanedUnrouted = unroutedStops.map(s => {
        let isTuple = Array.isArray(s);
        let sId = isTuple ? s[0] : (s.rowId || s.r);
        return [
            sId, 'X', 
            isTuple ? s[2] : (s.address || s.a), isTuple ? s[3] : (s.client || s.c), 
            isTuple ? s[4] : (s.app || s.p), isTuple ? s[5] : (s.dueDate || s.d), 
            isTuple ? s[6] : (s.type || s.t), "", 0, 
            isTuple ? s[9] : (s.lat || s.l), isTuple ? s[10] : (s.lng || s.g), "P", 0
        ];
    });

    let existingBay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
    let preservedStops = existingBay.filter(s => {
        let sRoute = String(Array.isArray(s) ? s[1] : (s.R || s.routeNum || s.cluster || 1));
        return !recalculatedRouteIds.has(sRoute);
    });

    let finalBay = preservedStops.concat(finalRoutedStops).concat(cleanedUnrouted);
    
    let hasRouted = finalBay.some(s => {
        let stat = Array.isArray(s) ? s[11] : (s.status || s.s);
        return String(stat).trim() === 'R';
    });
    let nextState = hasRouted ? 'Ready' : 'Pending';

    const batch = db.batch();
    batch.update(driverRef, { 
        'activeStaging.orders': JSON.stringify(finalBay), 
        'activeStaging.status': nextState 
    });
    
    if (stdCalls > 0) incrementApiUsage(batch, driverRef, compRef, 'apiUsage_StandardRouting', stdCalls);
    
    await batch.commit();

    let calcMethod = useExactApi ? `Standard Directions API - Exact Match (${stdCalls} chunk(s))` : `Local Math (Haversine Formula)`;

    return res.status(200).json({ 
        success: true, 
        updatedStops: finalBay,
        processUsed: calcMethod,
        backendVersion: 'V1.44'
    });
}

module.exports = { generateRoute, calculate };
