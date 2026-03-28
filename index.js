/**
 * index.js
 * VERSION: V1.34
 * * CHANGES:
 * V1.34 - Router Expansion. Wired up the missing endpoints for post-optimization 
 * (saveRoute, resetRoute, recreateOrders, restoreOriginalRoute, dispatchRoute) 
 * and pre-optimization (resolveUnmatchedAddress). Added explicit admin variable 
 * passing to dispatchRoute and resolveUnmatchedAddress for server timestamping.
 * Included detailed execution logging to match the legacy console format.
 * V1.33 - Initial modular routing setup.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin (uses default service account credentials in Cloud Run)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Import Modules
const { getDashboardInit } = require('./initialization');
const { uploadCsv, updateOrder, updateMultipleOrders, deleteMultipleOrders, resolveUnmatchedAddress } = require('./preOptimization');
const { generateRoute, calculate } = require('./optimization');
const { saveRoute, resetRoute, recreateOrders, restoreOriginalRoute, dispatchRoute } = require('./postOptimization');

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Utility for detailed execution timestamp logs
function getLogTime() {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' });
}

// --- GET ROUTER (Initialization) ---
app.get('/', async (req, res) => {
    const action = req.query.action || 'getDashboardInit';
    console.log(`[${getLogTime()}] REQ - GET ${action}`);
    
    try {
        if (action === 'getDashboardInit') {
            return await getDashboardInit(req, res, db);
        }
        console.error(`[${getLogTime()}] RES - GET ${action} (Invalid Action)`);
        return res.status(400).json({ error: "Invalid GET action provided" });
    } catch (error) {
        console.error(`[${getLogTime()}] ERROR - GET ${action}:`, error.message);
        return res.status(500).json({ error: error.message });
    }
});

// --- POST ROUTER (Mutations & Actions) ---
app.post('/', async (req, res) => {
    const action = req.body.action;
    const payload = req.body.payload || req.body;
    
    console.log(`[${getLogTime()}] REQ - POST ${action || 'UNKNOWN'}`);

    if (!action) {
        console.error(`[${getLogTime()}] RES - POST (Missing Action)`);
        return res.status(400).json({ error: "Missing action in request body" });
    }

    try {
        switch (action) {
            // Pre-Optimization
            case 'uploadCsv': 
                return await uploadCsv(payload, res, db, admin);
            case 'resolveUnmatchedAddress': 
                return await resolveUnmatchedAddress(payload, res, db, admin);
            case 'updateOrder': 
                return await updateOrder(payload, res, db);
            case 'updateMultipleOrders': 
                return await updateMultipleOrders(payload, res, db);
            case 'deleteMultipleOrders': 
                return await deleteMultipleOrders(payload, res, db);
            
            // Optimization
            case 'generateRoute': 
                return await generateRoute(payload, res, db);
            case 'calculate': 
                return await calculate(payload, res, db);
            
            // Post-Optimization
            case 'saveRoute': 
                return await saveRoute(payload, res, db);
            case 'resetRoute': 
                return await resetRoute(payload, res, db);
            case 'recreateOrders': 
                return await recreateOrders(payload, res, db);
            case 'restoreOriginalRoute': 
                return await restoreOriginalRoute(payload, res, db);
            case 'dispatchRoute': 
                return await dispatchRoute(payload, res, db, admin);

            default:
                console.error(`[${getLogTime()}] RES - POST ${action} \n { "error": "Invalid or unhandled action provided: ${action}" }`);
                return res.status(400).json({ error: `Invalid or unhandled action provided: ${action}` });
        }
    } catch (error) {
        console.error(`[${getLogTime()}] ERROR - POST ${action}:`, error);
        return res.status(500).json({ error: error.message });
    }
});

// --- SERVER START ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`[${getLogTime()}] Enterprise Node.js Backend listening on port ${PORT}`);
});
