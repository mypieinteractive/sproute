const { parseCoordsString } = require('./helpers');

async function updateUserFromGlide(payload, res, db) {
    const { driverId, companyId, name, email, startAddress, endAddress, startCoords, endCoords, isInspector } = payload;
    if (!driverId) return res.status(400).json({ error: "Missing driverId." });

    const driverRef = db.collection('Users').doc(String(driverId));
    const driverDoc = await driverRef.get();

    let sGeo = parseCoordsString(startCoords);
    let eGeo = parseCoordsString(endCoords);

    if (!driverDoc.exists) {
        const newUser = {
            'Company ID': companyId || "",
            'Name': name || "New User",
            'Email': email || "",
            'Is Inspector': isInspector === true,
            'Start Address': startAddress || "",
            'End Address': endAddress || "",
            'Start Lat': sGeo ? sGeo.lat : null,
            'Start Lng': sGeo ? sGeo.lng : null,
            'End Lat': eGeo ? eGeo.lat : null,
            'End Lng': eGeo ? eGeo.lng : null,
            'lockedBy': null,
            'activeStaging': {
                'orders': "[]",
                'status': "Pending",
                'conflictFlag': null
            }
        };
        await driverRef.set(newUser);
    } else {
        let updates = {};
        if (name !== undefined) updates['Name'] = name;
        if (email !== undefined) updates['Email'] = email;
        if (companyId !== undefined) updates['Company ID'] = companyId;
        if (isInspector !== undefined) updates['Is Inspector'] = isInspector === true;

        if (startAddress !== undefined) updates['Start Address'] = startAddress;
        if (sGeo) {
            updates['Start Lat'] = sGeo.lat;
            updates['Start Lng'] = sGeo.lng;
        }

        if (endAddress !== undefined) updates['End Address'] = endAddress;
        if (eGeo) {
            updates['End Lat'] = eGeo.lat;
            updates['End Lng'] = eGeo.lng;
        }

        if (Object.keys(updates).length > 0) {
            await driverRef.update(updates);
        }
    }
    return res.status(200).json({ success: true });
}

async function updateCompanyFromGlide(payload, res, db) {
    const { companyId, name, address, email, logoUrl, startHour, serviceDelayMins, defaultEmailMessage, ccCompanyDefault, useExactApi } = payload;
    const subStatus = payload['Subscription Status'];
    
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
    if (subStatus !== undefined) updates['Subscription Status'] = subStatus;
    
    updates['Company ID'] = companyId;
    updates.companyId = companyId;

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
    
    updates['Row ID'] = rowId;
    updates.rowId = rowId;
    
    if (companyId) {
        updates['Company ID'] = companyId;
        updates.companyId = companyId;
    }

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
        updates['Start Address'] = pAddr;
        updates['Start Lat'] = pLat;
        updates['Start Lng'] = pLng;
    } else {
        updates['End Address'] = pAddr;
        updates['End Lat'] = pLat;
        updates['End Lng'] = pLng;
    }

    await driverRef.update(updates);
    return res.status(200).json({ success: true, endpoint: { lat: pLat, lng: pLng, address: pAddr } });
}

module.exports = {
    updateUserFromGlide, updateCompanyFromGlide, updateCsvSettingsFromGlide, updateEndpoint
};
