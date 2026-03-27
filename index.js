/**
 * index.js
 * VERSION: V1.33
 * * CHANGES:
 * V1.33 - Architecture Restructure. Separated the monolithic index.js file into 
 * modular controller logic (helpers.js, initialization.js, glideWebhooks.js, 
 * preOptimization.js, and optimization.js) to improve readability and 
 * establish clean paths for future feature expansion.
 * V1.32 - Lock Logic Parity. 
 */

const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin globally
const firebaseApp = admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT
});
const db = getFirestore(firebaseApp, 'sproute');

// Import Modular Controllers
const { getDashboardInit } = require('./initialization');
const { updateUserFromGlide, updateCompanyFromGlide, updateCsvSettingsFromGlide, updateEndpoint } = require('./glideWebhooks');
const { uploadCsv, updateOrder, updateMultipleOrders, deleteMultipleOrders } = require('./preOptimization');
const { generateRoute, calculate } = require('./optimization');

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: '*/*', limit: '50mb' }));
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    next();
});

// GET Route (Dashboard Initialization)
app.get('/', (req, res) => getDashboardInit(req, res, db));

// POST Route (Action Hub)
app.post('/', async (req, res) => {
    try {
        let payload = req.body;

        if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } 
            catch (e) { return res.status(400).json({ error: "Invalid JSON format in payload." }); }
        }

        if (!payload || Object.keys(payload).length === 0) return res.status(400).json({ error: "Empty payload." });

        let action = payload.action;

        // Fallbacks for direct Glide row webhooks
        if (!action) {
            if (payload._collection === "Users" && payload.driverId) action = 'updateUserFromGlide';
            else if (payload._collection === "Companies" && payload.companyId) action = 'updateCompanyFromGlide';
            else if (payload._collection === "CSV_Settings" && payload.rowId) action = 'updateCsvSettingsFromGlide';
        }

        // Action Router
        switch (action) {
            case 'updateUserFromGlide': return updateUserFromGlide(payload, res, db);
            case 'updateCompanyFromGlide': return updateCompanyFromGlide(payload, res, db);
            case 'updateCsvSettingsFromGlide': return updateCsvSettingsFromGlide(payload, res, db);
            case 'updateEndpoint': return updateEndpoint(payload, res, db);
            
            case 'uploadCsv': return uploadCsv(payload, res, db, admin);
            case 'updateOrder': return updateOrder(payload, res, db);
            case 'updateMultipleOrders': return updateMultipleOrders(payload, res, db);
            case 'deleteMultipleOrders': return deleteMultipleOrders(payload, res, db);
            
            case 'generateRoute': return generateRoute(payload, res, db);
            case 'calculate': return calculate(payload, res, db);
            
            default: return res.status(400).json({ error: `Invalid or unhandled action provided: ${action}` });
        }
    } catch (error) {
        console.error(`[POST ERROR] ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

app.all('*', (req, res) => res.status(405).json({ error: 'Method Not Allowed' }));

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => {
    console.log(`[SERVER BOOT] Sproute Backend (V1.33) listening on port ${port}`);
});
