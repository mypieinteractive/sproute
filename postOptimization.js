/**
 * postOptimization.js
 * VERSION: V1.1
 * * CHANGES:
 * V1.1 - Removed environment variable fallback for the dashboard URL, hardcoding 
 * the static GitHub Pages URL directly into the dispatchRoute function.
 * V1.0 - Initial creation. Migrated the final five POST actions from Apps Script. 
 */

const { safeJsonParse } = require('./helpers');

// --- HELPER: Evaluate State ---
function evaluateRouteState(arr, currState) {
    if (!arr || arr.length === 0) return "Pending";
    const hasRouted = arr.some(s => {
        let stat = Array.isArray(s) ? s[11] : (s.status || s.s);
        return String(stat).trim() === 'R';
    });
    if (!hasRouted) return "Pending";
    return currState === "Ready" ? "Staging" : currState;
}

// --- HELPER: Minify Order for Undo ---
function minifyOrder(o) {
    let stat = o.status ? String(o.status).substring(0,1).toUpperCase() : "P";
    return [
        o.rowId || o.id || "",
        o.cluster === 'X' ? 'X' : (o.cluster || o.routeNum || 0) + 1,
        o.address || "",
        o.client || "",
        o.app || "",
        o.dueDate || "",
        o.type || "",
        o.eta || "",
        parseFloat(o.dist) || 0,
        parseFloat(o.lat) || 0,
        parseFloat(o.lng) || 0,
        stat,
        parseInt(o.durationSecs) || 0
    ];
}

// --- 1. SAVE ROUTE (Manual Drag & Drop Sync) ---
async function saveRoute(payload, res, db) {
    const { driverId, routeId, stops, routeState } = payload;
    if (!stops) return res.status(400).json({ error: "Missing stops array." });

    if (routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(routeId));
        const dispatchDoc = await dispatchRef.get();
        if (dispatchDoc.exists) {
            await dispatchRef.update({ currentRoute: JSON.stringify(stops) });
            return res.status(200).json({ success: true });
        }
    } else if (driverId) {
        const driverRef = db.collection('Users').doc(String(driverId));
        const driverDoc = await driverRef.get();
        if (driverDoc.exists) {
            let nextStat = evaluateRouteState(stops, routeState || 'Pending');
            await driverRef.update({
                'activeStaging.orders': JSON.stringify(stops),
                'activeStaging.status': nextStat
            });
            return res.status(200).json({ success: true });
        }
    }
    return res.status(404).json({ error: "Target Route/Driver not found." });
}

// --- 2. RESET ROUTE (Clear Calculations) ---
async function resetRoute(payload, res, db) {
    const { driverId } = payload;
    if (!driverId) return res.status(400).json({ error: "Missing driverId." });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();

    if (driverDoc.exists) {
        let bay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
        if (bay.length > 0) {
            bay.forEach(s => {
                let isTuple = Array.isArray(s);
                if (isTuple) {
                    s[11] = "P"; s[7] = ""; s[8] = 0; s[12] = 0;
                } else {
                    s.status = "P"; s.s = "P"; s.eta = ""; s.dist = 0; s.durationSecs = 0;
                }
            });
            
            await driverRef.update({
                'activeStaging.orders': JSON.stringify(bay),
                'activeStaging.status': 'Pending'
            });
        }
        return res.status(200).json({ success: true });
    }
    return res.status(404).json({ error: "Driver not found." });
}

// --- 3. RECREATE ORDERS (Undo Action) ---
async function recreateOrders(payload, res, db) {
    const { driverId, routeId, orders } = payload;
    if (!orders || orders.length === 0) return res.status(400).json({ error: "No orders to recreate." });

    if (routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(routeId));
        const dispatchDoc = await dispatchRef.get();
        if (dispatchDoc.exists) {
            let currentArr = safeJsonParse(dispatchDoc.data().currentRoute, []);
            let originalArr = safeJsonParse(dispatchDoc.data().originalRoute, []);
            
            orders.forEach(o => currentArr.push(minifyOrder(o)));
            orders.forEach(o => {
                let exists = originalArr.find(stop => String(Array.isArray(stop) ? stop[0] : stop.rowId) === String(o.rowId || o.id));
                if (!exists) originalArr.push(minifyOrder(o));
            });

            await dispatchRef.update({
                currentRoute: JSON.stringify(currentArr),
                originalRoute: JSON.stringify(originalArr)
            });
            return res.status(200).json({ success: true });
        }
    } else if (driverId) {
        const driverRef = db.collection('Users').doc(String(driverId));
        const driverDoc = await driverRef.get();
        if (driverDoc.exists) {
            let bay = safeJsonParse(driverDoc.data().activeStaging?.orders, []);
            orders.forEach(o => bay.push(minifyOrder(o)));
            
            let currStat = driverDoc.data().activeStaging?.status || 'Pending';
            let nextStat = evaluateRouteState(bay, currStat);

            await driverRef.update({
                'activeStaging.orders': JSON.stringify(bay),
                'activeStaging.status': nextStat
            });
            return res.status(200).json({ success: true });
        }
    }
    return res.status(404).json({ error: "Target Route/Driver not found." });
}

// --- 4. RESTORE ORIGINAL ROUTE (Revert Dispatch Sandbox) ---
async function restoreOriginalRoute(payload, res, db) {
    const { routeId } = payload;
    if (!routeId) return res.status(400).json({ error: "Missing routeId." });

    const dispatchRef = db.collection('Dispatch').doc(String(routeId));
    const dispatchDoc = await dispatchRef.get();

    if (dispatchDoc.exists) {
        const origJson = dispatchDoc.data().originalRoute || "[]";
        await dispatchRef.update({ currentRoute: origJson });
        return res.status(200).json({ success: true });
    }
    return res.status(404).json({ error: "Route ID not found." });
}

// --- 5. DISPATCH ROUTE (The Relay Engine) ---
async function dispatchRoute(payload, res, db, admin) {
    const { driverId, companyId, customBody, ccCompany, addCc, ccEmail, mapBase64 } = payload;
    if (!driverId) return res.status(400).json({ error: "Missing driverId." });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();

    if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

    const stagingJsonStr = driverDoc.data().activeStaging?.orders || "[]";
    const bay = safeJsonParse(stagingJsonStr, []);

    if (bay.length === 0) return res.status(400).json({ error: "No orders found to dispatch." });

    const routeId = new Date().getTime().toString();
    const dashboardLink = `https://mypieinteractive.github.io/prospect-dashboard?id=${routeId}`;

    const batch = db.batch();

    // 1. Create the permanent Dispatch record
    const dispatchRef = db.collection('Dispatch').doc(routeId);
    batch.set(dispatchRef, {
        routeId: routeId,
        driverId: driverId,
        companyId: companyId || driverDoc.data().companyId,
        originalRoute: stagingJsonStr,
        currentRoute: stagingJsonStr,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Clear the Driver's Staging Bay
    batch.update(driverRef, {
        'activeStaging.orders': "[]",
        'activeStaging.status': "Pending",
        'lockedBy': null
    });

    await batch.commit();

    // 3. Relay to Apps Script for Email Delivery
    const relayPayload = {
        action: "dispatchRoute",
        routeId: routeId,
        driverId: driverId,
        companyId: companyId,
        dashboardLink: dashboardLink,
        stagingJsonStr: stagingJsonStr,
        customBody: customBody,
        mapBase64: mapBase64,
        ccCompany: ccCompany,
        addCc: addCc,
        ccEmail: ccEmail
    };

    const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
    if (webhookUrl) {
        // Fire and forget to prevent UI latency, log errors internally
        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(relayPayload)
        }).catch(err => console.error("[RELAY ERROR] Failed to ping Apps Script:", err.message));
    } else {
        console.warn("[RELAY WARNING] APPS_SCRIPT_WEBHOOK_URL not set. Email not sent.");
    }

    return res.status(200).json({ success: true, routeId: routeId });
}

module.exports = {
    saveRoute, resetRoute, recreateOrders, restoreOriginalRoute, dispatchRoute
};
