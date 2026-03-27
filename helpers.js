const admin = require('firebase-admin');

function getDistMi(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function colIdx(c) {
    if (!c || c === "(None)" || c === "") return -1;
    let idx = 0;
    for (let i = 0; i < c.length; i++) idx = idx * 26 + (c.charCodeAt(i) - 64);
    return idx - 1;
}

function incrementApiUsage(batch, driverRef, compRef, field, count) {
    if (count <= 0) return;
    batch.update(driverRef, { [field]: admin.firestore.FieldValue.increment(count) });
    batch.update(compRef, { [field]: admin.firestore.FieldValue.increment(count) });
}

function getField(data, keys) {
    for (let k of keys) {
        if (data[k] !== undefined) return data[k];
    }
    return undefined;
}

function safeJsonParse(dataStr, fallback = []) {
    if (!dataStr) return fallback;
    if (typeof dataStr === 'object') return dataStr;
    try {
        return JSON.parse(dataStr);
    } catch (e) {
        return fallback;
    }
}

function parseCoordsString(coordsStr) {
    if (!coordsStr || typeof coordsStr !== 'string') return null;
    let parts = coordsStr.split(',');
    if (parts.length >= 2) {
        let lat = parseFloat(parts[0].trim());
        let lng = parseFloat(parts[1].trim());
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    return null;
}

function formatStopForManager(obj, driverId, companyId, routeState) {
    let sId = Array.isArray(obj) ? obj[0] : (obj.r || obj.rowId);
    let sLat = Array.isArray(obj) ? obj[9] : (obj.l || obj.lat || obj[5]);
    let sLng = Array.isArray(obj) ? obj[10] : (obj.g || obj.lng || obj[6]);
    let sStat = Array.isArray(obj) ? obj[11] : (obj.s || obj.status || obj[7]);
    let sAddr = Array.isArray(obj) ? obj[2] : (obj.address || obj.a || obj[0]);
    let sClient = Array.isArray(obj) ? obj[3] : (obj.client || obj.c || obj[1]);
    let sApp = Array.isArray(obj) ? obj[4] : (obj.app || obj.p || obj[2]);
    let sDue = Array.isArray(obj) ? obj[5] : (obj.dueDate || obj.d || obj[3]);
    let sType = Array.isArray(obj) ? obj[6] : (obj.type || obj.t || obj[4]);

    return {
        rowId: sId, lat: sLat, lng: sLng, status: sStat,
        address: sAddr, client: sClient, app: sApp, dueDate: sDue, type: sType,
        driverId: driverId, companyId: companyId,
        routeState: routeState, routeTargetId: driverId,
        rawTuple: Array.isArray(obj) ? obj : null
    };
}

module.exports = {
    getDistMi, colIdx, incrementApiUsage, getField, 
    safeJsonParse, parseCoordsString, formatStopForManager
};
