/**
 * initialization.js
 * VERSION: V1.36
 * * CHANGES:
 * V1.36 - Decoupled Billing Logic. Removed the hardcoded "Individual" fallback mask. 
 * The dashboard initialization now strictly reads the exact accountType and 
 * subscription fields from the database, returning empty strings if the data is absent.
 * V1.35 - Pure CamelCase Harmonization. 
 */

const { safeJsonParse, formatStopForManager } = require('./helpers');

async function getDashboardInit(req, res, db) {
    try {
        let explicitCompanyId = req.query.companyId || req.query.company;
        if (Array.isArray(explicitCompanyId)) explicitCompanyId = explicitCompanyId[0];
        
        const driverId = req.query.driverId || req.query.driver;
        const adminId = req.query.adminId || req.query.admin;
        const isManager = req.query.isManager === 'true';
        
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

        // Explicit Billing & Tier variables without hardcoded fallbacks
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
                    activeStops = stagingBay;
                    globalRouteState = rState;
                    foundDriverName = driverName;
                    
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
            routeStart: globalRouteStart || null,
            routeEnd: globalRouteEnd || null,
            inspectors: inspectors,
            serviceDelay: serviceDelay,
            companyLogo: companyLogo,
            tier: accountType, // Kept for backwards compatibility with legacy frontend if needed
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
