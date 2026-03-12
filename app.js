// *
// * Dashboard - V6.10
// * FILE: app.js
// * Changes: Completely deprecated routeClusters property. Flattened generateRoute and finalizeSync payloads to send a single 1D array under the 'stops' property with Index 2 stamped.
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

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

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

let COMPANY_SERVICE_DELAY = 0; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 
let currentInspectorFilter = 'all';

let defaultEmailMessage = "";
let companyEmail = "";
let managerEmail = "";

let routeStart = null;
let routeEnd = null;

let dirtyRoutes = new Set(); 
let historyStack = [];
let isAlteredRoute = false;

let isPollingForRoute = false;
let pollRetries = 0;

let latestSuggestions = { start: null, end: null };

function customAlert(msg) {
    return new Promise(resolve => {
        const m = document.getElementById('modal-overlay');
        const mc = document.getElementById('modal-content');
        mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none';
        m.style.display = 'flex';
        mc.innerHTML = `
            <div style="background: var(--bg-panel, #1E293B); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: white; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <h3 style="margin-top:0;">Alert</h3>
                <p style="font-size: 15px; margin-bottom: 20px;">${msg}</p>
                <div style="display:flex; justify-content:flex-end;">
                    <button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-alert-ok">OK</button>
                </div>
            </div>`;
        document.getElementById('modal-alert-ok').onclick = () => {
            m.style.display = 'none';
            resolve();
        };
    });
}

function customConfirm(msg) {
    return new Promise(resolve => {
        const m = document.getElementById('modal-overlay');
        const mc = document.getElementById('modal-content');
        mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none';
        m.style.display = 'flex';
        mc.innerHTML = `
            <div style="background: var(--bg-panel, #1E293B); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: white; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <h3 style="margin-top:0;">Confirm</h3>
                <p style="font-size: 15px; margin-bottom: 20px;">${msg}</p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button style="padding:10px 20px; border:none; border-radius:6px; background:#444; color:white; cursor:pointer;" id="modal-confirm-cancel">Cancel</button>
                    <button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-confirm-ok">OK</button>
                </div>
            </div>`;
        document.getElementById('modal-confirm-ok').onclick = () => { m.style.display = 'none'; resolve(true); };
        document.getElementById('modal-confirm-cancel').onclick = () => { m.style.display = 'none'; resolve(false); };
    });
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

function undoLastAction() {
    if (historyStack.length === 0) return;
    const last = historyStack.pop();
    stops = last.stops;
    dirtyRoutes = new Set(last.dirty);
    render(); drawRoute(); updateSummary(); updateRouteTimes(); updateUndoUI();
    silentSaveRouteState(); 
}

function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = historyStack.length === 0;
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

    let minified = routedStops.map(s => minifyStop(s, (s.cluster || 0) + 1));
    
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

    fetch(WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
    }).catch(e => console.log("Silent save error", e));
}

const params = new URLSearchParams(window.location.search);
let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const viewMode = params.get('view') || 'inspector'; 
const isManagerView = (viewMode === 'manager' || viewMode === 'managermobile'); 

document.body.className = `view-${viewMode} manager-all-inspectors`;

mapboxgl.accessToken = MAPBOX_TOKEN;
const mapConfig = { 
    container: 'map', 
    style: 'mapbox://styles/mapbox/dark-v11', 
    center: [-96.797, 32.776],
    zoom: 11, 
    attributionControl: false,
    boxZoom: false,
    preserveDrawingBuffer: true 
};
const map = new mapboxgl.Map(mapConfig);

let stops = [], originalStops = [], inspectors = [], markers = [], initialBounds = null, selectedIds = new Set(), currentDisplayMode = 'detailed', currentStartTime = "8:00 AM";
let currentSort = { col: null, asc: true };

const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', 
    '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', 
    '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
];

function expandStop(minStop) {
    if (minStop.address) return minStop; 
    
    let t = Array.isArray(minStop) ? minStop : (minStop.rawTuple || minStop);
    
    if (Array.isArray(t)) {
        let clusterIdx = parseInt(t[2]);
        if (isNaN(clusterIdx)) clusterIdx = 1;
        
        return {
            ...minStop, 
            id: String(t[0]), seq: t[1], cluster: Math.max(0, clusterIdx - 1),
            address: t[3], client: t[4], app: t[5], dueDate: t[6], type: t[7],
            eta: t[8], dist: t[9], lat: t[10], lng: t[11], status: t[12], 
            durationSecs: t[13], rowId: String(t[0])
        };
    }

    return minStop; 
}

function minifyStop(s, routeNum) {
    return [
        s.rowId || s.id || "", 
        Number(s.seq) || 0, 
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

function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-filter');
    if (!filterSelect || !isManagerView || inspectors.length === 0) return;

    const validInspectorIds = new Set();
    stops.forEach(s => {
        const status = (s.status || '').toLowerCase();
        if (status !== 'cancelled' && status !== 'deleted' && s.driverId) {
            validInspectorIds.add(String(s.driverId));
        }
    });

    const currentVal = filterSelect.value || 'all';
    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(String(i.id))) {
            const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
            filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
        }
    });
    
    filterSelect.innerHTML = filterHtml;
    if (currentVal !== 'all' && !validInspectorIds.has(String(currentVal))) {
        filterSelect.value = 'all';
        handleInspectorFilterChange('all');
    } else {
        filterSelect.value = currentVal;
        if (currentVal !== 'all') {
            const inspIdx = inspectors.findIndex(i => String(i.id) === String(currentVal));
            if (inspIdx > -1) filterSelect.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
        } else {
            filterSelect.style.color = 'var(--text-main)';
        }
    }
}

function handleInspectorFilterChange(val) {
    currentInspectorFilter = val;
    document.body.classList.toggle('manager-all-inspectors', val === 'all');
    document.body.classList.toggle('manager-single-inspector', val !== 'all');
    selectedIds.clear();
    
    const filterSelect = document.getElementById('inspector-filter');
    if (filterSelect) {
        if (val === 'all') {
            filterSelect.style.color = 'var(--text-main)';
        } else {
            const inspIdx = inspectors.findIndex(i => String(i.id) === String(val));
            if (inspIdx > -1) filterSelect.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
        }
    }

    if (val !== 'all') liveClusterUpdate();
    
    updateRouteButtonColors();
    render(); drawRoute(); updateSummary();
}

function updateRouteButtonColors() {
    if (!isManagerView) return;
    
    let baseColor = MASTER_PALETTE[0];
    if (currentInspectorFilter !== 'all') {
        const inspIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
        if (inspIdx > -1) baseColor = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
    }

    const mr1 = document.getElementById('move-r1-btn');
    const mr2 = document.getElementById('move-r2-btn');
    const mr3 = document.getElementById('move-r3-btn');
    if (mr1) mr1.style.borderLeftColor = baseColor;
    if (mr2) mr2.style.borderLeftColor = '#000000';
    if (mr3) mr3.style.borderLeftColor = '#ffffff';

    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if (btn) btn.style.setProperty('--route-color', baseColor);
        
        const ind = document.getElementById(`rbtn-ind-${i}`);
        if (ind) {
            ind.innerHTML = '';
            for(let c=0; c<i; c++) {
                let bgHex = baseColor;
                if (c === 1) bgHex = '#000000';
                if (c === 2) bgHex = '#ffffff';
                
                const circle = document.createElement('div');
                circle.className = 'rbtn-circle';
                circle.style.backgroundColor = hexToRgba(bgHex, 0.75); 
                circle.style.border = `2px solid ${baseColor}`;
                ind.appendChild(circle);
            }
        }
    }
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
    const cluster = stopData.cluster || 0;
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

const resizerEl = document.getElementById('resizer');
const sidebarEl = document.getElementById('sidebar');
const mapWrapEl = document.getElementById('map-wrapper');
let isResizing = false;

function startResize(e) {
    if(!isManagerView) return;
    isResizing = true;
    resizerEl.classList.add('active');
    document.body.style.cursor = viewMode === 'managermobile' ? 'row-resize' : 'col-resize';
    mapWrapEl.style.pointerEvents = 'none'; 
}

resizerEl.addEventListener('mousedown', startResize);
resizerEl.addEventListener('touchstart', (e) => { startResize(e.touches[0]); }, {passive: false});

function performResize(e) {
    if (!isResizing) return;
    let clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    let clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    
    if (viewMode === 'managermobile') {
        let newHeight = window.innerHeight - clientY;
        if (newHeight < 200) newHeight = 200;
        if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
        sidebarEl.style.height = newHeight + 'px';
        sidebarEl.style.flex = 'none';
        mapWrapEl.style.height = (window.innerHeight - newHeight - resizerEl.offsetHeight) + 'px';
        mapWrapEl.style.flex = 'none';
    } else {
        let newWidth = window.innerWidth - clientX;
        if (newWidth < 300) newWidth = 300;
        if (newWidth > window.innerWidth - 300) newWidth = window.innerWidth - 300;
        sidebarEl.style.width = newWidth + 'px';
    }
}

document.addEventListener('mousemove', performResize);
document.addEventListener('touchmove', performResize, {passive: false});

function stopResize() {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        resizerEl.classList.remove('active');
        mapWrapEl.style.pointerEvents = 'auto';
        if(map) map.resize(); 
    }
}

document.addEventListener('mouseup', stopResize);
document.addEventListener('touchend', stopResize);

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
        
        if (data.status === 'processing' || data.status === 'queued') {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'flex';
            setTimeout(loadData, 5000);
            return; 
        }

        if (data.routeId) {
            routeId = data.routeId;
        }

        if (data.needsRecalculation) {
            isAlteredRoute = true;
            dirtyRoutes.add('all'); 
        }

        routeStart = data.routeStart || null;
        routeEnd = data.routeEnd || null;
        
        if (data.isAlteredRoute) isAlteredRoute = true;

        let rawStops = Array.isArray(data) ? data : (data.stops || []);
        
        stops = rawStops.map(s => {
            let exp = expandStop(s);
            return {
                ...exp,
                id: exp.rowId || exp.id,
                status: getStatusText(exp.status),
                cluster: exp.cluster || 0,
                manualCluster: false,
                hiddenInInspector: false,
                routeState: exp.routeState || s.routeState || 'Pending',
                routeTargetId: routeId || null
            };
        });

        stops.forEach(s => {
            if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) {
                markRouteDirty(s.driverId, s.cluster);
            }
        });

        if (isPollingForRoute) {
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
            }
        }

        let maxCluster = 0;
        stops.forEach(s => {
            if (s.cluster > maxCluster) maxCluster = s.cluster;
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

        if (!Array.isArray(data)) {
            if (data.defaultEmailMessage) defaultEmailMessage = data.defaultEmailMessage;
            if (data.companyEmail) companyEmail = data.companyEmail;
            if (data.managerEmail) managerEmail = data.managerEmail;

            inspectors = data.inspectors || []; 
            inspectors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (data.serviceDelay !== undefined) COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay) || 0; 
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

            if (isManagerView && data.tier && data.tier.toLowerCase() !== 'individual') {
                if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
                if (sidebarLogo) sidebarLogo.style.display = 'none'; 
                if (filterSelect) filterSelect.style.display = 'block';
                updateInspectorDropdown(); 
            } else {
                if (sidebarDriverEl) sidebarDriverEl.innerText = displayName;
            }
            
            updateRouteButtonColors();
            
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

        render(); drawRoute(); updateSummary(); initSortable();

    } catch (e) { 
        console.error("Error loading data:", e); 
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay && !isPollingForRoute) overlay.style.display = 'none';
        updateUndoUI();
    }
}

let geocodeTimeout;

function commitTopSuggestion(type, inputEl) {
    const eps = getActiveEndpoints();
    const currentSaved = type === 'start' ? eps.start?.address : eps.end?.address;

    if (inputEl.value.trim() !== '' && inputEl.value !== currentSaved) {
        if (latestSuggestions[type]) {
            const top = latestSuggestions[type];
            inputEl.value = top.place_name;
            selectEndpoint(type, top.place_name, top.center[1], top.center[0], inputEl);
        }
    }
}

window.handleEndpointKeyDown = function(e, type) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); 
    }
};

async function handleEndpointInput(e, type) {
    checkEndpointModified();
    clearTimeout(geocodeTimeout);
    const val = e.target.value;
    const dropdownId = `autocomplete-${type}`;
    let dropdown = document.getElementById(dropdownId);
    
    if (!val.trim()) { 
        if (dropdown) dropdown.innerHTML = ''; 
        latestSuggestions[type] = null;
        return; 
    }
    
    geocodeTimeout = setTimeout(async () => {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${MAPBOX_TOKEN}&country=us&types=address,poi`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            latestSuggestions[type] = data.features.length > 0 ? data.features[0] : null;
            renderAutocomplete(data.features, e.target, type);
        } catch (err) { console.error("Autocomplete Error:", err); }
    }, 300);
}

function renderAutocomplete(features, inputEl, type) {
    let dropdown = document.getElementById(`autocomplete-${type}`);
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = `autocomplete-${type}`;
        dropdown.className = 'autocomplete-dropdown';
        dropdown.style.position = 'absolute';
        dropdown.style.background = 'var(--bg-panel, #1E293B)';
        dropdown.style.border = '1px solid var(--border-color, #334155)';
        dropdown.style.zIndex = '1000';
        dropdown.style.width = '100%';
        dropdown.style.maxHeight = '200px';
        dropdown.style.overflowY = 'auto';
        dropdown.style.borderRadius = '4px';
        dropdown.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
        inputEl.parentNode.appendChild(dropdown);
    }
    
    dropdown.innerHTML = '';
    if (features.length === 0) return;
    
    features.forEach(f => {
        const item = document.createElement('div');
        item.style.padding = '8px 10px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid var(--border-color, #334155)';
        item.style.color = 'var(--text-main, #F8FAFC)';
        item.style.fontSize = '13px';
        item.innerText = f.place_name;
        
        item.onmouseenter = () => item.style.background = 'var(--blue, #3B82F6)';
        item.onmouseleave = () => item.style.background = 'transparent';
        
        item.onmousedown = (e) => {
            e.preventDefault(); 
            latestSuggestions[type] = f; 
            inputEl.value = f.place_name;
            dropdown.innerHTML = '';
            selectEndpoint(type, f.place_name, f.center[1], f.center[0], inputEl);
        };
        dropdown.appendChild(item);
    });
}

function handleEndpointBlur(type, inputEl) {
    setTimeout(() => {
        commitTopSuggestion(type, inputEl);
        const dropdown = document.getElementById(`autocomplete-${type}`);
        if (dropdown) dropdown.innerHTML = ''; 
    }, 200);
}

async function selectEndpoint(type, address, lat, lng, inputEl) {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const insp = inspectors.find(i => String(i.id) === String(inspId));
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));

    if (isManagerView && hasRouted) {
        const proceed = await customConfirm("Note: updating the start or end point of the route clears the currently optimized route and will require new route generation. Continue?");
        if (!proceed) {
            const eps = getActiveEndpoints();
            if (inputEl) inputEl.value = type === 'start' ? (eps.start?.address || '') : (eps.end?.address || '');
            return;
        }
    }
    
    let epObj = { address, lat, lng };
    if (type === 'start') routeStart = epObj;
    if (type === 'end') routeEnd = epObj;

    if (insp) {
        if (type === 'start') { insp.startAddress = address; insp.startLat = lat; insp.startLng = lng; }
        if (type === 'end') { insp.endAddress = address; insp.endLat = lat; insp.endLng = lng; }
    }
    
    if (isManagerView && hasRouted) {
        await executeRouteReset(insp.id);
    } else {
        markRouteDirty('endpoints', 0);
        render(); drawRoute(); updateSummary();
        saveEndpointToBackend(type, address, lat, lng);
    }
}

async function executeRouteReset(driverId) {
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        let payload = { action: 'resetRoute', driverId: driverId };
        if (!isManagerView) payload.routeId = routeId;

        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify(payload) 
        });
        
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
        const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        console.error("Endpoint update failed:", e);
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

function getActiveEndpoints() {
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

function handleOpenEmailModal() {
    const insp = inspectors.find(i => String(i.id) === String(currentInspectorFilter));
    if (!insp) return;

    const activeInspStops = stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter));
    if(activeInspStops.length === 0) return;

    const m = document.getElementById('modal-overlay');
    const mc = document.getElementById('modal-content');
    
    mc.style.padding = '0';
    mc.style.background = 'transparent';
    mc.style.border = 'none';

    m.style.display = 'flex';
    
    const displayCompanyEmail = companyEmail ? companyEmail : 'Company Email Not Found';
    const displayDriverEmail = insp.email ? insp.email : '[Email not provided]';

    const modalHtml = `
        <div style="background: #2c2c2e; padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 18px; font-weight: bold;">Customize Email Message</h3>
            
            <textarea id="email-body-text" style="width: 100%; min-height: 150px; background: #3a3a3c; color: #fff; border: 1px solid #4a4a4c; border-radius: 6px; padding: 16px 16px 28px 16px; font-family: inherit; font-size: 15px; line-height: 1.5; margin-bottom: 24px; box-sizing: border-box; overflow: hidden; resize: none;">${defaultEmailMessage}</textarea>
            
            <div style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 10px;">
                <input type="checkbox" id="cc-company-checkbox" checked style="margin-top: 4px; accent-color: #7b93b8; transform: scale(1.2);">
                <label for="cc-company-checkbox" style="font-size: 16px; cursor: pointer; color: #e5e5e5; font-weight: 500;">
                    CC the Company Email<br>
                    <span style="font-size: 14px; color: #9a9a9a; font-weight: normal;">${displayCompanyEmail}</span>
                </label>
            </div>

            <div style="margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" id="cc-additional-checkbox" onchange="document.getElementById('additional-cc-wrapper').style.display = this.checked ? 'block' : 'none'" style="accent-color: #7b93b8; transform: scale(1.2);">
                    <label for="cc-additional-checkbox" style="font-size: 16px; cursor: pointer; color: #e5e5e5; font-weight: 500;">Additional CC</label>
                </div>
                <div id="additional-cc-wrapper" style="display: none; padding-left: 28px;">
                    <input type="email" id="additional-cc-email" placeholder="email@example.com" style="width: 100%; background: #3a3a3c; color: white; border: 1px solid #4a4a4c; border-radius: 4px; padding: 10px 12px; font-size: 15px; box-sizing: border-box;">
                </div>
            </div>

            <div style="background: #1e1e1e; border: 1px solid #333; padding: 16px; border-radius: 6px; font-size: 15px; color: #fff; margin-bottom: 24px; line-height: 1.5;">
                A list of orders and the map image will be sent to <span style="color: var(--blue, #3B82F6); font-weight: normal;">${insp.name}</span> <span style="color: white;">at</span> <span style="color: var(--blue, #3B82F6); font-weight: normal;">${displayDriverEmail}</span>, along with a direct link to open the interactive map on their device.
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-start;">
                <button id="btn-submit-dispatch" style="padding: 12px 24px; background: #35475b; color: white; border: none; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer;">Submit</button>
                <button id="btn-cancel-dispatch" style="padding: 12px 24px; background: transparent; color: white; border: 1px solid #555; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;

    mc.innerHTML = modalHtml;

    setTimeout(() => {
        const ta = document.getElementById('email-body-text');
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
            ta.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = this.scrollHeight + 'px';
            });
        }
    }, 10);

    document.getElementById('btn-cancel-dispatch').onclick = () => {
        m.style.display = 'none';
    };

    document.getElementById('btn-submit-dispatch').onclick = async () => {
        const btn = document.getElementById('btn-submit-dispatch');
        btn.innerText = 'Dispatching...';
        btn.disabled = true;

        const customBody = document.getElementById('email-body-text').value;
        const ccCompany = document.getElementById('cc-company-checkbox').checked;
        const addCcChecked = document.getElementById('cc-additional-checkbox').checked;
        const ccEmail = addCcChecked ? document.getElementById('additional-cc-email').value : '';

        const dIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
        const inspColor = dIdx > -1 ? MASTER_PALETTE[dIdx % MASTER_PALETTE.length] : MASTER_PALETTE[0];

        const geojsonStops = {
            type: 'FeatureCollection',
            features: activeInspStops.filter(s => s.lat && s.lng).map(s => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [parseFloat(s.lng), parseFloat(s.lat)] },
                properties: { cluster: s.cluster || 0 }
            }))
        };

        if (map.getSource('temp-snapshot-pins')) {
            map.getSource('temp-snapshot-pins').setData(geojsonStops);
        } else {
            map.addSource('temp-snapshot-pins', { type: 'geojson', data: geojsonStops });
            map.addLayer({
                id: 'temp-snapshot-circles',
                type: 'circle',
                source: 'temp-snapshot-pins',
                paint: {
                    'circle-radius': 12,
                    'circle-color': [
                        'match',
                        ['get', 'cluster'],
                        0, inspColor,
                        1, '#000000',
                        '#ffffff'
                    ],
                    'circle-stroke-width': 3,
                    'circle-stroke-color': inspColor
                }
            });
        }

        await new Promise(resolve => {
            map.once('idle', resolve);
            setTimeout(resolve, 800); 
        });

        const mapBase64 = map.getCanvas().toDataURL('image/png');

        if (map.getLayer('temp-snapshot-circles')) map.removeLayer('temp-snapshot-circles');
        if (map.getSource('temp-snapshot-pins')) map.removeSource('temp-snapshot-pins');

        const payload = {
            action: "dispatchRoute",
            driverId: currentInspectorFilter,
            companyId: companyParam || '',
            customBody: customBody,
            ccCompany: ccCompany,
            addCc: addCcChecked,
            ccEmail: ccEmail,
            mapBase64: mapBase64
        };
        if (!isManagerView) payload.routeId = routeId;

        try {
            const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
            const result = await res.json();
            
            if (result.success) {
                m.style.display = 'none';
                
                stops.forEach(s => {
                    if (String(s.driverId) === String(currentInspectorFilter) && isRouteAssigned(s.status)) {
                        s.routeState = 'Dispatched';
                        s.status = 'Dispatched'; 
                    }
                });
                render(); drawRoute(); updateSummary();
                
                const toast = document.createElement('div');
                toast.innerText = 'Route Sent!';
                toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 20px; font-weight: bold; font-size: 14px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.3s;';
                document.body.appendChild(toast);
                
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => toast.remove(), 300);
                }, 1000);
            } else {
                throw new Error("Dispatch failed");
            }
        } catch (e) {
            btn.innerText = 'Submit';
            btn.disabled = false;
            await customAlert("Failed to dispatch route. Please try again.");
        }
    };
}

function updateRoutingUI() {
    const activeStops = stops.filter(s => isActiveStop(s));
    const isDirty = dirtyRoutes.size > 0;

    const routingControls = document.getElementById('routing-controls');
    const hintEl = document.getElementById('inspector-select-hint');

    const btnGen = document.getElementById('btn-header-generate');
    const btnStartOver = document.getElementById('btn-header-start-over');
    const btnRecalc = document.getElementById('btn-header-recalc');
    const btnRestore = document.getElementById('btn-header-restore');
    const optInspBtn = document.getElementById('btn-header-optimize-insp');
    const badgeChanges = document.getElementById('badge-changes-made');
    const btnSend = document.getElementById('btn-header-send-route');

    [btnGen, btnStartOver, btnRecalc, btnRestore, optInspBtn, badgeChanges, btnSend].forEach(btn => {
        if (btn) btn.style.display = 'none';
    });

    if (isManagerView && currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        
        let showHint = false;
        const allValidStops = stops.filter(s => {
            const status = (s.status || '').toLowerCase();
            return status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        });

        for (const insp of inspectors) {
            if (allValidStops.filter(s => String(s.driverId) === String(insp.id)).length > 2) {
                showHint = true; 
                break;
            }
        }
        if (hintEl) hintEl.style.display = (showHint && viewMode !== 'managermobile') ? 'block' : 'none';
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    let currentState = 'Pending';
    const activeInspStops = stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter));
    
    if (activeInspStops.length > 0) {
        const targetStop = activeInspStops.find(s => s.routeState) || activeInspStops[0];
        let rs = (targetStop.routeState || 'Pending').toLowerCase();
        
        if (rs === 'queued') currentState = 'Queued';
        else if (rs === 'ready') currentState = 'Ready';
        else if (rs === 'staging') currentState = 'Staging';
        else if (rs === 'staging-endpoint') currentState = 'Staging-endpoint';
        else currentState = 'Pending';
    }

    if (isDirty) {
        currentState = dirtyRoutes.has('endpoints_0') ? 'Staging-endpoint' : 'Staging';
    }

    if (isManagerView) {
        const unroutedCount = activeInspStops.filter(s => !isRouteAssigned(s.status)).length;

        if (currentState === 'Pending') {
            if (unroutedCount > 0 && btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
        } else if (currentState === 'Queued') {
            // Deliberately keep all buttons hidden while waiting for optimization
        } else if (currentState === 'Ready') {
            if (btnStartOver) btnStartOver.style.display = 'flex';
            if (btnSend && !isDirty) btnSend.style.display = 'flex';
        } else if (currentState === 'Staging') {
            if (btnRecalc) btnRecalc.style.display = 'flex';
            if (btnStartOver) btnStartOver.style.display = 'flex';
            if (badgeChanges && isDirty) badgeChanges.style.display = 'flex';
        } else if (currentState === 'Staging-endpoint') {
            if (btnRecalc) btnRecalc.style.display = 'flex';
            if (optInspBtn) optInspBtn.style.display = 'flex';
            if (btnStartOver) btnStartOver.style.display = 'flex';
            if (badgeChanges && isDirty) badgeChanges.style.display = 'flex';
        }

        if (routingControls) {
            routingControls.style.display = (currentState === 'Pending' && unroutedCount > 0) ? 'flex' : 'none';
        }

    } else {
        if(routingControls) routingControls.style.display = 'flex';
        
        let showRecalc = false;
        let showOpt = false;
        let showBadge = false;

        if (isDirty) {
            showRecalc = true;
            showBadge = true;
            if (dirtyRoutes.has('endpoints_0') || PERMISSION_REOPTIMIZE) showOpt = true;
        } else if (isAlteredRoute) {
            if(btnRestore) btnRestore.style.display = 'flex'; 
        }
        
        if(btnRecalc) btnRecalc.style.display = showRecalc ? 'flex' : 'none';
        if(optInspBtn) optInspBtn.style.display = showOpt ? 'flex' : 'none';
        if(badgeChanges) badgeChanges.style.display = showBadge ? 'flex' : 'none';

        if (!showRecalc && !showOpt && !isAlteredRoute) {
            if(routingControls) routingControls.style.display = 'none';
        }
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
    if (headerGenBtnText) headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
    
    stops.forEach(s => s.manualCluster = false); 
    liveClusterUpdate();
    updateSelectionUI(); 
}

function moveSelectedToRoute(cIdx) {
    pushToHistory();
    selectedIds.forEach(id => {
        const s = stops.find(st => String(st.id) === String(id));
        if (s) {
            if (isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster); 
            }
            s.cluster = cIdx;
            s.manualCluster = true; 
            markRouteDirty(s.driverId, s.cluster); 
        }
    });
    selectedIds.clear();
    
    reorderStopsFromDOM();
    render(); 
    drawRoute();
    updateSummary();
    updateRouteTimes();
    silentSaveRouteState();
}

function updateRouteTimes() {
    if(!isManagerView || currentInspectorFilter === 'all') return;
    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    for(let i=0; i<3; i++) {
        const clusterStops = activeStops.filter(s => s.cluster === i);
        const count = clusterStops.length;
        let totalSecs = 0;
        clusterStops.forEach(s => totalSecs += parseFloat(s.durationSecs || 0));
        
        const hrs = count > 0 ? ((totalSecs + (count * COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
        const timeEl = document.getElementById(`rtime-${i+1}`);
        if(timeEl) {
            timeEl.innerText = count > 0 ? `${hrs} hrs` : '-- hrs';
        }
    }
}

async function handleGenerateRoute() {
    if (currentInspectorFilter === 'all') return;
    const insp = inspectors.find(i => String(i.id) === String(currentInspectorFilter));
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    let unroutedStops = stops.filter(s => 
        isActiveStop(s) && 
        s.lng && 
        s.lat && 
        String(s.driverId) === String(insp.id) && 
        !isRouteAssigned(s.status)
    );

    let flatStopsPayload = unroutedStops.map(s => minifyStop(s, (s.cluster || 0) + 1));

    const eps = getActiveEndpoints();
    let sAddr = eps.start ? eps.start.address : '';
    let eAddr = eps.end ? eps.end.address : '';

    stops.forEach(s => {
        if (isActiveStop(s) && String(s.driverId) === String(insp.id)) {
            s.routeState = 'Queued';
        }
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

        const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        
        if (data.status === 'queued' || data.success) {
            let pqPayload = { action: 'processQueue', driverId: insp.id };
            if (!isManagerView) pqPayload.routeId = routeId;
            
            fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(pqPayload) })
            .catch(err => console.log("Ignored expected timeout from processQueue", err));
            
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

async function handleStartOver() {
    if(!(await customConfirm("Undo Routing and clear all routes for this inspector?"))) return;
    const insp = inspectors.find(i => String(i.id) === String(currentInspectorFilter));
    if (!insp) return;
    await executeRouteReset(insp.id);
}

async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        const inspId = isManagerView ? currentInspectorFilter : driverParam;
        let payload = { action: 'restoreOriginalRoute', driverId: inspId };
        if (!isManagerView) payload.routeId = routeId;

        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify(payload) 
        });
        
        await loadData(); 
    } catch(e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error restoring the route. Please try again."); 
        console.error(e);
    } finally {
        if(overlay) overlay.style.display = 'none'; 
    }
}

function liveClusterUpdate() {
    if(!isManagerView || currentInspectorFilter === 'all') return;
    
    const k = currentRouteCount;
    const w = parseInt(document.getElementById('slider-priority').value) / 100;
    
    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    if(activeStops.length === 0) return;

    const unroutedStops = activeStops.filter(s => !isRouteAssigned(s.status));

    if(k === 1) {
        unroutedStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        updateMarkerColors();
        updateRouteTimes();
        return;
    }

    if (unroutedStops.length === 0) return;

    let centroids = [];
    for(let i=0; i<k; i++) {
        let idx = Math.floor(i * unroutedStops.length / k);
        centroids.push({ lat: unroutedStops[idx].lat, lng: unroutedStops[idx].lng });
    }

    let today = new Date(); 
    today.setHours(0,0,0,0);

    for(let iter=0; iter<10; iter++) {
        unroutedStops.forEach(s => {
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
            let clusterStops = unroutedStops.filter(s => s.cluster === i);
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
        const stopData = stops.find(st => String(st.id) === String(m._stopId));
        if (stopData) {
            const visualStyle = getVisualStyle(stopData);
            const pin = m.getElement().querySelector('.pin-visual');
            if(pin) {
                pin.style.backgroundColor = visualStyle.bg;
                pin.style.border = `3px solid ${visualStyle.border}`;
                pin.style.color = visualStyle.text;
            }
            
            const row = document.getElementById(`item-${stopData.id}`);
            if (row) {
                const badge = row.querySelector('.num-badge');
                if (badge) {
                    badge.style.backgroundColor = visualStyle.bg;
                    badge.style.border = `3px solid ${visualStyle.border}`;
                    badge.style.color = visualStyle.text;
                }
            }
        }
    });
}

window.toggleSelectAll = function(cb) {
    selectedIds.clear();
    if (cb.checked) {
        stops.filter(s => isActiveStop(s)).forEach(s => selectedIds.add(s.id));
    }
    updateSelectionUI();
};

async function triggerBulkDelete() { 
    if(!(await customConfirm("Delete selected orders?"))) return;
    pushToHistory();
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        selectedIds.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster);
            }
        });

        const deletePromises = Array.from(selectedIds).map(id => {
            const idx = stops.findIndex(s => String(s.id) === String(id));
            let dId = null;
            if (idx > -1) {
                dId = stops[idx].driverId;
                stops[idx].status = 'Deleted';
            }
            let payload = { action: 'markOrderDeleted', rowId: id, driverId: dId };
            if (!isManagerView) payload.routeId = routeId;
            return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        });
        
        await Promise.all(deletePromises);
        
        selectedIds.clear(); 
        updateInspectorDropdown(); 
        
        reorderStopsFromDOM();
        render(); drawRoute(); updateSummary(); updateRouteTimes();
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
        const unroutePromises = Array.from(selectedIds).map(id => {
            const idx = stops.findIndex(s => String(s.id) === String(id));
            let dId = null;
            if (idx > -1) {
                dId = stops[idx].driverId;
                if (isRouteAssigned(stops[idx].status)) {
                    markRouteDirty(stops[idx].driverId, stops[idx].cluster);
                }
                stops[idx].status = 'Pending';
                if (!isManagerView) stops[idx].hiddenInInspector = true; 
            }
            let payload = { action: 'unrouteOrder', rowId: id, driverId: dId };
            if (!isManagerView) payload.routeId = routeId;
            return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        });
        
        await Promise.all(unroutePromises);
        
        selectedIds.clear(); 
        
        reorderStopsFromDOM();
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        silentSaveRouteState();
        
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error removing orders from the route. Please try again.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function processReassignDriver(rowId, newDriverName, newDriverId) {
    const stopIdx = stops.findIndex(s => String(s.id) === String(rowId));
    if (stopIdx > -1) { stops[stopIdx].driverName = newDriverName; stops[stopIdx].driverId = newDriverId; }
    let payload = { action: 'updateOrder', rowId: rowId, driverId: newDriverId, updates: { driverName: newDriverName, driverId: newDriverId } };
    if (!isManagerView) payload.routeId = routeId;
    return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
}

async function handleInspectorChange(e, rowId, selectEl) {
    e.stopPropagation(); 
    const newDriverId = selectEl.value;
    const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    
    let idsToUpdate = [rowId];
    if (selectedIds.has(rowId) && selectedIds.size > 1) {
        if (await customConfirm(`Reassign all ${selectedIds.size} selected orders to ${newDriverName}?`)) {
            idsToUpdate = Array.from(selectedIds);
        } else { 
            render(); return; 
        }
    }
    
    pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try { 
        idsToUpdate.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster); 
                markRouteDirty(newDriverId, s.cluster); 
            }
        });

        await Promise.all(idsToUpdate.map(id => processReassignDriver(id, newDriverName, newDriverId)));
        
        updateInspectorDropdown(); 
        await loadData();
        
    } catch (err) { 
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error reassigning orders. Please try again."); 
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
    let totalSecs = 0;
    
    const today = new Date(); today.setHours(0,0,0,0);

    clusterStops.forEach(s => {
        const distVal = parseFloat(s.dist || 0);
        if (!isNaN(distVal)) totalMi += distVal;
        
        totalSecs += parseFloat(s.durationSecs || 0);

        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    let hrs = clusterStops.length > 0 ? ((totalSecs + (clusterStops.length * COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : 0;
    let dueText = pastDue > 0 ? `<span style="color:var(--red)">${pastDue} Past Due</span>` : (dueToday > 0 ? `<span style="color:var(--orange)">${dueToday} Due Today</span>` : `0 Due`);
    
    const el = document.createElement('div');
    el.className = 'list-subheading';
    el.innerHTML = `<span>ROUTE ${clusterNum + 1}</span><span class="route-summary-text">${totalMi.toFixed(1)} mi | ${hrs} hrs | ${clusterStops.length} stops | ${dueText}</span>`;
    return el;
}

window.checkEndpointModified = function() {
    const sVal = document.getElementById('input-endpoint-start')?.value || '';
    const eVal = document.getElementById('input-endpoint-end')?.value || '';
    
    const eps = getActiveEndpoints();
    const sOrig = eps.start?.address || '';
    const eOrig = eps.end?.address || '';
    
    const modified = (sVal.trim() !== sOrig.trim()) || (eVal.trim() !== eOrig.trim());
    if (modified) markRouteDirty('endpoints', 0);
    
    updateRoutingUI();
};

function createEndpointRow(type, endpointData) {
    const displayAddr = endpointData && endpointData.address ? endpointData.address : '';
    const placeholder = type === 'start' ? 'Search Start Address...' : 'Search End Address...';
    const inputId = `input-endpoint-${type}`;
    const rowIcon = type === 'start' ? '🏠' : '🏁';
    
    const el = document.createElement('div');
    el.className = 'stop-item static-endpoint compact';
    el.innerHTML = `
        <div class="stop-sidebar" style="background:var(--bg-header); color:var(--text-main); font-size:18px;">${rowIcon}</div>
        <div class="stop-content" style="padding: 0 10px; flex-direction:row; align-items:center; display:flex;">
            <div style="position:relative; width:100%; flex:1;">
                <input type="text" id="${inputId}" class="endpoint-input" style="font-size: 14px; width: 100%;" value="${displayAddr}" placeholder="${placeholder}" onfocus="this.select()" onmouseup="return false;" oninput="handleEndpointInput(event, '${type}')" onkeydown="handleEndpointKeyDown(event, '${type}')" onblur="handleEndpointBlur('${type}', this)">
            </div>
        </div>
        <div class="stop-actions" style="width: 40px;"></div>
    `;
    return el;
}

function render() {
    updateRoutingUI();
    const listContainer = document.getElementById('stop-list');
    listContainer.innerHTML = ''; 
    markers.forEach(m => m.remove()); 
    markers = [];
    const bounds = new mapboxgl.LngLatBounds();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isSingleInspector = isManagerView && currentInspectorFilter !== 'all';
    const isAllInspectors = isManagerView && currentInspectorFilter === 'all';
    
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => isRouteAssigned(s.status));

    if (isManagerView) {
        const header = document.createElement('div');
        header.className = 'glide-table-header';
        header.style.position = 'sticky';
        header.style.top = '0';
        header.style.zIndex = '20';
        header.style.marginTop = '-1px';
        
        const sortIcon = (col) => isAllInspectors ? getSortIcon(col) : '';
        const sortClick = (col) => isAllInspectors ? `onclick="sortTable('${col}')"` : '';
        const sortClass = isAllInspectors ? 'sortable' : '';
        
        const appSortClass = isAllInspectors ? 'sortable' : '';
        const appSortClick = isAllInspectors ? `onclick="sortTable('app')"` : '';
        const appSortIcon = isAllInspectors ? getSortIcon('app') : '';

        header.innerHTML = `
            <div class="col-num">
                <input type="checkbox" id="bulk-select-all" class="grey-checkbox" onchange="toggleSelectAll(this)">
            </div>
            <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">ETA</div>
            <div class="col-due ${sortClass}" ${sortClick('dueDate')}>Due ${sortIcon('dueDate')}</div>
            <div class="col-insp ${sortClass}" ${sortClick('driverName')} style="display: ${isSingleInspector ? 'none' : 'block'};">Inspector ${sortIcon('driverName')}</div>
            <div class="col-addr ${sortClass}" ${sortClick('address')}>Address ${sortIcon('address')}</div>
            <div class="col-app ${appSortClass}" ${appSortClick}>App ${appSortIcon}</div>
            <div class="col-client ${sortClass}" ${sortClick('client')}>Client ${sortIcon('client')}</div>
            <div class="col-handle" style="visibility:${hasRouted ? 'visible' : 'hidden'};"><i class="fa-solid fa-grip-lines"></i></div>
        `;
        listContainer.appendChild(header);
    }
    
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

        const isRoutedStop = isRouteAssigned(s.status);
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        let etaTime = s.eta || '--';
        
        if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) {
            etaTime = '--';
        }

        if (isManagerView) {
            item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
            if (inspectors.length > 0) {
                const optionsHtml = inspectors.map((insp, idx) => {
                    const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
                    return `<option value="${insp.id}" style="color: ${color}; font-weight: bold;" ${String(s.driverId) === String(insp.id) ? 'selected' : ''}>${insp.name}</option>`;
                }).join('');
                const defaultPlaceholder = !s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : '';
                const disableSelectAttr = !PERMISSION_MODIFY ? 'disabled' : '';

                let currentInspColor = 'var(--text-main)';
                if (s.driverId) {
                    const dIdx = inspectors.findIndex(i => String(i.id) === String(s.driverId));
                    if (dIdx > -1) currentInspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
                }

                inspectorHtml = `
                    <div class="col-insp" onclick="event.stopPropagation()" style="display: ${isSingleInspector ? 'none' : 'block'};">
                        <select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" style="color: ${currentInspColor}; font-weight: bold;" ${disableSelectAttr}>
                            ${defaultPlaceholder}
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            }

            const style = getVisualStyle(s);
            const handleHtml = `<div class="col-handle ${showHandle ? 'handle' : ''}" style="visibility:${showHandle ? 'visible' : 'hidden'};">${showHandle ? '<i class="fa-solid fa-grip-lines"></i>' : ''}</div>`;

            let metaHtml = '';
            if (viewMode === 'managermobile') {
                metaHtml = `<div class="meta-text">${s.app || '--'} | ${s.client || '--'}</div>`;
            }

            item.innerHTML = `
                <div class="col-num"><div class="num-badge" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};">${displayIndex}</div></div>
                <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">${etaTime}</div>
                <div class="col-due ${urgencyClass}">${dueFmt}</div>
                ${inspectorHtml}
                <div class="col-addr">
                    <div class="addr-text">${(s.address||'').split(',')[0]}</div>
                    ${metaHtml}
                    <div class="type-text">${s.type || ''}</div>
                </div>
                <div class="col-app">${s.app || '--'}</div>
                <div class="col-client">${s.client || '--'}</div>
                ${handleHtml}
            `;
        } else {
            item.className = `stop-item ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
            
            const metaDisplay = (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) ? `-- | ${s.client || '--'}` : `${etaTime} | ${s.client || '--'}`;
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
                    <i class="fa-solid fa-location-arrow icon-btn" style="color:var(--blue)" onclick="openNav(event, '${s.lat}','${s.lng}', '${(s.address || '').replace(/'/g, "\\'")}')"></i>
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
            el.className = `marker ${s.status.toLowerCase().replace(' ', '-')}`; 
            
            const style = getVisualStyle(s);
            el.innerHTML = `<div class="pin-visual" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};"><span>${displayIndex}</span></div>`;

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

    if (isSingleInspector || !isManagerView) {
        const unroutedStops = activeStops.filter(s => !isRouteAssigned(s.status));
        const routedStops = activeStops.filter(s => isRouteAssigned(s.status));
        routedStops.sort(sortByEta);

        let eps = getActiveEndpoints();
        listContainer.appendChild(createEndpointRow('start', eps.start));

        if (unroutedStops.length > 0) {
            const unroutedDiv = document.createElement('div');
            unroutedDiv.id = 'unrouted-list';
            unroutedDiv.style.minHeight = '30px'; 
            listContainer.appendChild(unroutedDiv);
            
            if (isManagerView) {
                const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS';
                unroutedDiv.appendChild(el); 
            }
            
            unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1, hasRouted)); });
        }
        
        if (routedStops.length > 0) {
            const uniqueClusters = [...new Set(routedStops.map(s => s.cluster || 0))].sort();
            uniqueClusters.forEach(clusterId => {
                const cStops = routedStops.filter(s => (s.cluster || 0) === clusterId);
                if (cStops.length > 0) {
                    const routedDiv = document.createElement('div');
                    routedDiv.id = isManagerView ? `routed-list-${clusterId}` : `driver-list-${clusterId}`;
                    routedDiv.className = 'routed-group-container';
                    routedDiv.style.minHeight = '30px';
                    listContainer.appendChild(routedDiv);
                    
                    routedDiv.appendChild(createRouteSubheading(clusterId, cStops)); 
                    
                    cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1, true)); });
                }
            });
        }
        
        listContainer.appendChild(createEndpointRow('end', eps.end));
        
    } else {
        const mainDiv = document.createElement('div');
        mainDiv.id = 'main-list-container';
        listContainer.appendChild(mainDiv);
        activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
    }

    let endpointsToDraw = [];
    
    const pushEndpoint = (lng, lat, dId, type) => {
        if (lng && lat) {
            let existing = endpointsToDraw.find(e => e.lng === lng && e.lat === lat && String(e.driverId) === String(dId));
            if (existing) {
                if (type === 'start') existing.isStart = true;
                if (type === 'end') existing.isEnd = true;
            } else {
                endpointsToDraw.push({ lng, lat, driverId: dId, isStart: type === 'start', isEnd: type === 'end' });
            }
        }
    };

    if (isAllInspectors) {
        const activeDriverIds = new Set(activeStops.map(s => String(s.driverId)));
        inspectors.forEach(insp => {
            if (activeDriverIds.has(String(insp.id))) {
                let sLng = insp.startLng; let sLat = insp.startLat;
                let eLng = insp.endLng || insp.startLng; let eLat = insp.endLat || insp.startLat;
                pushEndpoint(parseFloat(sLng), parseFloat(sLat), insp.id, 'start');
                pushEndpoint(parseFloat(eLng), parseFloat(eLat), insp.id, 'end');
            }
        });
    } else {
        let eps = getActiveEndpoints();
        let cInsp = inspectors.find(i => String(i.id) === String(isManagerView ? currentInspectorFilter : driverParam));
        let dId = cInsp ? cInsp.id : null;
        if (eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), dId, 'start');
        if (eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), dId, 'end');
    }

    endpointsToDraw.forEach(ep => {
        let inspColor = '#ffffff';
        if (ep.driverId) {
            const dIdx = inspectors.findIndex(i => String(i.id) === String(ep.driverId));
            if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
        } else if (currentInspectorFilter !== 'all') {
            const dIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
            if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
        }
        
        let emojisHtml = '';
        if (ep.isStart) emojisHtml += `<div style="position: absolute; top: -14px; left: -5px; font-size: 16px;">🏠</div>`;
        if (ep.isEnd) emojisHtml += `<div style="position: absolute; top: -14px; right: -5px; font-size: 16px;">🏁</div>`;
        
        const el = document.createElement('div');
        el.className = 'marker start-end-marker';
        
        el.innerHTML = `
            <div class="pin-visual" style="background-color: ${inspColor}; border: none; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>
            ${emojisHtml}
        `;
        
        const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([ep.lng, ep.lat]).addTo(map);
        markers.push(m);
        bounds.extend([ep.lng, ep.lat]);
    });

    if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
        initialBounds = bounds; map.fitBounds(bounds, { padding: 50, maxZoom: 15 }); 
    }
    
    updateSelectionUI();
    initSortable(); 
    
    setTimeout(() => { if (map) map.resize(); }, 150);
}

function updateSummary() {
    const active = stops.filter(s => isActiveStop(s) && s.status !== 'Completed');
    let totalMi = 0;
    let totalSecs = 0;
    
    active.forEach(s => {
        const distVal = parseFloat(s.dist || 0);
        if (!isNaN(distVal)) totalMi += distVal;
        
        totalSecs += parseFloat(s.durationSecs || 0);
    });
    
    let totalHrs = active.length > 0 ? ((totalSecs + (active.length * COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
    
    document.getElementById('sum-dist').innerText = `${totalMi.toFixed(1)} mi`;
    document.getElementById('sum-time').innerText = `${totalHrs} hrs`;
    
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
        const isEndpointsDirty = dirtyRoutes.has('endpoints_0');
        let stopsToCalculate = [];

        if (isEndpointsDirty) {
            stopsToCalculate = activeStops;
        } else {
            stopsToCalculate = activeStops.filter(s => {
                const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
                return dirtyRoutes.has(routeKey);
            });
        }

        if (stopsToCalculate.length === 0) { 
            if (overlay) overlay.style.display = 'none';
            dirtyRoutes.clear();
            render(); drawRoute(); updateSummary();
            return; 
        }

        const eps = getActiveEndpoints();

        let payload = {
            action: 'calculate',
            driverId: isManagerView ? currentInspectorFilter : driverParam,
            driver: driverParam,
            startTime: currentStartTime,
            startAddr: eps.start?.address || null,
            endAddr: eps.end?.address || null,
            isManager: isManagerView,
            stops: stopsToCalculate.map(s => minifyStop(s, (s.cluster || 0) + 1))
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s);
            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: exp.cluster || 0, manualCluster: false });
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

    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error calculating the route. Please try again."); 
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

async function toggleComplete(e, id) {
    e.stopPropagation();
    pushToHistory();
    const idx = stops.findIndex(s => String(s.id) === String(id));
    const isCurrentlyCompleted = stops[idx].status.toLowerCase() === 'completed';
    const newStatus = isCurrentlyCompleted ? (stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
    stops[idx].status = newStatus;
    render(); drawRoute(); updateSummary();
    
    try {
        let payload = { action: 'updateOrder', rowId: id, driverId: stops[idx].driverId, updates: { status: getStatusCode(newStatus) } };
        if (!isManagerView) payload.routeId = routeId;
        await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch(err) { console.error("Toggle Complete Error", err); }
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
        if(m._stopId) {
            m.getElement().classList.toggle('bulk-selected', selectedIds.has(m._stopId)); 
            if(selectedIds.has(m._stopId)) { const row = document.getElementById(`item-${m._stopId}`); if (row) row.classList.add('selected'); } 
        }
    }); 
    
    const has = selectedIds.size>0; 
    let hasRouted = false;
    
    selectedIds.forEach(id => {
        const s = stops.find(st => String(st.id) === String(id));
        if (s && isRouteAssigned(s.status)) hasRouted = true;
    });

    const selectAllCb = document.getElementById('bulk-select-all');
    if (selectAllCb) {
        const activeStops = stops.filter(s => isActiveStop(s));
        selectAllCb.checked = (activeStops.length > 0 && selectedIds.size === activeStops.length);
    }
    
    document.getElementById('bulk-delete-btn').style.display = (has && PERMISSION_MODIFY && isManagerView) ? 'block' : 'none'; 
    document.getElementById('bulk-unroute-btn').style.display = (hasRouted && PERMISSION_MODIFY) ? 'block' : 'none'; 
    
    const completeBtn = document.getElementById('bulk-complete-btn');
    if (completeBtn) {
        completeBtn.style.display = (has && !isManagerView) ? 'block' : 'none'; 
    }

    const hintEl = document.getElementById('map-hint');
    if (hintEl) {
        hintEl.style.opacity = has ? '0' : '1';
    }
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`move-r${i}-btn`);
        if(btn) {
            if(isManagerView && currentInspectorFilter !== 'all' && has && i <= currentRouteCount && currentRouteCount > 1) {
                let allInTargetRoute = true;
                selectedIds.forEach(id => {
                    const s = stops.find(st => String(st.id) === String(id));
                    if (s && s.cluster !== (i - 1)) {
                        allInTargetRoute = false;
                    }
                });
                btn.style.display = allInTargetRoute ? 'none' : 'block';
            } else {
                btn.style.display = 'none';
            }
        }
    }
}

function focusPin(id) { const tgt = stops.find(s=>String(s.id)===String(id)); if(tgt && tgt.lng && tgt.lat) map.flyTo({ center: [tgt.lng, tgt.lat] }); }
function focusTile(id) { document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function resetMapView() { if (initialBounds) map.fitBounds(initialBounds, { padding: 50, maxZoom: 15 }); }
function filterList() { const q = document.getElementById('search-input').value.toLowerCase(); document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); }

function drawRoute() { 
    if (map.getLayer('route-line-0')) map.removeLayer('route-line-0');
    if (map.getLayer('route-line-1')) map.removeLayer('route-line-1');
    if (map.getLayer('route-line-2')) map.removeLayer('route-line-2');
    if (map.getSource('route')) map.removeSource('route');

    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    let routedStops = [];
    
    if (isManagerView) {
        routedStops = activeStops.filter(s => isRouteAssigned(s.status));
    } else {
        routedStops = activeStops;
    }
    
    if (routedStops.length === 0) return; 

    routedStops.sort(sortByEta);

    const features = [];
    const routesMap = new Map();

    routedStops.forEach(s => {
        const key = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        if (!routesMap.has(key)) routesMap.set(key, []);
        routesMap.get(key).push(s);
    });

    routesMap.forEach((cStops, key) => {
        if (cStops.length > 0) {
            const style = getVisualStyle(cStops[0]);
            let coords = cStops.map(s => [parseFloat(s.lng), parseFloat(s.lat)]);
            
            let dId = key.split('_')[0];
            let clusterIndex = parseInt(key.split('_')[1]);
            let eps = getActiveEndpoints();
            let rStart = eps.start;
            let rEnd = eps.end;

            if (isManagerView && currentInspectorFilter === 'all' && dId !== 'unassigned') {
                const insp = inspectors.find(i => String(i.id) === String(dId));
                if (insp) {
                    rStart = { lng: insp.startLng, lat: insp.startLat };
                    rEnd = { lng: insp.endLng || insp.startLng, lat: insp.endLat || insp.startLat };
                }
            }

            if (rStart && rStart.lng && rStart.lat) coords.unshift([parseFloat(rStart.lng), parseFloat(rStart.lat)]);
            if (rEnd && rEnd.lng && rEnd.lat) coords.push([parseFloat(rEnd.lng), parseFloat(rEnd.lat)]);

            if (coords.length > 1) {
                features.push({
                    "type": "Feature",
                    "properties": { "color": style.line, "clusterIdx": clusterIndex }, 
                    "geometry": { "type": "LineString", "coordinates": coords }
                });
            }
        }
    });

    map.addSource('route', { "type": "geojson", "data": { "type": "FeatureCollection", "features": features } }); 
    
    map.addLayer({ 
        "id": "route-line-0", 
        "type": "line", 
        "source": "route", 
        "filter": ["==", "clusterIdx", 0],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6 } 
    }); 
    
    map.addLayer({ 
        "id": "route-line-1", 
        "type": "line", 
        "source": "route", 
        "filter": ["==", "clusterIdx", 1],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-dasharray": [2, 2] } 
    }); 
    
    map.addLayer({ 
        "id": "route-line-2", 
        "type": "line", 
        "source": "route", 
        "filter": ["==", "clusterIdx", 2],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-dasharray": [0.5, 2] } 
    }); 
}

function openNav(e, la, ln, addr) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { showNavChoice(la, ln, addr); } else { launchMaps(p, la, ln, addr); } }
function showNavChoice(la, ln, addr) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; }
function setNavPref(p, la, ln, addr) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; launchMaps(p, la, ln, addr); }
function launchMaps(p, la, ln, addr) { 
    let destination = `${la},${ln}`;
    if (addr) {
        const parts = addr.split(',');
        const street = parts[0].trim();
        const zipMatch = addr.match(/\b\d{5}(?:-\d{4})?\b/);
        if (zipMatch) {
            destination = encodeURIComponent(`${street}, ${zipMatch[0]}`);
        } else {
            destination = encodeURIComponent(addr);
        }
    }
    window.location.href = p === 'google' ? `http://googleusercontent.com/maps.google.com/?daddr=${destination}` : `https://maps.apple.com/?daddr=${destination}`; 
}

function reorderStopsFromDOM() {
    let unroutedIds = [];
    let routedIds = [];
    
    if (document.getElementById('unrouted-list')) {
        unroutedIds = Array.from(document.getElementById('unrouted-list').children).map(el => el.id.replace('item-', '')).filter(Boolean);
    }
    
    document.querySelectorAll('.routed-group-container').forEach(cont => {
        const rIds = Array.from(cont.children).map(el => el.id.replace('item-', '')).filter(Boolean);
        routedIds = routedIds.concat(rIds);
    });
    
    if (unroutedIds.length === 0 && routedIds.length === 0 && document.getElementById('main-list-container')) {
        routedIds = Array.from(document.getElementById('main-list-container').children).map(el => el.id.replace('item-', '')).filter(Boolean);
    }
    
    const visibleIds = new Set([...unroutedIds, ...routedIds]);
    const otherStops = stops.filter(s => !visibleIds.has(s.id));
    
    const newUnrouted = unroutedIds.map(id => stops.find(s => String(s.id) === String(id))).filter(Boolean);
    const newRouted = routedIds.map(id => stops.find(s => String(s.id) === String(id))).filter(Boolean);
    
    stops = [...otherStops, ...newUnrouted, ...newRouted];
}

function initSortable() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
    if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

    if (!PERMISSION_MODIFY) return;

    if (isManagerView && currentInspectorFilter !== 'all') {
        const unroutedEl = document.getElementById('unrouted-list');

        document.querySelectorAll('.routed-group-container').forEach(routedEl => {
            const inst = Sortable.create(routedEl, {
                group: 'manager-routes',
                handle: '.handle',
                filter: '.static-endpoint, .list-subheading',
                animation: 150,
                onStart: () => pushToHistory(),
                onEnd: async (evt) => {
                    let isMovedToUnrouted = false;
                    
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            markRouteDirty(dId, stop.cluster);
                        }
                    }

                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
                        const idx = stops.findIndex(s => String(s.id) === String(stopId));
                        let dId = null;
                        if (idx > -1) {
                            dId = stops[idx].driverId;
                            stops[idx].status = 'Pending'; 
                            stops[idx].routeState = 'Pending';
                        }
                        
                        const overlay = document.getElementById('processing-overlay');
                        if(overlay) overlay.style.display = 'flex';
                        try {
                            let unroutePayload = { action: 'unrouteOrder', rowId: stopId, driverId: dId };
                            if (!isManagerView) unroutePayload.routeId = routeId;
                            await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(unroutePayload) });
                        } catch (e) { console.error(e); }
                        finally { if(overlay) overlay.style.display = 'none'; }
                    }
                    
                    reorderStopsFromDOM();
                    render(); 
                    silentSaveRouteState();
                    
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
                sort: false, 
                handle: '.handle',
                filter: '.list-subheading',
                animation: 150,
                onStart: () => pushToHistory()
            });
        }
    } else if (!isManagerView) {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                handle: '.handle',
                filter: '.static-endpoint, .list-subheading',
                animation: 150,
                onStart: () => pushToHistory(),
                onEnd: (evt) => {
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            markRouteDirty(dId, stop.cluster);
                        }
                    }

                    reorderStopsFromDOM();
                    render(); 
                    silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
    }
}

loadData();
