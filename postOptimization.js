/**
 * postOptimization.js
 * VERSION: V1.45
 * * CHANGES:
 * V1.45 - Asynchronous Queue Claim Check. Rewrote dispatchRoute to calculate 
 * legacy route statistics (Total Orders, Routes, Due Dates). It now saves the heavy 
 * Base64 image and JSON Array to Firestore, and pushes a microscopic "claim check" 
 * payload containing the UI stats to the Google Apps Script Webhook for zero-lag logging.
 * V1.44 - Google Apps Script Dispatch Integration. 
 */

const { getField, safeJsonParse } = require('./helpers');

const GAS_DISPATCH_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxqvQCesYcHzJ9ps9YR7LM9st7gptSARmLXI10gYmAdpkgSXQFCBqrPsVNwA4PjTIZW/exec';

async function saveRoute(payload, res, db) {
    if (!payload.stops) return res.status(400).json({ error: "Missing stops." });
    
    if (payload.routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(payload.routeId));
        const dispatchDoc = await dispatchRef.get();
        if (dispatchDoc.exists) {
            await dispatchRef.update({ currentRoute: JSON.stringify(payload.stops) });
            return res.status(200).json({ success: true });
        }
    } else if (payload.driverId) {
        const driverRef = db.collection('Users').doc(String(payload.driverId));
        const driverDoc = await driverRef.get();
        if (driverDoc.exists) {
            let existingBay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
            let preservedPending = existingBay.filter(s => {
                let stat = String(Array.isArray(s) ? s[11] : (s.status || s.s)).trim().toUpperCase();
                return stat === 'P' || stat === 'V';
            });
            let finalBay = payload.stops.concat(preservedPending);

            await driverRef.update({ 
                'activeStaging.orders': JSON.stringify(finalBay)
            });
            return res.status(200).json({ success: true });
        }
    }
    return res.status(404).json({ error: "Target Route/Driver not found." });
}

async function recreateOrders(payload, res, db) {
    const ordersToRestore = payload.orders || [];
    if (ordersToRestore.length === 0) return res.status(400).json({ error: "No orders provided to recreate." });

    const minifyOrder = (o) => {
        let stat = o.status ? String(o.status).substring(0,1).toUpperCase() : "P";
        return [
            o.rowId || o.id || "", o.cluster || o.routeNum || 1, o.address || "", o.client || "",
            o.app || "", o.dueDate || "", o.type || "", o.eta || "", parseFloat(o.dist) || 0,
            parseFloat(o.lat) || 0, parseFloat(o.lng) || 0, stat, parseInt(o.durationSecs) || 0
        ];
    };

    if (payload.routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(payload.routeId));
        const dispatchDoc = await dispatchRef.get();
        
        if (dispatchDoc.exists) {
            let sandboxArr = safeJsonParse(dispatchDoc.data().currentRoute, []);
            ordersToRestore.forEach(o => sandboxArr.push(minifyOrder(o)));
            
            let originalArr = safeJsonParse(dispatchDoc.data().originalRoute, []);
            ordersToRestore.forEach(o => {
                let exists = originalArr.find(stop => String(Array.isArray(stop) ? stop[0] : stop.rowId) === String(o.rowId || o.id));
                if (!exists) originalArr.push(minifyOrder(o));
            });
            
            await dispatchRef.update({ 
                currentRoute: JSON.stringify(sandboxArr), originalRoute: JSON.stringify(originalArr)
            });
            return res.status(200).json({ success: true });
        }
    } else if (payload.driverId) {
        const driverRef = db.collection('Users').doc(String(payload.driverId));
        const driverDoc = await driverRef.get();
        
        if (driverDoc.exists) {
            let stagingArr = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
            ordersToRestore.forEach(o => stagingArr.push(minifyOrder(o)));
            
            let stateToSave = payload.routeState || 'Staging';
            await driverRef.update({ 
                'activeStaging.orders': JSON.stringify(stagingArr), 'activeStaging.status': stateToSave
            });
            return res.status(200).json({ success: true });
        }
    }
    return res.status(404).json({ error: "Target Route/Driver not found for undo action." });
}

async function restoreOriginalRoute(payload, res, db) {
    if (payload.routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(payload.routeId));
        const dispatchDoc = await dispatchRef.get();
        
        if (dispatchDoc.exists) {
            const origJson = dispatchDoc.data().originalRoute || "[]";
            await dispatchRef.update({ currentRoute: origJson });
            return res.status(200).json({ success: true });
        }
        return res.status(404).json({ error: "Route ID not found to restore." });
    }
    return res.status(400).json({ error: "Missing Route ID." });
}

async function resetRoute(payload, res, db) {
    const driverId = payload.driverId;
    if (!driverId) return res.status(400).json({ error: "Missing driverId" });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();
    
    if (driverDoc.exists) {
        let stopsArray = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
        let resurrectedTuples = [];
        
        if (stopsArray.length > 0) {
            stopsArray.forEach(s => {
                let isTuple = Array.isArray(s);
                resurrectedTuples.push([
                    isTuple ? s[0] : (s.rowId || s.r || ""), 1, 
                    isTuple ? s[2] : (s.address || s.a || ""), isTuple ? s[3] : (s.client || s.c || ""), 
                    isTuple ? s[4] : (s.app || s.p || ""), isTuple ? s[5] : (s.dueDate || s.d || ""), 
                    isTuple ? s[6] : (s.type || s.t || ""), "", 0, 
                    isTuple ? s[9] : (s.lat || s.l || 0), isTuple ? s[10] : (s.lng || s.g || 0), "P", 0
                ]);
            });
        }
        
        await driverRef.update({ 
            'activeStaging.orders': JSON.stringify(resurrectedTuples),
            'activeStaging.status': 'Pending' 
        });
        return res.status(200).json({ success: true });
    }
    return res.status(404).json({ error: "Driver not found" });
}

async function dispatchRoute(payload, res, db, admin) {
    const driverRef = db.collection('Users').doc(String(payload.driverId));
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found for dispatch." });
    
    const driverData = driverDoc.data();
    const stagingJsonStr = driverData.activeStaging?.orders || "[]";
    let stagingJson = safeJsonParse(stagingJsonStr, []);
    
    if (stagingJson.length === 0) return res.status(400).json({ error: "No orders found to dispatch." });

    // --- Legacy Stats Calculation for the UI ---
    let totalOrders = stagingJson.length;
    let r1Stops = 0, r2Stops = 0, r3Stops = 0, dueToday = 0, pastDue = 0;
    
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
    const [{ value: mo }, , { value: da }, , { value: ye }] = formatter.formatToParts(new Date());
    const todayMs = new Date(`${ye}-${mo}-${da}T00:00:00`).getTime(); 

    stagingJson.forEach(s => {
        let rLabel = String(Array.isArray(s) ? s[1] : (s.R || s.routeNum || 1));
        let dDate = Array.isArray(s) ? s[5] : (s.d || s.dueDate);
        
        if (rLabel.includes('1')) r1Stops++;
        else if (rLabel.includes('2')) r2Stops++;
        else if (rLabel.includes('3')) r3Stops++;
        
        if (dDate) {
            let dueTimeMs = new Date(`${dDate}T00:00:00`).getTime();
            if (dueTimeMs < todayMs) pastDue++; 
            else if (dueTimeMs === todayMs) dueToday++;
        }
    });
    // ------------------------------------------

    const routeId = new Date().getTime().toString();
    const dashboardLink = `https://mypieinteractive.github.io/prospect-dashboard/?id=${routeId}`;
    const dispatchRef = db.collection('Dispatch').doc(routeId);
    
    // Save Heavy Payload to Firestore
    await dispatchRef.set({
        routeId: routeId,
        driverId: payload.driverId || "",
        companyId: payload.companyId || "",
        currentRoute: stagingJsonStr,
        originalRoute: stagingJsonStr,
        mapBase64: payload.mapBase64 || "",
        customBody: payload.customBody || "",
        ccCompany: payload.ccCompany || false,
        addCc: payload.addCc || "",
        ccEmail: payload.ccEmail || "",
        endpointsObj: driverData.endpoints || {},
        dashboardLink: dashboardLink,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send Microscopic "Claim Check" to GAS Webhook
    const gasPayload = {
        action: 'queueDispatch',
        routeId: routeId,
        driverId: payload.driverId,
        companyId: payload.companyId,
        customBody: payload.customBody,
        ccCompany: payload.ccCompany,
        addCc: payload.addCc,
        ccEmail: payload.ccEmail,
        dashboardLink: dashboardLink,
        totalOrders, r1Stops, r2Stops, r3Stops, dueToday, pastDue
    };

    try {
        const gasResponse = await fetch(GAS_DISPATCH_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gasPayload)
        });

        const gasResult = await gasResponse.json();
        if (!gasResult.success) {
            return res.status(500).json({ error: "Failed to queue dispatch email: " + (gasResult.error || "Unknown error") });
        }
    } catch (error) {
        return res.status(500).json({ error: "Network error when attempting to queue email." });
    }

    await driverRef.update({
        lockedBy: null,
        'activeStaging.orders': '[]',
        'activeStaging.status': null
    });

    return res.status(200).json({ success: true, routeId: routeId });
}

module.exports = {
    saveRoute, recreateOrders, restoreOriginalRoute, resetRoute, dispatchRoute
};
