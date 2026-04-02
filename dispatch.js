/**
 * dispatch.js
 * VERSION: V1.0
 * DESCRIPTION: Handles the final route dispatch workflow. Fetches the active staging 
 * data from Firestore, creates a permanent Dispatch snapshot document, and relays 
 * the email payload to the legacy Apps Script to trigger the visual email.
 */

const { safeJsonParse } = require('./helpers');

async function dispatchRoute(payload, res, db) {
    try {
        const driverRef = db.collection('Users').doc(String(payload.driverId));
        const driverDoc = await driverRef.get();
        if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

        const activeStaging = driverDoc.data().activeStaging || {};
        const stagingJsonStr = activeStaging.orders || "[]";
        const endpointsObj = driverDoc.data().endpoints || {};

        let stagingJson = safeJsonParse(stagingJsonStr, []);
        if (stagingJson.length === 0) return res.status(400).json({ error: "No orders found to dispatch." });

        // 1. Generate Route ID & Link
        const routeId = new Date().getTime().toString();
        const dashboardLink = `https://mypieinteractive.github.io/prospect-dashboard/?id=${routeId}`;

        // 2. Calculate Dashboard Stats
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

        // 3. Relay Payload to Apps Script (Enterprise.gs)
        const asPayload = {
            action: 'dispatchRoute',
            driverId: payload.driverId,
            companyId: payload.companyId,
            customBody: payload.customBody || '',
            ccCompany: payload.ccCompany || false,
            addCc: payload.addCc || '',
            ccEmail: payload.ccEmail || '',
            mapBase64: payload.mapBase64 || '',  // Passed to Apps Script, NOT saved to DB
            dashboardLink: dashboardLink,
            stagingJsonStr: stagingJsonStr,      // Passing DB truth directly to script
            endpointsObj: endpointsObj           // Passing DB truth directly to script
        };

        // Fallback to your specific script URL if ENV is missing
        const AS_URL = process.env.APPS_SCRIPT_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzgh2KCzfdWbOmdVq_edpuI_m6HxkfErzYAEHySfKkq1zgLtwuiUT3GCS5Xor9GgjFa/exec';
        
        const asResponse = await fetch(AS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(asPayload)
        });
        
        const asData = await asResponse.json();
        let logStatus = asData.success ? "Sent Instantly" : `Failed: ${asData.error || 'Apps Script Error'}`;

        // 4. Save permanent snapshot to Firestore 'Dispatch' Collection
        const dispatchDoc = {
            routeId: routeId,
            driverId: payload.driverId,
            companyId: payload.companyId,
            dashboardLink: dashboardLink,
            status: logStatus,
            timestamp: new Date().toISOString(),
            ccCompany: payload.ccCompany || false,
            addCc: payload.addCc || '',
            ccEmail: payload.ccEmail || '',
            orders: stagingJson, 
            endpoints: endpointsObj,
            stats: {
                totalOrders: stagingJson.length,
                r1Stops, r2Stops, r3Stops, dueToday, pastDue
            }
        };

        await db.collection('Dispatch').doc(routeId).set(dispatchDoc);

        if (asData.success) {
            // 5. Clear the Driver's Staging Bay 
            await driverRef.update({
                'activeStaging.orders': '[]',
                'activeStaging.status': 'Pending',
                'endpoints': {}
            });
            return res.status(200).json({ success: true, routeId: routeId });
        } else {
            return res.status(500).json({ error: "Email Relay Failed: " + (asData.error || "Unknown") });
        }

    } catch (error) {
        console.error("Dispatch Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = { dispatchRoute };
