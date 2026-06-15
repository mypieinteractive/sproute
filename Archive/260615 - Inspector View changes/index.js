/**
 * index.js
 * VERSION: V15.0
 * * CHANGES:
 * V1.38 - Firestore Claim Check API. Added a dedicated GET endpoint `/dispatchData/:id` 
 * to securely serve large Dispatch documents (containing base64 map images and full arrays) 
 * back to the Google Apps Script background worker.
 * V1.37 - Deployment Crash Fix. Removed duplicate import declaration for `dispatchRoute` 
 * and deleted the stray `if (action === 'dispatchRoute')` execution block that sat outside 
 * the main switch statement, resolving the fatal SyntaxError preventing server startup.
 */

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin globally
let firebaseApp;
if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
        projectId: process.env.GOOGLE_CLOUD_PROJECT
    });
} else {
    firebaseApp = admin.app();
}

// Connect explicitly to the 'sproute' named database
const db = getFirestore(firebaseApp, 'sproute');

// Import Modular Controllers
const { getDashboardInit } = require('./backend/initialization');
const { updateUserFromGlide, updateCompanyFromGlide, updateCsvSettingsFromGlide, updateEndpoint } = require('./backend/glideWebhooks');
const { uploadCsv, updateOrder, updateMultipleOrders, deleteMultipleOrders, resolveUnmatchedAddress } = require('./backend/preOptimization');
const { generateRoute, calculate } = require('./backend/optimization');
const { saveRoute, resetRoute, recreateOrders, restoreOriginalRoute, dispatchRoute } = require('./backend/postOptimization');

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Utility for detailed execution timestamp logs
function getLogTime() {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' });
}

// --- GET ROUTER (Initialization & Fetching) ---
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

// GET ENDPOINT FOR GAS BACKGROUND QUEUE
app.get('/dispatchData/:id', async (req, res) => {
    try {
        const doc = await db.collection('Dispatch').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: "Dispatch document not found" });
        return res.json(doc.data());
    } catch (error) {
        console.error(`[${getLogTime()}] ERROR - Fetching Dispatch Data:`, error.message);
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
            // Glide Webhooks
            case 'updateUserFromGlide': return await updateUserFromGlide(payload, res, db);
            case 'updateCompanyFromGlide': return await updateCompanyFromGlide(payload, res, db);
            case 'updateCsvSettingsFromGlide': return await updateCsvSettingsFromGlide(payload, res, db);
            case 'updateEndpoint': return await updateEndpoint(payload, res, db);

            // Pre-Optimization
            case 'uploadCsv': return await uploadCsv(payload, res, db, admin);
            case 'resolveUnmatchedAddress': return await resolveUnmatchedAddress(payload, res, db, admin);
            case 'updateOrder': return await updateOrder(payload, res, db);
            case 'updateMultipleOrders': return await updateMultipleOrders(payload, res, db);
            case 'deleteMultipleOrders': return await deleteMultipleOrders(payload, res, db);
            
            // Optimization
            case 'generateRoute': return await generateRoute(payload, res, db);
            case 'calculate': return await calculate(payload, res, db);
            
            // Post-Optimization
            case 'saveRoute': return await saveRoute(payload, res, db);
            case 'resetRoute': return await resetRoute(payload, res, db);
            case 'recreateOrders': return await recreateOrders(payload, res, db);
            case 'restoreOriginalRoute': return await restoreOriginalRoute(payload, res, db);
            case 'dispatchRoute': return await dispatchRoute(payload, res, db, admin);

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
