// *
// * Dashboard - V12.4
// * FILE: config.js
// * Changes: Centralized state variables, global settings, and Testing Mode logic.
// *

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';

const params = new URLSearchParams(window.location.search);
let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const adminParam = params.get('admin');
const backendParam = params.get('backend'); 

// --- A/B Testing Mode Configuration ---
let WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzgh2KCzfdWbOmdVq_edpuI_m6HxkfErzYAEHySfKkq1zgLtwuiUT3GCS5Xor9GgjFa/exec';
let isTestingMode = (backendParam === 'testing');
let activeTestingBackend = sessionStorage.getItem('sproute_testing_backend') || 'appscript';

if (isTestingMode) {
    if (activeTestingBackend === 'firestore') {
        WEB_APP_URL = 'https://glidewebhooksync-761669621272.us-south1.run.app';
        console.log("🔥 Testing Mode: API requests routed to Firestore (Cloud Run).");
    } else {
        console.log("🟢 Testing Mode: API requests routed to Apps Script.");
    }
}
// --------------------------------------

// Global API Usage Tracker
let frontEndApiUsage = { geocode: 0, mapLoads: 0 };

const viewMode = (params.get('view') || 'inspector').toLowerCase(); 
const isManagerView = (viewMode === 'manager' || viewMode === 'managermobile' || viewMode === 'managermobilesplit'); 

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

let COMPANY_SERVICE_DELAY = 0; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 

let availableCsvTypes = [];
let currentInspectorFilter = sessionStorage.getItem('sproute_inspector_filter') || 'all';

// GLIDE REFRESH TRACKING
const currentQuery = window.location.search;
const lastQuery = sessionStorage.getItem('sproute_last_query');
let isFreshGlideRefresh = false;

if (lastQuery && currentQuery !== lastQuery) {
    if (currentQuery.includes('Upload-')) {
        isFreshGlideRefresh = true;
    }
}
sessionStorage.setItem('sproute_last_query', currentQuery);

let pageLoadRetries = 0;
const MAX_RETRIES = 5;

let defaultEmailMessage = "";
let companyEmail = "";
let managerEmail = "";
let adminEmail = ""; 
let ccCompanyDefault = true;

let routeStart = null;
let routeEnd = null;

let dirtyRoutes = new Set(); 
let historyStack = [];
let isAlteredRoute = false;

let isPollingForRoute = false;
let isPollingForUpload = false;
let pollRetries = 0;

let currentRouteViewFilter = 'all';
let isFirstMapRender = true;
let latestSuggestions = { start: null, end: null };

let stops = [], originalStops = [], inspectors = [], markers = [], initialBounds = null, selectedIds = new Set(), currentDisplayMode = 'detailed', currentStartTime = "8:00 AM";
let currentSort = { col: null, asc: true };

const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', 
    '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', 
    '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
];

function getStatusText(code) {
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

function getStatusCode(text) {
    if (!text) return 'P';
    return STATUS_MAP_TO_CODE[String(text).toLowerCase()] || 'P';
}

function isRouteAssigned(status) {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'routed' || s === 'completed' || s === 'dispatched';
}

function expandStop(minStop) {
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

function minifyStop(s, routeNum) {
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

function timeToMins(tStr) {
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

function sortByEta(a, b) {
    return timeToMins(a.eta) - timeToMins(b.eta);
}

function isActiveStop(s) {
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

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getVisualStyle(stopData) {
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

function isStopVisible(s, applyRouteFilter = true) {
    if (!isActiveStop(s)) return false;
    
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

function getActiveEndpoints() {
    if (!isManagerView) {
        return { 
            start: routeStart ? { address: routeStart.address, lat: routeStart.lat, lng: routeStart.lng } : null, 
            end: routeEnd ? { address: routeEnd.address, lat: routeEnd.lat, lng: routeEnd.lng } : null 
        };
    }
    
    if (isManagerView && currentInspectorFilter === 'all') return { start: null, end: null };
    
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const insp = inspectors.find(i => String(i.id) === String(inspId));
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    
    let start = null; 
    let end = null;
    
    if (hasRouted && routeStart && routeStart.address) {
        start = routeStart;
    } else if (insp) {
        start = { address: insp.startAddress || insp.start || '', lat: insp.startLat, lng: insp.startLng };
    }
    
    if (hasRouted && routeEnd && routeEnd.address) {
        end = routeEnd;
    } else if (insp) {
        end = { address: insp.endAddress || insp.end || insp.startAddress || insp.start || '', lat: insp.endLat || insp.startLat, lng: insp.endLng || insp.startLng };
    }
    
    return { start, end };
}
