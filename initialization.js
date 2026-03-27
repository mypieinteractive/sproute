const { getField, safeJsonParse, formatStopForManager } = require('./helpers');

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
                    resolvedCompanyId = getField(userDoc.data(), ['Company ID', 'companyId', 'CompanyId']);
                }
            }
        }

        if (!resolvedCompanyId) {
            return res.status(400).json({ error: "Could not resolve Company ID from provided parameters." });
        }

        let compDoc = null;
        let companyData = {};
        
        const compRef = db.collection('Companies').doc(String(resolvedCompanyId));
        let directDoc = await compRef.get();
        
        if (directDoc.exists) {
            compDoc = directDoc;
        } else {
            const compQuery = await db.collection('Companies').where('Company ID', '==', String(resolvedCompanyId)).limit(1).get();
            if (!compQuery.empty) {
                compDoc = compQuery.docs[0];
            } else {
                const compQuery2 = await db.collection('Companies').where('Row ID', '==', String(resolvedCompanyId)).limit(1).get();
                if (!compQuery2.empty) compDoc = compQuery2.docs[0];
            }
        }

        if (compDoc && compDoc.exists) {
            companyData = compDoc.data();
        }

        let rawAccountType = String(companyData['Subscription Status'] || companyData['Account Type'] || companyData.accountType || "Individual").trim();
        let accountType = rawAccountType.charAt(0).toUpperCase() + rawAccountType.slice(1).toLowerCase();
        let displayName = String(companyData.name || companyData['Company Name'] || "Dashboard").trim();
        
        let permissions = { modify: true, reoptimize: true }; 
        if (companyData.useExactApi !== undefined) permissions.useExactApi = companyData.useExactApi;
        
        let companyEmail = companyData.email || companyData['Company Email'] || "";
        let defaultEmailMessage = companyData.defaultEmailMessage || companyData['Default Email Message'] || "";
        let serviceDelay = parseInt(companyData.serviceDelayMins || companyData['Service Delay']) || 0;
        let companyAddress = companyData.address || companyData['Company Address'] || "";
        let companyLogo = companyData.logoUrl || companyData['Company Logo'] || "";
        
        let rawCc = companyData.ccCompanyDefault;
        let ccCompanyDefault = rawCc === undefined ? false : (String(rawCc).toLowerCase() === 'true' || rawCc === true);

        let queryField = companyData['Company ID'] !== undefined ? 'Company ID' : 'companyId';
        const usersSnap = await db.collection('Users').where(queryField, '==', String(resolvedCompanyId)).get();
        
        const inspectors = [];
        let globalRouteStart = null, globalRouteEnd = null, globalRouteState = 'Pending', foundDriverName = '';
        
        usersSnap.forEach(doc => {
            const uData = doc.data();
            
            const rawIsInsp = getField(uData, ['Is Inspector', 'isInspector', 'IsInspector']);
            const isInsp = rawIsInsp === true || String(rawIsInsp).toLowerCase() === 'true';
            
            let startAddr = getField(uData, ['Start Address', 'startAddress']) || "";
            let startLat = getField(uData, ['Start Lat', 'startLat']) || null;
            let startLng = getField(uData, ['Start Lng', 'startLng']) || null;

            let endAddr = getField(uData, ['End Address', 'endAddress']) || "";
            let endLat = getField(uData, ['End Lat', 'endLat']) || null;
            let endLng = getField(uData, ['End Lng', 'endLng']) || null;
            
            const driverName = getField(uData, ['Name', 'name']) || "Inspector";
            const driverEmail = getField(uData, ['Email', 'email']) || "";
            
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

        let csvSettingsSnap = await db.collection('CSV_Settings').where(queryField, '==', String(resolvedCompanyId)).get();
        if (csvSettingsSnap.empty && queryField === 'Company ID') {
            csvSettingsSnap = await db.collection('CSV_Settings').where('companyId', '==', String(resolvedCompanyId)).get();
        }

        const csvTypes = [];
        csvSettingsSnap.forEach(doc => {
            let t = doc.data().csvType || doc.data().Type || doc.data().type;
            if (t) csvTypes.push(t);
        });

        const responseObj = {
            stops: activeStops,
            routeStart: globalRouteStart || null,
            routeEnd: globalRouteEnd || null,
            inspectors: inspectors,
            serviceDelay: serviceDelay,
            companyLogo: companyLogo,
            tier: accountType,
            companyAddress: companyAddress,
            companyEmail: companyEmail,
            defaultEmailMessage: defaultEmailMessage,
            permissions: permissions,
            displayName: displayName,
            adminEmail: "",
            csvTypes: csvTypes,
            accountType: accountType,
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
                let aEmail = getField(adminDoc.data(), ['Email', 'email']);
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
