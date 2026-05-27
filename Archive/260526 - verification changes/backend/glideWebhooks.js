/**
 * glideWebhooks.js
 * VERSION: V15.0
 * * CHANGES:
 * V1.36 - Decoupled Billing Logic. Replaced the generic subscription mapping with 
 * four explicit, dedicated billing fields (accountType, subscriptionStatus, 
 * subscriptionId, subscriptionExpiry) to support future Stripe integrations while 
 * maintaining clean frontend UI rendering.
 * V1.35 - Pure CamelCase Harmonization. 
 */

const { parseCoordsString } = require('./helpers');

async function updateUserFromGlide(payload, res, db) {
    const { driverId, companyId, name, email, startAddress, endAddress, startCoords, endCoords, isInspector } = payload;
    if (!driverId) return res.status(400).json({ error: "Missing driverId." });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();

    let sGeo = parseCoordsString(startCoords);
    let eGeo = parseCoordsString(endCoords);
    
    // Safely parse the boolean in case Google Sheets/Glide passes it as a string
    const parsedIsInspector = isInspector === true || String(isInspector).toLowerCase() === 'true';

    if (!driverDoc.exists) {
        const newUser = {
            companyId: companyId || "",
            name: name || "New User",
            email: email || "",
            isInspector: parsedIsInspector,
            startAddress: startAddress || "",
            endAddress: endAddress || "",
            startLat: sGeo ? sGeo.lat : null,
            startLng: sGeo ? sGeo.lng : null,
            endLat: eGeo ? eGeo.lat : null,
            endLng: eGeo ? eGeo.lng : null,
            lockedBy: null,
            activeStaging: {
                orders: "[]",
                status: "Pending",
                conflictFlag: null
            }
        };
        await driverRef.set(newUser);
    } else {
        let updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (companyId !== undefined) updates.companyId = companyId;
        if (isInspector !== undefined) updates.isInspector = parsedIsInspector;

        if (startAddress !== undefined) updates.startAddress = startAddress;
        if (sGeo) {
            updates.startLat = sGeo.lat;
            updates.startLng = sGeo.lng;
        }

        if (endAddress !== undefined) updates.endAddress = endAddress;
        if (eGeo) {
            updates.endLat = eGeo.lat;
            updates.endLng = eGeo.lng;
        }

        if (Object.keys(updates).length > 0) {
            await driverRef.update(updates);
        }
    }
    return res.status(200).json({ success: true });
}

async function updateCompanyFromGlide(payload, res, db) {
    const { 
        companyId, name, address, email, logoUrl, startHour, serviceDelayMins, 
        defaultEmailMessage, ccCompanyDefault, useExactApi,
        accountType, subscriptionStatus, subscriptionId, subscriptionExpiry
    } = payload;
    
    if (!companyId) return res.status(400).json({ error: "Missing companyId." });

    const compRef = db.collection('Companies').doc(String(companyId));
    
    let updates = {};
    if (name !== undefined) updates.name = name;
    if (address !== undefined) updates.address = address;
    if (email !== undefined) updates.email = email;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (startHour !== undefined) updates.startHour = startHour;
    if (serviceDelayMins !== undefined) updates.serviceDelayMins = serviceDelayMins;
    if (defaultEmailMessage !== undefined) updates.defaultEmailMessage = defaultEmailMessage;
    if (ccCompanyDefault !== undefined) updates.ccCompanyDefault = ccCompanyDefault;
    if (useExactApi !== undefined) updates.useExactApi = useExactApi;
    
    // Dedicated Billing Fields
    if (accountType !== undefined) updates.accountType = accountType;
    if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
    if (subscriptionId !== undefined) updates.subscriptionId = subscriptionId;
    if (subscriptionExpiry !== undefined) updates.subscriptionExpiry = subscriptionExpiry;

    await compRef.set(updates, { merge: true });
    return res.status(200).json({ success: true });
}

async function updateCsvSettingsFromGlide(payload, res, db) {
    const { rowId, companyId, csvType, address, zip, client, dueDate, orderType, lat, lng, city, state } = payload;
    if (!rowId) return res.status(400).json({ error: "Missing rowId." });

    const csvRef = db.collection('CSV_Settings').doc(String(rowId));
    
    let updates = {};
    if (csvType !== undefined) updates.csvType = csvType;
    if (address !== undefined) updates.address = address;
    if (zip !== undefined) updates.zip = zip;
    if (client !== undefined) updates.client = client;
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (orderType !== undefined) updates.orderType = orderType;
    if (lat !== undefined) updates.lat = lat;
    if (lng !== undefined) updates.lng = lng;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (companyId !== undefined) updates.companyId = companyId;

    await csvRef.set(updates, { merge: true });
    return res.status(200).json({ success: true });
}

async function updateEndpoint(payload, res, db) {
    const { driverId, type, address, lat, lng } = payload;
    if (!driverId || !type) return res.status(400).json({ error: "Missing parameters." });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) return res.status(404).json({ error: "Driver not found." });

    let pLat = parseFloat(lat);
    let pLng = parseFloat(lng);
    let pAddr = address || "";

    let updates = {};
    if (type === 'start') {
        updates.startAddress = pAddr;
        updates.startLat = pLat;
        updates.startLng = pLng;
    } else {
        updates.endAddress = pAddr;
        updates.endLat = pLat;
        updates.endLng = pLng;
    }

    await driverRef.update(updates);
    return res.status(200).json({ success: true, endpoint: { lat: pLat, lng: pLng, address: pAddr } });
}

module.exports = {
    updateUserFromGlide, updateCompanyFromGlide, updateCsvSettingsFromGlide, updateEndpoint
};
