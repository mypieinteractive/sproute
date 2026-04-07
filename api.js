/**
 * Dashboard - V13.4 (Enterprise Core)
 * FILE: api.js (Data, State, and Network Layer)
 */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';
const BACKEND_URL = 'https://glidewebhooksync-761669621272.us-south1.run.app';
const params = new URLSearchParams(window.location.search);

// --- GLOBAL STATE VARIABLES ---
let frontEndApiUsage = { geocode: 0, mapLoads: 0 };
let unmatchedAddressesQueue = [];
let currentUnmatchedIndex = 0;
let currentUploadDriverId = null;

let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const adminParam = params.get('admin');

const rawViewMode = (params.get('view') || 'inspector').toLowerCase(); 
const activeViewMode = rawViewMode === 'managermobilesplit' ? 'managermobile' : rawViewMode;
const isManagerView = activeViewMode.startsWith('manager'); 
const isMobileManager = activeViewMode === 'managermobile';
const isTestingMode = params.has('testing') || params.get('testing') === '';

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

const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
];

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

// --- UTILITY FUNCTIONS ---
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

function isStopVisible(s, applyRouteFilter = true) {
    if (!isActiveStop(s)) return false;
    if (isManagerView && currentInspectorFilter !== 'all' && String(s.driverId) !== String(currentInspectorFilter)) return false;
    if (!isManagerView && !isRouteAssigned(s.status)) return false;
    if (applyRouteFilter && currentRouteViewFilter !== 'all' && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== currentRouteViewFilter) return false;
    return true;
}

function isActiveStop(s) {
    const status = (s.status || '').toLowerCase().trim();
    if (isManagerView) return (status === 'pending' || status === 'routed' || status === 'completed');
    let active = status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
    return s.hiddenInInspector ? false : active;
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

function getActiveEndpoints() {
    if (!isManagerView) {
        return { start: routeStart ? { address: routeStart.address, lat: routeStart.lat, lng: routeStart.lng } : null, end: routeEnd ? { address: routeEnd.address, lat: routeEnd.lat, lng: routeEnd.lng } : null };
    }
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

// --- CORE DATA FETCHING ---
async function loadData() {
    if (!routeId && !companyParam && !driverParam) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
        return;
    }

    let queryParams = '';
    if (routeId) queryParams = `?id=${routeId}`;
    else if (companyParam) queryParams = `?company=${companyParam}`;
    else if (driverParam) queryParams = `?driver=${driverParam}`;
    if (adminParam) queryParams += (queryParams ? '&' : '?') + `admin=${adminParam}`;
    queryParams += (queryParams ? '&' : '?') + `isManager=${isManagerView}`;

    try {
        let fetchUrl = `${BACKEND_URL}${queryParams}&_t=${new Date().getTime()}`;
        logToVisualConsole('REQ', 'GET /loadData', fetchUrl);
        const res = await fetch(fetchUrl);
        const data = await res.clone().json();
        logToVisualConsole('RES', 'GET /loadData (Success)', data);
        
        if (data.confirmHijack) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            
            const proceed = await (typeof customConfirm === 'function' ? customConfirm(data.message || "The previous admin's session has expired. Do you want to take over and overwrite this Inspector's route?") : Promise.resolve(true));
            if (overlay) overlay.style.display = 'flex'; 
            
            if (proceed) apiFetch({ action: 'executeHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter }).catch(e => console.log(e));
            else apiFetch({ action: 'cancelHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter }).catch(e => console.log(e));
            setTimeout(loadData, 2000); 
            return;
        }

        if (data.uploadError) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            if(typeof customAlert === 'function') await customAlert(data.message || "Upload cancelled. Another admin is currently modifying this Inspector's route.");
            if (adminParam) apiFetch({ action: 'clearAlert', adminId: adminParam }).catch(e => console.log(e));
            return;
        }

        let rawStops = Array.isArray(data) ? data : (data.stops ? (typeof data.stops === 'string' ? JSON.parse(data.stops) : data.stops) : []);
        let currentSnapshot = JSON.stringify(rawStops);
        let preUploadSnapshot = sessionStorage.getItem('sproute_snapshot');

        if (isFreshGlideRefresh && preUploadSnapshot && (currentSnapshot === preUploadSnapshot || rawStops.length === 0) && pageLoadRetries < MAX_RETRIES) {
            pageLoadRetries++;
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'flex';
            setTimeout(loadData, 3000); 
            return; 
        }
        
        if (isFreshGlideRefresh && preUploadSnapshot && currentSnapshot !== preUploadSnapshot) {
            try {
                const oldStops = JSON.parse(preUploadSnapshot);
                let diffStop = rawStops.find(n => {
                    let oldStr = oldStops.find(o => (o.rowId || o.id || o[0]) === (n.rowId || n.id || n[0]));
                    return !oldStr || JSON.stringify(oldStr) !== JSON.stringify(n);
                });
                if (diffStop) {
                    let expandedDiff = expandStop(diffStop);
                    if (expandedDiff.driverId && isManagerView) {
                        currentInspectorFilter = String(expandedDiff.driverId);
                        sessionStorage.setItem('sproute_inspector_filter', currentInspectorFilter);
                    }
                }
            } catch(e) {}
        }

        isFreshGlideRefresh = false; 
        if (!data.uploadError && !data.confirmHijack) sessionStorage.setItem('sproute_snapshot', currentSnapshot);
        if (data.routeId) routeId = data.routeId;
        if (data.needsRecalculation) { isAlteredRoute = true; dirtyRoutes.add('all'); }

        routeStart = data.routeStart || null;
        routeEnd = data.routeEnd || null;
        if (data.isAlteredRoute) isAlteredRoute = true;

        let globalRouteState = data.routeState || 'Pending';
        let globalDriverId = data.driverId || (isManagerView && currentInspectorFilter !== 'all' ? currentInspectorFilter : driverParam);

        if (data.adminEmail) adminEmail = data.adminEmail;
        if (data.csvTypes && Array.isArray(data.csvTypes)) availableCsvTypes = data.csvTypes;

        if (isPollingForRoute) {
            let fetchedMap = new Map();
            rawStops.forEach(s => {
                let exp = expandStop(s);
                fetchedMap.set(String(exp.rowId || exp.id), {
                    ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster,
                    manualCluster: false, hiddenInInspector: false, routeState: exp.routeState || s.routeState || globalRouteState,
                    driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: routeId || null
                });
            });

            stops = stops.map(s => {
                if (fetchedMap.has(String(s.id))) return fetchedMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready'; 
                return s;
            });
            
            stops.forEach(s => { if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster); });

            const driverHasRouted = stops.some(s => String(s.driverId) === String(currentInspectorFilter) && (isRouteAssigned(s.status) || s.routeState === 'Ready'));
            
            if (!driverHasRouted && pollRetries < 15) {
                pollRetries++;
                const overlay = document.getElementById('processing-overlay');
                if (overlay) overlay.style.display = 'flex';
                setTimeout(loadData, 5000);
                return;
            } else {
                isPollingForRoute = false; dirtyRoutes.clear(); silentSaveRouteState();
            }
        } else {
            stops = rawStops.map(s => {
                let exp = expandStop(s);
                return {
                    ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster,
                    manualCluster: false, hiddenInInspector: false, routeState: exp.routeState || s.routeState || globalRouteState,
                    driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: routeId || null
                };
            });
            stops.forEach(s => { if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster); });
        }

        stops.sort((a, b) => {
            let cA = a.cluster === 'X' ? 999 : (a.cluster || 0);
            let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
            if (cA !== cB) return cA - cB;
            return timeToMins(a.eta) - timeToMins(b.eta);
        });

        let maxCluster = 0;
        stops.forEach(s => { if (s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster; });
        currentRouteCount = Math.max(1, maxCluster + 1);
        const cappedCount = Math.min(3, currentRouteCount);
        for(let i=1; i<=3; i++) {
            const btn = document.getElementById(`rbtn-${i}`);
            if(btn) btn.classList.toggle('active', i === cappedCount);
        }
        document.body.setAttribute('data-route-count', currentRouteCount);

        originalStops = JSON.parse(JSON.stringify(stops)); 
        if (stops.length > 0 && stops[0].eta) currentStartTime = stops[0].eta;
        historyStack = [];

        document.body.classList.remove('tier-individual', 'tier-company');
        let acctType = data.accountType ? data.accountType.toLowerCase() : (data.tier ? data.tier.toLowerCase() : 'company');
        document.body.classList.add('tier-' + acctType);

        document.body.classList.toggle('manager-all-inspectors', currentInspectorFilter === 'all');
        document.body.classList.toggle('manager-single-inspector', currentInspectorFilter !== 'all');

        if (!Array.isArray(data)) {
            if (data.defaultEmailMessage) defaultEmailMessage = data.defaultEmailMessage;
            if (data.companyEmail) companyEmail = data.companyEmail;
            if (data.managerEmail) managerEmail = data.managerEmail;
            if (typeof data.ccCompanyDefault !== 'undefined') ccCompanyDefault = !!data.ccCompanyDefault;

            inspectors = data.inspectors || []; 
            inspectors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (data.serviceDelay !== undefined) COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay) || 0; 
            if (data.permissions) {
                if (typeof data.permissions.modify !== 'undefined') PERMISSION_MODIFY = data.permissions.modify;
                if (typeof data.permissions.reoptimize !== 'undefined') PERMISSION_REOPTIMIZE = data.permissions.reoptimize;
            }

            const mapLogo = document.getElementById('brand-logo-map');
            const emptyLogo = document.getElementById('empty-brand-logo');
            const isCompanyTier = document.body.classList.contains('tier-company');

            if (isCompanyTier && data.companyLogo) {
                if (mapLogo) mapLogo.src = data.companyLogo;
                if (emptyLogo) { emptyLogo.src = data.companyLogo; emptyLogo.style.display = 'block'; }
            } else {
                const sprouteLogoUrl = 'https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png';
                if (mapLogo) mapLogo.src = sprouteLogoUrl;
                if (emptyLogo) { emptyLogo.src = sprouteLogoUrl; emptyLogo.style.display = 'block'; }
            }
            
            let displayName = data.displayName || 'Sproute'; 
            const mapDriverEl = document.getElementById('map-driver-name');
            if (mapDriverEl) mapDriverEl.innerText = displayName;
            const sidebarDriverEl = document.getElementById('sidebar-driver-name');
            if (sidebarDriverEl && !isCompanyTier) sidebarDriverEl.innerText = displayName;
            const emptyNameEl = document.getElementById('empty-brand-name');
            if (emptyNameEl) emptyNameEl.innerText = displayName;

            if (typeof updateInspectorDropdown === 'function') updateInspectorDropdown(); 
            if (typeof updateRouteButtonColors === 'function') updateRouteButtonColors();
            
            let hasValidStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat).length > 0;
            if (!hasValidStops && data.companyAddress) {
                const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.companyAddress)}.json?access_token=${MAPBOX_TOKEN}`;
                try {
                    frontEndApiUsage.geocode++;
                    const geoRes = await fetch(geoUrl);
                    const geo = await geoRes.json();
                    if (geo.features && geo.features.length > 0 && typeof map !== 'undefined') {
                        map.jumpTo({ center: geo.features[0].center, zoom: 11 });
                    }
                } catch (err) {}
            }
        }

        if (typeof render === 'function') { render(); drawRoute(); updateSummary(); initSortable(); }
    } catch (e) { 
        console.error("Error loading data:", e); 
        logToVisualConsole('ERR', 'GET /loadData FAILED', e.message);
        isFreshGlideRefresh = false;
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay && !isPollingForRoute && !isFreshGlideRefresh) overlay.style.display = 'none';
        if (typeof updateUndoUI === 'function') updateUndoUI();
    }
}

function liveClusterUpdate() {
    if (isManagerView && currentInspectorFilter === 'all') return;
    const k = currentRouteCount, w = parseInt(document.getElementById('slider-priority').value) / 100;
    const activeStops = stops.filter(s => isStopVisible(s, false) && s.lng && s.lat);
    if(activeStops.length === 0) return;

    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
    const unroutedStops = activeStops.filter(s => {
        if (isRouteAssigned(s.status)) return false;
        if (hasActiveRoutes && s.cluster === 'X') return false;
        return true;
    });

    if(k === 1) {
        unroutedStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        if(typeof updateMarkerColors === 'function') { updateMarkerColors(); updateRouteTimes(); }
        return;
    }
    if (unroutedStops.length === 0) return;

    let today = new Date(); today.setHours(0,0,0,0);
    unroutedStops.forEach(s => {
        s._urgency = 0;
        if (s.dueDate) {
            let d = new Date(s.dueDate); d.setHours(0,0,0,0);
            if (d < today) s._urgency = 2; else if (d.getTime() === today.getTime()) s._urgency = 1;
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
    let temp = centroids[0]; centroids[0] = centroids[bestClusterIdx]; centroids[bestClusterIdx] = temp;

    let capacity = Math.ceil(unroutedStops.length / k), maxGeoDist = 0.0001;
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
        let bestAltDist = Infinity, bestAltIdx = 0;
        for(let i=1; i<k; i++) {
            let d = Math.sqrt(Math.pow(s.lat - centroids[i].lat, 2) + Math.pow(s.lng - centroids[i].lng, 2));
            if (d < bestAltDist) { bestAltDist = d; bestAltIdx = i; }
        }
        let effectiveDist0 = dist0 - ((s._urgency / 2) * w * pullMultiplier);
        s._dist0 = dist0; s._bestAltDist = bestAltDist; s._bestAltIdx = bestAltIdx; s._effectiveDist0 = effectiveDist0; s._affinity0 = bestAltDist - effectiveDist0;
    });

    let sortedStops = [...unroutedStops].filter(s => !s.manualCluster).sort((a, b) => b._affinity0 - a._affinity0);
    let route0Count = 0, altCounts = new Array(k).fill(0);

    sortedStops.forEach(s => {
        if (s._affinity0 > 0) {
            if (route0Count < capacity || s._effectiveDist0 < 0) { s.cluster = 0; route0Count++; } 
            else { s.cluster = s._bestAltIdx; altCounts[s._bestAltIdx]++; }
        } else {
            s.cluster = s._bestAltIdx; altCounts[s._bestAltIdx]++;
        }
    });

    unroutedStops.forEach(s => { delete s._urgency; delete s._tempCluster; delete s._dist0; delete s._bestAltDist; delete s._bestAltIdx; delete s._effectiveDist0; delete s._affinity0; });
    if(typeof updateMarkerColors === 'function') { updateMarkerColors(); updateRouteTimes(); }
}

async function performUpload(file, inspectorId, csvType, overrideLock = false) {
    const overlay = document.getElementById('processing-overlay');
    const loadingText = overlay.querySelector('.loading-text');
    const subText = overlay.querySelector('.loading-subtext');
    
    if (loadingText) loadingText.innerText = "Uploading CSV...";
    if (subText) subText.innerText = "Processing order data locally";
    overlay.style.display = 'flex';
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        try {
            if (loadingText) loadingText.innerText = "Syncing...";
            if (subText) subText.innerText = "Sending data to server";
            
            let payload = { action: 'uploadCsv', csvData: text, adminId: adminParam, driverId: inspectorId, companyId: companyParam || '', csvType: csvType };
            if (!isManagerView) payload.routeId = routeId;
            if (overrideLock) payload.overrideLock = true;
            
            const res = await apiFetch(payload);
            const data = await res.json();
            
            if (data.success) {
                if (data.unmatchedAddresses && data.unmatchedAddresses.length > 0) {
                    overlay.style.display = 'none';
                    unmatchedAddressesQueue = data.unmatchedAddresses;
                    currentUnmatchedIndex = 0; currentUploadDriverId = inspectorId;
                    if(typeof openUnmatchedModal === 'function') openUnmatchedModal();
                } else {
                    await loadData(); 
                    if (isManagerView && inspectorId) {
                        const filterEl = document.getElementById('inspector-filter');
                        if (filterEl && typeof handleInspectorFilterChange === 'function') { filterEl.value = inspectorId; handleInspectorFilterChange(inspectorId); }
                    }
                }
            } else if (data.status === 'size_limit') {
                overlay.style.display = 'none';
                if(typeof customAlert === 'function') await customAlert("The uploaded file is too large. Please reduce the number of rows and try again.");
            } else if (data.status === 'confirm_hijack') {
                overlay.style.display = 'none';
                const proceed = await (typeof customConfirm === 'function' ? customConfirm(data.message || "This route is currently locked by another admin. Do you want to take over and overwrite it?") : Promise.resolve(true));
                if (proceed) performUpload(file, inspectorId, csvType, true); 
            } else { throw new Error(data.error || "Upload failed"); }
        } catch (err) {
            overlay.style.display = 'none';
            if(typeof customAlert === 'function') await customAlert("An error occurred during the upload. Please try again.");
        } finally {
            if (loadingText) loadingText.innerText = "Processing...";
            if (subText) subText.innerText = "Syncing data with the server";
        }
    };
    reader.readAsText(file);
}

async function saveEndpointToBackend(type, address, lat, lng) {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    
    pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    let action = hasRouted ? 'updateEndpoint' : 'updateInspectorDefault';
    let payload = { action, type, address, lat, lng, driverId: inspId };
    
    if (!isManagerView) payload.routeId = routeId; 
    
    try {
        const res = await apiFetch(payload);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        if(typeof customAlert === 'function') await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally { if (overlay) overlay.style.display = 'none'; }
}
