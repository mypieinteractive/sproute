/**
 * postOptimization.js
 * VERSION: V1.46
 * * CHANGES:
 * V1.46 - Disconnected Google Apps Script Webhook. Imported zeptoMailer to 
 * handle email dispatches natively and instantly entirely within Node.js.
 */

const { safeJsonParse } = require('./backend/helpers');
const { sendRouteEmail } = require('./backend/zeptoMailer');

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

    // 1. Create the persistent Route ID and save the payload into Firestore
    const routeId = new Date().getTime().toString();
    const dashboardLink = `https://mypieinteractive.github.io/Sproute/?id=${routeId}`;
    const dispatchRef = db.collection('Dispatch').doc(routeId);
    
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

    // 2. Clear the Driver's Staging Bay
    await driverRef.update({
        lockedBy: null,
        'activeStaging.orders': '[]',
        'activeStaging.status': null
    });

    // 3. Immediately compile and send the ZeptoMail
    try {
        await sendRouteEmail(db, payload, routeId, driverData);
        return res.status(200).json({ success: true, routeId: routeId });
    } catch (emailError) {
        console.error("Failed to send ZeptoMail, but route was saved:", emailError);
        // We still return 200 so the UI resets, but we attach the warning.
        return res.status(200).json({ success: true, routeId: routeId, warning: "Route saved, but email failed to send." });
    }
}

module.exports = {
    saveRoute, recreateOrders, restoreOriginalRoute, resetRoute, dispatchRoute
};
