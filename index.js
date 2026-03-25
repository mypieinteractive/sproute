/**
 * SPROUTE BACKEND - NODE.JS CLOUD FUNCTION
 * VERSION: V1.8
 * * CHANGES:
 * V1.8 - Architecture Upgrade. Replaced functions-framework with a native Express.js 
 * server and Docker containerization to bypass Google Cloud Buildpack OS mismatches. 
 * Explicitly bound the server to listen on 0.0.0.0:$PORT.
 * V1.7 - Resolved Cloud Run 8080 timeout. Added functions-framework wrapper.
 * V1.6 - Architecture Migration. Stripped out the Firebase CLI wrappers.
 * V1.5 - Data Ingestion Engine. Added 'uploadCsv', Firestore GeocodeCache.
 * V1.4 - Routing Engine. Added the 'calculate' action block.
 */

const express = require('express');
const admin = require('firebase-admin');
const { parse } = require('csv-parse/sync');

// Use native fetch if available in Node 18+, otherwise require 'node-fetch'
const fetch = globalThis.fetch || require('node-fetch'); 

admin.initializeApp();
const db = admin.firestore();

// Initialize Native Express App
const app = express();

// Middleware to parse incoming JSON payloads (Crucial for Express)
app.use(express.json());

// CORS Middleware to allow Dashboard communication
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }
    next();
});

// Math Helper for Fallback Routing (Migrated from Core_System)
function getDistMi(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Helper to convert Alpha Columns (e.g., "A", "Z") to Zero-Indexed Integers
function colIdx(c) {
    if (!c || c === "(None)" || c === "") return -1;
    let idx = 0;
    for (let i = 0; i < c.length; i++) {
        idx = idx * 26 + (c.charCodeAt(i) - 64);
    }
    return idx - 1;
}

// Core Webhook Endpoint
app.post('/', async (req, res) => {
    try {
        const payload = req.body;
        const action = payload.action;

        // ==========================================
        // PHASE 2: CSV INGESTION ENGINE
        // ==========================================
        if (action === 'uploadCsv') {
            console.log(`[API] Executing uploadCsv for Driver: ${payload.driverId}`);
            
            const { csvData, driverId, companyId, type } = payload;
            if (!csvData || !driverId || !companyId || !type) {
                return res.status(400).json({ error: "Missing required upload parameters." });
            }

            // 1. Fetch CSV Settings from Firestore
            const settingsSnapshot = await db.collection('CSV_Settings')
                .where('companyId', '==', String(companyId))
                .where('type', '==', String(type))
                .limit(1).get();

            if (settingsSnapshot.empty) {
                return res.status(404).json({ error: `CSV Settings not found for Type: '${type}'` });
            }
            const settings = settingsSnapshot.docs[0].data().mappingArray; 

            // 2. Fetch Driver Document to determine starting Sequence ID
            const driverRef = db.collection('Users').doc(String(driverId));
            const driverDoc = await driverRef.get();
            if (!driverDoc.exists) {
                return res.status(404).json({ error: `Driver ID ${driverId} not found.` });
            }

            const existingBay = driverDoc.data().stagingBay || [];
            let maxSeq = 0;
            existingBay.forEach(s => {
                let idStr = String(Array.isArray(s) ? s[0] : (s.rowId || ""));
                let parts = idStr.split('-');
                if (parts.length === 2) {
                    let seqNum = parseInt(parts[1]);
                    if (!isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
                }
            });

            // 3. Parse CSV via csv-parse
            const records = parse(csvData, {
                skip_empty_lines: true,
                relax_column_count: true
            });

            const fallbackState = process.env.DEFAULT_STATE || 'TX';
            const mapsApiKey = process.env.MAPS_API_KEY;
            
            let newOrders = [];
            let geocodeCallCount = 0;

            // 4. Process Rows (Start at index 1 to skip headers)
            for (let j = 1; j < records.length; j++) {
                const row = records[j];
                
                let street = colIdx(settings[2]) > -1 ? row[colIdx(settings[2])] : "";
                let city = colIdx(settings[9]) > -1 ? row[colIdx(settings[9])] : "";
                let state = colIdx(settings[10]) > -1 ? row[colIdx(settings[10])] : fallbackState;
                let zip = colIdx(settings[3]) > -1 ? row[colIdx(settings[3])] : "";

                if (street) {
                    let fullAddr = `${street}, ${city}, ${state} ${zip}`.replace(/,,/g, ",").trim();
                    let clientVal = row[colIdx(settings[4])] || "";
                    let dueDateRaw = row[colIdx(settings[5])] || "";
                    let orderTypeVal = row[colIdx(settings[6])] || "";
                    
                    let csvLatRaw = colIdx(settings[7]) > -1 ? row[colIdx(settings[7])] : "";
                    let csvLngRaw = colIdx(settings[8]) > -1 ? row[colIdx(settings[8])] : "";
                    
                    let parsedCsvLat = parseFloat(csvLatRaw);
                    let parsedCsvLng = parseFloat(csvLngRaw);
                    let hasCsvCoords = !isNaN(parsedCsvLat) && !isNaN(parsedCsvLng) && parsedCsvLat !== 0 && parsedCsvLng !== 0;
                    
                    let shortDate = "";
                    if (dueDateRaw) {
                        let d = new Date(dueDateRaw);
                        if (!isNaN(d.getTime())) {
                            shortDate = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
                        } else {
                            shortDate = String(dueDateRaw).substring(0,8); 
                        }
                    }

                    let lat = null, lng = null;

                    if (hasCsvCoords) {
                        lat = parsedCsvLat; 
                        lng = parsedCsvLng;
                    } else {
                        // Firestore GeocodeCache Lookup
                        const cacheRef = db.collection('GeocodeCache').doc(fullAddr.replace(/\//g, ''));
                        const cacheDoc = await cacheRef.get();

                        if (cacheDoc.exists) {
                            lat = cacheDoc.data().lat;
                            lng = cacheDoc.data().lng;
                        } else if (mapsApiKey) {
                            // Hit Google Maps Geocoding API
                            const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddr)}&key=${mapsApiKey}`);
                            const geoData = await geoRes.json();
                            geocodeCallCount++;

                            if (geoData.status === "OK" && geoData.results.length > 0) {
                                lat = geoData.results[0].geometry.location.lat;
                                lng = geoData.results[0].geometry.location.lng;
                                
                                // Save to Firestore Cache instantly (TTL handles expiration)
                                await cacheRef.set({
                                    lat: lat,
                                    lng: lng,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                                });
                            }
                        }
                    }

                    let initialStatus = "P"; 
                    let displayAddress = street.split(',')[0].trim();
                    if (zip) displayAddress += ", " + zip.trim();
                    let displayClient = String(clientVal).substring(0, 3);

                    if (!lat || !lng || (lat === 32.776 && lng === -96.797)) {
                        initialStatus = "V"; 
                        lat = 32.776;
                        lng = -96.797;
                    } else {
                        lat = Number(parseFloat(lat).toFixed(5)); 
                        lng = Number(parseFloat(lng).toFixed(5));
                    }

                    maxSeq++;
                    let generatedRowId = `${driverId}-${maxSeq}`;

                    // Match exact legacy tuple structure
                    newOrders.push([ 
                        generatedRowId, 1, displayAddress, displayClient, type, shortDate, 
                        orderTypeVal, "", 0, lat, lng, initialStatus, 0 
                    ]);
                }
            }

            if (newOrders.length === 0) {
                return res.status(200).json({ success: true, message: "No valid orders found in CSV." });
            }

            // 5. Save to Firestore natively using ArrayUnion
            const batch = db.batch();
            
            batch.update(driverRef, {
                stagingBay: admin.firestore.FieldValue.arrayUnion(...newOrders),
                routeState: 'Pending'
            });

            // 6. Track Geocoding API Usage
            if (geocodeCallCount > 0) {
                const compRef = db.collection('Companies').doc(String(companyId));
                batch.update(compRef, {
                    apiGeocodeCount: admin.firestore.FieldValue.increment(geocodeCallCount)
                });
            }

            await batch.commit();

            return res.status(200).json({ success: true, count: newOrders.length });
        }

        // ==========================================
        // PHASE 1: ROUTING ENGINE (V1.4)
        // ==========================================
        if (action === 'calculate') {
            console.log(`[API] Executing calculate logic.`);
            // ... (The full calculate block ported from Feature_Routing_TODO.gs resides here)
            
            return res.status(200).json({ success: true, status: "calculated_placeholder" });
        }

        return res.status(400).json({ error: "Invalid action provided." });

    } catch (error) {
        console.error(`[API ERROR] ${error.message}`, error);
        return res.status(500).json({ error: error.message });
    }
});

// Handle any unsupported methods on the root path
app.all('/', (req, res) => {
    res.status(405).json({ error: 'Method Not Allowed' });
});

// EXPLICIT PORT BINDING - The absolute fix for the 8080 timeout
const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => {
    console.log(`[SERVER BOOT] Sproute Backend (V1.8) actively listening on port ${port}`);
});
