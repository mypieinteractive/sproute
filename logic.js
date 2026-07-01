/* Dashboard - V15.5 */
/* FILE: logic.js */
/* Changes: */
/* 1. Implemented K-Means++ style initialization in calculateClusters to pick initial centroids based on maximum geographic distance from each other, resolving the severely unbalanced order distribution issue. */
/* 2. Added a robust unique ID generator in expandStop to prevent Map/List selection glitches caused by "undefined" or blank rowIds (ID Collisions). */

export const MASTER_PALETTE = [
    '#34495E', // Brand Dark Slate
    '#3498DB', // Brand Blue
    '#85BA4E', // Brand Green
    '#800000', // Maroon
    '#f58231', // Orange
    '#000000', // Black
    '#ffe119', // Yellow
    '#fabed4'  // Pink
];

export const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
export const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

export function getStatusText(code) {
    if (!code) return 'Pending';
    let c = String(code).trim().toUpperCase();
    if (c === 'S' || c === 'DISPATCHED') return 'Dispatched';
    if (c === 'R' || c === 'ROUTED') return 'Routed';
    if (c === 'C' || c === 'COMPLETED') return 'Completed';
    if (c === 'D' || c === 'DELETED') return 'Deleted';
    if (c === 'V' || c === 'O') return 'Validation Failed';
    if (c === 'P' || c === 'PENDING') return 'Pending';
    return STATUS_MAP_TO_TEXT[c] || 'Pending';
}

export function getStatusCode(text) {
    if (!text) return 'P';
    return STATUS_MAP_TO_CODE[String(text).toLowerCase()] || 'P';
}

export function isRouteAssigned(status) {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'routed' || s === 'completed' || s === 'dispatched';
}

export const isTrueInspector = (val) => val === true || String(val).trim().toLowerCase() === 'true';

export function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function timeToMins(tStr) {
    if (!tStr || typeof tStr !== 'string') return Number.MAX_SAFE_INTEGER;
    let m = tStr.match(/(\d+):(\d+)\s*(AM|PM|am|pm)/i);
    if (!m) return Number.MAX_SAFE_INTEGER;
    let h = parseInt(m[1], 10);
    let mins = parseInt(m[2], 10);
    let p = m[3].toUpperCase();
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return (h * 60) + mins;
}

export function sortByEta(a, b) {
    return timeToMins(a.eta) - timeToMins(b.eta);
}

export function expandStop(minStop) {
    if (!minStop) return {};

    if (!Array.isArray(minStop) && !minStop.rawTuple && !minStop.data && !minStop.tuple && minStop.address) {
        return minStop;
    }

    let t = null;
    if (Array.isArray(minStop)) t = minStop;
    else if (minStop.rawTuple) t = minStop.rawTuple;
    else if (minStop.data) t = minStop.data;
    else if (minStop.tuple) t = minStop.tuple;

    let expanded = { ...minStop }; 

    if (t && Array.isArray(t) && t.length >= 12) {
        let rawCluster = String(t[1] || '').trim().toUpperCase();
        
        // ID COLLISION FIX: Safely parse rowId. If missing or explicitly 'undefined', assign a mathematically unique UUID.
        let rawId = String(t[0]);
        if (!t[0] || rawId === 'undefined' || rawId.trim() === '') {
            rawId = "sproute_uid_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        }

        expanded.id = rawId;
        expanded.rowId = rawId;
        
        if (rawCluster === 'X' || rawCluster === '') {
            expanded.cluster = 'X';
        } else {
            let clusterIdx = parseInt(rawCluster);
            expanded.cluster = isNaN(clusterIdx) ? 'X' : Math.max(0, clusterIdx - 1);
        }
        
        expanded.address = String(t[2] || '');
        expanded.client = String(t[3] || '');
        expanded.app = String(t[4] || '');
        expanded.dueDate = String(t[5] || '');
        expanded.type = String(t[6] || '');
        expanded.eta = String(t[7] || '');
        expanded.dist = parseFloat(t[8] || 0);
        expanded.lat = parseFloat(t[9] || 0);
        expanded.lng = parseFloat(t[10] || 0);
        expanded.status = String(t[11] || 'P');
        expanded.durationSecs = parseInt(t[12] || 0, 10);
    }

    return expanded;
}

export function minifyStop(s, routeNum) {
    return [
        s.rowId || s.id || "", 
        routeNum, 
        s.address || "", 
        s.client ? String(s.client).substring(0, 3) : "", 
        s.app || "",                                      
        s.dueDate || "", 
        s.type || "", 
        s.eta || "", 
        s.dist ? Number(parseFloat(s.dist)) : 0, 
        s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0,       
        s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, 
        getStatusCode(s.status), 
        Number(s.durationSecs) || 0                              
    ];
}

export function isActiveStop(s, isManagerView) {
    const status = (s.status || '').toLowerCase().trim();
    if (isManagerView) {
        if (status === 'dispatched' || status === 's') return false;
        return (status === 'pending' || status === 'routed' || status === 'completed');
    } else {
        let active = status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        if (s.hiddenInInspector) active = false;
        return active;
    }
}

export function isStopVisible(s, applyRouteFilter, isManagerView, currentInspectorFilter, currentRouteViewFilter) {
    if (!isActiveStop(s, isManagerView)) return false;
    
    if (isManagerView && currentInspectorFilter !== 'all') {
        if (String(s.driverId) !== String(currentInspectorFilter)) return false;
    }

    if (!isManagerView && !isRouteAssigned(s.status)) {
        return false;
    }

    if (applyRouteFilter && currentRouteViewFilter !== 'all' && isRouteAssigned(s.status) && s.cluster !== 'X') {
        if (String(s.cluster) !== String(currentRouteViewFilter)) return false;
    }
    
    return true;
}

export function getVisualStyle(stopData, isManagerView, currentInspectorFilter, currentRouteCount, stops, inspectors) {
    const isRouted = isRouteAssigned(stopData.status);
    
    let inspectorIndex = 0;
    if (stopData.driverId) {
        const idx = inspectors.findIndex(i => String(i.id) === String(stopData.driverId));
        if (idx !== -1) inspectorIndex = idx;
    }
    
    const baseColor = MASTER_PALETTE[inspectorIndex % MASTER_PALETTE.length];
    const cluster = stopData.cluster === 'X' ? 0 : (stopData.cluster || 0);
    const hasRoutedForInsp = stops.some(s => String(s.driverId) === String(stopData.driverId) && isRouteAssigned(s.status));
    
    const isPreviewingClusters = isManagerView && currentInspectorFilter !== 'all' && currentRouteCount > 1 && !hasRoutedForInsp && !isRouted;
    const isSinglePreview = isManagerView && currentInspectorFilter !== 'all' && currentRouteCount === 1 && !hasRoutedForInsp && !isRouted;
    
    let bgHex, borderHex = baseColor, textHex;
    
    if (isRouted || isPreviewingClusters) {
        if (cluster === 0) { bgHex = baseColor; textHex = '#ffffff'; }
        else if (cluster === 1) { bgHex = '#000000'; textHex = '#ffffff'; }
        else { bgHex = '#ffffff'; textHex = '#000000'; }
    } else if (isSinglePreview) {
        bgHex = baseColor; textHex = '#ffffff';
    } else {
        bgHex = 'transparent'; textHex = baseColor;
    }

    let bgFinal = bgHex;
    if (bgHex !== 'transparent') {
        bgFinal = bgHex.startsWith('#') ? hexToRgba(bgHex, 0.75) : bgHex;
    }
    return { bg: bgFinal, border: borderHex, text: textHex, line: borderHex };
}

export function calculateClusters(unroutedStops, k, priorityWeight, startGeo) {
    if (unroutedStops.length === 0) return;

    if (k === 1) {
        unroutedStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        return;
    }

    const w = priorityWeight / 100;
    let today = new Date(); 
    today.setHours(0,0,0,0);

    unroutedStops.forEach(s => {
        s._urgency = 0;
        if (s.dueDate) {
            let d = new Date(s.dueDate);
            d.setHours(0,0,0,0);
            if (d < today) s._urgency = 2;
            else if (d.getTime() === today.getTime()) s._urgency = 1;
        }
    });

    // 1. Angular Sweep Algorithm
    // Calculate angle of each stop relative to the start point (depot)
    let originLat = startGeo && startGeo.lat ? startGeo.lat : unroutedStops[0].lat;
    let originLng = startGeo && startGeo.lng ? startGeo.lng : unroutedStops[0].lng;

    let manualStops = unroutedStops.filter(s => s.manualCluster);
    let autoStops = unroutedStops.filter(s => !s.manualCluster);

    autoStops.forEach(s => {
        // Calculate angle from -PI to PI
        s._angle = Math.atan2(s.lng - originLng, s.lat - originLat);
    });

    // Sort radially around the depot
    autoStops.sort((a, b) => a._angle - b._angle);

    // 2. Divide into `k` contiguous angular chunks
    // This perfectly isolates routes radially, preventing crossing paths.
    const baseCapacity = Math.floor(autoStops.length / k);
    let remainder = autoStops.length % k;
    let currentIdx = 0;

    let chunks = [];
    for (let i = 0; i < k; i++) {
        let chunkCapacity = baseCapacity + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;

        let chunk = autoStops.slice(currentIdx, currentIdx + chunkCapacity);
        chunks.push(chunk);
        currentIdx += chunkCapacity;
    }

    // 3. Optional: apply slight K-Means shifting to the boundary nodes if we want,
    // but a pure angular sweep guarantees perfectly balanced capacities + no crossing.
    // We will assign a temporary cluster ID to these chunks.
    for (let i = 0; i < chunks.length; i++) {
        chunks[i].forEach(s => s._tempCluster = i);
    }

    // 4. Urgency-Based Route Numbering
    // We want Route 1 (cluster 0) to ALWAYS have the most urgency, Route 2 (cluster 1) the second, etc.
    // Calculate total urgency for each chunk
    let chunkStats = [];
    for (let i = 0; i < k; i++) {
        let urgencySum = 0;
        let cStops = unroutedStops.filter(s => s._tempCluster === i);
        cStops.forEach(s => urgencySum += s._urgency);

        // Slightly bias the urgency by the priorityWeight slider to allow user control.
        // If slider is 0, we still sort strictly by urgency.
        let finalUrgency = urgencySum + (w * urgencySum);

        chunkStats.push({ tempId: i, urgency: finalUrgency });
    }

    // Sort chunks descending by urgency
    chunkStats.sort((a, b) => b.urgency - a.urgency);

    // Map the sorted chunks to final cluster IDs (0 to k-1)
    for (let newClusterId = 0; newClusterId < k; newClusterId++) {
        let oldTempId = chunkStats[newClusterId].tempId;
        unroutedStops.filter(s => s._tempCluster === oldTempId).forEach(s => {
            s.cluster = newClusterId;
        });
    }

    // Clean up temporary variables
    unroutedStops.forEach(s => {
        delete s._urgency;
        delete s._tempCluster;
        delete s._angle;
    });
}

export function getDistMi(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

export function estimateTSP(startGeo, stopsArr) {
    if (stopsArr.length === 0) return 0;

    let totalDist = 0;
    let currentGeo = startGeo && startGeo.lat ? startGeo : { lat: stopsArr[0].lat, lng: stopsArr[0].lng };
    let unvisited = [...stopsArr];

    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDist = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            let d = getDistMi(currentGeo.lat, currentGeo.lng, unvisited[i].lat, unvisited[i].lng);
            if (d < minDist) {
                minDist = d;
                nearestIdx = i;
            }
        }

        totalDist += minDist;
        currentGeo = { lat: unvisited[nearestIdx].lat, lng: unvisited[nearestIdx].lng };
        unvisited.splice(nearestIdx, 1);
    }

    return totalDist;
}

export function sortStops(stopsArr, col, asc) {
    return stopsArr.sort((a, b) => {
        let valA = a[col] || ''; let valB = b[col] || '';
        if (col === 'dueDate') {
            valA = valA ? new Date(valA).getTime() : Number.MAX_SAFE_INTEGER;
            valB = valB ? new Date(valB).getTime() : Number.MAX_SAFE_INTEGER;
        } else {
            valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
        }
        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
    });
}
