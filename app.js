/* Dashboard - V1.6.2 */
/* FILE: app.js */
/* Changes: */
/* 1. Appended missing sproute-trigger-upload event listener to bridge Drag & Drop/Modal uploads directly to performUpload. */

import { 
    expandStop, minifyStop, getStatusCode, getStatusText, isRouteAssigned, 
    isActiveStop, timeToMins, calculateClusters 
} from './logic.js';

import { 
    initMap, renderMapMarkers, drawRouteMap, updateMarkerColorsMap, 
    updateMapSelectionStyles, resetMapBounds, resizeMap 
} from './map.js';

import * as UI from './ui.js'; 

export const Config = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA',
    BACKEND_URL: 'https://glidewebhooksync-761669621272.us-south1.run.app',
    routeId: new URLSearchParams(window.location.search).get('id'),
    driverParam: new URLSearchParams(window.location.search).get('driver'),
    companyParam: new URLSearchParams(window.location.search).get('company'),
    adminParam: new URLSearchParams(window.location.search).get('admin'),
    viewMode: (new URLSearchParams(window.location.search).get('view') || 'inspector').toLowerCase(),
    get isManagerView() { return ['manager', 'managermobile', 'managermobilesplit'].includes(this.viewMode); }
};

export const AppState = {
    frontEndApiUsage: { geocode: 0, mapLoads: 0 },
    stops: [],
    originalStops: [],
    inspectors: [],
    selectedIds: new Set(),
    dirtyRoutes: new Set(),
    historyStack: [],
    routeStart: null,
    routeEnd: null,
    currentRouteCount: 1,
    availableCsvTypes: [],
    currentInspectorFilter: sessionStorage.getItem('sproute_inspector_filter') || 'all',
    currentRouteViewFilter: 'all',
    currentDisplayMode: 'detailed',
    currentStartTime: "8:00 AM",
    currentSort: { col: null, asc: true },
    latestSuggestions: { start: null, end: null },
    COMPANY_SERVICE_DELAY: 0,
    PERMISSION_MODIFY: true,
    PERMISSION_REOPTIMIZE: true,
    defaultEmailMessage: "",
    companyEmail: "",
    managerEmail: "",
    adminEmail: "",
    ccCompanyDefault: true,
    isAlteredRoute: false,
    unmatchedAddressesQueue: [],
    currentUnmatchedIndex: 0,
    currentUploadDriverId: null,
    isFreshGlideRefresh: false,
    isPollingForRoute: false,
    pollRetries: 0
};

document.body.className = `view-${Config.viewMode} manager-all-inspectors empty-state-active`;
if (Config.viewMode === 'managermobilesplit') document.body.classList.add('split-show-map');

const currentQuery = window.location.search;
const lastQuery = sessionStorage.getItem('sproute_last_query');
if (lastQuery && currentQuery !== lastQuery && currentQuery.includes('Upload-')) AppState.isFreshGlideRefresh = true;
sessionStorage.setItem('sproute_last_query', currentQuery);

let pageLoadRetries = 0;
const MAX_RETRIES = 5;

const mapConfig = { 
    container: 'map', style: 'mapbox://styles/mapbox/dark-v11', center: [-96.797, 32.776], zoom: 11, 
    attributionControl: false, boxZoom: false, preserveDrawingBuffer: true,
    cooperativeGestures: (Config.viewMode === 'inspector' || Config.viewMode === 'managermobile' || Config.viewMode === 'managermobilesplit')
};

initMap(Config.MAPBOX_TOKEN, mapConfig, (event) => {
    if (event.action === 'clear') AppState.selectedIds.clear();
    else if (event.action === 'lasso') event.ids.forEach(id => AppState.selectedIds.add(id));
    UI.updateSelectionUI(); updateMapSelectionStyles(AppState.selectedIds);
});
AppState.frontEndApiUsage.mapLoads++;

export async function apiFetch(payload) {
    payload.frontEndApiUsage = { geocode: AppState.frontEndApiUsage.geocode, mapLoads: AppState.frontEndApiUsage.mapLoads };
    AppState.frontEndApiUsage.geocode = 0; AppState.frontEndApiUsage.mapLoads = 0;
    try {
        const response = await fetch(Config.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return response;
    } catch (err) { throw err; }
}

export async function loadData() {
    let queryParams = '';
    if (Config.routeId) queryParams = `?id=${Config.routeId}`;
    else if (Config.companyParam) queryParams = `?company=${Config.companyParam}`;
    else if (Config.driverParam) queryParams = `?driver=${Config.driverParam}`;
    
    if (Config.adminParam) queryParams += (queryParams ? '&' : '?') + `admin=${Config.adminParam}`;
    queryParams += (queryParams ? '&' : '?') + `isManager=${Config.isManagerView}`;

    if (!queryParams) { UI.hideOverlay(); return; }

    try {
        let fetchUrl = `${Config.BACKEND_URL}${queryParams}&_t=${new Date().getTime()}`;
        const res = await fetch(fetchUrl);
        const data = await res.clone().json();
        
        if (data.confirmHijack) {
            UI.hideOverlay(); AppState.isFreshGlideRefresh = false;
            const proceed = await UI.customConfirm(data.message || "Take over and overwrite this Inspector's route?");
            UI.showOverlay();
            if (proceed) apiFetch({ action: 'executeHijack', adminId: Config.adminParam, driverId: data.driverId || AppState.currentInspectorFilter }).catch(e=>console.log(e));
            else apiFetch({ action: 'cancelHijack', adminId: Config.adminParam, driverId: data.driverId || AppState.currentInspectorFilter }).catch(e=>console.log(e));
            setTimeout(loadData, 2000); return;
        }

        if (data.uploadError) {
            UI.hideOverlay(); AppState.isFreshGlideRefresh = false;
            await UI.customAlert(data.message || "Upload cancelled. Another admin is currently modifying this route.");
            if (Config.adminParam) apiFetch({ action: 'clearAlert', adminId: Config.adminParam }).catch(e=>console.log(e));
            return;
        }

        let rawStops = [];
        if (Array.isArray(data)) rawStops = data;
        else if (data.stops) {
            if (typeof data.stops === 'string') { try { rawStops = JSON.parse(data.stops); } catch(e) { rawStops = []; } } 
            else if (Array.isArray(data.stops)) rawStops = data.stops;
        }

        let currentSnapshot = JSON.stringify(rawStops);
        let preUploadSnapshot = sessionStorage.getItem('sproute_snapshot');

        if (AppState.isFreshGlideRefresh && preUploadSnapshot && (currentSnapshot === preUploadSnapshot || rawStops.length === 0) && pageLoadRetries < MAX_RETRIES) {
            pageLoadRetries++; UI.showOverlay(); setTimeout(loadData, 3000); return; 
        }
        
        if (AppState.isFreshGlideRefresh && preUploadSnapshot && currentSnapshot !== preUploadSnapshot) {
            try {
                const oldStops = JSON.parse(preUploadSnapshot);
                let diffStop = rawStops.find(n => {
                    let oldStr = oldStops.find(o => (o.rowId || o.id || o[0]) === (n.rowId || n.id || n[0]));
                    return !oldStr || JSON.stringify(oldStr) !== JSON.stringify(n);
                });
                if (diffStop) {
                    let expandedDiff = expandStop(diffStop);
                    if (expandedDiff.driverId && Config.isManagerView) {
                        AppState.currentInspectorFilter = String(expandedDiff.driverId);
                        sessionStorage.setItem('sproute_inspector_filter', AppState.currentInspectorFilter);
                    }
                }
            } catch(e) {}
        }

        AppState.isFreshGlideRefresh = false; 
        if (!data.uploadError && !data.confirmHijack) sessionStorage.setItem('sproute_snapshot', currentSnapshot);
        if (data.routeId) Config.routeId = data.routeId;
        if (data.needsRecalculation) { AppState.isAlteredRoute = true; AppState.dirtyRoutes.add('all'); }

        AppState.routeStart = data.routeStart || null; AppState.routeEnd = data.routeEnd || null;
        if (data.isAlteredRoute) AppState.isAlteredRoute = true;

        let globalRouteState = data.routeState || 'Pending';
        let globalDriverId = data.driverId || (Config.isManagerView && AppState.currentInspectorFilter !== 'all' ? AppState.currentInspectorFilter : Config.driverParam);
        
        if (data.adminEmail) AppState.adminEmail = data.adminEmail;
        if (data.csvTypes && Array.isArray(data.csvTypes)) AppState.availableCsvTypes = data.csvTypes;

        if (AppState.isPollingForRoute) {
            let fetchedMap = new Map();
            rawStops.forEach(s => {
                let exp = expandStop(s);
                fetchedMap.set(String(exp.rowId || exp.id), {
                    ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster, manualCluster: false, hiddenInInspector: false,
                    routeState: exp.routeState || s.routeState || globalRouteState, driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: Config.routeId || null
                });
            });

            AppState.stops = AppState.stops.map(s => {
                if (fetchedMap.has(String(s.id))) return fetchedMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready'; return s;
            });
            
            AppState.stops.forEach(s => { if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster); });

            const driverHasRouted = AppState.stops.some(s => String(s.driverId) === String(AppState.currentInspectorFilter) && (isRouteAssigned(s.status) || s.routeState === 'Ready'));
            if (!driverHasRouted && AppState.pollRetries < 15) {
                AppState.pollRetries++; UI.showOverlay(); setTimeout(loadData, 5000); return;
            } else { AppState.isPollingForRoute = false; AppState.dirtyRoutes.clear(); silentSaveRouteState(); }
        } else {
            AppState.stops = rawStops.map(s => {
                let exp = expandStop(s);
                return { ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster, manualCluster: false, hiddenInInspector: false, routeState: exp.routeState || s.routeState || globalRouteState, driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: Config.routeId || null };
            });
            AppState.stops.forEach(s => { if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster); });
        }

        AppState.stops.sort((a, b) => {
            let cA = a.cluster === 'X' ? 999 : (a.cluster || 0); let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
            if (cA !== cB) return cA - cB; return timeToMins(a.eta) - timeToMins(b.eta);
        });

        let maxCluster = 0;
        AppState.stops.forEach(s => { if (s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster; });
        AppState.currentRouteCount = Math.max(1, maxCluster + 1);
        
        document.body.setAttribute('data-route-count', AppState.currentRouteCount);
        AppState.originalStops = JSON.parse(JSON.stringify(AppState.stops)); 
        if (AppState.stops.length > 0 && AppState.stops[0].eta) AppState.currentStartTime = AppState.stops[0].eta;
        AppState.historyStack = [];

        document.body.classList.remove('tier-individual', 'tier-company');
        let acctType = data.accountType ? data.accountType.toLowerCase() : (data.tier ? data.tier.toLowerCase() : 'company');
        document.body.classList.add('tier-' + acctType);
        document.body.classList.toggle('manager-all-inspectors', AppState.currentInspectorFilter === 'all');
        document.body.classList.toggle('manager-single-inspector', AppState.currentInspectorFilter !== 'all');

        if (!Array.isArray(data)) {
            if (data.defaultEmailMessage) AppState.defaultEmailMessage = data.defaultEmailMessage;
            if (data.companyEmail) AppState.companyEmail = data.companyEmail;
            if (data.managerEmail) AppState.managerEmail = data.managerEmail;
            if (typeof data.ccCompanyDefault !== 'undefined') AppState.ccCompanyDefault = !!data.ccCompanyDefault;
            AppState.inspectors = data.inspectors || []; 
            AppState.inspectors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            if (data.serviceDelay !== undefined) AppState.COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay) || 0; 
            if (data.permissions) {
                if (typeof data.permissions.modify !== 'undefined') AppState.PERMISSION_MODIFY = data.permissions.modify;
                if (typeof data.permissions.reoptimize !== 'undefined') AppState.PERMISSION_REOPTIMIZE = data.permissions.reoptimize;
            }
            UI.updateInspectorDropdown(); UI.updateRouteButtonColors();
            let hasValidStops = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView) && s.lng && s.lat).length > 0;
            if (!hasValidStops && data.companyAddress) {
                try {
                    AppState.frontEndApiUsage.geocode++;
                    const geo = await (await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.companyAddress)}.json?access_token=${Config.MAPBOX_TOKEN}`)).json();
                    if (geo.features && geo.features.length > 0) { const map = window.getMapInstance ? window.getMapInstance() : null; if(map) map.jumpTo({ center: geo.features[0].center, zoom: 11 }); }
                } catch (err) {}
            }
        }
        triggerFullRender();
    } catch (e) { AppState.isFreshGlideRefresh = false; } 
    finally { if (!AppState.isPollingForRoute && !AppState.isFreshGlideRefresh) UI.hideOverlay(); UI.updateUndoUI(); }
}

export function triggerFullRender() { UI.render(); UI.drawRoute(); UI.updateSummary(); UI.initSortable(); }
export function markRouteDirty(driverId, clusterIdx) { AppState.dirtyRoutes.add(`${driverId || 'unassigned'}_${clusterIdx || 0}`); }
export function pushToHistory() { AppState.historyStack.push({ stops: JSON.parse(JSON.stringify(AppState.stops)), dirty: new Set(AppState.dirtyRoutes) }); if (AppState.historyStack.length > 20) AppState.historyStack.shift(); UI.updateUndoUI(); }

export async function undoLastAction() {
    if (AppState.historyStack.length === 0) return;
    const last = AppState.historyStack.pop();
    const resurrectedStops = last.stops.filter(oldStop => !AppState.stops.some(currentStop => String(currentStop.id) === String(oldStop.id)));
    AppState.stops = last.stops; AppState.dirtyRoutes = new Set(last.dirty);
    if (resurrectedStops.length > 0) {
        UI.showOverlay();
        try {
            let payload = { action: 'recreateOrders', driverId: Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam, orders: resurrectedStops };
            if (!Config.isManagerView) payload.routeId = Config.routeId; await apiFetch(payload);
        } catch (e) {} finally { UI.hideOverlay(); }
    }
    triggerFullRender(); UI.updateRouteTimes(); UI.updateUndoUI(); silentSaveRouteState(); 
}

export function silentSaveRouteState() {
    const inspId = Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam;
    if (inspId === 'all' || !inspId) return;
    let routedStops = AppState.stops.filter(s => { if (!isRouteAssigned(s.status)) return false; if (Config.isManagerView) return String(s.driverId) === String(inspId); return s.routeTargetId === String(Config.routeId); });
    if (routedStops.length === 0) return;
    let minified = routedStops.map(s => minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1));
    let macroState = 'Ready';
    if (AppState.dirtyRoutes.has('endpoints_0')) macroState = 'Staging-endpoint'; else if (AppState.dirtyRoutes.size > 0) macroState = 'Staging';
    let payload = { action: 'saveRoute', driverId: inspId, stops: minified, routeState: macroState };
    if (!Config.isManagerView) payload.routeId = Config.routeId;
    apiFetch(payload).catch(e => console.log(e));
}

export function getActiveEndpoints() {
    if (!Config.isManagerView) return { start: AppState.routeStart ? { address: AppState.routeStart.address, lat: AppState.routeStart.lat, lng: AppState.routeStart.lng } : null, end: AppState.routeEnd ? { address: AppState.routeEnd.address, lat: AppState.routeEnd.lat, lng: AppState.routeEnd.lng } : null };
    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') return { start: null, end: null };
    const inspId = Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam;
    const insp = AppState.inspectors.find(i => String(i.id) === String(inspId));
    const activeStops = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    let start = null; let end = null;
    if (hasRouted && AppState.routeStart && AppState.routeStart.address) start = AppState.routeStart; else if (insp) start = { address: insp.startAddress || insp.start || '', lat: insp.startLat, lng: insp.startLng };
    if (hasRouted && AppState.routeEnd && AppState.routeEnd.address) end = AppState.routeEnd; else if (insp) end = { address: insp.endAddress || insp.end || insp.startAddress || insp.start || '', lat: insp.endLat || insp.startLat, lng: insp.endLng || insp.startLng };
    return { start, end };
}

export async function handleGenerateRoute() {
    if (AppState.currentInspectorFilter === 'all') return;
    const insp = AppState.inspectors.find(i => String(i.id) === String(AppState.currentInspectorFilter));
    if (!insp) return;
    UI.showOverlay();

    let stopsToOptimize = []; const isEndpointsDirty = AppState.dirtyRoutes.has('endpoints_0'); const hasActiveRoutes = AppState.stops.some(s => isRouteAssigned(s.status));
    if (isEndpointsDirty) {
        stopsToOptimize = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView) && s.lng && s.lat && String(s.driverId) === String(insp.id));
        if (hasActiveRoutes) stopsToOptimize = stopsToOptimize.filter(s => s.cluster !== 'X');
    } else {
        stopsToOptimize = AppState.stops.filter(s => {
            if (!isActiveStop(s, Config.isManagerView) || !s.lng || !s.lat || String(s.driverId) !== String(insp.id)) return false;
            if (hasActiveRoutes && s.cluster === 'X') return false;
            const routeKey = `${s.driverId}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`; return AppState.dirtyRoutes.has(routeKey) || !isRouteAssigned(s.status);
        });
    }
    
    let sentClusters = [...new Set(stopsToOptimize.map(s => s.cluster))].filter(c => c !== 'X').sort();
    let flatStopsPayload = stopsToOptimize.map(s => { return minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1); });
    const eps = getActiveEndpoints(); stopsToOptimize.forEach(s => s.routeState = 'Queued'); UI.render(); 

    try {
        let payload = { action: 'generateRoute', inspectorName: insp.name, driverId: insp.id, stops: flatStopsPayload, startAddr: eps.start?.address || '', endAddr: eps.end?.address || '', routeState: 'Queued' };
        if (!Config.isManagerView) payload.routeId = Config.routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.updatedStops || (data.stops && Array.isArray(data.stops))) {
            let optimizedData = data.updatedStops || data.stops;
            const returnedStopsMap = new Map();
            optimizedData.forEach(s => {
                let exp = expandStop(s); let backendCluster = exp.cluster; let mappedCluster = backendCluster;
                if (sentClusters.length > 0) {
                    if (sentClusters.includes(backendCluster)) mappedCluster = backendCluster; 
                    else if (backendCluster < sentClusters.length) mappedCluster = sentClusters[backendCluster]; 
                    else if (sentClusters.length === 1) mappedCluster = sentClusters[0]; 
                }
                returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
            });

            AppState.stops = AppState.stops.map(s => {
                if (returnedStopsMap.has(String(s.id))) return returnedStopsMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready'; return s;
            });

            AppState.stops.sort((a, b) => {
                let cA = a.cluster === 'X' ? 999 : (a.cluster || 0); let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
                if (cA !== cB) return cA - cB; return timeToMins(a.eta) - timeToMins(b.eta);
            });

            AppState.isPollingForRoute = false; AppState.dirtyRoutes.clear(); triggerFullRender(); silentSaveRouteState(); 
        } else if (data.status === 'queued' || data.success) {
            let pqPayload = { action: 'processQueue', driverId: insp.id };
            if (!Config.isManagerView) pqPayload.routeId = Config.routeId;
            apiFetch(pqPayload).catch(err => console.log(err));
            
            AppState.isPollingForRoute = true; AppState.pollRetries = 0; setTimeout(loadData, 5000);
        } else { await loadData(); }
    } catch (e) { UI.hideOverlay(); await UI.customAlert("Generation encountered an error. Please wait a moment and try again."); } 
}

export async function handleCalculate() {
    UI.showOverlay();
    try {
        const activeStops = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView) && s.lng && s.lat);
        const isEndpointsDirty = AppState.dirtyRoutes.has('endpoints_0'); const hasActiveRoutes = AppState.stops.some(s => isRouteAssigned(s.status));
        let stopsToCalculate = [];

        if (isEndpointsDirty) {
            stopsToCalculate = activeStops; if (hasActiveRoutes) stopsToCalculate = stopsToCalculate.filter(s => s.cluster !== 'X');
        } else {
            stopsToCalculate = activeStops.filter(s => {
                if (hasActiveRoutes && s.cluster === 'X') return false;
                const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`; return AppState.dirtyRoutes.has(routeKey);
            });
        }

        if (stopsToCalculate.length === 0) { UI.hideOverlay(); AppState.dirtyRoutes.clear(); triggerFullRender(); return; }
        
        let sentClusters = [...new Set(stopsToCalculate.map(s => s.cluster))].filter(c => c !== 'X').sort(); const eps = getActiveEndpoints();
        let payload = { action: 'calculate', driverId: Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam, driver: Config.driverParam, startTime: AppState.currentStartTime, startAddr: eps.start?.address || null, endAddr: eps.end?.address || null, isManager: Config.isManagerView, stops: stopsToCalculate.map(s => minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1)) };
        if (!Config.isManagerView) payload.routeId = Config.routeId;

        const res = await apiFetch(payload); const data = await res.json(); if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s); let backendCluster = exp.cluster; let mappedCluster = backendCluster;
            if (sentClusters.length > 0) {
                if (sentClusters.includes(backendCluster)) mappedCluster = backendCluster;
                else if (backendCluster < sentClusters.length) mappedCluster = sentClusters[backendCluster];
                else if (sentClusters.length === 1) mappedCluster = sentClusters[0];
            }
            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
        });

        AppState.stops = AppState.stops.map(s => returnedStopsMap.has(String(s.id)) ? returnedStopsMap.get(String(s.id)) : s);
        if (!Config.isManagerView) AppState.isAlteredRoute = true;
        AppState.historyStack = []; AppState.dirtyRoutes.clear(); AppState.originalStops = JSON.parse(JSON.stringify(AppState.stops)); 
        
        triggerFullRender(); silentSaveRouteState();

    } catch (e) { UI.hideOverlay(); await UI.customAlert("Error calculating the route. Please try again."); } finally { UI.hideOverlay(); }
}

export async function triggerBulkDelete() { 
    if(!(await UI.customConfirm("Delete selected orders?"))) return;
    pushToHistory(); UI.showOverlay();

    try {
        let idsToDelete = Array.from(AppState.selectedIds);
        idsToDelete.forEach(id => { const s = AppState.stops.find(st => String(st.id) === String(id)); if (s && isRouteAssigned(s.status)) markRouteDirty(s.driverId, s.cluster); });
        let payload = { action: 'deleteMultipleOrders', rowIds: idsToDelete }; if (!Config.isManagerView) payload.routeId = Config.routeId;
        
        await apiFetch(payload); AppState.stops = AppState.stops.filter(s => !AppState.selectedIds.has(s.id)); AppState.selectedIds.clear(); 
        
        UI.updateInspectorDropdown(); UI.reorderStopsFromDOM(); triggerFullRender(); UI.updateRouteTimes(); silentSaveRouteState();
    } catch (err) { UI.hideOverlay(); await UI.customAlert("Error deleting orders. Please try again."); } finally { UI.hideOverlay(); }
}

export async function triggerBulkUnroute() { 
    if(!(await UI.customConfirm("Remove selected orders from route?"))) return;
    pushToHistory(); UI.showOverlay();

    try {
        let updatesArray = [];
        Array.from(AppState.selectedIds).forEach(id => {
            const idx = AppState.stops.findIndex(s => String(s.id) === String(id)); let dId = null;
            if (idx > -1) {
                dId = AppState.stops[idx].driverId;
                if (isRouteAssigned(AppState.stops[idx].status)) markRouteDirty(AppState.stops[idx].driverId, AppState.stops[idx].cluster);
                AppState.stops[idx].status = 'Pending'; AppState.stops[idx].cluster = 'X'; AppState.stops[idx].manualCluster = false; AppState.stops[idx].eta = ''; AppState.stops[idx].dist = 0; AppState.stops[idx].durationSecs = 0;
                if (Config.viewMode === 'inspector') AppState.stops[idx].hiddenInInspector = true; 
            }
            updatesArray.push({ rowId: id, driverId: dId });
        });
        
        let payload = { action: 'updateMultipleOrders', updatesList: updatesArray, sharedUpdates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' }, adminId: Config.adminParam };
        if (!Config.isManagerView) payload.routeId = Config.routeId;
        
        await apiFetch(payload); AppState.selectedIds.clear(); UI.reorderStopsFromDOM(); triggerFullRender(); UI.updateRouteTimes(); silentSaveRouteState();
    } catch (err) { UI.hideOverlay(); await UI.customAlert("Error removing orders from the route. Please try again."); } finally { UI.hideOverlay(); }
}

export async function handleRestoreOriginal() {
    if(!(await UI.customConfirm("Restore the original route layout planned by the manager?"))) return;
    UI.showOverlay();

    try {
        let payload = { action: 'restoreOriginalRoute', driverId: Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam };
        if (!Config.isManagerView) payload.routeId = Config.routeId;
        await apiFetch(payload); await loadData(); 
    } catch(e) { UI.hideOverlay(); await UI.customAlert("Error restoring the route. Please try again."); } finally { UI.hideOverlay(); }
}

export async function toggleComplete(e, id) {
    e.stopPropagation(); pushToHistory();
    const idx = AppState.stops.findIndex(s => String(s.id) === String(id));
    const newStatus = AppState.stops[idx].status.toLowerCase() === 'completed' ? (AppState.stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
    AppState.stops[idx].status = newStatus; triggerFullRender();
    
    try {
        let payload = { action: 'updateOrder', rowId: id, driverId: AppState.stops[idx].driverId, updates: { status: getStatusCode(newStatus) }, adminId: Config.adminParam };
        if (!Config.isManagerView) payload.routeId = Config.routeId;
        await apiFetch(payload);
    } catch(err) { console.error("Toggle Complete Error", err); }
}

export async function performUpload(file, inspectorId, csvType, overrideLock = false) {
    UI.showOverlay("Uploading CSV...", "Processing order data locally");
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        try {
            UI.showOverlay("Syncing...", "Sending data to server");
            let payload = { action: 'uploadCsv', csvData: text, adminId: Config.adminParam, driverId: inspectorId, companyId: Config.companyParam || '', csvType: csvType };
            if (!Config.isManagerView) payload.routeId = Config.routeId; if (overrideLock) payload.overrideLock = true;
            
            const res = await apiFetch(payload); const data = await res.json();
            
            if (data.success) {
                if (Config.isManagerView && inspectorId && inspectorId !== 'all') {
                    AppState.currentInspectorFilter = String(inspectorId); sessionStorage.setItem('sproute_inspector_filter', AppState.currentInspectorFilter);
                    document.body.classList.remove('manager-all-inspectors'); document.body.classList.add('manager-single-inspector');
                }
                
                if (data.unmatchedAddresses && data.unmatchedAddresses.length > 0) {
                    UI.hideOverlay(); AppState.unmatchedAddressesQueue = data.unmatchedAddresses; AppState.currentUnmatchedIndex = 0; AppState.currentUploadDriverId = inspectorId; UI.openUnmatchedModal();
                } else { 
                    await loadData(); 
                    UI.hideOverlay();
                }
            } else if (data.status === 'size_limit') {
                UI.hideOverlay(); await UI.customAlert("The uploaded file is too large. Please reduce rows and try again.");
            } else if (data.status === 'confirm_hijack') {
                UI.hideOverlay(); const proceed = await UI.customConfirm(data.message || "This route is currently locked by another admin. Overwrite it?");
                if (proceed) performUpload(file, inspectorId, csvType, true); 
            } else { throw new Error(data.error || "Upload failed"); }
        } catch (err) {
            console.error(err); UI.hideOverlay(); await UI.customAlert("An error occurred during the upload. Please try again.");
        }
    };
    reader.readAsText(file);
}

// --- Restored Sort Logic ---
export function sortTable(col) {
    if (AppState.currentSort.col === col) AppState.currentSort.asc = !AppState.currentSort.asc;
    else { AppState.currentSort.col = col; AppState.currentSort.asc = true; }

    AppState.stops.sort((a, b) => {
        let valA = a[col] || ''; let valB = b[col] || '';
        if (col === 'dueDate') {
            valA = valA ? new Date(valA).getTime() : Number.MAX_SAFE_INTEGER;
            valB = valB ? new Date(valB).getTime() : Number.MAX_SAFE_INTEGER;
        } else {
            valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
        }
        if (valA < valB) return AppState.currentSort.asc ? -1 : 1;
        if (valA > valB) return AppState.currentSort.asc ? 1 : -1;
        return 0;
    });
    UI.render(); 
}

// --- Local Actions ---

export function setRoutes(num) {
    AppState.currentRouteCount = num;
    document.body.setAttribute('data-route-count', num);
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if(btn) btn.classList.toggle('active', i === num);
    }
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
    
    AppState.stops.forEach(s => s.manualCluster = false); 
    
    const activeStops = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView) && s.lng && s.lat);
    if(activeStops.length > 0) {
        calculateClusters(activeStops, num, parseInt(document.getElementById('slider-priority')?.value || 0));
        updateMarkerColorsMap(AppState.stops, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteCount, AppState.inspectors);
        UI.updateRouteTimes();
    }
    UI.updateSelectionUI(); 
    UI.updatePrioritySliderUI();
}

export function moveSelectedToRoute(cIdx) {
    pushToHistory(); let movedStops = []; const hasActiveRoutes = AppState.stops.some(st => isRouteAssigned(st.status));
    AppState.selectedIds.forEach(id => {
        const s = AppState.stops.find(st => String(st.id) === String(id));
        if (s) {
            if (isRouteAssigned(s.status)) markRouteDirty(s.driverId, s.cluster); 
            s.cluster = cIdx; s.manualCluster = true; 
            if (hasActiveRoutes) { s.status = 'Routed'; s.routeState = 'Staging'; markRouteDirty(s.driverId, s.cluster); }
            movedStops.push(s);
        }
    });
    
    AppState.stops = AppState.stops.filter(s => !AppState.selectedIds.has(s.id)); AppState.stops.push(...movedStops); AppState.selectedIds.clear();
    triggerFullRender(); UI.updateRouteTimes(); silentSaveRouteState();
}

window.AppState = AppState; window.Config = Config; window.handleCalculate = handleCalculate; window.handleGenerateRoute = handleGenerateRoute; window.handleRestoreOriginal = handleRestoreOriginal; window.triggerBulkDelete = triggerBulkDelete; window.triggerBulkUnroute = triggerBulkUnroute; window.toggleComplete = toggleComplete; window.undoLastAction = undoLastAction; window.setRoutes = setRoutes; window.moveSelectedToRoute = moveSelectedToRoute; window.sortTable = sortTable;

export function updateShiftCursor(isShiftDown) {
    const wrap = document.getElementById('map-wrapper');
    if (wrap) {
        if (isShiftDown && !wrap.classList.contains('shift-down')) wrap.classList.add('shift-down');
        else if (!isShiftDown && wrap.classList.contains('shift-down')) wrap.classList.remove('shift-down');
    }
}

// 1. ADDED EVENT LISTENER FOR UPLOADS
document.addEventListener('sproute-trigger-upload', (e) => {
    const { file, inspectorId, csvType } = e.detail;
    performUpload(file, inspectorId, csvType);
});

document.addEventListener('keydown', (e) => { 
    if (e.key === 'Shift') updateShiftCursor(true); 
    if (Config.isManagerView && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.getElementById('modal-overlay').style.display === 'flex') return;
        if (AppState.selectedIds.size > 0 && AppState.PERMISSION_MODIFY) triggerBulkDelete();
    }
});
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') updateShiftCursor(false); }); document.addEventListener('mousemove', (e) => { updateShiftCursor(e.shiftKey); });
loadData();
