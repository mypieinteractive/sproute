/* Dashboard - V15.4 */
/* FILE: logic.js */
/* Changes: */
/* 1. Extracted pure algorithms, business rules, and data formatting from app.js to create a dependency-free logic module. */
/* 2. Modified functions like getVisualStyle and calculateClusters to accept state as parameters, preventing circular dependencies. */

export const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', 
    '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', 
    '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
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
        
        expanded.id = String(t[0]);
        expanded.rowId = String(t[0]);
        
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
        if (s.cluster !== currentRouteViewFilter) return false;
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

export function calculateClusters(unroutedStops, k, priorityWeight) {
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

    let centroids = [];
    for(let i=0; i<k; i++) {
        let idx = Math.floor(i * unroutedStops.length / k);
        centroids.push({ lat: unroutedStops[idx].lat, lng: unroutedStops[idx].lng });
    }

    for(let iter=0; iter<5; iter++) {
        unroutedStops.forEach(s => {
            let bestD = Infinity, bestC = 0;
            centroids.forEach((c, cIdx) => {
                let d = Math.sqrt(Math.pow(s.lat - c.lat, 2) + Math.pow(s.lng - c.lng, 2));
                if (d < bestD) { bestD = d; bestC = cIdx; }
            });
            s._tempCluster = bestC;
        });
        for(let i=0; i<k; i++) {
            let cStops = unroutedStops.filter(s => s._tempCluster === i);
            if(cStops.length > 0) {
                centroids[i].lat = cStops.reduce((sum, s) => sum + s.lat, 0) / cStops.length;
                centroids[i].lng = cStops.reduce((sum, s) => sum + s.lng, 0) / cStops.length;
            }
        }
    }

    let clusterUrgency = new Array(k).fill(0);
    unroutedStops.forEach(s => { clusterUrgency[s._tempCluster] += s._urgency; });
    let bestClusterIdx = 0, maxUrg = -1;
    for(let i=0; i<k; i++) {
        if (clusterUrgency[i] > maxUrg) { maxUrg = clusterUrgency[i]; bestClusterIdx = i; }
    }
    let temp = centroids[0];
    centroids[0] = centroids[bestClusterIdx];
    centroids[bestClusterIdx] = temp;

    let capacity = Math.ceil(unroutedStops.length / k);
    
    let maxGeoDist = 0.0001;
    unroutedStops.forEach(s => {
        centroids.forEach(c => {
            let d = Math.sqrt(Math.pow(s.lat - c.lat, 2) + Math.pow(s.lng - c.lng, 2));
            if (d > maxGeoDist) maxGeoDist = d;
        });
    });

    const pullMultiplier = maxGeoDist * 2.5; 

    unroutedStops.forEach(s => {
        if (s.manualCluster) return;

        let dist0 = Math.sqrt(Math.pow(s.lat - centroids[0].lat, 2) + Math.pow(s.lng - centroids[0].lng, 2));
        let bestAltDist = Infinity;
        let bestAltIdx = 0;

        for(let i=1; i<k; i++) {
            let d = Math.sqrt(Math.pow(s.lat - centroids[i].lat, 2) + Math.pow(s.lng - centroids[i].lng, 2));
            if (d < bestAltDist) { bestAltDist = d; bestAltIdx = i; }
        }

        let effectiveDist0 = dist0 - ((s._urgency / 2) * w * pullMultiplier);
        s._dist0 = dist0;
        s._bestAltDist = bestAltDist;
        s._bestAltIdx = bestAltIdx;
        s._effectiveDist0 = effectiveDist0;
        s._affinity0 = bestAltDist - effectiveDist0;
    });

    let sortedStops = [...unroutedStops].filter(s => !s.manualCluster).sort((a, b) => b._affinity0 - a._affinity0);

    let route0Count = 0;
    let altCounts = new Array(k).fill(0);

    sortedStops.forEach(s => {
        let wants0 = s._affinity0 > 0;
        if (wants0) {
            if (route0Count < capacity) {
                s.cluster = 0;
                route0Count++;
            } else if (s._effectiveDist0 < 0) {
                s.cluster = 0;
                route0Count++;
            } else {
                s.cluster = s._bestAltIdx;
                altCounts[s._bestAltIdx]++;
            }
        } else {
            s.cluster = s._bestAltIdx;
            altCounts[s._bestAltIdx]++;
        }
    });

    unroutedStops.forEach(s => {
        delete s._urgency;
        delete s._tempCluster;
        delete s._dist0;
        delete s._bestAltDist;
        delete s._bestAltIdx;
        delete s._effectiveDist0;
        delete s._affinity0;
    });
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
