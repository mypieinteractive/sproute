// *
// * Dashboard - V4.19
// * FILE: app.js
// * Changes: V4.19 - Increased pin interior opacity to 0.75. Fixed inspector view endpoints 
// * not pre-populating. Added sticky logic to subheadings. Realigned Re-Optimize button to left. 
// * Wipes ETAs on page load if backend flags needsRecalculation. Added local front-end 
// * geocoding to instantly resolve coordinates for start/end 🏁 pins and route lines.
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

let COMPANY_SERVICE_DELAY = 0; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 
let currentInspectorFilter = 'all';

let routeStart = null;
let routeEnd = null;

let dirtyRoutes = new Set(); 
let historyStack = [];
let isAlteredRoute = false;

// Custom Dark Mode Alerts & Confirms
function customAlert(msg) {
    return new Promise(resolve => {
        const m = document.getElementById('modal-overlay');
        m.style.display = 'flex';
        document.getElementById('modal-content').innerHTML = `
            <h3 style="margin-top:0;">Alert</h3>
            <p style="font-size: 14px; margin-bottom: 20px;">${msg}</p>
            <div style="display:flex; justify-content:flex-end;">
                <button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-alert-ok">OK</button>
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
        m.style.display = 'flex';
        document.getElementById('modal-content').innerHTML = `
            <h3 style="margin-top:0;">Confirm</h3>
            <p style="font-size: 14px; margin-bottom: 20px;">${msg}</p>
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button style="padding:10px 20px; border:none; border-radius:6px; background:#444; color:white; cursor:pointer;" id="modal-confirm-cancel">Cancel</button>
                <button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-confirm-ok">OK</button>
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
}

function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = historyStack.length === 0;
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
    boxZoom: false
};
if (viewMode === 'managermobile') {
    mapConfig.cooperativeGestures = true;
}
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
    if (!filterSelect || !isManagerView || inspectors.length === 0) return;

    const validInspectorIds = new Set();
    stops.forEach(s => {
        const status = (s.status || '').toLowerCase();
        if (status !== 'cancelled' && status !== 'deleted' && s.driverId) {
            validInspectorIds.add(s.driverId);
        }
    });

    const currentVal = filterSelect.value || 'all';
    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(i.id)) {
            const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
            filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
        }
    });
    
    filterSelect.innerHTML = filterHtml;
    if (currentVal !== 'all' && !validInspectorIds.has(currentVal)) {
        filterSelect.value = 'all';
        handleInspectorFilterChange('all');
    } else {
        filterSelect.value = currentVal;
        if (currentVal !== 'all') {
            const inspIdx = inspectors.findIndex(i => i.id === currentVal);
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
                circle.style.backgroundColor = hexToRgba(bgHex, 0.75); // Increased opacity
                circle.style.border = `2px solid ${baseColor}`;
                ind.appendChild(circle);
            }
        }
    }
}

function isActiveStop(s) {
    let active = true;
    const status = (s.status || '').toLowerCase();
    
    if (isManagerView) {
        active = (status === '' || status === 'routed' || status === 'completed');
    } else {
        active = status !== 'cancelled' && status !== 'deleted' && !status.includes('unfound');
        if (s.hiddenInInspector) active = false;
    }
    
    if (isManagerView && currentInspectorFilter !== 'all') {
        if (s.driverId !== currentInspectorFilter) active = false;
    }
    
    return active;
}

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getVisualStyle(stopData) {
    const isRouted = (stopData.status || '').toLowerCase() === 'routed' || (stopData.status || '').toLowerCase() === 'completed';
    
    let inspectorIndex = 0;
    if (stopData.driverId) {
        const idx = inspectors.findIndex(i => i.id === stopData.driverId);
        if (idx !== -1) inspectorIndex = idx;
    }
    
    const baseColor = MASTER_PALETTE[inspectorIndex % MASTER_PALETTE.length];
    const cluster = stopData.cluster || 0;
    const hasRoutedForInsp = stops.some(s => s.driverId === stopData.driverId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed'));
    
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
        if (bgHex.startsWith('#')) {
            bgFinal = hexToRgba(bgHex, 0.75); // Increased to 0.75 per request
        } else {
            bgFinal = bgHex; 
        }
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
        
        if (data.routeId) {
            routeId = data.routeId;
        }
        
        // Blank out ETAs if backend explicitly says calculations are out of sync
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
                cluster: exp.cluster || 0,
                manualCluster: false,
                _hasExplicitCluster: s.R !== undefined,
                hiddenInInspector: false
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
        document.body.setAttribute('data-route-count', currentRouteCount);

        originalStops = JSON.parse(JSON.stringify(stops)); 
        if (stops.length > 0 && stops[0].eta) currentStartTime = stops[0].eta;
        
        historyStack = [];

        if (!Array.isArray(data)) {
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
        if (overlay) overlay.style.display = 'none';
        updateUndoUI();
    }
}

function updateRoutingUI() {
    const activeStops = stops.filter(s => isActiveStop(s));
    const routedCount = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed').length;
    const unroutedCount = activeStops.length - routedCount;
    const isDirty = dirtyRoutes.size > 0;

    const routingControls = document.getElementById('routing-controls');
    const hintEl = document.getElementById('inspector-select-hint');
    
    const btnGen = document.getElementById('btn-header-generate');
    const btnStartOver = document.getElementById('btn-header-start-over');
    const btnRecalc = document.getElementById('btn-header-recalc');
    const btnRestore = document.getElementById('btn-header-restore');
    
    // Default Hide
    if(btnGen) btnGen.style.display = 'none';
    if(btnStartOver) btnStartOver.style.display = 'none';
    if(btnRecalc) btnRecalc.style.display = 'none';
    if(btnRestore) btnRestore.style.display = 'none';

    if (isManagerView && currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        
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
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    if (isManagerView) {
        if (unroutedCount > 25) {
            if(routingControls) routingControls.style.display = 'flex';
        } else {
            if(routingControls) routingControls.style.display = 'none';
        }

        if (unroutedCount > 0 && routedCount === 0) {
            if(btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
        } else if (isDirty) {
            if(btnRecalc) btnRecalc.style.display = 'flex';
        } else if (routedCount > 0) {
            if(btnStartOver) btnStartOver.style.display = 'flex';
        }
    } else {
        if(routingControls) routingControls.style.display = 'none';
        
        if (isAlteredRoute && !isDirty) {
            if(btnRestore) btnRestore.style.display = 'flex';
        } else if (isDirty || (isAlteredRoute && isDirty)) { 
             if(btnRecalc) btnRecalc.style.display = 'flex';
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
            if ((s.status||'').toLowerCase() === 'routed') {
                markRouteDirty(s.driverId, s.cluster); 
            }
            s.cluster = cIdx;
            s.manualCluster = true; 
            markRouteDirty(s.driverId, s.cluster); 
        }
    });
    selectedIds.clear();
    render(); 
    drawRoute();
    updateSummary();
    updateRouteTimes();
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

    let startInput = document.getElementById('input-endpoint-start');
    let endInput = document.getElementById('input-endpoint-end');
    
    let sAddr = startInput ? startInput.value : '';
    let eAddr = endInput ? endInput.value : '';

    try {
        await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'generateRoute', inspectorName: insp.name, driverId: insp.id, routeClusters: clusteredArrays, startAddr: sAddr, endAddr: eAddr })
        });
        
        await loadData();
    } catch (e) {
        if(overlay) overlay.style.display = 'none';
        // Updated error messaging for potential 504 timeouts
        await customAlert("Generation is taking longer than expected or encountered an error. Please wait a moment and refresh the page.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

async function handleStartOver() {
    if(!(await customConfirm("Clear All Routes For This Inspector?"))) return;
    
    const insp = inspectors.find(i => i.id === currentInspectorFilter);
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'resetRoute', driverId: insp.id, routeId: routeId }) 
        });
        
        historyStack = []; 
        
        stops.forEach(s => {
            if (s.driverId === insp.id && (s.status||'').toLowerCase() === 'routed') {
                s.eta = '';
                s.dist = '';
                s.status = '';
            }
        });
        
        dirtyRoutes.clear();
        render(); drawRoute(); updateSummary(); updateUndoUI();
    } catch(e) { 
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error resetting the route. Please try again."); 
        console.error(e);
    } finally { 
        if(overlay) overlay.style.display = 'none'; 
    }
}

async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    
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
            if (s && (s.status || '').toLowerCase() === 'routed') {
                markRouteDirty(s.driverId, s.cluster);
            }
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

    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error deleting orders. Please try again.");
        console.error("Bulk Delete Error:", err);
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
            const idx = stops.findIndex(s => s.id === id);
            if (idx > -1) {
                if ((stops[idx].status || '').toLowerCase() === 'routed') {
                    markRouteDirty(stops[idx].driverId, stops[idx].cluster);
                }
                stops[idx].status = '';
                if (!isManagerView) stops[idx].hiddenInInspector = true; 
            }
            return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'unrouteOrder', rowId: id }) });
        });
        
        await Promise.all(unroutePromises);
        
        selectedIds.clear(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error removing orders from the route. Please try again.");
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
            if (s && (s.status || '').toLowerCase() === 'routed') {
                markRouteDirty(s.driverId, s.cluster); 
                markRouteDirty(newDriverId, s.cluster); 
            }
        });

        for (const id of idsToUpdate) await processReassignDriver(id, newDriverName, newDriverId); 
        
        updateInspectorDropdown(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
    } catch (err) { 
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error reassigning orders. Please try again."); 
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
    let totalSecs = 0;
    
    const today = new Date(); today.setHours(0,0,0,0);

    clusterStops.forEach(s => {
        const rawDist = String(s.dist || '0').replace(/[^0-9.]/g, '');
        const distVal = parseFloat(rawDist);
        if (!isNaN(distVal)) {
            totalMi += distVal;
        }
        
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
    const sOrig = routeStart?.address || '';
    const eOrig = routeEnd?.address || '';
    
    const modified = (sVal.trim() !== sOrig.trim()) || (eVal.trim() !== eOrig.trim());
    const isDirty = dirtyRoutes.has('endpoints_0');
    const canOpt = isManagerView || PERMISSION_REOPTIMIZE;
    
    document.querySelectorAll('.btn-endpoint-opt').forEach(btn => {
        btn.style.display = ((modified || isDirty) && canOpt) ? 'block' : 'none';
    });
};

window.handleEndpointOptimize = async function() {
    const sVal = document.getElementById('input-endpoint-start')?.value || '';
    const eVal = document.getElementById('input-endpoint-end')?.value || '';
    
    if (routeStart) routeStart.address = sVal; else routeStart = {address: sVal};
    if (routeEnd) routeEnd.address = eVal; else routeEnd = {address: eVal};

    await finalizeSync('optimize', sVal, eVal);
    
    if(routeId) {
        fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'updateEndpoint', routeId: routeId, type: 'start', address: sVal }) }).catch(()=>{});
        fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'updateEndpoint', routeId: routeId, type: 'end', address: eVal }) }).catch(()=>{});
    }
    
    dirtyRoutes.delete('endpoints_0');
    render();
};

// Local Front-End Geocoding to instantly resolve endpoint lat/lng
async function geocodeAddress(addr) {
    if (!addr) return null;
    try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${MAPBOX_TOKEN}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            return {
                lat: data.features[0].center[1],
                lng: data.features[0].center[0]
            };
        }
    } catch (e) { console.error("Geocoding error:", e); }
    return null;
}

function createEndpointRow(type, endpointData) {
    const displayAddr = endpointData && endpointData.address ? endpointData.address : '';
    const placeholder = type === 'start' ? 'Enter Start Address...' : 'Enter End Address...';
    const inputId = `input-endpoint-${type}`;
    const labelText = type === 'start' ? 'Start' : 'End';
    
    const isDirty = dirtyRoutes.has('endpoints_0');
    const canOpt = isManagerView || PERMISSION_REOPTIMIZE;
    const displayStyle = (isDirty && canOpt) ? 'block' : 'none';
    
    const optBtnHtml = `<button class="header-action-btn btn-endpoint-opt" style="display:${displayStyle}; background:#2C3D4F; color:white; flex-shrink:0; width:auto; padding:0 12px; margin-right: 8px;" onmousedown="event.preventDefault(); handleEndpointOptimize()">Re-Optimize</button>`;
    
    if (!isManagerView) {
        const el = document.createElement('div');
        el.className = 'stop-item static-endpoint compact';
        el.innerHTML = `
            <div class="stop-sidebar" style="background:var(--bg-header); color:var(--text-main); font-size:18px;">🏁</div>
            <div class="stop-content" style="padding: 0 10px; flex-direction:row; align-items:center; display:flex;">
                ${optBtnHtml}
                <input type="text" id="${inputId}" class="endpoint-input" style="font-size: 14px; flex:1;" value="${displayAddr}" placeholder="${placeholder}" oninput="checkEndpointModified()" onblur="updateEndpointAddress('${type}', this.value)">
            </div>
            <div class="stop-actions" style="width: 40px;"></div>
        `;
        return el;
    } else {
        const el = document.createElement('div');
        el.className = 'glide-row static-endpoint';
        el.innerHTML = `
            <div class="col-num" style="font-size:16px; margin-left: 10px;">🏁</div>
            <div class="col-eta"></div>
            <div class="col-due"></div>
            <div class="col-insp" style="display:flex; justify-content:flex-start; align-items:center; padding-right:6px; overflow:hidden;">
                ${optBtnHtml}
                <span style="font-weight:bold; color:var(--text-muted); font-size:13px; white-space:nowrap;" class="endpoint-label-text">${labelText}</span>
            </div>
            <div class="col-addr">
                <input type="text" id="${inputId}" class="endpoint-input" style="font-size: 14px; width:100%; max-width: 250px;" value="${displayAddr}" placeholder="${placeholder}" oninput="checkEndpointModified()" onblur="updateEndpointAddress('${type}', this.value)">
            </div>
            <div class="col-app"></div>
            <div class="col-client"></div>
            <div class="col-handle" style="visibility:hidden;"></div>
        `;
        return el;
    }
}

async function updateEndpointAddress(type, value) {
    if (!value.trim()) return;

    // Immediately resolve local coordinates for drawing 🏁 lines
    const geo = await geocodeAddress(value);
    let epObj = { address: value };
    if (geo) {
        epObj.lat = geo.lat;
        epObj.lng = geo.lng;
    }
    
    if (type === 'start') routeStart = epObj;
    if (type === 'end') routeEnd = epObj;
    markRouteDirty('endpoints', 0);
    render(); drawRoute(); // Updates map instantly with front-end geo
    
    if (!routeId) {
        if (currentInspectorFilter && currentInspectorFilter !== 'all') {
            localStorage.setItem(`sproute_${type}_${currentInspectorFilter}`, value);
        }
        return;
    }
    
    pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    try {
        const res = await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'updateEndpoint', routeId: routeId, type: type, address: value, lat: epObj.lat, lng: epObj.lng })
        });
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
    } catch (e) {
        console.error("Endpoint update failed:", e);
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
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
    const hasRouted = activeStops.some(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed');

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
            <div class="col-eta">ETA</div>
            <div class="col-due ${sortClass}" ${sortClick('dueDate')}>Due ${sortIcon('dueDate')}</div>
            <div class="col-insp ${sortClass}" ${sortClick('driverName')}>Inspector ${sortIcon('driverName')}</div>
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
        const isRoutedStop = statusStr === 'routed' || statusStr === 'completed';
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        
        // Wipe ETAs if route logic is dirty or marked universally out-of-sync by the backend
        if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) {
            etaTime = '--';
        }

        if (isManagerView) {
            item.className = `glide-row ${s.status} ${currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
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
                    <div class="col-insp" onclick="event.stopPropagation()">
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
                <div class="col-eta">${etaTime}</div>
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
            item.className = `stop-item ${s.status} ${currentDisplayMode}`;
            
            let distStr = s.dist ? String(s.dist) : '--';
            if(distStr !== '--' && !distStr.includes('mi')) distStr += ' mi';
            
            const metaDisplay = (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) ? '-- | --' : `${etaTime} | ${distStr}`;
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

    if (isSingleInspector) {
        const unroutedStops = activeStops.filter(s => (s.status||'').toLowerCase() !== 'routed' && (s.status||'').toLowerCase() !== 'completed');
        const routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed');
        routedStops.sort(sortByEta);

        let currentStart = routeStart;
        let currentEnd = routeEnd;
        
        if (!routeId) {
            const insp = inspectors.find(i => i.id === currentInspectorFilter);
            if (insp) {
                currentStart = { address: localStorage.getItem('sproute_start_' + insp.id) || insp.start || '' };
                currentEnd = { address: localStorage.getItem('sproute_end_' + insp.id) || insp.end || insp.start || '' };
            }
        }
        
        listContainer.appendChild(createEndpointRow('start', currentStart));

        if (unroutedStops.length > 0) {
            const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS';
            listContainer.appendChild(el);
            const unroutedDiv = document.createElement('div');
            unroutedDiv.id = 'unrouted-list';
            unroutedDiv.style.minHeight = '30px'; 
            listContainer.appendChild(unroutedDiv);
            unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1, hasRouted)); });
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
        
        listContainer.appendChild(createEndpointRow('end', currentEnd));
        
    } else if (viewMode === 'inspector') {
        const activeStopsCopy = [...activeStops].sort(sortByEta);
        const uniqueClusters = [...new Set(activeStopsCopy.map(s => s.cluster || 0))].sort();
        
        listContainer.appendChild(createEndpointRow('start', routeStart));
        
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
        
        listContainer.appendChild(createEndpointRow('end', routeEnd));
        
    } else {
        const mainDiv = document.createElement('div');
        mainDiv.id = 'main-list-container';
        listContainer.appendChild(mainDiv);
        activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
    }

    // --- Draw Start/End 🏁 Map Markers Dynamically ---
    let endpointsToDraw = [];
    if (isAllInspectors) {
        const activeDriverIds = new Set(activeStops.map(s => s.driverId));
        inspectors.forEach(insp => {
            if (activeDriverIds.has(insp.id)) {
                let sLng = insp.startLng || (routeStart ? routeStart.lng : null);
                let sLat = insp.startLat || (routeStart ? routeStart.lat : null);
                let eLng = insp.endLng || insp.startLng || (routeEnd ? routeEnd.lng : (routeStart ? routeStart.lng : null));
                let eLat = insp.endLat || insp.startLat || (routeEnd ? routeEnd.lat : (routeStart ? routeStart.lat : null));
                
                if (sLng && sLat) endpointsToDraw.push({lng: parseFloat(sLng), lat: parseFloat(sLat)});
                if (eLng && eLat) endpointsToDraw.push({lng: parseFloat(eLng), lat: parseFloat(eLat)});
            }
        });
    } else {
        let currentStart = routeStart;
        let currentEnd = routeEnd;
        if (!routeId && isSingleInspector) {
            const insp = inspectors.find(i => i.id === currentInspectorFilter);
            if (insp) {
                currentStart = { lng: insp.startLng || (routeStart ? routeStart.lng : null), lat: insp.startLat || (routeStart ? routeStart.lat : null) };
                currentEnd = { lng: insp.endLng || insp.startLng || (routeEnd ? routeEnd.lng : (routeStart ? routeStart.lng : null)), lat: insp.endLat || insp.startLat || (routeEnd ? routeEnd.lat : (routeStart ? routeStart.lat : null)) };
            }
        }
        if (currentStart && currentStart.lng && currentStart.lat) endpointsToDraw.push({lng: parseFloat(currentStart.lng), lat: parseFloat(currentStart.lat)});
        if (currentEnd && currentEnd.lng && currentEnd.lat) endpointsToDraw.push({lng: parseFloat(currentEnd.lng), lat: parseFloat(currentEnd.lat)});
    }

    const seenCoords = new Set();
    endpointsToDraw.forEach(ep => {
        const key = `${ep.lng},${ep.lat}`;
        if (!seenCoords.has(key)) {
            seenCoords.add(key);
            const el = document.createElement('div');
            el.className = 'marker start-end-marker';
            el.innerHTML = `<div style="font-size: 24px; filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.5)); transform: translateY(-10px);">🏁</div>`;
            const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([ep.lng, ep.lat]).addTo(map);
            markers.push(m);
            bounds.extend([ep.lng, ep.lat]);
        }
    });

    if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
        initialBounds = bounds; map.fitBounds(bounds, { padding: 50, maxZoom: 15 }); 
    }
    
    updateSelectionUI();
    initSortable(); 
    
    setTimeout(() => { if (map) map.resize(); }, 150);
}

function updateSummary() {
    const active = stops.filter(s => isActiveStop(s) && s.status !== 'completed');
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

        let payload = {
            action: 'calculate',
            routeId: routeId,
            driver: driverParam,
            startTime: currentStartTime,
            startAddr: routeStart && routeStart.address ? routeStart.address : null,
            endAddr: routeEnd && routeEnd.address ? routeEnd.address : null,
            isManager: isManagerView,
            stops: stopsToCalculate.map(s => minifyStop(s, (s.cluster || 0) + 1))
        };

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
                return returnedStopsMap.get(s.id);
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
        console.error(e);
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

function toggleComplete(e, id) {
    e.stopPropagation();
    pushToHistory();
    const idx = stops.findIndex(s => s.id == id);
    stops[idx].status = (stops[idx].status === 'completed') ? 'Routed' : 'completed';
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
        if(m._stopId) {
            m.getElement().classList.toggle('bulk-selected', selectedIds.has(m._stopId)); 
            if(selectedIds.has(m._stopId)) { const row = document.getElementById(`item-${m._stopId}`); if (row) row.classList.add('selected'); } 
        }
    }); 
    
    const has = selectedIds.size>0; 
    let hasRouted = false;
    
    selectedIds.forEach(id => {
        const s = stops.find(st => st.id === id);
        if (s && (s.status || '').toLowerCase() === 'routed') hasRouted = true;
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
                    const s = stops.find(st => st.id === id);
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

function focusPin(id) { const tgt = stops.find(s=>s.id==id); if(tgt && tgt.lng && tgt.lat) map.flyTo({ center: [tgt.lng, tgt.lat] }); }
function focusTile(id) { document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function resetMapView() { if (initialBounds) map.fitBounds(initialBounds, { padding: 50, maxZoom: 15 }); }
function filterList() { const q = document.getElementById('search-input').value.toLowerCase(); document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); }

function drawRoute() { 
    if (map.getSource('route')) map.getSource('route').setData({ "type": "FeatureCollection", "features": [] });

    const activeStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    let routedStops = [];
    
    if (isManagerView) {
        routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed');
    } else {
        routedStops = activeStops;
    }
    
    // Allow lines to be drawn even if there's only 1 routed stop connecting to endpoints
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
            let rStart = routeStart;
            let rEnd = routeEnd;

            // Connect specific inspector endpoints if manager is viewing all
            if (isManagerView && dId !== 'unassigned') {
                const insp = inspectors.find(i => i.id === dId);
                if (insp) {
                    rStart = { lng: insp.startLng || (routeStart ? routeStart.lng : null), lat: insp.startLat || (routeStart ? routeStart.lat : null) };
                    rEnd = { lng: insp.endLng || insp.startLng || (routeEnd ? routeEnd.lng : (routeStart ? routeStart.lng : null)), lat: insp.endLat || insp.startLat || (routeEnd ? routeEnd.lat : (routeStart ? routeStart.lat : null)) };
                }
            }

            if (rStart && rStart.lng && rStart.lat) coords.unshift([parseFloat(rStart.lng), parseFloat(rStart.lat)]);
            if (rEnd && rEnd.lng && rEnd.lat) coords.push([parseFloat(rEnd.lng), parseFloat(rEnd.lat)]);

            if (coords.length > 1) {
                features.push({
                    "type": "Feature",
                    "properties": { "color": style.line }, 
                    "geometry": { "type": "LineString", "coordinates": coords }
                });
            }
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
                "line-color": ["get", "color"], 
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

async function finalizeSync(type, directStart = null, directEnd = null) {
    const startAddr = directStart !== null ? directStart : (document.getElementById('start-addr')?.value || '');
    const endAddr = directEnd !== null ? directEnd : (document.getElementById('end-addr')?.value || '');
    const modal = document.getElementById('modal-overlay');
    if(modal) modal.style.display = 'none';
    
    // Send geocoded coords directly to backend if available
    let sLat = routeStart && routeStart.lat ? routeStart.lat : null;
    let sLng = routeStart && routeStart.lng ? routeStart.lng : null;
    let eLat = routeEnd && routeEnd.lat ? routeEnd.lat : null;
    let eLng = routeEnd && routeEnd.lng ? routeEnd.lng : null;

    let payload = { 
        action: type, routeId: routeId, driver: driverParam, 
        startTime: currentStartTime, startAddr: startAddr, endAddr: endAddr,
        startLat: sLat, startLng: sLng, endLat: eLat, endLng: eLng,
        isManager: isManagerView
    };

    if (isManagerView && currentInspectorFilter !== 'all') {
        let clusteredArrays = [];
        for(let i = 0; i < currentRouteCount; i++) {
            let itemsInCluster = stops.filter(s => s.cluster === i);
            if (itemsInCluster.length > 0) {
                clusteredArrays.push(itemsInCluster.map(s => minifyStop(s, i + 1)));
            }
        }
        payload.routeClusters = clusteredArrays;
        payload.priorityLevel = document.getElementById('slider-priority') ? document.getElementById('slider-priority').value : 0;
    } else {
        payload.stops = stops.map(s => minifyStop(s, (s.cluster || 0) + 1));
    }

    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json(); 
        stops = data.updatedStops.map(s => {
            let exp = expandStop(s);
            return { ...exp, id: exp.rowId || exp.id, cluster: exp.cluster || 0, manualCluster: false };
        });
        
        if (!isManagerView) isAlteredRoute = true;
        historyStack = [];
        dirtyRoutes.clear();
        render(); drawRoute(); updateSummary();
    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error updating locations. Please try again."); 
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
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

    if (isManagerView && currentInspectorFilter !== 'all') {
        const unroutedEl = document.getElementById('unrouted-list');

        document.querySelectorAll('.routed-group-container').forEach(routedEl => {
            const inst = Sortable.create(routedEl, {
                group: 'manager-routes',
                handle: '.handle',
                filter: '.static-endpoint',
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
                        if (matchNew) markRouteDirty(dId, parseInt(matchNew[2]));
                    }

                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
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
                    render(); 
                    
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
                animation: 150,
                onStart: () => pushToHistory()
            });
        }
    } else if (!isManagerView) {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                handle: '.handle',
                filter: '.static-endpoint',
                animation: 150,
                onStart: () => pushToHistory(),
                onEnd: (evt) => {
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => s.id === stopId);
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) markRouteDirty(dId, parseInt(matchNew[2]));
                    }

                    reorderStopsFromDOM();
                    render(); 
                }
            });
            sortableInstances.push(inst);
        });
    }
}

loadData();
