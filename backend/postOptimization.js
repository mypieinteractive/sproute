/**
 * postOptimization.js
 * VERSION: V15.6
 * * CHANGES:
 * V15.6 - Fixed "ghost" polylines bug: explicitly clear 'activeStaging.polylines' by setting it to '{}' in both resetRoute and dispatchRoute to prevent long-term data bloat in the Users collection.
 * V15.5 - Implemented Transaction Rollback for dispatchRoute. It now saves to the Dispatch document FIRST. If ZeptoMail fails, it deletes the newly created Dispatch document (rollback) and throws an error to the frontend, leaving the User's activeStaging perfectly intact so they can try again.
 */

const { safeJsonParse } = require('./helpers');
const { sendRouteEmail } = require('./zeptoMailer');

async function saveRoute(payload, res, db) {
    if (!payload.stops) return res.status(400).json({ error: "Missing stops." });
    
    if (payload.routeId) {
        const dispatchRef = db.collection('Dispatch').doc(String(payload.routeId));
        const dispatchDoc = await dispatchRef.get();
        if (dispatchDoc.exists) {
            let updates = { currentRoute: JSON.stringify(payload.stops) };
            if (payload.polylines) updates.currentPolylines = JSON.stringify(payload.polylines);
            await dispatchRef.update(updates);
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

            let updates = { 
                'activeStaging.orders': JSON.stringify(finalBay),
                'activeStaging.status': payload.routeState || 'Staging'
            };
            if (payload.polylines) updates['activeStaging.polylines'] = JSON.stringify(payload.polylines);

            await driverRef.update(updates);
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
            const origPolys = dispatchDoc.data().polylines || "{}";
            
            await dispatchRef.update({ 
                currentRoute: origJson, 
                currentPolylines: origPolys 
            });
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
            'activeStaging.status': 'Pending',
            'activeStaging.polylines': '{}'
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

    const routeId = new Date().getTime().toString();
    const dashboardLink = `https://mypieinteractive.github.io/Sproute/?id=${routeId}`;
    const baselinePolys = driverData.activeStaging?.polylines || "{}";

    const dispatchRef = db.collection('Dispatch').doc(routeId);

    // --- 1. WRITE TO DISPATCH DOCUMENT FIRST ---
    await dispatchRef.set({
        routeId: routeId,
        driverId: payload.driverId || "",
        companyId: payload.companyId || "",
        driverName: driverData.name || "Inspector",
        currentRoute: stagingJsonStr,
        originalRoute: stagingJsonStr,
        polylines: baselinePolys, 
        currentPolylines: baselinePolys, 
        customBody: payload.customBody || "",
        ccCompany: payload.ccCompany || false,
        addCc: payload.addCc || "",
        ccEmail: payload.ccEmail || "",
        endpointsObj: driverData.endpoints || {},
        dashboardLink: dashboardLink,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // --- 2. ATTEMPT EMAIL DISPATCH ---
    try {
        await sendRouteEmail(db, payload, routeId, driverData);
    } catch (emailError) {
        console.error("ZeptoMail failed. Initiating database rollback:", emailError);
        
        // --- 3A. ROLLBACK: DELETE THE DISPATCH DOCUMENT ---
        await dispatchRef.delete();
        
        // Return error to frontend so the modal stays open and Staging is untouched
        return res.status(400).json({ error: "Email failed to send. Route reverted to Staging. Error: " + emailError.message });
    }

    // --- 3B. EMAIL SUCCESSFUL - CLEAR STAGING FROM USERS ---
    await driverRef.update({
        lockedBy: null,
        'activeStaging.orders': '[]',
        'activeStaging.status': null,
        'activeStaging.polylines': '{}'
    });

    return res.status(200).json({ success: true, routeId: routeId });
}

module.exports = { saveRoute, recreateOrders, restoreOriginalRoute, resetRoute, dispatchRoute };
