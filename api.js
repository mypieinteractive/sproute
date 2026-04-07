/**
 * Dashboard - V13.5 (Enterprise Core)
 * FILE: api.js (Data, State, and Network Layer)
 */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';
const BACKEND_URL = 'https://glidewebhooksync-761669621272.us-south1.run.app';
const params = new URLSearchParams(window.location.search);

const rawViewMode = (params.get('view') || 'inspector').toLowerCase(); 
const activeViewMode = rawViewMode === 'managermobilesplit' ? 'managermobile' : rawViewMode;
const isManagerView = activeViewMode.startsWith('manager'); 
const isMobileManager = activeViewMode === 'managermobile';
const isTestingMode = params.has('testing') || params.get('testing') === '';

// --- GLOBAL STATE ---
let frontEndApiUsage = { geocode: 0, mapLoads: 0 };
let unmatchedAddressesQueue = [];
let currentUnmatchedIndex = 0;
let currentUploadDriverId = null;

let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const adminParam = params.get('admin');

let COMPANY_SERVICE_DELAY = 0; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 

let availableCsvTypes = [];
let currentInspectorFilter = sessionStorage.getItem('sproute_inspector_filter') || 'all';
const currentQuery = window.location.search;
const lastQuery = sessionStorage.getItem('sproute_last_query');
let isFreshGlideRefresh = false;

if (lastQuery && currentQuery !== lastQuery) {
    if (currentQuery.includes('Upload-')) isFreshGlideRefresh = true;
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
let pollRetries = 0;

let currentRouteViewFilter = 'all';
let isFirstMapRender = true;
let latestSuggestions = { start: null, end: null };

let stops = [], originalStops = [], inspectors = [], markers = [], initialBounds = null, selectedIds = new Set(), currentDisplayMode = 'detailed', currentStartTime = "8:00 AM";
let currentSort = { col: null, asc: true };
let geocodeTimeout;
let start_pos, box_el;
let dragCounter = 0;

const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
];

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

// --- UTILITY LOGIC ---
function logToVisualConsole(type, title, payload) {
    if (!isTestingMode) return;
    const consoleEl = document.getElementById('console-firestore');
    if (!consoleEl) return;
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type.toLowerCase()}`;
    let timeStr = new Date().toLocaleTimeString();
    let payloadStr = '';
    if (payload) {
        try {
            payloadStr = typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload);
            if (payloadStr.length > 800) payloadStr = payloadStr.substring(0, 800) + '\n... [TRUNCATED]';
        } catch(e) { payloadStr = 'Unparsable Payload'; }
    }
    entry.innerHTML = `<strong>[${timeStr}] ${title}</strong>${payloadStr ? '<br><br>' + payloadStr : ''}`;
    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function apiFetch(payload) {
    payload.frontEndApiUsage = { geocode: frontEndApiUsage.geocode, mapLoads: frontEndApiUsage.mapLoads };
    frontEndApiUsage.geocode = 0; frontEndApiUsage.mapLoads = 0;
    
    logToVisualConsole('REQ', `POST /${payload.action}`, payload);
    try {
        const response = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const clone = response.clone();
        clone.json().then(data => logToVisualConsole('RES', `POST /${payload.action} (Success)`, data)).catch(e => logToVisualConsole('RES', `POST /${payload.action}`, 'Non-JSON Response Received'));
        return response;
    } catch (err) {
        console.error(`POST ${payload.action} Error:`, err);
        logToVisualConsole('ERR', `POST /${payload.action} FAILED`, err.message);
        throw err;
    }
}

function getStatusText(code) {
    if (!code) return 'Pending';
    let c = String(code).trim().toUpperCase();
    if (['S', 'DISPATCHED'].includes(c)) return 'Dispatched';
    if (['R', 'ROUTED'].includes(c)) return 'Routed';
    if (['C', 'COMPLETED'].includes(c)) return 'Completed';
    if (['D', 'DELETED'].includes(c)) return 'Deleted';
    if (['V', 'O'].includes(c)) return 'Validation Failed';
    return STATUS_MAP_TO_TEXT[c] || 'Pending';
}

function getStatusCode(text) { return STATUS_MAP_TO_CODE[String(text || '').toLowerCase()] || 'P'; }
function isRouteAssigned(status) { const s = (status || '').toLowerCase(); return s === 'routed' || s === 'completed' || s === 'dispatched'; }
const isTrueInspector = (val) => val === true || String(val).trim().toLowerCase() === 'true';

function isActiveStop(s) {
    const status = (s.status || '').toLowerCase().trim();
    if (isManagerView) return (status === 'pending' || status === 'routed' || status === 'completed');
    let active = status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
    return s.hiddenInInspector ? false : active;
}

function isStopVisible(s, applyRouteFilter = true) {
    if (!isActiveStop(s)) return false;
    if (isManagerView && currentInspectorFilter !== 'all' && String(s.driverId) !== String(currentInspectorFilter)) return false;
    if (!isManagerView && !isRouteAssigned(s.status)) return false;
    if (applyRouteFilter && currentRouteViewFilter !== 'all' && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== currentRouteViewFilter) return false;
    return true;
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
    } else if (isSinglePreview) { bgHex = baseColor; textHex = '#ffffff'; } 
    else { bgHex = 'transparent'; textHex = baseColor; }

    return { bg: bgHex !== 'transparent' && bgHex.startsWith('#') ? hexToRgba(bgHex, 0.75) : bgHex, border: borderHex, text: textHex, line: borderHex };
}

function expandStop(minStop) {
    if (!minStop) return {};
    if (!Array.isArray(minStop) && !minStop.rawTuple && !minStop.data && !minStop.tuple && minStop.address) return minStop;
    let t = Array.isArray(minStop) ? minStop : (minStop.rawTuple || minStop.data || minStop.tuple);
    let expanded = { ...minStop }; 

    if (t && Array.isArray(t) && t.length >= 12) {
        let rawCluster = String(t[1] || '').trim().toUpperCase();
        expanded.id = String(t[0]); expanded.rowId = String(t[0]);
        if (rawCluster === 'X' || rawCluster === '') expanded.cluster = 'X';
        else { let clusterIdx = parseInt(rawCluster); expanded.cluster = isNaN(clusterIdx) ? 'X' : Math.max(0, clusterIdx - 1); }
        expanded.address = String(t[2] || ''); expanded.client = String(t[3] || '');
        expanded.app = String(t[4] || ''); expanded.dueDate = String(t[5] || '');
        expanded.type = String(t[6] || ''); expanded.eta = String(t[7] || '');
        expanded.dist = parseFloat(t[8] || 0); expanded.lat = parseFloat(t[9] || 0);
        expanded.lng = parseFloat(t[10] || 0); expanded.status = String(t[11] || 'P');
        expanded.durationSecs = parseInt(t[12] || 0, 10);
    }
    return expanded;
}

function minifyStop(s, routeNum) {
    return [
        s.rowId || s.id || "", routeNum, s.address || "", s.client ? String(s.client).substring(0, 3) : "", 
        s.app || "", s.dueDate || "", s.type || "", s.eta || "", s.dist ? Number(parseFloat(s.dist)) : 0, 
        s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0, s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, 
        getStatusCode(s.status), Number(s.durationSecs) || 0                              
    ];
}

function timeToMins(tStr) {
    if (!tStr || typeof tStr !== 'string') return Number.MAX_SAFE_INTEGER;
    let m = tStr.match(/(\d+):(\d+)\s*(AM|PM|am|pm)/i);
    if (!m) return Number.MAX_SAFE_INTEGER;
    let h = parseInt(m[1], 10), mins = parseInt(m[2], 10), p = m[3].toUpperCase();
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return (h * 60) + mins;
}

function getActiveEndpoints() {
    if (!isManagerView) return { start: routeStart ? { address: routeStart.address, lat: routeStart.lat, lng: routeStart.lng } : null, end: routeEnd ? { address: routeEnd.address, lat: routeEnd.lat, lng: routeEnd.lng } : null };
    if (isManagerView && currentInspectorFilter === 'all') return { start: null, end: null };
    
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const insp = inspectors.find(i => String(i.id) === String(inspId));
    const hasRouted = stops.some(s => isActiveStop(s) && String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    
    let start = null, end = null;
    if (hasRouted && routeStart && routeStart.address) start = routeStart;
    else if (insp) start = { address: insp.startAddress || insp.start || '', lat: insp.startLat, lng: insp.startLng };
    
    if (hasRouted && routeEnd && routeEnd.address) end = routeEnd;
    else if (insp) end = { address: insp.endAddress || insp.end || insp.startAddress || insp.start || '', lat: insp.endLat || insp.startLat, lng: insp.endLng || insp.startLng };
    
    return { start, end };
}

function markRouteDirty(driverId, clusterIdx) { dirtyRoutes.add(`${driverId || 'unassigned'}_${clusterIdx || 0}`); }
function pushToHistory() { historyStack.push({ stops: JSON.parse(JSON.stringify(stops)), dirty: new Set(dirtyRoutes) }); if (historyStack.length > 20) historyStack.shift(); if(typeof updateUndoUI === 'function') updateUndoUI(); }

async function undoLastAction() {
    if (historyStack.length === 0) return;
    const last = historyStack.pop();
    const resurrectedStops = last.stops.filter(oldStop => !stops.some(currentStop => String(currentStop.id) === String(oldStop.id)));
    stops = last.stops; dirtyRoutes = new Set(last.dirty);

    if (resurrectedStops.length > 0) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'flex';
        try {
            let payload = { action: 'recreateOrders', driverId: isManagerView ? currentInspectorFilter : driverParam, orders: resurrectedStops };
            if (!isManagerView) payload.routeId = routeId;
            await apiFetch(payload);
        } catch (e) {} finally { if (overlay) overlay.style.display = 'none'; }
    }
    if (typeof render === 'function') { render(); drawRoute(); updateSummary(); updateRouteTimes(); updateUndoUI(); }
    silentSaveRouteState(); 
}

function silentSaveRouteState() {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    if (inspId === 'all' || !inspId) return;
    let routedStops = stops.filter(s => {
        if (!isRouteAssigned(s.status)) return false;
        return isManagerView ? String(s.driverId) === String(inspId) : s.routeTargetId === String(routeId);
    });
    if (routedStops.length === 0) return;

    let minified = routedStops.map(s => minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1));
    let macroState = dirtyRoutes.has('endpoints_0') ? 'Staging-endpoint' : (dirtyRoutes.size > 0 ? 'Staging' : 'Ready');
    let payload = { action: 'saveRoute', driverId: inspId, stops: minified, routeState: macroState };
    if (!isManagerView) payload.routeId = routeId;
    apiFetch(payload).catch(e => console.log("Silent save error", e));
}
