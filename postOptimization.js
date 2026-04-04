/**
 * postOptimization.js
 * VERSION: V1.46
 * * CHANGES:
 * V1.46 - Truthful Undo Architecture. Implemented immediate backend wipe of the staging bay 
 * before the Apps Script relay to support Optimistic UI on the frontend. If the email relay fails, 
 * the backend performs a secure rollback, safely restoring the orders to Firestore.
 */

const { getField, safeJsonParse } = require('./helpers');

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
            o.rowId || o.id || "",
            o.cluster || o.routeNum || 1,
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
                currentRoute: JSON.stringify(sandboxArr),
                originalRoute: JSON.stringify(originalArr)
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
                'activeStaging.orders': JSON.stringify(stagingArr),
                'activeStaging.status': stateToSave
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
    try {
        const driverRef = db.collection('Users').doc(String(payload.driverId));
        const driverDoc = await driverRef.get();
        if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found for dispatch." });

        const activeStaging = driverDoc.data().activeStaging || {};
        const stagingJsonStr = activeStaging.orders || "[]";
        const originalStatus = activeStaging.status || "Pending";
        const endpointsObj = driverDoc.data().endpoints || {};

        let stagingJson = safeJsonParse(stagingJsonStr, []);
        if (stagingJson.length === 0) return res.status(400).json({ error: "No orders found to dispatch." });

        const routeId = new Date().getTime().toString();
        const dashboardLink = `https://mypieinteractive.github.io/prospect-dashboard/?id=${routeId}`;

        let r1Stops = 0, r2Stops = 0, r3Stops = 0, dueToday = 0, pastDue = 0;
        let today = new Date(); 
        today.setHours(0,0,0,0);
        
        stagingJson.forEach(s => {
            let rLabel = Array.isArray(s) ? s[1] : (s.R || 1);
            let dDate = Array.isArray(s) ? s[5] : (s.d || s.dueDate);
            if (String(rLabel) === '1') r1Stops++;
            else if (String(rLabel) === '2') r2Stops++;
            else if (String(rLabel) === '3') r3Stops++;
            
            if (dDate) {
                let dueTime = new Date(dDate); dueTime.setHours(0,0,0,0);
                if (dueTime < today) pastDue++; 
                else if (dueTime.getTime() === today.getTime()) dueToday++;
            }
        });

        // 1. TRUTHFUL UI SYNC: Immediately wipe the Staging Bay in Firestore.
        // This ensures the database matches the frontend's optimistic state.
        await driverRef.update({
            lockedBy: null,
            'activeStaging.orders': '[]',
            'activeStaging.status': 'Pending',
            'endpoints': {}
        });

        // 2. Log Initial Dispatch state
        const dispatchDoc = {
            routeId: routeId,
            driverId: payload.driverId,
            companyId: payload.companyId,
            dashboardLink: dashboardLink,
            status: "Processing Relay...",
            timestamp: admin ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
            ccCompany: payload.ccCompany || false,
            addCc: payload.addCc || '',
            ccEmail: payload.ccEmail || '',
            currentRoute: stagingJsonStr, 
            originalRoute: stagingJsonStr,
            endpoints: endpointsObj,
            stats: { totalOrders: stagingJson.length, r1Stops, r2Stops, r3Stops, dueToday, pastDue }
        };
        await db.collection('Dispatch').doc(routeId).set(dispatchDoc);

        // 3. Execute the Google Apps Script Email Relay
        const asPayload = {
            action: 'dispatchRoute',
            driverId: payload.driverId,
            companyId: payload.companyId,
            customBody: payload.customBody || '',
            ccCompany: payload.ccCompany || false,
            addCc: payload.addCc || '',
            ccEmail: payload.ccEmail || '',
            mapBase64: payload.mapBase64 || '',  
            dashboardLink: dashboardLink,
            stagingJsonStr: stagingJsonStr,      
            endpointsObj: endpointsObj           
        };

        const AS_URL = process.env.APPS_SCRIPT_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbxqvQCesYcHzJ9ps9YR7LM9st7gptSARmLXI10gYmAdpkgSXQFCBqrPsVNwA4PjTIZW/exec';
        
        let emailSuccess = false;
        let errorMessage = "Unknown Error";

        try {
            const asResponse = await fetch(AS_URL, {
                method: 'POST',
                body: JSON.stringify(asPayload)
            });
            
            const responseText = await asResponse.text();
            
            try {
                const asData = JSON.parse(responseText);
                emailSuccess = !!asData.success;
                if (!emailSuccess) errorMessage = asData.error || 'Apps Script returned an error';
            } catch (jsonErr) {
                console.error("Apps Script returned non-JSON:", responseText.substring(0, 200));
                emailSuccess = false;
                errorMessage = "Email Server rejected the payload. (Likely too large).";
            }
        } catch (err) {
            console.error("Apps Script Fetch Error:", err);
            emailSuccess = false;
            errorMessage = "Network/Timeout Error connecting to email server.";
        }

        // 4. Resolve the Outcome
        if (emailSuccess) {
            await db.collection('Dispatch').doc(routeId).update({ status: "Sent Instantly" });
            return res.status(200).json({ success: true, routeId: routeId });
        } else {
            // FAILURE: Perform the Truthful Server-Side Rollback
            await db.collection('Dispatch').doc(routeId).update({ status: `Failed: ${errorMessage}` });
            
            await driverRef.update({
                'activeStaging.orders': stagingJsonStr,
                'activeStaging.status': originalStatus,
                'endpoints': endpointsObj
            });
            
            return res.status(500).json({ error: errorMessage });
        }

    } catch (error) {
        console.error("Dispatch Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = {
    saveRoute, recreateOrders, restoreOriginalRoute, resetRoute, dispatchRoute
};
