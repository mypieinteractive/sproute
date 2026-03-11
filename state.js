// *
// * Dashboard - V6.6
// * FILE: state.js
// * Description: Core configuration, shared mutable State object, and helper utilities. (Zero Imports)
// *

export const Config = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA',
    WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzgh2KCzfdWbOmdVq_edpuI_m6HxkfErzYAEHySfKkq1zgLtwuiUT3GCS5Xor9GgjFa/exec',
    MASTER_PALETTE: [
        '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', 
        '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
        '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', 
        '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
    ],
    STATUS_MAP_TO_TEXT: { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' },
    STATUS_MAP_TO_CODE: { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' }
};

const params = new URLSearchParams(window.location.search);
const viewMode = params.get('view') || 'inspector';

export const State = {
    routeId: params.get('id'),
    driverParam: params.get('driver'),
    companyParam: params.get('company'),
    viewMode: viewMode,
    isManagerView: (viewMode === 'manager' || viewMode === 'managermobile'),
    
    COMPANY_SERVICE_DELAY: 0, 
    PERMISSION_MODIFY: true,
    PERMISSION_REOPTIMIZE: true,
    sortableInstances: [],
    sortableUnrouted: null,
    currentRouteCount: 1, 
    currentInspectorFilter: 'all',
    defaultEmailMessage: "",
    companyEmail: "",
    managerEmail: "",
    routeStart: null,
    routeEnd: null,
    dirtyRoutes: new Set(), 
    historyStack: [],
    isAlteredRoute: false,
    isPollingForRoute: false,
    pollRetries: 0,
    latestSuggestions: { start: null, end: null },
    
    stops: [], 
    originalStops: [], 
    inspectors: [], 
    markers: [], 
    initialBounds: null, 
    selectedIds: new Set(), 
    currentDisplayMode: 'detailed', 
    currentStartTime: "8:00 AM",
    currentSort: { col: null, asc: true }
};

export function getStatusText(code) {
    if (!code) return 'Pending';
    let c = String(code).trim().toUpperCase();
    if (c === 'S' || c === 'DISPATCHED') return 'Dispatched';
    if (c === 'R' || c === 'ROUTED') return 'Routed';
    if (c === 'C' || c === 'COMPLETED') return 'Completed';
    if (c === 'D' || c === 'DELETED') return 'Deleted';
    if (c === 'V' || c === 'O') return 'Validation Failed';
    if (c === 'P' || c === 'PENDING') return 'Pending';
    return Config.STATUS_MAP_TO_TEXT[c] || 'Pending';
}

export function getStatusCode(text) {
    if (!text) return 'P';
    return Config.STATUS_MAP_TO_CODE[String(text).toLowerCase()] || 'P';
}

export function expandStop(minStop) {
    if (minStop.address) return minStop; 
    
    if (minStop.rawTuple && Array.isArray(minStop.rawTuple)) {
        const t = minStop.rawTuple;
        let clusterIdx = 0;
        if (typeof t[2] === 'string' && t[2].startsWith('R:')) clusterIdx = parseInt(t[2].split(':')[1]) - 1;
        else if (!isNaN(parseInt(t[2]))) clusterIdx = parseInt(t[2]) - 1;
        
        return {
            ...minStop, id: t[0], seq: t[1], cluster: Math.max(0, clusterIdx),
            address: t[3], client: t[4], app: t[5], dueDate: t[6], type: t[7],
            eta: t[8], dist: t[9], lat: t[10], lng: t[11], status: t[12], 
            durationSecs: t[13], rowId: t[0]
        };
    }

    let rawCluster = minStop.R;
    let clusterIdx = 0;
    if (typeof rawCluster === 'string' && rawCluster.startsWith('R:')) clusterIdx = parseInt(rawCluster.split(':')[1]) - 1;
    else if (!isNaN(parseInt(rawCluster))) clusterIdx = parseInt(rawCluster) - 1;
    
    return {
        ...minStop, id: minStop.r || minStop.i, seq: minStop.i, cluster: Math.max(0, clusterIdx),
        address: minStop.a, client: minStop.c, app: minStop.p, dueDate: minStop.d, type: minStop.t,
        eta: minStop.e, dist: minStop.D, lat: minStop.l, lng: minStop.g, status: minStop.s, 
        durationSecs: minStop.u, rowId: minStop.r
    };
}

export function minifyStop(s, routeNum) {
    return [
        s.rowId || s.id || "", Number(s.seq) || 0, 'R:' + routeNum, s.address || "", s.client || "", s.app || "",                                            
        s.dueDate || "", s.type || "", s.eta || "", s.dist || "", s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0,       
        s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, getStatusCode(s.status), Number(s.durationSecs) || 0                             
    ];
}

export function isActiveStop(s) {
    const status = (s.status || '').toLowerCase().trim();
    const routeState = (s.routeState || '').toLowerCase().trim();

    if (State.isManagerView) {
        if (routeState === 'dispatched' || status === 'dispatched' || status === 's') return false;
        return (status === 'pending' || status === 'routed' || status === 'completed');
    } else {
        let active = status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        if (s.hiddenInInspector) active = false;
        return active;
    }
}

export function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function markRouteDirty(driverId, clusterIdx) {
    State.dirtyRoutes.add(`${driverId || 'unassigned'}_${clusterIdx || 0}`);
}

export function getVisualStyle(stopData) {
    const isRouted = (stopData.status || '').toLowerCase() === 'routed' || (stopData.status || '').toLowerCase() === 'completed' || (stopData.status || '').toLowerCase() === 'dispatched';
    
    let inspectorIndex = 0;
    if (stopData.driverId) {
        const idx = State.inspectors.findIndex(i => i.id === stopData.driverId);
        if (idx !== -1) inspectorIndex = idx;
    }
    
    const baseColor = Config.MASTER_PALETTE[inspectorIndex % Config.MASTER_PALETTE.length];
    const cluster = stopData.cluster || 0;
    const hasRoutedForInsp = State.stops.some(s => s.driverId === stopData.driverId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
    const isPreviewingClusters = State.isManagerView && State.currentInspectorFilter !== 'all' && State.currentRouteCount > 1 && !hasRoutedForInsp && !isRouted;
    const isSinglePreview = State.isManagerView && State.currentInspectorFilter !== 'all' && State.currentRouteCount === 1 && !hasRoutedForInsp && !isRouted;
    
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
    if (bgHex !== 'transparent') bgFinal = bgHex.startsWith('#') ? hexToRgba(bgHex, 0.75) : bgHex;
    return { bg: bgFinal, border: borderHex, text: textHex, line: borderHex };
}
