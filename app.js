// *
// * Dashboard - V8.0
// * FILE: app.js
// * Changes: Dual-Mode payload routing to support Inspector Email_Requests Sandbox 
// * vs Manager Inspectors Staging. Clean redirects post-dispatch. Restored "Restore Route" 
// * functionality specifically for Inspector sandbox.
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

async function undoLastAction() {
    if (historyStack.length === 0) return;
    const last = historyStack.pop();
    stops = last.stops;
    dirtyRoutes = new Set(last.dirty);
    render(); drawRoute(); updateSummary(); updateRouteTimes(); updateUndoUI();
    await silentSaveRouteState(); 
}

function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = historyStack.length === 0;
}

// DUAL-MODE SAVE: Targets either Inspector Staging or Email_Requests Sandbox
async function silentSaveRouteState() {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    if (inspId === 'all' || !inspId) return;
    
    let routeStops = isManagerView ? stops.filter(s => s.driverId === inspId) : stops.filter(s => s.routeTargetId === String(routeId));
    if (routeStops.length === 0) return;

    let minified = routeStops.map(s => {
        let rNum = (s.cluster || 0) + 1;
        let outEta = s.eta;
        let outDist = s.dist;
        let outDur = s.durationSecs;
        
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        if (dirtyRoutes.has(routeKey) || dirtyRoutes.has('all') || s.status.toLowerCase() === 'pending' || s.status.toLowerCase() === 'deleted') {
            outEta = ''; outDist = ''; outDur = 0;
        }

        return [
            s.rowId || s.id || "", Number(s.seq) || 0, 'R:' + rNum, s.address || "", s.client || "", s.app || "",                                            
            s.dueDate || "", s.type || "", outEta || "", outDist || "", s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0,       
            s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, getStatusCode(s.status), Number(outDur) || 0                            
        ];
    });
    
    let payload = { action: 'saveRoute', stops: minified };
    
    if (isManagerView) {
        payload.driverId = inspId;
    } else {
        payload.routeId = routeId;
        payload.driverId = driverParam;
    }

    try { await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) }); } 
    catch(e) { console.log("Silent save error", e); }
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
    
    if (minStop.rawTuple && Array.isArray(minStop.rawTuple)) {
        const t = minStop.rawTuple;
        let clusterIdx = 0;
        if (typeof t[2] === 'string' && t[2].startsWith('R:')) {
            clusterIdx = parseInt(t[2].split(':')[1]) - 1;
        } else if (!isNaN(parseInt(t[2]))) {
            clusterIdx = parseInt(t[2]) - 1;
        }
        return {
            ...minStop, 
            id: t[0], seq: t[1], cluster: Math.max(0, clusterIdx),
            address: t[3], client: t[4], app: t[5], dueDate: t[6], type: t[7],
            eta: t[8], dist: t[9], lat: t[10], lng: t[11], status: t[12], 
            durationSecs: t[13], rowId: t[0]
        };
    }

    let rawCluster = minStop.R;
    let clusterIdx = 0;
    if (typeof rawCluster === 'string' && rawCluster.startsWith('R:')) {
        clusterIdx = parseInt(rawCluster.split(':')[1]) - 1;
    } else if (!isNaN(parseInt(rawCluster))) {
        clusterIdx = parseInt(rawCluster) - 1;
    }
    return {
        ...minStop, id: minStop.r || minStop.i, seq: minStop.i, cluster: Math.max(0, clusterIdx),
        address: minStop.a, client: minStop.c, app: minStop.p, dueDate: minStop.d, type: minStop.t,
        eta: minStop.e, dist: minStop.D, lat: minStop.l, lng: minStop.g, status: minStop.s, 
        durationSecs: minStop.u, rowId: minStop.r
    };
}

function minifyStop(s, routeNum) {
    return [
        s.rowId || s.id || "", Number(s.seq) || 0, 'R:' + routeNum, s.address || "", s.client || "", s.app || "",                                            
        s.dueDate || "", s.type || "", s.eta || "", s.dist || "", s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0,       
        s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, getStatusCode(s.status), Number(s.durationSecs) || 0                            
    ];
}

function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-dropdown-wrapper');
    const selectEl = document.getElementById('inspector-filter');
    const sidebarDriverEl = document.getElementById('sidebar-driver-name');
    
    if (!selectEl || !isManagerView || inspectors.length === 0) return;

    const validInspectorIds = new Set();
    stops.forEach(s => {
        const status = (s.status || '').toLowerCase();
        if (status !== 'cancelled' && status !== 'deleted' && s.driverId) {
            validInspectorIds.add(s.driverId);
        }
    });

    if (validInspectorIds.size === 0) {
        if (filterSelect) filterSelect.style.display = 'none';
        if (sidebarDriverEl) {
            sidebarDriverEl.innerText = "Upload a CSV to begin";
            sidebarDriverEl.style.display = 'block';
        }
        return;
    }

    if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
    if (filterSelect) filterSelect.style.display = 'block';

    const currentVal = selectEl.value || 'all';
    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(i.id)) {
            const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
            filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
        }
    });
    
    selectEl.innerHTML = filterHtml;
    
    if (currentVal !== 'all' && !validInspectorIds.has(currentVal)) {
        selectEl.value = 'all';
        handleInspectorFilterChange('all');
    } else {
        selectEl.value = currentVal;
        if (currentVal !== 'all') {
            const inspIdx = inspectors.findIndex(i => i.id === currentVal);
            if (inspIdx > -1) selectEl.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
        } else {
            selectEl.style.color = 'var(--text-main)';
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
            const inspIdx = inspectors.findIndex(i => i.id === val);
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
        const inspIdx = inspectors.findIndex(i => i.id === currentInspectorFilter);
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
    const routeState = (s.routeState || '').toLowerCase().trim();

    if (isManagerView) {
        if (routeState === 'dispatched' || status === 'dispatched' || status === 's') return false;
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
    const isRouted = (stopData.status || '').toLowerCase() === 'routed' || (stopData.status || '').toLowerCase() === 'completed' || (stopData.status || '').toLowerCase() === 'dispatched';
    
    let inspectorIndex = 0;
    if (stopData.driverId) {
        const idx = inspectors.findIndex(i => i.id === stopData.driverId);
        if (idx !== -1) inspectorIndex = idx;
    }
    
    const baseColor = MASTER_PALETTE[inspectorIndex % MASTER_PALETTE.length];
    const cluster = stopData.cluster || 0;
    const hasRoutedForInsp = stops.some(s => s.driverId === stopData.driverId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
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

        if (data.routeId) routeId = data.routeId;

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
                _hasExplicitCluster: s.R !== undefined,
                hiddenInInspector: false,
                routeState: exp.routeState || s.routeState || 'Pending',
                routeTargetId: exp.routeTargetId || s.routeTargetId || null
            };
        });

        stops.forEach(s => {
            if (s.routeState === 'Staging' && s.driverId) {
                if (!s.eta || s.eta === '--' || s.eta === '') {
                    markRouteDirty(s.driverId, s.cluster);
                }
            }
        });

        const getLocalDateStr = (etaStr) => {
            if (!etaStr) return "";
            const d = new Date(etaStr);
            return isNaN(d.getTime()) ? String(etaStr).split(' ')[0] : d.toDateString();
        };

        let activeDates = [...new Set(stops.filter(s => s.eta && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')).map(s => getLocalDateStr(s.eta)))];
        activeDates = activeDates.filter(Boolean);
        activeDates.sort((a, b) => new Date(a) - new Date(b));

        stops.forEach(s => {
            if (!s._hasExplicitCluster && s.eta && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')) {
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
                let hasValidStops = stops.some(s => s.status.toLowerCase() !== 'deleted' && s.status.toLowerCase() !== 'cancelled');
                
                if (!hasValidStops) {
                    if (filterSelect) filterSelect.style.display = 'none';
                    if (sidebarDriverEl) { sidebarDriverEl.innerText = "Upload a CSV to begin"; sidebarDriverEl.style.display = 'block'; }
                } else {
                    if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
                    if (sidebarLogo) sidebarLogo.style.display = 'none'; 
                    if (filterSelect) filterSelect.style.display = 'block';
                    updateInspectorDropdown(); 
                }
            } else {
                if (sidebarDriverEl) sidebarDriverEl.innerText = displayName;
            }
            
            updateRouteButtonColors();
            
            let validStopsCheck = stops.filter(s => isActiveStop(s) && s.lng && s.lat).length > 0;
            if (!validStopsCheck && data.companyAddress) {
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
    const insp = inspectors.find(i => i.id === inspId);
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));

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
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'resetRoute', driverId: driverId, routeId: routeId }) 
        });
        
        historyStack = []; 
        stops.forEach(s => {
            if (s.driverId === driverId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')) {
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

// DUAL-MODE SAVE: Targets either Inspector Default Profile/Email Sandbox or Manager Route Endpoint
async function saveEndpointToBackend(type, address, lat, lng) {
    const inspId = isManagerView ? currentInspectorFilter : driverParam;
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
    pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    let action = isManagerView && !hasRouted ? 'updateInspectorDefault' : 'updateEndpoint';
    let payload = { action, type, address, lat, lng };
    
    if (isManagerView) {
        payload.driverId = inspId;
    } else {
        payload.routeId = routeId;
        payload.driverId = driverParam;
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
    const insp = inspectors.find(i => i.id === inspId);
    const activeStops = stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
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
    const insp = inspectors.find(i => i.id === currentInspectorFilter);
    if (!insp) return;

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

    document.getElementById('btn-cancel-dispatch').onclick = () => { m.style.display = 'none'; };

    document.getElementById('btn-submit-dispatch').onclick = async () => {
        const btn = document.getElementById('btn-submit-dispatch');
        btn.innerText = 'Dispatching...';
        btn.disabled = true;

        const customBody = document.getElementById('email-body-text').value;
        const ccCompany = document.getElementById('cc-company-checkbox').checked;
        const addCcChecked = document.getElementById('cc-additional-checkbox').checked;
        const ccEmail = addCcChecked ? document.getElementById('additional-cc-email').value : '';

        const dIdx = inspectors.findIndex(i => i.id === currentInspectorFilter);
        const inspColor = dIdx > -1 ? MASTER_PALETTE[dIdx % MASTER_PALETTE.length] : MASTER_PALETTE[0];

        const activeInspStops = stops.filter(s => isActiveStop(s) && s.driverId === currentInspectorFilter && (s.status.toLowerCase() === 'routed' || s.status.toLowerCase() === 'completed' || s.status.toLowerCase() === 'dispatched'));
        
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
                    'circle-color': [ 'match', ['get', 'cluster'], 0, inspColor, 1, '#000000', '#ffffff' ],
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

        try {
            const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
            const result = await res.json();
            
            if (result.success) {
                m.style.display = 'none';
                
                const toast = document.createElement('div');
                toast.innerText = 'Route Sent!';
                toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 20px; font-weight: bold; font-size: 14px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.3s;';
                document.body.appendChild(toast);
                
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => {
                        toast.remove();
                        window.location.href = window.location.pathname + "?company=" + (companyParam || '') + "&view=" + viewMode;
                    }, 300);
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
    
    let inspStops = isManagerView ? activeStops.filter(s => s.driverId === currentInspectorFilter) : activeStops;
    let inspRoutedStops = inspStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');
    let inspUnroutedStops = inspStops.filter(s => (s.status||'').toLowerCase() === 'pending');
    
    let isReady = false;
    if (inspRoutedStops.length > 0) {
        isReady = inspRoutedStops.some(s => s.routeState.toLowerCase() === 'ready');
    }
    
    let isInspDirty = false;
    for (let s of inspStops) {
        if (dirtyRoutes.has(`${s.driverId}_${s.cluster||0}`) || dirtyRoutes.has('all')) {
            isInspDirty = true; break;
        }
    }
    if (dirtyRoutes.has('endpoints_0')) isInspDirty = true;

    const routedCount = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched').length;
    const unroutedCount = activeStops.length - routedCount;

    const routingControls = document.getElementById('routing-controls');
    const hintEl = document.getElementById('inspector-select-hint');
    
    const oldSidebarBtn = document.getElementById('btn-sidebar-send-route');
    if (oldSidebarBtn) oldSidebarBtn.remove();

    const btnGen = document.getElementById('btn-header-generate');
    const btnStartOver = document.getElementById('btn-header-start-over');
    const btnRecalc = document.getElementById('btn-header-recalc');
    const btnRestore = document.getElementById('btn-header-restore');

    if (!document.getElementById('btn-header-send-route')) {
        const sendBtn = document.createElement('button');
        sendBtn.id = 'btn-header-send-route';
        sendBtn.className = 'header-action-btn';
        sendBtn.style.cssText = 'background: #2E4053; color: white; display: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; font-size: 14px; border: none; cursor: pointer; align-items: center; gap: 8px;';
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Send Route(s)</span>';
        sendBtn.onclick = () => handleOpenEmailModal();
        if (routingControls) routingControls.appendChild(sendBtn);
    }

    if (!document.getElementById('btn-header-optimize-insp')) {
        const optBtn = document.createElement('button');
        optBtn.id = 'btn-header-optimize-insp';
        optBtn.className = 'header-action-btn';
        optBtn.style.cssText = 'background: #2C3D4F; color: white; display: none;';
        optBtn.innerHTML = '<span>Re-Optimize</span>';
        optBtn.onclick = () => handleEndpointOptimize();
        if (routingControls) routingControls.appendChild(optBtn);
    }
    
    if (!document.getElementById('badge-changes-made')) {
        const badge = document.createElement('div');
        badge.id = 'badge-changes-made';
        badge.style.cssText = 'background-color: var(--red, #e6194B); color: yellow; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; display: none; align-items: center; justify-content: center; margin-right: 8px;';
        badge.innerText = 'Changes Made';
        if (routingControls) routingControls.insertBefore(badge, routingControls.firstChild); 
    }

    const optInspBtn = document.getElementById('btn-header-optimize-insp');
    const badgeChanges = document.getElementById('badge-changes-made');
    const btnSend = document.getElementById('btn-header-send-route');

    if(badgeChanges) badgeChanges.style.order = '1';
    if(btnGen) btnGen.style.order = '2';
    if(btnRecalc) btnRecalc.style.order = '3';
    if(optInspBtn) optInspBtn.style.order = '4';
    if(btnRestore) btnRestore.style.order = '5';
    if(btnStartOver) btnStartOver.style.order = '6'; 
    if(btnSend) btnSend.style.order = '7'; 
    
    if(btnGen) btnGen.style.display = 'none';
    if(btnStartOver) btnStartOver.style.display = 'none';
    if(btnRecalc) btnRecalc.style.display = 'none';
    if(btnRestore) btnRestore.style.display = 'none';
    if(optInspBtn) optInspBtn.style.display = 'none';
    if(badgeChanges) badgeChanges.style.display = 'none';
    if(btnSend) btnSend.style.display = 'none';

    if (isManagerView && currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        
        let showHint = false;
        const allValidStops = stops.filter(s => {
            const status = (s.status || '').toLowerCase();
            return status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        });

        for (const insp of inspectors) {
            if (allValidStops.filter(s => s.driverId === insp.id).length > 2) {
                showHint = true; 
                break;
            }
        }
        if (hintEl) hintEl.style.display = (showHint && viewMode !== 'managermobile') ? 'block' : 'none';
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    if (isManagerView) {
        if (inspUnroutedStops.length > 25) {
            if(routingControls) routingControls.style.display = 'flex';
        } else {
            if(routingControls) routingControls.style.display = 'none';
        }

        const isStaging = inspRoutedStops.some(s => s.routeState.toLowerCase() === 'staging') || isInspDirty;

        if (inspUnroutedStops.length > 0 && inspRoutedStops.length === 0) {
            if(btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
        } 
        
        if (isStaging) {
            if(btnStartOver) btnStartOver.style.display = 'flex'; 
            
            if (dirtyRoutes.has('endpoints_0')) {
                if(optInspBtn) optInspBtn.style.display = 'flex';
            } else {
                if(btnRecalc) btnRecalc.style.display = (viewMode === 'managermobile' && !isInspDirty) ? 'none' : 'flex';
            }
        } else if (inspRoutedStops.length > 0) {
            if(btnStartOver) btnStartOver.style.display = 'flex';
        }

        if (isReady && !isInspDirty && !isStaging) {
            if(btnSend) btnSend.style.display = 'flex';
        }

    } else {
        if(routingControls) routingControls.style.display = 'flex';
        
        let showRecalc = false;
        let showOpt = false;
        let showBadge = false;

        if (isInspDirty) {
            showRecalc = true;
            showBadge = true;
            if (PERMISSION_REOPTIMIZE) showOpt = true;
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
        const s = stops.find(st => st.id === id);
        if (s) {
            if ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched') {
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
    const inspId = currentInspectorFilter;
    
    stops.forEach(s => {
        if (isActiveStop(s) && s.lng && s.lat && s.driverId === inspId && s.status.toLowerCase() === 'pending') {
            s.status = 'Routed';
            markRouteDirty(s.driverId, s.cluster);
        }
    });
    
    reorderStopsFromDOM();
    render(); 
    await handleCalculate();
}

// DUAL-MODE SAVE: Targets either Inspector Staging or Email Sandbox
async function handleCalculate() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        reorderStopsFromDOM();
        
        const inspId = isManagerView ? currentInspectorFilter : driverParam;
        let allRouteStops = isManagerView ? stops.filter(s => s.driverId === inspId) : stops.filter(s => s.routeTargetId === String(routeId));
        allRouteStops = allRouteStops.filter(s => s.status.toLowerCase() !== 'cancelled');

        const eps = getActiveEndpoints();

        let payload = {
            action: 'calculate',
            driverId: isManagerView ? inspId : driverParam,
            startTime: currentStartTime,
            startAddr: eps.start?.address || null,
            endAddr: eps.end?.address || null,
            stops: allRouteStops.map(s => minifyStop(s, (s.cluster || 0) + 1))
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
            if (returnedStopsMap.has(s.id)) {
                let updated = returnedStopsMap.get(s.id);
                updated.routeState = 'Ready'; 
                return updated;
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

async function handleStartOver() {
    if(!(await customConfirm("Clear All Routes For This Inspector?"))) return;
    const insp = inspectors.find(i => i.id === currentInspectorFilter);
    if (!insp) return;
    await executeRouteReset(insp.id);
}

async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout sent by the manager?"))) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'restoreOriginalRoute', routeId: routeId }) 
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

    const unroutedStops = activeStops.filter(s => {
        const st = (s.status||'').toLowerCase();
        return st !== 'routed' && st !== 'completed' && st !== 'dispatched';
    });

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
        const stopData = stops.find(st => st.id === m._stopId);
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
            const s = stops.find(st => st.id === id);
            if (s && ((s.status || '').toLowerCase() === 'routed' || (s.status || '').toLowerCase() === 'dispatched')) {
                markRouteDirty(s.driverId, s.cluster);
            }
            if (s) s.status = 'Deleted'; 
        });

        selectedIds.clear(); 
        updateInspectorDropdown(); 
        
        reorderStopsFromDOM();
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        await silentSaveRouteState(); 

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
    
    selectedIds.forEach(id => {
        const idx = stops.findIndex(s => s.id === id);
        if (idx > -1) {
            if ((stops[idx].status || '').toLowerCase() === 'routed' || (stops[idx].status || '').toLowerCase() === 'dispatched') {
                markRouteDirty(stops[idx].driverId, stops[idx].cluster);
            }
            stops[idx].status = 'Pending';
            stops[idx].eta = '';
            if (!isManagerView) stops[idx].hiddenInInspector = true; 
        }
    });
    
    selectedIds.clear(); 
    
    reorderStopsFromDOM();
    render(); drawRoute(); updateSummary(); updateRouteTimes();
    await silentSaveRouteState(); 
}

async function processReassignDriver(rowId, newDriverName, newDriverId) {
    const stopIdx = stops.findIndex(s => s.id === rowId);
    if (stopIdx > -1) { stops[stopIdx].driverName = newDriverName; stops[stopIdx].driverId = newDriverId; }
    const payload = { action: 'updateOrder', rowId: rowId, updates: { driverName: newDriverName, driverId: newDriverId } };
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
            const s = stops.find(st => st.id === id);
            if (s && ((s.status || '').toLowerCase() === 'routed' || (s.status || '').toLowerCase() === 'dispatched')) {
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
        const rawDist = String(s.dist || '0').replace(/[^0-9.]/g, '');
        const distVal = parseFloat(rawDist);
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

window.handleEndpointOptimize = async function() {
    const eps = getActiveEndpoints();
    let sVal = document.getElementById('input-endpoint-start')?.value || eps.start?.address;
    let eVal = document.getElementById('input-endpoint-end')?.value || eps.end?.address;
    
    if (routeStart) routeStart.address = sVal; else routeStart = { address: sVal, lat: eps.start?.lat, lng: eps.start?.lng };
    if (routeEnd) routeEnd.address = eVal; else routeEnd = { address: eVal, lat: eps.end?.lat, lng: eps.end?.lng };

    await finalizeSync('optimize', sVal, eVal);
    
    if(routeId) {
        let sPayload = { action: 'updateEndpoint', routeId: routeId, type: 'start', address: sVal };
        if (routeStart && routeStart.lat) { sPayload.lat = routeStart.lat; sPayload.lng = routeStart.lng; }
        fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(sPayload) }).catch(()=>{});
        
        let ePayload = { action: 'updateEndpoint', routeId: routeId, type: 'end', address: eVal };
        if (routeEnd && routeEnd.lat) { ePayload.lat = routeEnd.lat; ePayload.lng = routeEnd.lng; }
        fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(ePayload) }).catch(()=>{});
    }
    
    dirtyRoutes.delete('endpoints_0');
    render();
};

function createEndpointRow(type, endpointData) {
    const displayAddr = endpointData && endpointData.address ? endpointData.address : '';
    const placeholder = type === 'start' ? 'Search Start Address...' : 'Search End Address...';
    const inputId = `input-endpoint-${type}`;
    const rowIcon = type === 'start' ? '🏠' : '🏁';
    
    const el = document.createElement('div');
    el.className = 'glide-row static-endpoint compact';
    el.style.borderBottom = '1px solid var(--border-color)';
    el.innerHTML = `
        <div class="col-num" style="width:35px; margin-left:0; font-size:18px; justify-content:center; color:var(--text-main);">${rowIcon}</div>
        <div style="flex:1; padding: 0 10px; position:relative;">
            <input type="text" id="${inputId}" class="endpoint-input" style="font-size: 14px; width:100%; max-width: 400px; padding: 6px 10px;" value="${displayAddr}" placeholder="${placeholder}" onfocus="this.select()" onmouseup="return false;" oninput="handleEndpointInput(event, '${type}')" onkeydown="handleEndpointKeyDown(event, '${type}')" onblur="handleEndpointBlur('${type}', this)">
        </div>
        <div class="col-handle" style="visibility:hidden;"><i class="fa-solid fa-grip-lines"></i></div>
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
    const hasRouted = activeStops.some(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');

    if (isManagerView) {
        const header = document.createElement('div');
        header.className = 'glide-table-header';
        
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

        const extractTime = (dateStr) => {
            if (!dateStr) return '--';
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
            }
            const match = String(dateStr).match(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
            return match ? match[0].toUpperCase() : '--';
        };
        
        let etaTime = extractTime(s.eta);
        const statusStr = (s.status||'').toLowerCase();
        const isRoutedStop = statusStr === 'routed' || statusStr === 'completed' || statusStr === 'dispatched';
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        
        if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) {
            etaTime = '--';
        }

        if (isManagerView) {
            item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
            if (inspectors.length > 0) {
                const optionsHtml = inspectors.map((insp, idx) => {
                    const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
                    return `<option value="${insp.id}" style="color: ${color}; font-weight: bold;" ${s.driverId === insp.id ? 'selected' : ''}>${insp.name}</option>`;
                }).join('');
                const defaultPlaceholder = !s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : '';
                const disableSelectAttr = !PERMISSION_MODIFY ? 'disabled' : '';

                let currentInspColor = 'var(--text-main)';
                if (s.driverId) {
                    const dIdx = inspectors.findIndex(i => i.id === s.driverId);
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
        const unroutedStops = activeStops.filter(s => (s.status||'').toLowerCase() !== 'routed' && (s.status||'').toLowerCase() !== 'completed' && (s.status||'').toLowerCase() !== 'dispatched');
        const routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');
        routedStops.sort((a,b) => (a.eta ? new Date(a.eta).getTime() : 0) - (b.eta ? new Date(b.eta).getTime() : 0));

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
            let existing = endpointsToDraw.find(e => e.lng === lng && e.lat === lat && e.driverId === dId);
            if (existing) {
                if (type === 'start') existing.isStart = true;
                if (type === 'end') existing.isEnd = true;
            } else {
                endpointsToDraw.push({ lng, lat, driverId: dId, isStart: type === 'start', isEnd: type === 'end' });
            }
        }
    };

    if (isAllInspectors) {
        const activeDriverIds = new Set(activeStops.map(s => s.driverId));
        inspectors.forEach(insp => {
            if (activeDriverIds.has(insp.id)) {
                let sLng = insp.startLng; let sLat = insp.startLat;
                let eLng = insp.endLng || insp.startLng; let eLat = insp.endLat || insp.startLat;
                pushEndpoint(parseFloat(sLng), parseFloat(sLat), insp.id, 'start');
                pushEndpoint(parseFloat(eLng), parseFloat(eLat), insp.id, 'end');
            }
        });
    } else {
        let eps = getActiveEndpoints();
        let cInsp = inspectors.find(i => i.id === (isManagerView ? currentInspectorFilter : driverParam));
        let dId = cInsp ? cInsp.id : null;
        if (eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), dId, 'start');
        if (eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), dId, 'end');
    }

    endpointsToDraw.forEach(ep => {
        let inspColor = '#ffffff';
        if (ep.driverId) {
            const dIdx = inspectors.findIndex(i => i.id === ep.driverId);
            if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
        } else if (currentInspectorFilter !== 'all') {
            const dIdx = inspectors.findIndex(i => i.id === currentInspectorFilter);
            if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
        }
        
        let emojisHtml = '';
        if (ep.isStart) emojisHtml += `<div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 16px;">🏠</div>`;
        if (ep.isEnd) emojisHtml += `<div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 16px;">🏁</div>`;
        
        const el = document.createElement('div');
        el.className = 'marker start-end-marker';
        
        el.innerHTML = `
            <div class="pin-visual" style="background-color: ${inspColor}; border: 2px solid #000000; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>
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
        const rawDist = String(s.dist || '0').replace(/[^0-9.]/g, '');
        const distVal = parseFloat(rawDist);
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
    
    const newUnrouted = unroutedIds.map(id => {
        let s = stops.find(st => st.id === id);
        if (s) {
            s.status = 'Pending';
            s.eta = '';
        }
        return s;
    }).filter(Boolean);
    
    const newRouted = routedIds.map(id => {
        let s = stops.find(st => st.id === id);
        if (s && s.status.toLowerCase() === 'pending') {
            s.status = 'Routed';
        }
        return s;
    }).filter(Boolean);
    
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
                    const stop = stops.find(s => s.id === stopId);
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            stop.status = 'Routed'; 
                            markRouteDirty(dId, stop.cluster);
                        }
                    }

                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
                        const idx = stops.findIndex(s => s.id === stopId);
                        if (idx > -1) {
                            stops[idx].status = 'Pending'; 
                            stops[idx].eta = '';
                        }
                    }
                    
                    reorderStopsFromDOM();
                    render(); 
                    await silentSaveRouteState();
                    
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
                onEnd: async (evt) => {
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => s.id === stopId);
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
                    await silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
    }
}

loadData();
