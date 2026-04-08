/**
 * Dashboard - V15.4
 * FILE: core.js
 * Changes: 
 * 1. Split from monolithic app.js. Contains global state, data fetching, API handlers, and core algorithms.
 */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';
const BACKEND_URL = 'https://glidewebhooksync-761669621272.us-south1.run.app';
const params = new URLSearchParams(window.location.search);

let frontEndApiUsage = { geocode: 0, mapLoads: 0 };
let unmatchedAddressesQueue = [];
let currentUnmatchedIndex = 0;
let currentUploadDriverId = null;

let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const adminParam = params.get('admin');

const viewMode = (params.get('view') || 'inspector').toLowerCase(); 
const isManagerView = (viewMode === 'manager' || viewMode === 'managermobile' || viewMode === 'managermobilesplit'); 

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

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

const isTrueInspector = (val) => val === true || String(val).trim().toLowerCase() === 'true';

async function apiFetch(payload) {
    payload.frontEndApiUsage = { geocode: frontEndApiUsage.geocode, mapLoads: frontEndApiUsage.mapLoads };
    frontEndApiUsage.geocode = 0;
    frontEndApiUsage.mapLoads = 0;
    
    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return response;
    } catch (err) {
        console.error(`POST ${payload.action} Error:`, err);
        throw err;
    }
}

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

function markRouteDirty(driverId, clusterIdx) {
    dirtyRoutes.add(`${driverId || 'unassigned'}_${clusterIdx || 0}`);
}

function pushToHistory() {
    historyStack.push({
        stops: JSON.parse(JSON.stringify(stops)),
        dirty: new Set(dirtyRoutes)
    });
    if (historyStack.length > 20) historyStack.shift();
    updateUndoUI();
}

async function undoLastAction() {
    if (historyStack.length === 0) return;
    const last = historyStack.pop();

    const resurrectedStops = last.stops.filter(oldStop => !stops.some(currentStop => String(currentStop.id) === String(oldStop.id)));

    stops = last.stops;
    dirtyRoutes = new Set(last.dirty);

    if (resurrectedStops.length > 0) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'flex';
        try {
            let payload = {
                action: 'recreateOrders',
                driverId: isManagerView ? currentInspectorFilter : driverParam,
                orders: resurrectedStops
            };
            if (!isManagerView) payload.routeId = routeId;

            await apiFetch(payload);
        } catch (e) {
            console.error("Failed to resurrect orders:", e);
        } finally {
            if (overlay) overlay.style.display = 'none';
        }
    }

    render(); drawRoute(); updateSummary(); updateRouteTimes(); updateUndoUI();
    silentSaveRouteState(); 
}

function silentSaveRouteState() {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    if (inspId === 'all' || !inspId) return;
    
    let routedStops = stops.filter(s => {
        if (!isRouteAssigned(s.status)) return false;
        if (isManagerView) return String(s.driverId) === String(inspId);
        return s.routeTargetId === String(routeId);
    });
    
    if (routedStops.length === 0) return;

    let minified = routedStops.map(s => minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1));
    
    let macroState = 'Ready';
    if (dirtyRoutes.has('endpoints_0')) macroState = 'Staging-endpoint';
    else if (dirtyRoutes.size > 0) macroState = 'Staging';
    
    let payload = {
        action: 'saveRoute',
        driverId: inspId,
        stops: minified,
        routeState: macroState
    };
    
    if (!isManagerView) payload.routeId = routeId;

    apiFetch(payload).catch(e => console.log("Silent save error", e));
}

async function loadData() {
    let queryParams = '';
    
    if (routeId) queryParams = `?id=${routeId}`;
    else if (companyParam) queryParams = `?company=${companyParam}`;
    else if (driverParam) queryParams = `?driver=${driverParam}`;
    
    if (adminParam) {
        queryParams += (queryParams ? '&' : '?') + `admin=${adminParam}`;
    }
    
    queryParams += (queryParams ? '&' : '?') + `isManager=${isManagerView}`;

    if (!queryParams) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
        return;
    }

    try {
        let fetchUrl = `${BACKEND_URL}${queryParams}&_t=${new Date().getTime()}`;
        
        const res = await fetch(fetchUrl);
        const data = await res.clone().json();
        
        if (data.confirmHijack) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            
            const proceed = await customConfirm(data.message || "The previous admin's session has expired. Do you want to take over and overwrite this Inspector's route?");
            
            if (overlay) overlay.style.display = 'flex'; 
            
            if (proceed) {
                apiFetch({ action: 'executeHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter })
                .catch(e => console.log('Hijack execute failed:', e));
            } else {
                apiFetch({ action: 'cancelHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter })
                .catch(e => console.log('Hijack cancel failed:', e));
            }
            
            setTimeout(loadData, 2000); 
            return;
        }

        if (data.uploadError) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            
            await customAlert(data.message || "Upload cancelled. Another admin is currently modifying this Inspector's route.");
            
            if (adminParam) {
                apiFetch({ action: 'clearAlert', adminId: adminParam })
                .catch(e => console.log('Clear alert silent error', e));
            }
            return;
        }

        let rawStops = [];
        if (Array.isArray(data)) {
            rawStops = data;
        } else if (data.stops) {
            if (typeof data.stops === 'string') {
                try { rawStops = JSON.parse(data.stops); } catch(e) { rawStops = []; }
            } else if (Array.isArray(data.stops)) {
                rawStops = data.stops;
            }
        }

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
                    if (!oldStr) return true; 
                    return JSON.stringify(oldStr) !== JSON.stringify(n);
                });

                if (diffStop) {
                    let expandedDiff = expandStop(diffStop);
                    if (expandedDiff.driverId && isManagerView) {
                        currentInspectorFilter = String(expandedDiff.driverId);
                        sessionStorage.setItem('sproute_inspector_filter', currentInspectorFilter);
                    }
                }
            } catch(e) { console.error("Snapshot diff error:", e); }
        }

        isFreshGlideRefresh = false; 
        
        if (!data.uploadError && !data.confirmHijack) {
            sessionStorage.setItem('sproute_snapshot', currentSnapshot);
        }

        if (data.routeId) routeId = data.routeId;

        if (data.needsRecalculation) {
            isAlteredRoute = true;
            dirtyRoutes.add('all'); 
        }

        routeStart = data.routeStart || null;
        routeEnd = data.routeEnd || null;
        
        if (data.isAlteredRoute) isAlteredRoute = true;

        let globalRouteState = data.routeState || 'Pending';
        let globalDriverId = data.driverId || (isManagerView && currentInspectorFilter !== 'all' ? currentInspectorFilter : driverParam);

        if (data.adminEmail) adminEmail = data.adminEmail;
        
        if (data.csvTypes && Array.isArray(data.csvTypes)) {
            availableCsvTypes = data.csvTypes;
        }

        if (isPollingForRoute) {
            let fetchedMap = new Map();
            rawStops.forEach(s => {
                let exp = expandStop(s);
                fetchedMap.set(String(exp.rowId || exp.id), {
                    ...exp,
                    id: exp.rowId || exp.id,
                    status: getStatusText(exp.status),
                    cluster: exp.cluster,
                    manualCluster: false,
                    hiddenInInspector: false,
                    routeState: exp.routeState || s.routeState || globalRouteState,
                    driverId: exp.driverId || s.driverId || globalDriverId,
                    routeTargetId: routeId || null
                });
            });

            stops = stops.map(s => {
                if (fetchedMap.has(String(s.id))) {
                    return fetchedMap.get(String(s.id));
                }
                if (s.routeState === 'Queued') s.routeState = 'Ready'; 
                return s;
            });
            
            stops.forEach(s => {
                if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) {
                    markRouteDirty(s.driverId, s.cluster);
                }
            });

            const driverHasRouted = stops.some(s => String(s.driverId) === String(currentInspectorFilter) && (isRouteAssigned(s.status) || s.routeState === 'Ready'));
            
            if (!driverHasRouted && pollRetries < 15) {
                pollRetries++;
                const overlay = document.getElementById('processing-overlay');
                if (overlay) overlay.style.display = 'flex';
                setTimeout(loadData, 5000);
                return;
            } else {
                isPollingForRoute = false; 
                dirtyRoutes.clear(); 
                silentSaveRouteState();
            }
        } else {
            stops = rawStops.map(s => {
                let exp = expandStop(s);
                return {
                    ...exp,
                    id: exp.rowId || exp.id,
                    status: getStatusText(exp.status),
                    cluster: exp.cluster,
                    manualCluster: false,
                    hiddenInInspector: false,
                    routeState: exp.routeState || s.routeState || globalRouteState,
                    driverId: exp.driverId || s.driverId || globalDriverId,
                    routeTargetId: routeId || null
                };
            });

            stops.forEach(s => {
                if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) {
                    markRouteDirty(s.driverId, s.cluster);
                }
            });
        }

        stops.sort((a, b) => {
            let cA = a.cluster === 'X' ? 999 : (a.cluster || 0);
            let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
            if (cA !== cB) return cA - cB;
            return timeToMins(a.eta) - timeToMins(b.eta);
        });

        let maxCluster = 0;
        stops.forEach(s => {
            if (s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster;
        });

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
            if (sidebarDriverEl && !isCompanyTier) {
                sidebarDriverEl.innerText = displayName;
            }

            const emptyBrandName = document.getElementById('empty-brand-name');
            if (emptyBrandName) emptyBrandName.innerText = displayName;

            updateInspectorDropdown(); 
            updateRouteButtonColors();
            
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
                } catch (err) {
                    console.error("Geocoding failed for company address.", err);
                }
            }
        }

        render(); drawRoute(); updateSummary(); initSortable();
        
    } catch (e) { 
        console.error("Error loading data:", e); 
        isFreshGlideRefresh = false;
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay && !isPollingForRoute && !isFreshGlideRefresh) {
            overlay.style.display = 'none';
        }
        updateUndoUI();
    }
}

async function executeRouteReset(driverId) {
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        let payload = { action: 'resetRoute', driverId: driverId };
        if (!isManagerView) payload.routeId = routeId;

        await apiFetch(payload);
        
        historyStack = []; 
        stops.forEach(s => {
            if (String(s.driverId) === String(driverId) && isRouteAssigned(s.status)) {
                s.eta = ''; s.dist = ''; s.status = 'Pending'; s.routeState = 'Pending';
            }
        });
        
        routeStart = null;
        routeEnd = null;
        
        dirtyRoutes.clear();
        render(); drawRoute(); updateSummary(); updateUndoUI();
    } catch(e) { 
        await customAlert("Error resetting the route."); 
    } finally { 
        if(overlay) overlay.style.display = 'none'; 
    }
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

async function saveEndpointToBackend(type, address, lat, lng) {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    
    pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    let action = hasRouted ? 'updateEndpoint' : 'updateInspectorDefault';
    let payload = { action, type, address, lat, lng, driverId: inspId };
    
    if (!isManagerView) {
        payload.routeId = routeId; 
    }
    
    try {
        const res = await apiFetch(payload);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        console.error("Endpoint update failed:", e);
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

async function handleCalculate() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const activeStops = stops.filter(s => isStopVisible(s, false) && s.lng && s.lat);
        const isEndpointsDirty = dirtyRoutes.has('endpoints_0');
        const hasActiveRoutes = stops.some(s => isRouteAssigned(s.status));
        let stopsToCalculate = [];

        if (isEndpointsDirty) {
            stopsToCalculate = activeStops;
            if (hasActiveRoutes) {
                stopsToCalculate = stopsToCalculate.filter(s => s.cluster !== 'X');
            }
        } else {
            stopsToCalculate = activeStops.filter(s => {
                if (hasActiveRoutes && s.cluster === 'X') return false;
                const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
                return dirtyRoutes.has(routeKey);
            });
        }

        if (stopsToCalculate.length === 0) { 
            if (overlay) overlay.style.display = 'none';
            dirtyRoutes.clear();
            render(); drawRoute(); updateSummary();
            return; 
        }
        
        let sentClusters = [...new Set(stopsToCalculate.map(s => s.cluster))].filter(c => c !== 'X').sort();

        const eps = getActiveEndpoints();

        let payload = {
            action: 'calculate',
            driverId: isManagerView ? currentInspectorFilter : driverParam,
            driver: driverParam,
            startTime: currentStartTime,
            startAddr: eps.start?.address || null,
            endAddr: eps.end?.address || null,
            isManager: isManagerView,
            stops: stopsToCalculate.map(s => {
                let outC = s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1;
                return minifyStop(s, outC);
            })
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s);
            let backendCluster = exp.cluster;
            let mappedCluster = backendCluster;

            if (sentClusters.length > 0) {
                if (sentClusters.includes(backendCluster)) {
                    mappedCluster = backendCluster;
                } else if (backendCluster < sentClusters.length) {
                    mappedCluster = sentClusters[backendCluster];
                } else if (sentClusters.length === 1) {
                    mappedCluster = sentClusters[0];
                }
            }

            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
        });

        stops = stops.map(s => {
            if (returnedStopsMap.has(String(s.id))) {
                return returnedStopsMap.get(String(s.id));
            }
            return s;
        });

        if (!isManagerView) isAlteredRoute = true;
        historyStack = []; 
        dirtyRoutes.clear();
        originalStops = JSON.parse(JSON.stringify(stops)); 
        render(); drawRoute(); updateSummary();
        silentSaveRouteState();

    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error calculating the route. Please try again."); 
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

async function handleGenerateRoute() {
    if (currentInspectorFilter === 'all') return;
    const insp = inspectors.find(i => String(i.id) === String(currentInspectorFilter));
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    let stopsToOptimize = [];
    const isEndpointsDirty = dirtyRoutes.has('endpoints_0');
    const hasActiveRoutes = stops.some(s => isRouteAssigned(s.status));

    if (isEndpointsDirty) {
        stopsToOptimize = stops.filter(s => isActiveStop(s) && s.lng && s.lat && String(s.driverId) === String(insp.id));
        if (hasActiveRoutes) {
            stopsToOptimize = stopsToOptimize.filter(s => s.cluster !== 'X');
        }
    } else {
        stopsToOptimize = stops.filter(s => {
            if (!isActiveStop(s) || !s.lng || !s.lat || String(s.driverId) !== String(insp.id)) return false;
            if (hasActiveRoutes && s.cluster === 'X') return false;
            
            const routeKey = `${s.driverId}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
            return dirtyRoutes.has(routeKey) || !isRouteAssigned(s.status);
        });
    }
    
    let sentClusters = [...new Set(stopsToOptimize.map(s => s.cluster))].filter(c => c !== 'X').sort();

    let flatStopsPayload = stopsToOptimize.map(s => {
        let outCluster = s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1;
        return minifyStop(s, outCluster);
    });

    const eps = getActiveEndpoints();
    let sAddr = eps.start ? eps.start.address : '';
    let eAddr = eps.end ? eps.end.address : '';

    stopsToOptimize.forEach(s => {
        s.routeState = 'Queued';
    });
    render(); 

    try {
        let payload = { 
            action: 'generateRoute', 
            inspectorName: insp.name, 
            driverId: insp.id, 
            stops: flatStopsPayload, 
            startAddr: sAddr, 
            endAddr: eAddr, 
            routeState: 'Queued' 
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.updatedStops || (data.stops && Array.isArray(data.stops))) {
            let optimizedData = data.updatedStops || data.stops;
            const returnedStopsMap = new Map();
            optimizedData.forEach(s => {
                let exp = expandStop(s);
                let backendCluster = exp.cluster;
                let mappedCluster = backendCluster;

                if (sentClusters.length > 0) {
                    if (sentClusters.includes(backendCluster)) {
                        mappedCluster = backendCluster; 
                    } else if (backendCluster < sentClusters.length) {
                        mappedCluster = sentClusters[backendCluster]; 
                    } else if (sentClusters.length === 1) {
                        mappedCluster = sentClusters[0]; 
                    }
                }

                returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
            });

            stops = stops.map(s => {
                if (returnedStopsMap.has(String(s.id))) return returnedStopsMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready';
                return s;
            });

            stops.sort((a, b) => {
                let cA = a.cluster === 'X' ? 999 : (a.cluster || 0);
                let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
                if (cA !== cB) return cA - cB;
                return timeToMins(a.eta) - timeToMins(b.eta);
            });

            isPollingForRoute = false;
            dirtyRoutes.clear();
            render(); drawRoute(); updateSummary();
            silentSaveRouteState(); 
        } else if (data.status === 'queued' || data.success) {
            let pqPayload = { action: 'processQueue', driverId: insp.id };
            if (!isManagerView) pqPayload.routeId = routeId;
            
            apiFetch(pqPayload).catch(err => console.log("Ignored expected timeout from processQueue", err));
            
            isPollingForRoute = true;
            pollRetries = 0;
            setTimeout(loadData, 5000);
        } else {
            await loadData();
        }
    } catch (e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Generation encountered an error. Please wait a moment and try again.");
    } 
}

async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        const inspId = isManagerView ? currentInspectorFilter : driverParam;
        let payload = { action: 'restoreOriginalRoute', driverId: inspId };
        if (!isManagerView) payload.routeId = routeId;

        await apiFetch(payload);
        
        await loadData(); 
    } catch(e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error restoring the route. Please try again."); 
        console.error(e);
    } finally {
        if(overlay) overlay.style.display = 'none'; 
    }
}

function setRoutes(num) {
    currentRouteCount = num;
    document.body.setAttribute('data-route-count', num);
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if(btn) btn.classList.toggle('active', i === num);
    }
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
    
    stops.forEach(s => s.manualCluster = false); 
    liveClusterUpdate();
    if(typeof updateSelectionUI === 'function') updateSelectionUI(); 
}

function moveSelectedToRoute(cIdx) {
    pushToHistory();
    let movedStops = [];
    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
    
    selectedIds.forEach(id => {
        const s = stops.find(st => String(st.id) === String(id));
        if (s) {
            if (isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster); 
            }
            s.cluster = cIdx;
            s.manualCluster = true; 
            
            if (hasActiveRoutes) {
                s.status = 'Routed';
                s.routeState = 'Staging';
                markRouteDirty(s.driverId, s.cluster); 
            }
            movedStops.push(s);
        }
    });
    
    stops = stops.filter(s => !selectedIds.has(s.id));
    stops.push(...movedStops);
    
    selectedIds.clear();
    
    render(); 
    drawRoute();
    updateSummary();
    if (typeof updateRouteTimes === 'function') updateRouteTimes();
    silentSaveRouteState();
}

function liveClusterUpdate() {
    if (isManagerView && currentInspectorFilter === 'all') return;
    
    const k = currentRouteCount;
    const prioritySlider = document.getElementById('slider-priority');
    const w = prioritySlider ? parseInt(prioritySlider.value) / 100 : 0;
    
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
        if (typeof updateMarkerColors === 'function') updateMarkerColors();
        if (typeof updateRouteTimes === 'function') updateRouteTimes();
        return;
    }

    if (unroutedStops.length === 0) return;

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
    
    if (typeof updateMarkerColors === 'function') updateMarkerColors();
    if (typeof updateRouteTimes === 'function') updateRouteTimes();
}

async function triggerBulkDelete() { 
    if(!(await customConfirm("Delete selected orders?"))) return;
    
    pushToHistory(); 
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        let idsToDelete = Array.from(selectedIds);
        idsToDelete.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster);
            }
        });

        let payload = { action: 'deleteMultipleOrders', rowIds: idsToDelete };
        if (!isManagerView) payload.routeId = routeId;
        
        await apiFetch(payload);
        
        stops = stops.filter(s => !selectedIds.has(s.id));
        
        selectedIds.clear(); 
        if(typeof updateInspectorDropdown === 'function') updateInspectorDropdown(); 
        
        if(typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
        render(); drawRoute(); updateSummary(); 
        if (typeof updateRouteTimes === 'function') updateRouteTimes();
        silentSaveRouteState();

    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error deleting orders. Please try again.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function triggerBulkUnroute() { 
    if(!(await customConfirm("Remove selected orders from route?"))) return;
    pushToHistory();
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        let updatesArray = [];
        Array.from(selectedIds).forEach(id => {
            const idx = stops.findIndex(s => String(s.id) === String(id));
            let dId = null;
            if (idx > -1) {
                dId = stops[idx].driverId;
                if (isRouteAssigned(stops[idx].status)) {
                    markRouteDirty(stops[idx].driverId, stops[idx].cluster);
                }
                stops[idx].status = 'Pending';
                stops[idx].cluster = 'X';
                stops[idx].manualCluster = false;
                stops[idx].eta = '';
                stops[idx].dist = 0;
                stops[idx].durationSecs = 0;
                if (viewMode === 'inspector') stops[idx].hiddenInInspector = true; 
            }
            updatesArray.push({ rowId: id, driverId: dId });
        });
        
        let payload = { 
            action: 'updateMultipleOrders', 
            updatesList: updatesArray, 
            sharedUpdates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' },
            adminId: adminParam 
        };
        if (!isManagerView) payload.routeId = routeId;
        
        await apiFetch(payload);
        
        selectedIds.clear(); 
        
        if(typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
        render(); drawRoute(); updateSummary(); 
        if (typeof updateRouteTimes === 'function') updateRouteTimes();
        silentSaveRouteState();
        
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error removing orders from the route. Please try again.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
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
            
            let payload = {
                action: 'uploadCsv',
                csvData: text,
                adminId: adminParam,
                driverId: inspectorId,
                companyId: companyParam || '',
                csvType: csvType
            };
            if (!isManagerView) payload.routeId = routeId;
            if (overrideLock) payload.overrideLock = true;
            
            const res = await apiFetch(payload);
            const data = await res.json();
            
            if (data.success) {
                if (data.unmatchedAddresses && data.unmatchedAddresses.length > 0) {
                    overlay.style.display = 'none';
                    unmatchedAddressesQueue = data.unmatchedAddresses;
                    currentUnmatchedIndex = 0;
                    currentUploadDriverId = inspectorId;
                    if(typeof openUnmatchedModal === 'function') openUnmatchedModal();
                } else {
                    await loadData(); 
                }
            } else if (data.status === 'size_limit') {
                overlay.style.display = 'none';
                await customAlert("The uploaded file is too large. Please reduce the number of rows and try again.");
            } else if (data.status === 'confirm_hijack') {
                overlay.style.display = 'none';
                const proceed = await customConfirm(data.message || "This route is currently locked by another admin. Do you want to take over and overwrite it?");
                if (proceed) {
                    performUpload(file, inspectorId, csvType, true); 
                }
            } else {
                throw new Error(data.error || "Upload failed");
            }
        } catch (err) {
            console.error(err);
            overlay.style.display = 'none';
            await customAlert("An error occurred during the upload. Please try again.");
        } finally {
            if (loadingText) loadingText.innerText = "Processing...";
            if (subText) subText.innerText = "Syncing data with the server";
        }
    };
    reader.readAsText(file);
}
