// *
// * Dashboard - V3.6
// * FILE: App.js
// * Changes: V3.6 - Hidden Optimize Route button in Manager view.
// * Updated estimated timing to use correct stop delay and calculate proper durations.
// * Added safe parseFloat checks so the distance summation correctly reads data from the DB.
// * Added ETA Time column to the list view in manager mode.
// *

function updateShiftCursor(isShiftDown) {
    const wrap = document.getElementById('map-wrapper');
    if (wrap) {
        if (isShiftDown && !wrap.classList.contains('shift-down')) {
            wrap.classList.add('shift-down');
        } else if (!isShiftDown && wrap.classList.contains('shift-down')) {
            wrap.classList.remove('shift-down');
        }
    }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Shift') updateShiftCursor(true); });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') updateShiftCursor(false); });
document.addEventListener('mousemove', (e) => { updateShiftCursor(e.shiftKey); });

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzgh2KCzfdWbOmdVq_edpuI_m6HxkfErzYAEHySfKkq1zgLtwuiUT3GCS5Xor9GgjFa/exec';

let COMPANY_SERVICE_DELAY = 15; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 
let currentInspectorFilter = 'all';

const params = new URLSearchParams(window.location.search);
const routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const viewMode = params.get('view') || 'driver'; 

document.body.className = `view-${viewMode} manager-all-inspectors`;

mapboxgl.accessToken = MAPBOX_TOKEN;
const map = new mapboxgl.Map({ 
    container: 'map', 
    style: 'mapbox://styles/mapbox/dark-v11', 
    center: [-96.797, 32.776],
    zoom: 11, 
    attributionControl: false,
    boxZoom: false 
});

let stops = [], originalStops = [], inspectors = [], markers = [], initialBounds = null, selectedIds = new Set(), currentDisplayMode = 'detailed', currentStartTime = "8:00 AM";
let currentSort = { col: null, asc: true };

const INSPECTOR_PALETTE = [
    { bg: '#2563eb', text: '#ffffff' }, 
    { bg: '#10b981', text: '#ffffff' }, 
    { bg: '#f1c40f', text: '#000000' }, 
    { bg: '#9b59b6', text: '#ffffff' }, 
    { bg: '#e67e22', text: '#000000' }, 
    { bg: '#1abc9c', text: '#000000' }, 
    { bg: '#e84393', text: '#ffffff' }, 
    { bg: '#00cec9', text: '#000000' }, 
    { bg: '#bcf60c', text: '#000000' }, 
    { bg: '#3f51b5', text: '#ffffff' }  
];

function expandStop(minStop) {
    if (minStop.address) return minStop; 
    let rawCluster = minStop.R;
    let clusterIdx = 0;
    if (typeof rawCluster === 'string' && rawCluster.startsWith('R:')) {
        clusterIdx = parseInt(rawCluster.split(':')[1]) - 1;
    } else if (!isNaN(parseInt(rawCluster))) {
        clusterIdx = parseInt(rawCluster) - 1;
    }
    return {
        id: minStop.r || minStop.i,
        seq: minStop.i,
        cluster: Math.max(0, clusterIdx),
        address: minStop.a, client: minStop.c, app: minStop.p, dueDate: minStop.d, type: minStop.t,
        eta: minStop.e, dist: minStop.D, lat: minStop.l, lng: minStop.g, status: minStop.s, 
        durationSecs: minStop.u, rowId: minStop.r
    };
}

function minifyStop(s, routeNum) {
    return {
        i: s.id || s.rowId, 
        R: 'R:' + routeNum, 
        a: s.address, 
        c: s.client, 
        p: s.app, 
        d: s.dueDate, 
        t: s.type, 
        e: s.eta, 
        D: s.dist, 
        l: s.lat ? parseFloat(s.lat).toFixed(5) : 0, 
        g: s.lng ? parseFloat(s.lng).toFixed(5) : 0, 
        s: s.status, 
        u: s.durationSecs, 
        r: s.rowId || s.id
    };
}

function sortByEta(a, b) {
    let tA = a.eta ? new Date(a.eta).getTime() : 0;
    let tB = b.eta ? new Date(b.eta).getTime() : 0;
    return tA - tB;
}

function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-filter');
    if (!filterSelect || viewMode !== 'manager' || inspectors.length === 0) return;

    const validInspectorIds = new Set();
    stops.forEach(s => {
        const status = (s.status || '').toLowerCase();
        if (status !== 'cancelled' && status !== 'deleted' && s.driverId) {
            validInspectorIds.add(s.driverId);
        }
    });

    const currentVal = filterSelect.value || 'all';
    let filterHtml = '<option value="all">All Inspectors</option>';
    
    inspectors.forEach(i => { 
        if (validInspectorIds.has(i.id)) {
            filterHtml += `<option value="${i.id}">${i.name}</option>`; 
        }
    });
    
    filterSelect.innerHTML = filterHtml;
    if (currentVal !== 'all' && !validInspectorIds.has(currentVal)) {
        filterSelect.value = 'all';
        handleInspectorFilterChange('all');
    } else {
        filterSelect.value = currentVal;
    }
}

function handleInspectorFilterChange(val) {
    currentInspectorFilter = val;
    document.body.classList.toggle('manager-all-inspectors', val === 'all');
    document.body.classList.toggle('manager-single-inspector', val !== 'all');
    selectedIds.clear();
    
    if (val !== 'all') liveClusterUpdate();
    
    render(); drawRoute(); updateSummary();
}

function isActiveStop(s) {
    let active = true;
    const status = (s.status || '').toLowerCase();
    
    if (viewMode === 'manager') {
        active = (status === '' || status === 'routed' || status === 'completed');
    } else {
        active = status !== 'cancelled' && status !== 'deleted' && !status.includes('unfound');
    }
    
    if (viewMode === 'manager' && currentInspectorFilter !== 'all') {
        if (s.driverId !== currentInspectorFilter) active = false;
    }
    
    return active;
}

function getVisualStyle(stopData) {
    if ((currentInspectorFilter !== 'all' || viewMode !== 'manager') && stopData.hasOwnProperty('cluster')) {
        return INSPECTOR_PALETTE[stopData.cluster % INSPECTOR_PALETTE.length];
    } else {
        if (!stopData.driverId) return { bg: 'var(--red)', text: '#ffffff' };
        const index = inspectors.findIndex(i => i.id === stopData.driverId);
        if (index === -1) return { bg: 'var(--red)', text: '#ffffff' };
        return INSPECTOR_PALETTE[index % INSPECTOR_PALETTE.length];
    }
}

const resizerEl = document.getElementById('resizer');
const sidebarEl = document.getElementById('sidebar');
const mapWrapEl = document.getElementById('map-wrapper');
let isResizing = false;

resizerEl.addEventListener('mousedown', (e) => {
    if(viewMode !== 'manager') return;
    isResizing = true;
    resizerEl.classList.add('active');
    document.body.style.cursor = 'col-resize';
    mapWrapEl.style.pointerEvents = 'none'; 
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    let newWidth = window.innerWidth - e.clientX;
    if (newWidth < 300) newWidth = 300;
    if (newWidth > window.innerWidth - 300) newWidth = window.innerWidth - 300;
    sidebarEl.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        resizerEl.classList.remove('active');
        mapWrapEl.style.pointerEvents = 'auto';
        if(map) map.resize(); 
    }
});

async function loadData() {
    let queryParams = '';
    if (companyParam) queryParams = `?company=${companyParam}`;
    else if (driverParam) queryParams = `?driver=${driverParam}`;
    else if (routeId) queryParams = `?id=${routeId}`;
    else {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`${WEB_APP_URL}${queryParams}`);
        const data = await res.json();
        let rawStops = Array.isArray(data) ? data : (data.stops || []);
        
        stops = rawStops.map(s => {
            let exp = expandStop(s);
            return {
                ...exp,
                id: exp.rowId || exp.id,
                cluster: exp.cluster || 0,
                manualCluster: false,
                _hasExplicitCluster: s.R !== undefined
            };
        });

        const getLocalDateStr = (etaStr) => {
            if (!etaStr) return "";
            const d = new Date(etaStr);
            return isNaN(d.getTime()) ? String(etaStr).split(' ')[0] : d.toDateString();
        };

        let activeDates = [...new Set(stops.filter(s => s.eta && (s.status||'').toLowerCase() === 'routed').map(s => getLocalDateStr(s.eta)))];
        activeDates = activeDates.filter(Boolean);
        activeDates.sort((a, b) => new Date(a) - new Date(b));

        stops.forEach(s => {
            if (!s._hasExplicitCluster && s.eta && (s.status||'').toLowerCase() === 'routed') {
                s.cluster = Math.max(0, activeDates.indexOf(getLocalDateStr(s.eta)));
            }
        });

        if (activeDates.length > 0) {
            currentRouteCount = activeDates.length;
            const cappedCount = Math.min(3, activeDates.length);
            for(let i=1; i<=3; i++) {
                const btn = document.getElementById(`rbtn-${i}`);
                if(btn) btn.classList.toggle('active', i === cappedCount);
            }
        }

        originalStops = JSON.parse(JSON.stringify(stops)); 
        if (stops.length > 0 && stops[0].eta) currentStartTime = stops[0].eta;

        if (!Array.isArray(data)) {
            inspectors = data.inspectors || []; 
            if (data.serviceDelay !== undefined) COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay); 
            if (data.permissions) {
                if (typeof data.permissions.modify !== 'undefined') PERMISSION_MODIFY = data.permissions.modify;
                if (typeof data.permissions.reoptimize !== 'undefined') PERMISSION_REOPTIMIZE = data.permissions.reoptimize;
            }
            
            document.body.classList.add('tier-' + (data.tier ? data.tier.toLowerCase() : 'individual'));

            const mapLogo = document.getElementById('brand-logo-map');
            const sidebarLogo = document.getElementById('brand-logo-sidebar');

            if (data.tier && data.companyLogo && (data.tier.toLowerCase() === 'company')) {
                if (mapLogo) mapLogo.src = data.companyLogo;
                if (sidebarLogo) sidebarLogo.src = data.companyLogo;
            } else {
                const sprouteLogoUrl = 'https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png';
                if (mapLogo) mapLogo.src = sprouteLogoUrl;
                if (sidebarLogo) sidebarLogo.src = sprouteLogoUrl;
            }
            
            let displayName = data.displayName || 'Sproute'; 
            const mapDriverEl = document.getElementById('map-driver-name');
            if (mapDriverEl) mapDriverEl.innerText = displayName;
            
            const sidebarDriverEl = document.getElementById('sidebar-driver-name');
            const filterSelect = document.getElementById('inspector-dropdown-wrapper');

            if (viewMode === 'manager' && data.tier && data.tier.toLowerCase() !== 'individual') {
                if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
                if (sidebarLogo) sidebarLogo.style.display = 'none'; 
                if (filterSelect) filterSelect.style.display = 'block';
                updateInspectorDropdown(); 
            } else {
                if (sidebarDriverEl) sidebarDriverEl.innerText = displayName;
            }
            
            let hasValidStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat).length > 0;
            if (!hasValidStops && data.companyAddress) {
                const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.companyAddress)}.json?access_token=${MAPBOX_TOKEN}`;
                fetch(geoUrl).then(r => r.json()).then(geo => {
                    if (geo.features && geo.features.length > 0) {
                        map.flyTo({ center: geo.features[0].center, zoom: 11 });
                    }
                }).catch(err => console.error("Geocoding failed for company address.", err));
            }
        }
        
        if(viewMode === 'map' || viewMode === 'list' || viewMode === 'manager') {
            document.querySelector('.rocker').style.display = 'none';
        }

        render(); drawRoute(); updateSummary(); initSortable();

    } catch (e) { 
        console.error("Error loading data:", e); 
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

function updateRoutingUI() {
    if(viewMode !== 'manager') return;

    const activeStops = stops.filter(s => isActiveStop(s));
    const routedCount = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed').length;
    
    const routingControls = document.getElementById('routing-controls');
    const dividerGroup = document.getElementById('route-divider-group');
    const priorityCont = document.getElementById('priority-container');
    const hintEl = document.getElementById('inspector-select-hint');
    const headerOptBtn = document.getElementById('btn-header-optimize');
    const headerGenBtn = document.getElementById('btn-header-generate');
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    const headerStartBtn = document.getElementById('btn-header-start-over');

    if (currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        if(headerOptBtn) headerOptBtn.style.display = 'none';
        if(headerGenBtn) headerGenBtn.style.display = 'none';
        if(headerStartBtn) headerStartBtn.style.display = 'none';

        let showHint = false;
        const allValidStops = stops.filter(s => {
            const status = (s.status || '').toLowerCase();
            return status !== 'cancelled' && status !== 'deleted' && !status.includes('unfound');
        });

        for (const insp of inspectors) {
            if (allValidStops.filter(s => s.driverId === insp.id).length > 2) {
                showHint = true; 
                break;
            }
        }
        if (hintEl) hintEl.style.display = showHint ? 'block' : 'none';

    } else {
        if (hintEl) hintEl.style.display = 'none';

        if (routedCount > 0) {
            if(routingControls) routingControls.style.display = 'none';
            if(headerGenBtn) headerGenBtn.style.display = 'none';
            if(headerStartBtn) headerStartBtn.style.display = 'flex';
            if(headerOptBtn) headerOptBtn.style.display = viewMode === 'manager' ? 'none' : 'flex';
        } else {
            if(routingControls) routingControls.style.display = 'flex';
            
            if (activeStops.length <= 25) {
                if(dividerGroup) dividerGroup.style.display = 'none';
                if(priorityCont) priorityCont.style.display = 'none';
            } else {
                if(dividerGroup) dividerGroup.style.display = 'flex';
                if(priorityCont) priorityCont.style.display = 'flex';
            }
            
            if(headerGenBtn) headerGenBtn.style.display = 'flex';
            if(headerStartBtn) headerStartBtn.style.display = 'none';
            if(headerOptBtn) headerOptBtn.style.display = 'none';
            
            if (headerGenBtnText) {
                headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
            }
        }
    }
}

function setRoutes(num) {
    currentRouteCount = num;
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if(btn) btn.classList.toggle('active', i === num);
    }
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    if (headerGenBtnText) headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
    
    stops.forEach(s => s.manualCluster = false); 
    
    liveClusterUpdate();
    updateSelectionUI(); 
}

function moveSelectedToRoute(cIdx) {
    selectedIds.forEach(id => {
        const s = stops.find(st => st.id === id);
        if (s) {
            s.cluster = cIdx;
            s.manualCluster = true; 
        }
    });
    selectedIds.clear();
    updateSelectionUI();
    updateMarkerColors();
    updateRouteTimes();
}

function updateRouteTimes() {
    if(viewMode !== 'manager' || currentInspectorFilter === 'all') return;
    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    for(let i=0; i<3; i++) {
        const count = activeStops.filter(s => s.cluster === i).length;
        const hrs = Math.ceil(count * ((COMPANY_SERVICE_DELAY + 15) / 60));
        const timeEl = document.getElementById(`rtime-${i+1}`);
        if(timeEl) {
            timeEl.innerText = count > 0 ? `${hrs} hrs` : '-- hrs';
        }
    }
}

async function handleGenerateRoute() {
    if (currentInspectorFilter === 'all') return;
    const insp = inspectors.find(i => i.id === currentInspectorFilter);
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    let clusteredArrays = [];
    for(let i = 0; i < currentRouteCount; i++) {
        let itemsInCluster = stops.filter(s => isActiveStop(s) && s.lng && s.lat && s.cluster === i && (s.status||'').toLowerCase() !== 'routed' && (s.status||'').toLowerCase() !== 'completed');
        if (itemsInCluster.length > 0) {
            clusteredArrays.push(itemsInCluster.map(s => minifyStop(s, i + 1)));
        }
    }

    try {
        await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'generateRoute', inspectorName: insp.name, driverId: insp.id, routeClusters: clusteredArrays })
        });
        
        await loadData();
    } catch (e) {
        alert("Failed to request route generation. Check logs.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function handleStartOver() {
    if(!confirm("Clear the current route and start over?")) return;
    
    const insp = inspectors.find(i => i.id === currentInspectorFilter);
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'resetRoute', driverId: insp.id, routeId: routeId }) 
        });
        
        stops.forEach(s => {
            if (s.driverId === insp.id && (s.status||'').toLowerCase() === 'routed') {
                s.eta = '';
                s.dist = '';
                s.status = '';
            }
        });
        
        document.getElementById('controls').style.display = 'none'; 
        render(); drawRoute(); updateSummary();
    } catch(e) { 
        alert("Failed to reset route."); 
        console.error(e);
    } finally { 
        if(overlay) overlay.style.display = 'none'; 
    }
}

function liveClusterUpdate() {
    if(viewMode !== 'manager' || currentInspectorFilter === 'all') return;
    
    const k = currentRouteCount;
    const w = parseInt(document.getElementById('slider-priority').value) / 100;
    
    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    if(activeStops.length === 0) return;

    if(k === 1) {
        activeStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        updateMarkerColors();
        updateRouteTimes();
        return;
    }

    let centroids = [];
    for(let i=0; i<k; i++) {
        let idx = Math.floor(i * activeStops.length / k);
        centroids.push({ lat: activeStops[idx].lat, lng: activeStops[idx].lng });
    }

    let today = new Date(); 
    today.setHours(0,0,0,0);

    for(let iter=0; iter<10; iter++) {
        activeStops.forEach(s => {
            if (s.manualCluster) return; 

            let bestD = Infinity;
            let bestC = 0;
            let dueTime = s.dueDate ? new Date(s.dueDate).getTime() : Infinity;
            let daysUntilDue = Math.floor((dueTime - today.getTime()) / (1000*3600*24));

            centroids.forEach((c, cIdx) => {
                let dLat = s.lat - c.lat;
                let dLng = s.lng - c.lng;
                let geoDist = Math.sqrt(dLat*dLat + dLng*dLng);

                let timePenalty = 0;
                if(w > 0 && s.dueDate) {
                    if(daysUntilDue < cIdx) {
                        timePenalty = (cIdx - Math.max(0, daysUntilDue)) * 0.2; 
                    }
                }

                let totalDist = geoDist + (timePenalty * w);
                if(totalDist < bestD) { bestD = totalDist; bestC = cIdx; }
            });
            s.cluster = bestC;
        });

        for(let i=0; i<k; i++) {
            let clusterStops = activeStops.filter(s => s.cluster === i);
            if(clusterStops.length > 0) {
                let sumLat = 0, sumLng = 0;
                clusterStops.forEach(s => { sumLat+=s.lat; sumLng+=s.lng; });
                centroids[i].lat = sumLat / clusterStops.length;
                centroids[i].lng = sumLng / clusterStops.length;
            }
        }
    }
    
    updateMarkerColors();
    updateRouteTimes();
}

function updateMarkerColors() {
    markers.forEach(m => {
        const stopData = stops.find(st => st.id === m._stopId);
        if (stopData) {
            const visualStyle = getVisualStyle(stopData);
            const pin = m.getElement().querySelector('.pin-visual');
            if(pin) {
                pin.style.backgroundColor = visualStyle.bg;
                pin.style.color = visualStyle.text;
            }
        }
    });
}

async function triggerBulkDelete() { 
    if(!confirm("Delete selected orders?")) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        let affectedRouted = false;
        selectedIds.forEach(id => {
            const s = stops.find(st => st.id === id);
            if (s && (s.status || '').toLowerCase() === 'routed') affectedRouted = true;
        });

        const deletePromises = Array.from(selectedIds).map(id => {
            const idx = stops.findIndex(s => s.id === id);
            if (idx > -1) stops[idx].status = 'Deleted';
            return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'markOrderDeleted', rowId: id }) });
        });
        
        await Promise.all(deletePromises);
        
        selectedIds.clear(); 
        updateInspectorDropdown(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        
        if (affectedRouted) {
            document.getElementById('controls').style.display = 'flex'; 
        }
    } catch (err) {
        alert("A network or server error occurred. Please check the Google Apps Script Execution Log.");
        console.error("Bulk Delete Error:", err);
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function triggerBulkUnroute() { 
    if(!confirm("Remove selected orders from route?")) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        const unroutePromises = Array.from(selectedIds).map(id => {
            const idx = stops.findIndex(s => s.id === id);
            if (idx > -1) stops[idx].status = '';
            return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'unrouteOrder', rowId: id }) });
        });
        
        await Promise.all(unroutePromises);
        
        selectedIds.clear(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        document.getElementById('controls').style.display = 'flex'; 
    } catch (err) {
        alert("A network or server error occurred.");
        console.error("Bulk Unroute Error:", err);
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function processReassignDriver(rowId, newDriverName, newDriverId) {
    const stopIdx = stops.findIndex(s => s.id === rowId);
    if (stopIdx > -1) { stops[stopIdx].driverName = newDriverName; stops[stopIdx].driverId = newDriverId; }
    const payload = { action: 'updateOrder', rowId: rowId, updates: { "HKAwZ": newDriverName, "xuPjx": newDriverId } };
    return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
}

async function handleInspectorChange(e, rowId, selectEl) {
    e.stopPropagation(); 
    const newDriverId = selectEl.value;
    const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    
    let idsToUpdate = [rowId];
    if (selectedIds.has(rowId) && selectedIds.size > 1) {
        if (confirm(`Reassign all ${selectedIds.size} selected orders to ${newDriverName}?`)) idsToUpdate = Array.from(selectedIds);
        else { render(); return; }
    }
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try { 
        let affectedRouted = false;
        idsToUpdate.forEach(id => {
            const s = stops.find(st => st.id === id);
            if (s && (s.status || '').toLowerCase() === 'routed') affectedRouted = true;
        });

        for (const id of idsToUpdate) await processReassignDriver(id, newDriverName, newDriverId); 
        
        updateInspectorDropdown(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        
        if (affectedRouted) {
            document.getElementById('controls').style.display = 'flex'; 
        }
    } catch (err) { 
        alert("Network error: Failed to update some orders."); 
        console.error(err);
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

function sortTable(col) {
    if (currentSort.col === col) currentSort.asc = !currentSort.asc;
    else { currentSort.col = col; currentSort.asc = true; }

    stops.sort((a, b) => {
        let valA = a[col] || ''; let valB = b[col] || '';
        if (col === 'dueDate') {
            valA = valA ? new Date(valA).getTime() : Number.MAX_SAFE_INTEGER;
            valB = valB ? new Date(valB).getTime() : Number.MAX_SAFE_INTEGER;
        } else {
            valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
        }
        if (valA < valB) return currentSort.asc ? -1 : 1;
        if (valA > valB) return currentSort.asc ? 1 : -1;
        return 0;
    });
    render(); 
}

function getSortIcon(col) {
    if (currentSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:0.3; margin-left:4px;"></i>';
    return currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--blue);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--blue);"></i>';
}

function setDisplayMode(mode) {
    currentDisplayMode = mode;
    document.getElementById('btn-detailed').classList.toggle('active', mode === 'detailed');
    document.getElementById('btn-compact').classList.toggle('active', mode === 'compact');
    render();
}

function createRouteSubheading(clusterNum, clusterStops) {
    let totalMi = 0;
    let dueToday = 0;
    let pastDue = 0;
    const today = new Date(); today.setHours(0,0,0,0);

    clusterStops.forEach(s => {
        const distVal = parseFloat(s.dist);
        if (!isNaN(distVal)) {
            totalMi += distVal;
        }
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    let hrs = Math.ceil(clusterStops.length * ((COMPANY_SERVICE_DELAY + 15) / 60));
    let dueText = pastDue > 0 ? `<span style="color:var(--red)">${pastDue} Past Due</span>` : (dueToday > 0 ? `<span style="color:var(--orange)">${dueToday} Due Today</span>` : `0 Due`);
    
    const el = document.createElement('div');
    el.className = 'list-subheading';
    el.innerHTML = `<span>ROUTE ${clusterNum + 1}</span><span class="route-summary-text">${totalMi.toFixed(1)} mi | ${hrs} hrs | ${clusterStops.length} stops | ${dueText}</span>`;
    return el;
}

function render(isDraft = false) {
    updateRoutingUI();
    const listContainer = document.getElementById('stop-list');
    listContainer.innerHTML = ''; 
    markers.forEach(m => m.remove()); 
    markers = [];
    const bounds = new mapboxgl.LngLatBounds();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (viewMode === 'list' || viewMode === 'manager') {
        const header = document.createElement('div');
        header.className = 'glide-table-header';
        
        const handleHeaderHtml = (viewMode === 'manager') ? `<div class="col-handle"></div>` : ``;
        header.innerHTML = `
            ${handleHeaderHtml}
            <div class="col-num"></div>
            <div class="col-eta sortable" onclick="sortTable('eta')">ETA ${getSortIcon('eta')}</div>
            <div class="col-due sortable" onclick="sortTable('dueDate')">Due ${getSortIcon('dueDate')}</div>
            <div class="col-insp sortable" onclick="sortTable('driverName')">Inspector ${getSortIcon('driverName')}</div>
            <div class="col-addr sortable" onclick="sortTable('address')">Address ${getSortIcon('address')}</div>
            <div class="col-app">App</div>
            <div class="col-client sortable" onclick="sortTable('client')">Client ${getSortIcon('client')}</div>
            <div class="col-type sortable" onclick="sortTable('type')">Order type ${getSortIcon('type')}</div>
        `;
        listContainer.appendChild(header);
    }

    const activeStops = stops.filter(s => isActiveStop(s));
    
    const processStop = (s, displayIndex, showHandle) => {
        const item = document.createElement('div');
        item.id = `item-${s.id}`;
        item.setAttribute('data-search', `${(s.address||'').toLowerCase()} ${(s.client||'').toLowerCase()}`);
        
        const due = s.dueDate ? new Date(s.dueDate) : null;
        let urgencyClass = '';
        
        if (due) {
            const dueTime = new Date(due);
            dueTime.setHours(0, 0, 0, 0); 
            if (dueTime < today) urgencyClass = 'past-due'; 
            else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today'; 
        }
        
        const dueFmt = due ? `${due.getMonth()+1}/${due.getDate()}` : "N/A";

        const extractTime = (dateStr) => {
            if (!dateStr) return '--';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) {
                const match = String(dateStr).match(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
                return match ? match[0].toUpperCase() : '--';
            }
            return d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
        };
        const etaTime = extractTime(s.eta);

        if (viewMode === 'list' || viewMode === 'manager') {
            item.className = `glide-row ${s.status}`;
            let inspectorHtml = `<div class="col-insp">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
            if (viewMode === 'manager' && inspectors.length > 0) {
                const optionsHtml = inspectors.map(insp => `<option value="${insp.id}" ${s.driverId === insp.id ? 'selected' : ''}>${insp.name}</option>`).join('');
                const defaultPlaceholder = !s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : '';
                const disableSelectAttr = !PERMISSION_MODIFY ? 'disabled' : '';

                inspectorHtml = `
                    <div class="col-insp" onclick="event.stopPropagation()">
                        <select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" ${disableSelectAttr}>
                            ${defaultPlaceholder}
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            }

            const style = getVisualStyle(s);
            const handleHtml = viewMode === 'manager' ? `<div class="col-handle ${showHandle ? 'handle' : ''}">${showHandle ? '<i class="fa-solid fa-grip-lines"></i>' : ''}</div>` : ``;

            item.innerHTML = `
                ${handleHtml}
                <div class="col-num"><div class="num-badge" style="background-color: ${style.bg}; color: ${style.text};">${displayIndex}</div></div>
                <div class="col-eta">${etaTime}</div>
                <div class="col-due ${urgencyClass}">${dueFmt}</div>
                ${inspectorHtml}
                <div class="col-addr">${(s.address||'').split(',')[0]}</div>
                <div class="col-app">${s.app || '--'}</div>
                <div class="col-client">${s.client || '--'}</div>
                <div class="col-type">${s.type || '--'}</div>
            `;
        } else {
            item.className = `stop-item ${s.status} ${currentDisplayMode}`;
            const metaDisplay = isDraft ? '-- | --' : `${s.eta || '--'} | ${s.dist || '--'}`;
            const handleHtml = PERMISSION_MODIFY ? `<div class="handle">☰</div>` : ``;
            
            item.innerHTML = `
                <div class="stop-sidebar ${urgencyClass}">${displayIndex}</div>
                ${handleHtml}
                <div class="csv-box">${(s.app || "--").substring(0,2).toUpperCase()}</div>
                <div class="stop-content">
                    <b>${(s.address||'').split(',')[0]}</b>
                    <div class="row-meta">${metaDisplay}</div>
                    <div class="row-details">${s.type || ''}</div>
                </div>
                <div class="due-date-container ${urgencyClass}">${dueFmt}</div>
                <div class="stop-actions">
                    <i class="fa-solid fa-circle-check icon-btn" style="color:var(--green)" onclick="toggleComplete(event, '${s.id}')"></i>
                    <i class="fa-solid fa-location-arrow icon-btn" style="color:var(--blue)" onclick="openNav(event, '${s.lat}','${s.lng}')"></i>
                </div>
            `;
        }
        
        item.onclick = (e) => {
            if (!e.shiftKey) selectedIds.clear();
            selectedIds.has(s.id) ? selectedIds.delete(s.id) : selectedIds.add(s.id);
            updateSelectionUI(); focusPin(s.id);
        };

        if(s.lng && s.lat) {
            const el = document.createElement('div');
            el.className = `marker ${s.status}`; 
            
            const style = getVisualStyle(s);
            el.innerHTML = `<div class="pin-visual" style="background-color: ${style.bg}; color: ${style.text};"><span>${displayIndex}</span></div>`;

            if (urgencyClass) {
                const w = document.createElement('div'); w.className = 'marker-warning'; 
                w.innerText = (urgencyClass === 'past-due') ? '⚠️' : '❕';
                el.appendChild(w);
            }
            
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!e.shiftKey) selectedIds.clear();
                selectedIds.has(s.id) ? selectedIds.delete(s.id) : selectedIds.add(s.id);
                updateSelectionUI(); focusTile(s.id);
            });
            
            const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
            m._stopId = s.id; markers.push(m); bounds.extend([s.lng, s.lat]);
        }
        return item;
    };

    if (viewMode === 'manager' && currentInspectorFilter !== 'all') {
        const unroutedStops = activeStops.filter(s => (s.status||'').toLowerCase() !== 'routed' && (s.status||'').toLowerCase() !== 'completed');
        const routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed');
        routedStops.sort(sortByEta);

        if (unroutedStops.length > 0) {
            const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS';
            listContainer.appendChild(el);
            const unroutedDiv = document.createElement('div');
            unroutedDiv.id = 'unrouted-list';
            unroutedDiv.style.minHeight = '30px'; 
            listContainer.appendChild(unroutedDiv);
            unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1, false)); });
        }
        
        if (routedStops.length > 0) {
            const uniqueClusters = [...new Set(routedStops.map(s => s.cluster || 0))].sort();
            uniqueClusters.forEach(clusterId => {
                const cStops = routedStops.filter(s => (s.cluster || 0) === clusterId);
                if (cStops.length > 0) {
                    listContainer.appendChild(createRouteSubheading(clusterId, cStops));
                    const routedDiv = document.createElement('div');
                    routedDiv.id = `routed-list-${clusterId}`;
                    routedDiv.className = 'routed-group-container';
                    routedDiv.style.minHeight = '30px';
                    listContainer.appendChild(routedDiv);
                    cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1, true)); });
                }
            });
        }
        
    } else if (viewMode === 'driver' || viewMode === 'routing') {
        const activeStopsCopy = [...activeStops].sort(sortByEta);
        const uniqueClusters = [...new Set(activeStopsCopy.map(s => s.cluster || 0))].sort();
        
        if (uniqueClusters.length > 1) {
            uniqueClusters.forEach(clusterId => {
                const cStops = activeStopsCopy.filter(s => (s.cluster || 0) === clusterId);
                if (cStops.length > 0) {
                    listContainer.appendChild(createRouteSubheading(clusterId, cStops));
                    const routedDiv = document.createElement('div');
                    routedDiv.id = `driver-list-${clusterId}`;
                    routedDiv.className = 'routed-group-container';
                    listContainer.appendChild(routedDiv);
                    cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1, true)); });
                }
            });
        } else {
            const mainDiv = document.createElement('div');
            mainDiv.id = 'main-list-container';
            listContainer.appendChild(mainDiv);
            activeStopsCopy.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
        }
    } else {
        const mainDiv = document.createElement('div');
        mainDiv.id = 'main-list-container';
        listContainer.appendChild(mainDiv);
        activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
    }

    if (activeStops.filter(s => s.lng && s.lat).length > 0) { 
        initialBounds = bounds; map.fitBounds(bounds, { padding: 50, maxZoom: 15 }); 
    }
    
    updateSelectionUI();
    initSortable(); 
}

function updateSummary() {
    const active = stops.filter(s => isActiveStop(s) && s.status !== 'completed');
    let totalMi = 0;
    active.forEach(s => {
        const distVal = parseFloat(s.dist);
        if (!isNaN(distVal)) totalMi += distVal;
    });
    document.getElementById('sum-dist').innerText = `${totalMi.toFixed(1)} mi`;
    document.getElementById('sum-time').innerText = `${Math.ceil(active.length * ((COMPANY_SERVICE_DELAY + 15) / 60))} hrs`;
    
    const totalOrders = active.length;
    let dueToday = 0;
    let pastDue = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    active.forEach(s => {
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate);
            dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    const statTotalEl = document.getElementById('stat-total');
    const statDueEl = document.getElementById('stat-due');
    const statPastEl = document.getElementById('stat-past');

    if(statTotalEl) statTotalEl.innerText = `${totalOrders} Orders`;
    if(statDueEl) statDueEl.innerText = `${dueToday} Due Today`;
    if(statPastEl) statPastEl.innerText = `${pastDue} Past Due`;
}

async function handleCalculate() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
        if (activeStops.length < 2) { alert("Not enough valid stops."); return; }

        const MAX_WAYPOINTS = 25; 
        let legs = []; 

        for (let i = 0; i < activeStops.length - 1; i += (MAX_WAYPOINTS - 1)) {
            const chunk = activeStops.slice(i, i + MAX_WAYPOINTS);
            const coords = chunk.map(s => `${s.lng},${s.lat}`).join(';');
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${MAPBOX_TOKEN}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) throw new Error("Routing failed: " + data.message);
            legs.push(...data.routes[0].legs);
        }

        let time = new Date();
        let match = currentStartTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (match) {
            let hours = parseInt(match[1]), mins = parseInt(match[2]);
            if (match[3] && match[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (match[3] && match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
            time.setHours(hours, mins, 0, 0);
        } else { time.setHours(8, 0, 0, 0); }

        let totalMeters = 0;
        activeStops.forEach((stop, index) => {
            if (index === 0) {
                stop.eta = formatTime(time); stop.dist = "0.0 mi"; stop.durationSecs = 0;
            } else {
                let leg = legs[index - 1];
                time = new Date(time.getTime() + (COMPANY_SERVICE_DELAY * 60 * 1000) + (leg.duration * 1000));
                stop.eta = formatTime(time);
                totalMeters += leg.distance;
                stop.dist = (totalMeters * 0.000621371).toFixed(1) + " mi";
                stop.durationSecs = leg.duration;
            }
        });

        if (routeId) {
            let minifiedStopsForSave = stops.map(s => minifyStop(s, (s.cluster || 0) + 1));
            await fetch(WEB_APP_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'saveRoute', routeId: routeId, driver: driverParam, stops: minifiedStopsForSave })
            });
        }

        document.getElementById('controls').style.display = 'none';
        originalStops = JSON.parse(JSON.stringify(stops)); 
        render(); drawRoute(); updateSummary();

    } catch (e) { 
        alert("Calculation failed: " + e.message); 
        console.error(e);
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

function handleOptimize() { showSyncOptions('optimize'); }

async function handleUndo() {
    if(!confirm("Discard all changes and revert to original route?")) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        if (viewMode === 'manager') {
            const payload = { action: 'undoManagerChanges', originalStops: originalStops };
            await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
            stops = JSON.parse(JSON.stringify(originalStops));
            
            updateInspectorDropdown(); 
            document.getElementById('controls').style.display = 'none';
            render(); drawRoute(); updateSummary();
        } else {
            stops = JSON.parse(JSON.stringify(originalStops));
            document.getElementById('controls').style.display = 'none';
            render(); drawRoute(); updateSummary();
        }
    } catch(e) { 
        alert("Failed to undo changes on server."); 
        console.error(e);
    } finally { 
        if(overlay) overlay.style.display = 'none'; 
    }
}

function toggleComplete(e, id) {
    e.stopPropagation();
    const idx = stops.findIndex(s => s.id == id);
    stops[idx].status = (stops[idx].status === 'completed') ? '' : 'completed';
    render(); drawRoute(); updateSummary();
}

let start_pos, box_el;
map.on('click', (e) => { if (e.originalEvent.target.classList.contains('mapboxgl-canvas')) { selectedIds.clear(); updateSelectionUI(); } });
const canvas = map.getCanvasContainer();

canvas.addEventListener('mousedown', (e) => { 
    if (e.target.closest('.mapboxgl-marker')) return; 
    if(e.shiftKey) { 
        map.dragPan.disable(); start_pos = mousePos(e); 
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); 
    } 
}, true);

function mousePos(e) { const r = canvas.getBoundingClientRect(); return new mapboxgl.Point(e.clientX-r.left, e.clientY-r.top); }

function onMouseMove(e) { 
    const curr = mousePos(e); 
    if(!box_el) { box_el=document.createElement('div'); box_el.className='boxdraw'; canvas.appendChild(box_el); } 
    const minX=Math.min(start_pos.x,curr.x), maxX=Math.max(start_pos.x,curr.x), minY=Math.min(start_pos.y,curr.y), maxY=Math.max(start_pos.y,curr.y); 
    box_el.style.left=minX+'px'; box_el.style.top=minY+'px'; box_el.style.width=(maxX-minX)+'px'; box_el.style.height=(maxY-minY)+'px'; 
}

function onMouseUp(e) { 
    document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); 
    if(box_el) { 
        const b=[start_pos, mousePos(e)]; 
        markers.filter(m => { 
            const pt=map.project(m.getLngLat()); 
            return pt.x>=Math.min(b[0].x,b[1].x) && pt.x<=Math.max(b[0].x,b[1].x) && pt.y>=Math.min(b[0].y,b[1].y) && pt.y<=Math.max(b[0].y,b[1].y); 
        }).forEach(m=>selectedIds.add(m._stopId)); 
        box_el.remove(); box_el=null; updateSelectionUI(); 
    } 
    map.dragPan.enable(); start_pos=null; 
}

function updateSelectionUI() { 
    document.querySelectorAll('.stop-item, .glide-row').forEach(el=>el.classList.remove('selected')); 
    markers.forEach(m=>{ 
        m.getElement().classList.toggle('bulk-selected', selectedIds.has(m._stopId)); 
        if(selectedIds.has(m._stopId)) { const row = document.getElementById(`item-${m._stopId}`); if (row) row.classList.add('selected'); } 
    }); 
    
    const has = selectedIds.size>0; 
    let hasRouted = false;
    
    selectedIds.forEach(id => {
        const s = stops.find(st => st.id === id);
        if (s && (s.status || '').toLowerCase() === 'routed') hasRouted = true;
    });
    
    document.getElementById('bulk-delete-btn').style.display = (has && PERMISSION_MODIFY) ? 'block' : 'none'; 
    document.getElementById('bulk-unroute-btn').style.display = (hasRouted && PERMISSION_MODIFY) ? 'block' : 'none'; 
    
    const completeBtn = document.getElementById('bulk-complete-btn');
    if (completeBtn) {
        completeBtn.style.display = (has && viewMode !== 'manager') ? 'block' : 'none'; 
    }
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`move-r${i}-btn`);
        if(btn) {
            if(viewMode === 'manager' && currentInspectorFilter !== 'all' && has && i <= currentRouteCount && currentRouteCount > 1) {
                btn.style.display = 'block';
            } else {
                btn.style.display = 'none';
            }
        }
    }
}

function focusPin(id) { const tgt = stops.find(s=>s.id==id); if(tgt && tgt.lng && tgt.lat) map.flyTo({ center: [tgt.lng, tgt.lat] }); }
function focusTile(id) { document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function resetMapView() { if (initialBounds) map.fitBounds(initialBounds, { padding: 50, maxZoom: 15 }); }
function filterList() { const q = document.getElementById('search-input').value.toLowerCase(); document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); }

function drawRoute() { 
    if (map.getSource('route')) map.getSource('route').setData({ "type": "FeatureCollection", "features": [] });

    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    let routedStops = [];
    
    if (viewMode === 'manager' && currentInspectorFilter !== 'all') {
        routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed');
    } else if (viewMode !== 'manager') {
        routedStops = activeStops;
    }
    
    if (routedStops.length < 2) return; 

    routedStops.sort(sortByEta);
    const uniqueClusters = [...new Set(routedStops.map(s => s.cluster || 0))];

    const features = [];
    uniqueClusters.forEach(cId => {
        const cStops = routedStops.filter(s => (s.cluster || 0) === cId);
        if (cStops.length > 1) {
            features.push({
                "type": "Feature",
                "properties": { "cluster": cId },
                "geometry": { "type": "LineString", "coordinates": cStops.map(s => [s.lng, s.lat]) }
            });
        }
    });

    if (map.getSource('route')) {
        map.getSource('route').setData({ "type": "FeatureCollection", "features": features }); 
    } else { 
        map.addSource('route', { "type": "geojson", "data": { "type": "FeatureCollection", "features": features } }); 
        map.addLayer({ 
            "id": "route", 
            "type": "line", 
            "source": "route", 
            "layout": { "line-join": "round", "line-cap": "round" }, 
            "paint": { 
                "line-color": [
                    "match", ["get", "cluster"],
                    0, INSPECTOR_PALETTE[0].bg,
                    1, INSPECTOR_PALETTE[1].bg,
                    2, INSPECTOR_PALETTE[2].bg,
                    "#2563eb"
                ], 
                "line-width": 4, 
                "line-opacity": 0.5 
            } 
        }); 
    } 
}

function openNav(e, la, ln) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { showNavChoice(la, ln); } else { launchMaps(p, la, ln); } }
function showNavChoice(la, ln) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}')">Apple Maps</button></div>`; }
function setNavPref(p, la, ln) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; launchMaps(p, la, ln); }
function launchMaps(p, la, ln) { window.location.href = p === 'google' ? `comgooglemaps://?daddr=${la},${ln}` : `maps://maps.apple.com/?daddr=${la},${ln}`; }

function showSyncOptions(type) {
    const modal = document.getElementById('modal-overlay'); modal.style.display = 'flex';
    const defS = stops.length ? stops[0].address : "", defE = stops.length ? stops[stops.length-1].address : "";
    document.getElementById('modal-content').innerHTML = `
        <h3 style="margin:0">Update Locations</h3>
        <p style="font-size:12px; color:var(--text-muted);">Start Time: ${currentStartTime}</p>
        <input type="text" id="start-addr" value="${defS}" placeholder="Start Address" style="width:100%; padding:8px; margin:5px 0; border-radius:4px;">
        <input type="text" id="end-addr" value="${defE}" placeholder="End Address" style="width:100%; padding:8px; margin:5px 0; border-radius:4px;">
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button style="flex:1; padding:10px; border:none; border-radius:6px; background:#444; color:#fff;" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
            <button style="flex:1; padding:10px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="finalizeSync('${type}')">Submit</button>
        </div>`;
}

async function finalizeSync(type) {
    const startAddr = document.getElementById('start-addr').value, endAddr = document.getElementById('end-addr').value;
    document.getElementById('modal-overlay').style.display = 'none';
    
    let payload = { 
        action: type, driver: driverParam, 
        startTime: currentStartTime, startAddr: startAddr, endAddr: endAddr 
    };

    if (viewMode === 'manager' && currentInspectorFilter !== 'all') {
        let clusteredArrays = [];
        for(let i = 0; i < currentRouteCount; i++) {
            let itemsInCluster = stops.filter(s => s.cluster === i);
            if (itemsInCluster.length > 0) {
                clusteredArrays.push(itemsInCluster.map(s => minifyStop(s, i + 1)));
            }
        }
        payload.routeClusters = clusteredArrays;
        payload.priorityLevel = document.getElementById('slider-priority').value;
    } else {
        payload.stops = stops.map(s => minifyStop(s, (s.cluster || 0) + 1));
    }

    try {
        const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json(); 
        stops = data.updatedStops.map(s => {
            let exp = expandStop(s);
            return { ...exp, id: exp.rowId || exp.id, cluster: exp.cluster || 0, manualCluster: false };
        });
        
        document.getElementById('controls').style.display = 'none'; 
        render(); drawRoute(); updateSummary();
    } catch (e) { alert("Sync Failed."); }
}

function reorderStopsFromDOM() {
    let unroutedIds = [];
    let routedIds = [];
    
    if (document.getElementById('unrouted-list')) {
        unroutedIds = Array.from(document.getElementById('unrouted-list').children).map(el => el.id.replace('item-', ''));
    }
    
    document.querySelectorAll('.routed-group-container').forEach(cont => {
        const rIds = Array.from(cont.children).map(el => el.id.replace('item-', ''));
        routedIds = routedIds.concat(rIds);
    });
    
    if (unroutedIds.length === 0 && routedIds.length === 0 && document.getElementById('main-list-container')) {
        routedIds = Array.from(document.getElementById('main-list-container').children).map(el => el.id.replace('item-', ''));
    }
    
    const visibleIds = new Set([...unroutedIds, ...routedIds]);
    const otherStops = stops.filter(s => !visibleIds.has(s.id));
    
    const newUnrouted = unroutedIds.map(id => stops.find(s => s.id === id)).filter(Boolean);
    const newRouted = routedIds.map(id => stops.find(s => s.id === id)).filter(Boolean);
    
    stops = [...otherStops, ...newUnrouted, ...newRouted];
}

function initSortable() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
    if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

    if (!PERMISSION_MODIFY) return;

    if (viewMode === 'manager' && currentInspectorFilter !== 'all') {
        const unroutedEl = document.getElementById('unrouted-list');

        document.querySelectorAll('.routed-group-container').forEach(routedEl => {
            const inst = Sortable.create(routedEl, {
                group: 'manager-routes',
                handle: '.handle',
                animation: 150,
                onEnd: async (evt) => {
                    let isMovedToUnrouted = false;
                    
                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
                        const stopId = evt.item.id.replace('item-', '');
                        const idx = stops.findIndex(s => s.id === stopId);
                        if (idx > -1) stops[idx].status = ''; 
                        
                        const overlay = document.getElementById('processing-overlay');
                        if(overlay) overlay.style.display = 'flex';
                        try {
                            await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'unrouteOrder', rowId: stopId }) });
                        } catch (e) { console.error(e); }
                        finally { if(overlay) overlay.style.display = 'none'; }
                    }
                    
                    reorderStopsFromDOM();
                    document.getElementById('controls').style.display = 'flex';
                    render(true); 
                    
                    if (isMovedToUnrouted) {
                        drawRoute(); updateSummary(); updateRouteTimes();
                    }
                }
            });
            sortableInstances.push(inst);
        });
        
        if (unroutedEl) {
            sortableUnrouted = Sortable.create(unroutedEl, {
                group: 'manager-routes',
                animation: 150
            });
        }
    } else if (viewMode !== 'list' && viewMode !== 'manager') {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                handle: '.handle',
                animation: 150,
                onEnd: (evt) => {
                    reorderStopsFromDOM();
                    document.getElementById('controls').style.display = 'flex';
                    render(true); 
                }
            });
            sortableInstances.push(inst);
        });
    }
}

loadData();
