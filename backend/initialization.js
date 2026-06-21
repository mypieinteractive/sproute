/**
 * initialization.js
 * VERSION: V15.7
 * * CHANGES:
 * V15.7 - Replaced brittle regex `.replace(/\\/g, '\\\\')` polyline parsing blocks with safe try/catch structures that degrade gracefully on failure without throwing execution-halting errors.
 */

const { safeJsonParse, formatStopForManager } = require('./helpers');

async function getDashboardInit(req, res, db) {
    try {
        let explicitRouteId = req.query.id;
        let explicitCompanyId = req.query.companyId || req.query.company;
        if (Array.isArray(explicitCompanyId)) explicitCompanyId = explicitCompanyId[0];
        
        const driverId = req.query.driverId || req.query.driver;
        const adminId = req.query.adminId || req.query.admin;
        const isManager = req.query.isManager === 'true';

        // --- 1. INSPECTOR DISPATCH LINK INTERCEPT ---
        if (explicitRouteId && !explicitCompanyId) {
            const dispatchDoc = await db.collection('Dispatch').doc(String(explicitRouteId)).get();
            if (!dispatchDoc.exists) return res.status(404).json({ error: "Route not found.", id: explicitRouteId });
            
            const dData = dispatchDoc.data();
            const resolvedCompanyId = dData.companyId;
            const dispatchDriverId = dData.driverId;
            const currentRoute = safeJsonParse(dData.currentRoute, []);
            const originalRoute = dData.originalRoute || "[]";
            
            const compDoc = await db.collection('Companies').doc(String(resolvedCompanyId)).get();
            let companyData = compDoc.exists ? compDoc.data() : {};
            
            const driverDoc = await db.collection('Users').doc(String(dispatchDriverId)).get();
            let driverData = driverDoc.exists ? driverDoc.data() : {};
            
            let activeStops = currentRoute.map(obj => formatStopForManager(obj, dispatchDriverId, resolvedCompanyId, 'Dispatched', explicitRouteId));
            let isAlteredRoute = dData.currentRoute !== originalRoute;

            let interceptPolys = {};
            let pRaw = dData.currentPolylines || dData.polylines;
            if (pRaw) {
                let pParsed = {};
                if (typeof pRaw === 'string') {
                    try { pParsed = JSON.parse(pRaw); } catch(e) { console.warn("Failed to parse polylines from backend.", e); pParsed = {}; }
                } else { pParsed = pRaw; }
                for (let k in pParsed) { interceptPolys[`${dispatchDriverId}_${k}`] = pParsed[k]; }
            }

            let inspectorModify = driverData.modifyRoutes === true || String(driverData.modifyRoutes).toLowerCase() === 'true';
            let inspectorReoptimize = driverData.reoptimize === true || String(driverData.reoptimize).toLowerCase() === 'true';
            
            let dispName = dData.driverName || driverData.name || "Inspector";

            return res.status(200).json({
                routeId: explicitRouteId,
                driverId: dispatchDriverId,
                stops: activeStops,
                originalRoute: originalRoute, 
                polylines: interceptPolys, 
                routeStart: driverData.startAddress ? { address: driverData.startAddress, lat: driverData.startLat, lng: driverData.startLng } : null,
                routeEnd: driverData.endAddress ? { address: driverData.endAddress, lat: driverData.endLat, lng: driverData.endLng } : null,
                serviceDelay: parseInt(companyData.serviceDelayMins) || 0,
                companyLogo: companyData.logoUrl || "",
                tier: companyData.accountType || "",
                accountType: companyData.accountType || "",
                companyAddress: companyData.address || "",
                companyEmail: companyData.email || "",
                defaultEmailMessage: companyData.defaultEmailMessage || "",
                permissions: { modify: inspectorModify, reoptimize: inspectorReoptimize, useExactApi: companyData.useExactApi }, 
                displayName: dispName,
                isAlteredRoute: isAlteredRoute,
                isAltered: dData.isAltered === true,
                showReset: typeof dData.showReset !== 'undefined' ? dData.showReset === true : dData.isAltered === true,
                needsRecalculation: false,
                csvTypes: [], 
                ccCompanyDefault: companyData.ccCompanyDefault === true || String(companyData.ccCompanyDefault).toLowerCase() === 'true'
            });
        }

        // --- 2. STANDARD MANAGER / INSPECTOR LOAD ---
        let resolvedCompanyId = explicitCompanyId ? String(explicitCompanyId).trim() : null;
        let activeStops = [];

        if (!resolvedCompanyId) {
            let lookupId = adminId || driverId; 
            if (lookupId) {
                const userDoc = await db.collection('Users').doc(String(lookupId)).get();
                if (userDoc.exists) {
                    resolvedCompanyId = userDoc.data().companyId;
                }
            }
        }

        if (!resolvedCompanyId) {
            return res.status(400).json({ error: "Could not resolve Company ID from provided parameters." });
        }

        const compDoc = await db.collection('Companies').doc(String(resolvedCompanyId)).get();
        let companyData = compDoc.exists ? compDoc.data() : {};

        let accountType = companyData.accountType || "";
        let subscriptionStatus = companyData.subscriptionStatus || "";
        let subscriptionId = companyData.subscriptionId || "";
        let subscriptionExpiry = companyData.subscriptionExpiry || "";

        let displayName = String(companyData.name || "Dashboard").trim();
        
        let permissions = { modify: true, reoptimize: true }; 
        if (companyData.useExactApi !== undefined) permissions.useExactApi = companyData.useExactApi;
        
        let companyEmail = companyData.email || "";
        let defaultEmailMessage = companyData.defaultEmailMessage || "";
        let serviceDelay = parseInt(companyData.serviceDelayMins) || 0;
        let companyAddress = companyData.address || "";
        let companyLogo = companyData.logoUrl || "";
        let ccCompanyDefault = companyData.ccCompanyDefault === true || String(companyData.ccCompanyDefault).toLowerCase() === 'true';

        const usersSnap = await db.collection('Users').where('companyId', '==', String(resolvedCompanyId)).get();
        
        const inspectors = [];
        let globalRouteStart = null, globalRouteEnd = null, globalRouteState = 'Pending', foundDriverName = '';
        let globalPolylines = {}; 
        
        let specificInspectorModify = false;
        let specificInspectorReoptimize = false;
        
        usersSnap.forEach(doc => {
            const uData = doc.data();
            
            const isInsp = uData.isInspector === true || String(uData.isInspector).toLowerCase() === 'true';
            let startAddr = uData.startAddress || "";
            let startLat = uData.startLat || null;
            let startLng = uData.startLng || null;
            let endAddr = uData.endAddress || "";
            let endLat = uData.endLat || null;
            let endLng = uData.endLng || null;
            const driverName = uData.name || "Inspector";
            const driverEmail = uData.email || "";
            
            let stagingBay = [];
            if (uData.activeStaging?.orders) {
                stagingBay = safeJsonParse(uData.activeStaging.orders, []);
            }

            let pRaw = uData.activeStaging?.polylines;
            if (pRaw) {
                let pParsed = {};
                if (typeof pRaw === 'string') {
                    try { pParsed = JSON.parse(pRaw); } catch(e) { console.warn("Failed to parse polylines from backend.", e); pParsed = {}; }
                } else { pParsed = pRaw; }
                
                for (let k in pParsed) { globalPolylines[`${doc.id}_${k}`] = pParsed[k]; }
            }
            
            let rState = uData.activeStaging?.status || 'Pending';

            inspectors.push({ 
                id: doc.id, name: driverName, email: driverEmail, isInspector: isInsp,
                startAddress: startAddr, startLat: startLat, startLng: startLng,
                endAddress: endAddr, endLat: endLat, endLng: endLng
            });

            if (isManager) {
                stagingBay.forEach(stopTuple => {
                    activeStops.push(formatStopForManager(stopTuple, doc.id, resolvedCompanyId, rState));
                });
            } else {
                if (driverId && doc.id === String(driverId)) {
                    activeStops = stagingBay.map(obj => formatStopForManager(obj, doc.id, resolvedCompanyId, rState));
                    globalRouteState = rState;
                    foundDriverName = driverName;
                    
                    specificInspectorModify = uData.modifyRoutes === true || String(uData.modifyRoutes).toLowerCase() === 'true';
                    specificInspectorReoptimize = uData.reoptimize === true || String(uData.reoptimize).toLowerCase() === 'true';
                    
                    globalRouteStart = null;
                    globalRouteEnd = null;
                    
                    if (startAddr || (startLat && startLng)) {
                        globalRouteStart = { address: startAddr, lat: startLat, lng: startLng };
                    }
                    if (endAddr || (endLat && endLng)) {
                        globalRouteEnd = { address: endAddr, lat: endLat, lng: endLng };
                    }
                }
            }
        });

        const csvSettingsSnap = await db.collection('CSV_Settings').where('companyId', '==', String(resolvedCompanyId)).get();
        const csvTypes = [];
        csvSettingsSnap.forEach(doc => {
            let t = doc.data().csvType;
            if (t) csvTypes.push(t);
        });

        const responseObj = {
            stops: activeStops,
            polylines: globalPolylines, 
            routeStart: globalRouteStart || null,
            routeEnd: globalRouteEnd || null,
            inspectors: inspectors,
            serviceDelay: serviceDelay,
            companyLogo: companyLogo,
            tier: accountType, 
            accountType: accountType,
            subscriptionStatus: subscriptionStatus,
            subscriptionId: subscriptionId,
            subscriptionExpiry: subscriptionExpiry,
            companyAddress: companyAddress,
            companyEmail: companyEmail,
            defaultEmailMessage: defaultEmailMessage,
            permissions: permissions,
            displayName: displayName,
            adminEmail: "",
            csvTypes: csvTypes,
            ccCompanyDefault: ccCompanyDefault
        };
        
        if (!isManager && driverId) {
            responseObj.routeState = globalRouteState;
            responseObj.driverId = driverId;
            if (foundDriverName) responseObj.driverName = foundDriverName;
            
            responseObj.permissions.modify = specificInspectorModify;
            responseObj.permissions.reoptimize = specificInspectorReoptimize;
        }

        if (adminId) {
            const adminDoc = await db.collection('Users').doc(String(adminId)).get();
            if (adminDoc.exists) {
                let aEmail = adminDoc.data().email;
                if (aEmail) responseObj.adminEmail = aEmail;
            }
        }

        return res.status(200).json(responseObj);

    } catch (error) {
        console.error(`[GET INIT ERROR] ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = { getDashboardInit };
