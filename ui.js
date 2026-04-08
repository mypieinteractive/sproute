/**
 * Dashboard - V15.4
 * FILE: ui.js
 * Changes: 
 * 1. Split from monolithic app.js. Contains UI rendering, Mapbox integration, modals, and event listeners.
 */

document.body.className = `view-${viewMode} manager-all-inspectors`;
if (isManagerView) document.body.classList.add('empty-state-active');
if (viewMode === 'managermobilesplit') document.body.classList.add('split-show-map');

mapboxgl.accessToken = MAPBOX_TOKEN;
const mapConfig = { 
    container: 'map', 
    style: 'mapbox://styles/mapbox/dark-v11', 
    center: [-96.797, 32.776],
    zoom: 11, 
    attributionControl: false,
    boxZoom: false,
    preserveDrawingBuffer: true,
    cooperativeGestures: (viewMode === 'inspector' || viewMode === 'managermobile' || viewMode === 'managermobilesplit')
};
const map = new mapboxgl.Map(mapConfig);
frontEndApiUsage.mapLoads++;

map.getContainer().addEventListener('touchend', () => {
    const blocker = document.querySelector('.mapboxgl-touch-pan-blocker');
    if (blocker) {
        blocker.style.transition = 'none';
        blocker.style.opacity = '0';
    }
}, { passive: true });

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

document.addEventListener('keydown', (e) => { 
    if (e.key === 'Shift') updateShiftCursor(true); 

    if (viewMode === 'manager' && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.getElementById('modal-overlay').style.display === 'flex') return;
        
        if (selectedIds.size > 0 && PERMISSION_MODIFY) {
            triggerBulkDelete();
        }
    }
});

document.addEventListener('keyup', (e) => { if (e.key === 'Shift') updateShiftCursor(false); });
document.addEventListener('mousemove', (e) => { updateShiftCursor(e.shiftKey); });

window.setRouteViewFilter = function(val) {
    currentRouteViewFilter = val;
    document.getElementById('view-rall-btn').classList.toggle('active', val === 'all');
    document.getElementById('view-r0-btn').classList.toggle('active', val === 0);
    document.getElementById('view-r1-btn').classList.toggle('active', val === 1);
    document.getElementById('view-r2-btn').classList.toggle('active', val === 2);
    
    if (val !== 'all') {
        const hiddenIds = [];
        selectedIds.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== val) {
                hiddenIds.push(id);
            }
        });
        hiddenIds.forEach(id => selectedIds.delete(id));
    }

    render();
    drawRoute();
    updateSummary();
};

window.setMobileSplitView = function(viewType) {
    document.getElementById('toggle-map').classList.toggle('active', viewType === 'map');
    document.getElementById('toggle-list').classList.toggle('active', viewType === 'list');
    
    if (viewType === 'map') {
        document.body.classList.add('split-show-map');
        document.body.classList.remove('split-show-list');
        setTimeout(() => { if(map) map.resize(); }, 100);
    } else {
        document.body.classList.add('split-show-list');
        document.body.classList.remove('split-show-map');
    }
};

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

function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = historyStack.length === 0;
}

function updateHeaderUI() {
    if (!isManagerView) return;
    const sidebarDriverEl = document.getElementById('sidebar-driver-name');
    const filterSelectWrap = document.getElementById('inspector-dropdown-wrapper');
    const isCompanyTier = document.body.classList.contains('tier-company');

    if (isCompanyTier) {
        if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
        if (filterSelectWrap) filterSelectWrap.style.display = 'block';
    } else {
        if (sidebarDriverEl) sidebarDriverEl.style.display = 'block';
        if (filterSelectWrap) filterSelectWrap.style.display = 'none';
    }
}

function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-filter');
    if (!filterSelect || !isManagerView) return;

    const validInspectorIds = new Set();
    stops.forEach(s => {
        if (isActiveStop(s) && s.driverId) {
            validInspectorIds.add(String(s.driverId));
        }
    });

    if (currentInspectorFilter !== 'all' && !validInspectorIds.has(String(currentInspectorFilter))) {
        currentInspectorFilter = 'all';
        sessionStorage.setItem('sproute_inspector_filter', 'all');
        document.body.classList.add('manager-all-inspectors');
        document.body.classList.remove('manager-single-inspector');
    }

    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(String(i.id))) {
            if (isTrueInspector(i.isInspector)) {
                const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
                filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
            }
        }
    });
    
    filterSelect.innerHTML = filterHtml;
    filterSelect.value = currentInspectorFilter;
    
    if (currentInspectorFilter !== 'all') {
        const inspIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
        if (inspIdx > -1) filterSelect.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
    } else {
        filterSelect.style.color = 'var(--text-main)';
    }
}

function handleInspectorFilterChange(val) {
    currentInspectorFilter = val;
    sessionStorage.setItem('sproute_inspector_filter', val);
    document.body.classList.toggle('manager-all-inspectors', val === 'all');
    document.body.classList.toggle('manager-single-inspector', val !== 'all');
    selectedIds.clear();
    
    currentRouteViewFilter = 'all';
    document.getElementById('view-rall-btn').classList.add('active');
    document.getElementById('view-r0-btn').classList.remove('active');
    document.getElementById('view-r1-btn').classList.remove('active');
    document.getElementById('view-r2-btn').classList.remove('active');
    
    updateInspectorDropdown();
    
    if (val !== 'all') liveClusterUpdate();
    
    updateRouteButtonColors();
    render(); drawRoute(); updateSummary(); initSortable();
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
            frontEndApiUsage.geocode++;
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
        if(typeof executeRouteReset === 'function') await executeRouteReset(insp.id);
    } else {
        markRouteDirty('endpoints', 0);
        render(); drawRoute(); updateSummary();
        if(typeof saveEndpointToBackend === 'function') saveEndpointToBackend(type, address, lat, lng);
    }
}

function handleOpenEmailModal() {
    if (currentRouteViewFilter !== 'all') {
        setRouteViewFilter('all');
    }

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
    const displayAdminEmail = adminEmail ? adminEmail : '[Email not provided]';
    const ccCheckedAttr = ccCompanyDefault ? 'checked' : '';

    const modalHtml = `
        <div style="background: #2c2c2e; padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 18px; font-weight: bold;">Customize Email Message</h3>
            
            <textarea id="email-body-text" style="width: 100%; min-height: 150px; background: #3a3a3c; color: #fff; border: 1px solid #4a4a4c; border-radius: 6px; padding: 16px 16px 28px 16px; font-family: inherit; font-size: 15px; line-height: 1.5; margin-bottom: 24px; box-sizing: border-box; overflow: hidden; resize: none;">${defaultEmailMessage}</textarea>
            
            <div style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 10px;">
                <input type="checkbox" id="cc-company-checkbox" ${ccCheckedAttr} style="margin-top: 4px; accent-color: #7b93b8; transform: scale(1.2);">
                <label for="cc-company-checkbox" style="font-size: 16px; cursor: pointer; color: #e5e5e5; font-weight: 500;">
                    CC the Company Email<br>
                    <span style="font-size: 14px; color: #9a9a9a; font-weight: normal;">${displayCompanyEmail}</span>
                </label>
            </div>

            <div style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 10px;">
                <input type="checkbox" id="cc-me-checkbox" checked style="margin-top: 4px; accent-color: #7b93b8; transform: scale(1.2);">
                <label for="cc-me-checkbox" style="font-size: 16px; cursor: pointer; color: #e5e5e5; font-weight: 500;">
                    CC Me<br>
                    <span style="font-size: 14px; color: #9a9a9a; font-weight: normal;">${displayAdminEmail}</span>
                </label>
            </div>

            <div style="margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px;">
                <label for="additional-cc-email" style="font-size: 16px; color: #e5e5e5; font-weight: 500;">Additional CC</label>
                <div id="additional-cc-wrapper" style="padding-left: 0;">
                    <input type="email" id="additional-cc-email" placeholder="email@example.com" style="width: 100%; background: #3a3a3c; color: white; border: 1px solid #4a4a4c; border-radius: 4px; padding: 10px 12px; font-size: 15px; box-sizing: border-box;">
                </div>
            </div>

            <div style="background: #1e1e1e; border: 1px solid #333; padding: 16px; border-radius: 6px; font-size: 15px; color: #fff; margin-bottom: 24px; line-height: 1.5;">
                A list of orders and the map image will be sent to <span style="color: var(--blue, #3B82F6); font-weight: normal;">${insp.name}</span> <span style="color: white;">at</span> <span style="color: var(--blue, #3B82F6); font-weight: normal;">${insp.email || '[Email not provided]'}</span>, along with a direct link to open the interactive map on their device.
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
        const ccMeChecked = document.getElementById('cc-me-checkbox').checked;
        const addCcValue = ccMeChecked ? adminEmail : '';
        const ccEmail = document.getElementById('additional-cc-email').value;

        const mapWrapper = document.getElementById('map-wrapper');
        const overlaysToHide = mapWrapper.querySelectorAll('.map-overlay-btns, #map-hint, #map-header, #route-summary, #mobile-view-toggle');
        
        const originalDisplays = [];
        overlaysToHide.forEach((el, index) => {
            originalDisplays[index] = el.style.display;
            el.style.display = 'none';
        });

        const bounds = new mapboxgl.LngLatBounds();
        let lats = [];
        let lngs = [];

        const routedStopsForInsp = stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter) && isRouteAssigned(s.status));
        
        const addPoint = (lng, lat) => {
            if (lng !== undefined && lat !== undefined && !isNaN(lng) && !isNaN(lat)) {
                bounds.extend([lng, lat]);
                lngs.push(lng);
                lats.push(lat);
            }
        };

        routedStopsForInsp.forEach(s => addPoint(s.lng, s.lat));
        let eps = getActiveEndpoints();
        if (eps.start) addPoint(eps.start.lng, eps.start.lat);
        if (eps.end) addPoint(eps.end.lng, eps.end.lat);

        let finalWidth = 800;
        let finalHeight = 450; 

        if (lats.length > 1) {
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);

            const dLat = maxLat - minLat;
            const avgLat = (maxLat + minLat) / 2;
            
            const dLng = (maxLng - minLng) * Math.cos(avgLat * Math.PI / 180);

            if (dLat > 0.00001 && dLng > 0.00001) {
                let ratio = dLng / dLat; 
                
                if (ratio > 1) {
                    finalWidth = 800;
                    finalHeight = Math.max(350, Math.floor(800 / ratio)); 
                } else {
                    finalHeight = 800;
                    finalWidth = Math.max(350, Math.floor(800 * ratio));
                }
            }
        }

        const originalWrapperStyle = mapWrapper.style.cssText;
        mapWrapper.style.cssText = `width: ${finalWidth}px !important; height: ${finalHeight}px !important; position: absolute !important; top: 0; left: 0; z-index: 0;`;
        
        map.resize(); 

        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 50, animate: false });
        }

        await new Promise(resolve => {
            map.once('idle', resolve);
            setTimeout(resolve, 1200); 
        });

        let mapBase64 = '';
        try {
            const canvasSnapshot = await html2canvas(mapWrapper, { 
                useCORS: true, 
                backgroundColor: '#171717',
                scale: 1 
            });
            mapBase64 = canvasSnapshot.toDataURL('image/jpeg', 0.85); 
        } catch(e) {
            console.error("Screenshot error:", e);
        }

        mapWrapper.style.cssText = originalWrapperStyle;
        map.resize(); 
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 50, animate: false }); 
        }

        overlaysToHide.forEach((el, index) => {
            el.style.display = originalDisplays[index];
        });

        const payload = {
            action: "dispatchRoute",
            driverId: currentInspectorFilter,
            companyId: companyParam || '',
            customBody: customBody,
            ccCompany: ccCompany,
            addCc: addCcValue,
            ccEmail: ccEmail,
            mapBase64: mapBase64
        };
        if (!isManagerView) payload.routeId = routeId;

        try {
            const res = await apiFetch(payload);
            const result = await res.json();
            
            if (result.success) {
                m.style.display = 'none';
                
                stops.forEach(s => {
                    if (String(s.driverId) === String(currentInspectorFilter) && isRouteAssigned(s.status)) {
                        s.routeState = 'Dispatched';
                        s.status = 'Dispatched'; 
                    }
                });
                
                if (isManagerView) {
                    const filterEl = document.getElementById('inspector-filter');
                    if (filterEl) filterEl.value = 'all';
                    handleInspectorFilterChange('all');
                } else {
                    render(); drawRoute(); updateSummary();
                }
                
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
    const isDirty = dirtyRoutes.size > 0;

    const routingControls = document.getElementById('routing-controls');
    const hintEl = document.getElementById('inspector-select-hint');

    const btnGen = document.getElementById('btn-header-generate');
    const btnRecalc = document.getElementById('btn-header-recalc');
    const btnRestore = document.getElementById('btn-header-restore');
    const optInspBtn = document.getElementById('btn-header-optimize-insp');
    const btnSend = document.getElementById('btn-header-send-route');

    [btnGen, btnRecalc, btnRestore, optInspBtn, btnSend].forEach(btn => {
        if (btn) btn.style.display = 'none';
    });

    if (isManagerView && currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        const routeToggles = document.getElementById('route-view-toggles');
        if(routeToggles) routeToggles.style.display = 'none';
        
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
        if (hintEl) hintEl.style.display = (showHint && viewMode !== 'managermobile' && viewMode !== 'managermobilesplit') ? 'block' : 'none';
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    let currentState = 'Pending';
    
    let targetStops = [];
    if (isManagerView) {
        targetStops = stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter));
    } else {
        targetStops = stops.filter(s => isActiveStop(s));
    }
    
    const hasActiveRoutesUI = targetStops.some(s => isRouteAssigned(s.status));
    
    if (targetStops.length > 0) {
        const routedStops = targetStops.filter(s => isRouteAssigned(s.status));
        const targetStop = routedStops.length > 0 ? routedStops[0] : targetStops[0];
        let rs = (targetStop.routeState || 'Pending').toLowerCase();
        
        if (rs === 'queued') currentState = 'Queued';
        else if (rs === 'ready') currentState = 'Ready';
        else if (rs === 'staging') currentState = 'Staging';
        else if (rs === 'staging-endpoint') currentState = 'Staging-endpoint';
        else currentState = 'Pending';
    }

    if (isDirty && hasActiveRoutesUI) {
        currentState = dirtyRoutes.has('endpoints_0') ? 'Staging-endpoint' : 'Staging';
    }

    let maxCluster = -1;
    targetStops.forEach(s => {
        if (isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster > maxCluster) {
            maxCluster = s.cluster;
        }
    });

    const togglesEl = document.getElementById('route-view-toggles');
    if (maxCluster > 0) {
        if(togglesEl) togglesEl.style.display = 'flex';
        const b1 = document.getElementById('view-r1-btn');
        const b2 = document.getElementById('view-r2-btn');
        if (b1) b1.style.display = maxCluster >= 1 ? 'block' : 'none';
        if (b2) b2.style.display = maxCluster >= 2 ? 'block' : 'none';
    } else {
        if(togglesEl) togglesEl.style.display = 'none';
        if (currentRouteViewFilter !== 'all') {
            currentRouteViewFilter = 'all';
            const rAll = document.getElementById('view-rall-btn');
            if (rAll) rAll.classList.add('active');
            for(let i=0; i<=2; i++) {
                const rBtn = document.getElementById(`view-r${i}-btn`);
                if (rBtn) rBtn.classList.remove('active');
            }
        }
    }

    let isCurrentViewDirty = false;
    if (isDirty) {
        if (currentRouteViewFilter === 'all') {
            isCurrentViewDirty = true;
        } else {
            let inspKey = isManagerView ? currentInspectorFilter : driverParam;
            let rKey = `${inspKey}_${currentRouteViewFilter}`;
            if (dirtyRoutes.has(rKey) || dirtyRoutes.has('endpoints_0') || dirtyRoutes.has('all')) {
                isCurrentViewDirty = true;
            }
        }
    }

    if (isManagerView) {
        const unroutedCount = targetStops.filter(s => !isRouteAssigned(s.status)).length;

        if (currentState === 'Pending') {
            if (unroutedCount > 0 && btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
        } else if (currentState === 'Queued') {
            // Processing
        } else if (currentState === 'Ready') {
            if (btnSend && !isCurrentViewDirty) btnSend.style.display = 'flex';
        } else if (currentState === 'Staging') {
            if (isCurrentViewDirty) {
                if (btnRecalc) btnRecalc.style.display = 'flex';
                if (optInspBtn) optInspBtn.style.display = 'flex';
            }
        } else if (currentState === 'Staging-endpoint') {
            if (isCurrentViewDirty) {
                if (btnRecalc) btnRecalc.style.display = 'flex';
                if (optInspBtn) optInspBtn.style.display = 'flex';
            }
        }

        if (routingControls) {
            routingControls.style.display = (currentState === 'Pending' && unroutedCount > 0) ? 'flex' : 'none';
        }

    } else {
        if(routingControls) routingControls.style.display = 'flex';
        
        let showRecalc = false;
        let showOpt = false;
        let showRestore = false;

        if (isDirty) {
            showRecalc = true;
            if (dirtyRoutes.has('endpoints_0') || PERMISSION_REOPTIMIZE) showOpt = true;
        } else if (isAlteredRoute) {
            if(btnRestore) btnRestore.style.display = 'flex'; 
            showRestore = true;
        }
        
        if(btnRecalc) btnRecalc.style.display = showRecalc ? 'flex' : 'none';
        if(optInspBtn) optInspBtn.style.display = showOpt ? 'flex' : 'none';

        if (!showRecalc && !showOpt && !showRestore) {
            if(routingControls) routingControls.style.display = 'none';
        }

        const sidebarBrand = document.getElementById('sidebar-brand');
        if (sidebarBrand) {
            sidebarBrand.style.display = (showRecalc || showOpt || showRestore) ? 'flex' : 'none';
        }
    }
}

function updateRouteTimes() {
    if (isManagerView && currentInspectorFilter === 'all') return;
    const activeStops = stops.filter(s => isStopVisible(s, false) && s.lng && s.lat);
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
        stops.filter(s => isStopVisible(s, true)).forEach(s => selectedIds.add(s.id));
    }
    updateSelectionUI();
};

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
            if (s) {
                if (isRouteAssigned(s.status)) {
                    markRouteDirty(s.driverId, s.cluster); 
                }
                
                s.driverName = newDriverName; 
                s.driverId = newDriverId; 
                s.status = 'Pending';
                s.routeState = 'Pending';
                s.cluster = 'X';
                s.manualCluster = false;
                s.eta = '';
                s.dist = 0;
                s.durationSecs = 0;
                if (viewMode === 'inspector') s.hiddenInInspector = true;
            }
        });

        let payload = { 
            action: 'updateMultipleOrders', 
            updatesList: idsToUpdate.map(id => ({ rowId: id })), 
            sharedUpdates: { 
                driverName: newDriverName, 
                driverId: newDriverId,
                status: 'P',
                eta: '',
                dist: 0,
                durationSecs: 0,
                routeNum: 'X',
                cluster: 'X'
            },
            adminId: adminParam
        };
        
        if (!isManagerView) payload.routeId = routeId;

        await apiFetch(payload);
        
        selectedIds.clear();
        updateInspectorDropdown(); 
        
        render(); 
        drawRoute(); 
        updateSummary();
        silentSaveRouteState();
        
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
    
    document.querySelectorAll('.stop-item, .glide-row').forEach(el => {
        if (mode === 'compact') {
            el.classList.add('compact');
            el.classList.remove('detailed');
        } else {
            el.classList.add('detailed');
            el.classList.remove('compact');
        }
    });
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

function showAddOrderModal() {
    const m = document.getElementById('modal-overlay');
    const mc = document.getElementById('modal-content');
    mc.style.padding = '0';
    mc.style.background = 'transparent';
    mc.style.border = 'none';

    let isIndividual = document.body.classList.contains('tier-individual');
    let selectedInspector = null;
    let selectedApp = null;

    if (isIndividual) {
        selectedInspector = adminParam || driverParam;
    } else if (isManagerView && currentInspectorFilter !== 'all') {
        selectedInspector = currentInspectorFilter;
    } else if (!isManagerView) {
        selectedInspector = driverParam;
    }

    let inspectorHtml = '';
    if (isManagerView && currentInspectorFilter === 'all' && !isIndividual) {
        const filteredInspectors = inspectors.filter(i => isTrueInspector(i.isInspector));
        let inspBtns = filteredInspectors.map(insp => `<div class="pill-btn add-insp-pill" data-val="${insp.id}">${insp.name}</div>`).join('');
        inspectorHtml = `
            <div class="form-group">
                <label>Inspector <span style="float:right; font-weight:normal;">Required</span></label>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-insp-container">
                    ${inspBtns}
                </div>
            </div>
        `;
    }

    let appBtns = availableCsvTypes.map(app => `<div class="pill-btn add-app-pill" data-val="${app}">${app}</div>`).join('');
    let appHtml = `
        <div class="form-group">
            <label>App <span style="float:right; font-weight:normal;">Optional</span></label>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-app-container">
                ${appBtns}
            </div>
        </div>
    `;

    const todayStr = new Date().toISOString().split('T')[0];

    const modalHtml = `
        <div style="background: #202123; padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Add Order</h3>
                <i class="fa-solid fa-xmark" style="cursor:pointer; color: #888; font-size: 20px;" id="add-close-icon"></i>
            </div>

            ${inspectorHtml}
            ${appHtml}

            <div class="form-group">
                <label>Address <span style="float:right; font-weight:normal;">Required</span></label>
                <input type="text" id="add-address" class="form-control" placeholder="123 Main St, City, ST 12345">
            </div>

            <div class="grid-2-col">
                <div class="form-group">
                    <label>Latitude <span style="float:right; font-weight:normal;">Optional</span></label>
                    <input type="number" step="any" id="add-lat" class="form-control" placeholder="e.g. 32.776">
                </div>
                <div class="form-group">
                    <label>Longitude <span style="float:right; font-weight:normal;">Optional</span></label>
                    <input type="number" step="any" id="add-lng" class="form-control" placeholder="e.g. -96.797">
                </div>
            </div>

            <div class="form-group">
                <label>Due Date <span style="float:right; font-weight:normal;">Required</span></label>
                <input type="date" id="add-due" class="form-control" value="${todayStr}">
            </div>

            <div class="grid-2-col">
                <div class="form-group">
                    <label>Client <span style="float:right; font-weight:normal;">Optional</span></label>
                    <input type="text" id="add-client" class="form-control" placeholder="Client Name">
                </div>
                <div class="form-group">
                    <label>Order Type <span style="float:right; font-weight:normal;">Optional</span></label>
                    <input type="text" id="add-type" class="form-control" placeholder="e.g. Install">
                </div>
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-start; margin-top: 10px;">
                <button id="btn-submit-add" style="padding: 10px 24px; background: #35475b; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0.5;" disabled>Add Order</button>
                <button id="btn-cancel-add" style="padding: 10px 24px; background: transparent; color: white; border: 1px solid #555; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;

    mc.innerHTML = modalHtml;
    m.style.display = 'flex';

    const checkValidity = () => {
        const submitBtn = document.getElementById('btn-submit-add');
        const addr = document.getElementById('add-address').value.trim();
        const due = document.getElementById('add-due').value;

        if (selectedInspector && addr && due) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.background = 'var(--green)';
        } else {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.background = '#35475b';
        }
    };

    document.querySelectorAll('.add-insp-pill').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.add-insp-pill').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            selectedInspector = el.getAttribute('data-val');
            checkValidity();
        };
    });

    document.querySelectorAll('.add-app-pill').forEach(el => {
        el.onclick = () => {
            if (el.classList.contains('active')) {
                el.classList.remove('active');
                selectedApp = null;
            } else {
                document.querySelectorAll('.add-app-pill').forEach(e => e.classList.remove('active'));
                el.classList.add('active');
                selectedApp = el.getAttribute('data-val');
            }
            checkValidity();
        };
    });

    document.getElementById('add-address').addEventListener('input', checkValidity);
    document.getElementById('add-due').addEventListener('input', checkValidity);

    const closeModal = () => { m.style.display = 'none'; };
    document.getElementById('add-close-icon').onclick = closeModal;
    document.getElementById('btn-cancel-add').onclick = closeModal;

    document.getElementById('btn-submit-add').onclick = () => {
        closeModal();
        
        const addr = document.getElementById('add-address').value.trim();
        const lat = document.getElementById('add-lat').value;
        const lng = document.getElementById('add-lng').value;
        const due = document.getElementById('add-due').value;
        const client = document.getElementById('add-client').value.trim();
        const type = document.getElementById('add-type').value.trim();

        const escapeCsv = (val) => '"' + String(val || '').replace(/"/g, '""') + '"';
        
        const headers = ['Address', 'Latitude', 'Longitude', 'Due Date', 'Client', 'Order Type'];
        const values = [addr, lat, lng, due, client, type];
        const csvContent = headers.join(',') + '\n' + values.map(escapeCsv).join(',');
        
        const file = new File([csvContent], "manual_order.csv", { type: "text/csv" });
        if(typeof performUpload === 'function') performUpload(file, selectedInspector, selectedApp || '');
    };

    checkValidity();
}

function showUploadModal(file) {
    const m = document.getElementById('modal-overlay');
    const mc = document.getElementById('modal-content');

    mc.style.padding = '0';
    mc.style.background = 'transparent';
    mc.style.border = 'none';

    let isIndividual = document.body.classList.contains('tier-individual');
    let selectedInspector = null;

    if (isIndividual) {
        selectedInspector = adminParam || driverParam;
    } else if (isManagerView && currentInspectorFilter !== 'all') {
        selectedInspector = currentInspectorFilter;
    } else if (!isManagerView) {
        selectedInspector = driverParam;
    }

    let selectedCsvType = null;

    let inspectorHtml = '';
    if (isManagerView && currentInspectorFilter === 'all' && !isIndividual) {
        const filteredInspectors = inspectors.filter(i => isTrueInspector(i.isInspector));
        let inspBtns = filteredInspectors.map(insp => `<div class="pill-btn insp-pill" data-val="${insp.id}">${insp.name}</div>`).join('');
        inspectorHtml = `
            <div style="margin-bottom: 20px;">
                <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">Inspector <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-insp-container">
                    ${inspBtns}
                </div>
            </div>
        `;
    }

    let appBtns = availableCsvTypes.map(app => `<div class="pill-btn app-pill" data-val="${app}">${app}</div>`).join('');

    const modalHtml = `
        <div style="background: #202123; padding: 24px; border-radius: 8px; width: 500px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Process CSV File</h3>
                <i class="fa-solid fa-xmark" style="cursor:pointer; color: #888; font-size: 20px;" id="upload-close-icon"></i>
            </div>

            <div style="margin-bottom: 20px;">
                <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">File <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
                <div style="background: #2a2b2d; border: 1px solid #333; padding: 12px 16px; border-radius: 6px; color: #ccc; display: flex; align-items: center; gap: 10px; font-size: 14px;">
                    <i class="fa-solid fa-file-csv" style="font-size: 18px;"></i> ${file.name}
                </div>
            </div>

            ${inspectorHtml}

            <div style="margin-bottom: 30px;">
                <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">App <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-app-container">
                    ${appBtns}
                </div>
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-start;">
                <button id="btn-submit-upload" style="padding: 10px 24px; background: #35475b; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0.5;" disabled>Submit</button>
                <button id="btn-cancel-upload" style="padding: 10px 24px; background: transparent; color: white; border: 1px solid #555; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;

    mc.innerHTML = modalHtml;
    m.style.display = 'flex';

    const checkValidity = () => {
        const submitBtn = document.getElementById('btn-submit-upload');
        if (selectedInspector && selectedCsvType) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.background = 'var(--blue)';
        } else {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.background = '#35475b';
        }
    };

    document.querySelectorAll('.insp-pill').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.insp-pill').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            selectedInspector = el.getAttribute('data-val');
            checkValidity();
        };
    });

    document.querySelectorAll('.app-pill').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.app-pill').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            selectedCsvType = el.getAttribute('data-val');
            checkValidity();
        };
    });

    const closeModal = () => { m.style.display = 'none'; };
    document.getElementById('upload-close-icon').onclick = closeModal;
    document.getElementById('btn-cancel-upload').onclick = closeModal;

    document.getElementById('btn-submit-upload').onclick = () => {
        closeModal();
        if(typeof performUpload === 'function') performUpload(file, selectedInspector, selectedCsvType);
    };
}

function handleFileSelection(file) {
    if (inspectors.length === 0 || availableCsvTypes.length === 0) {
        customAlert("Before you can upload your first CSV file, you need to set up your Inspector and CSV Column Matching Settings.");
        return;
    }
    if (file.name.toLowerCase().endsWith('.csv')) {
        showUploadModal(file);
    } else {
        customAlert("Please upload a valid CSV file.");
    }
}

function render() {
    updateHeaderUI();
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
    
    const activeStops = stops.filter(s => isStopVisible(s, true));
    const hasRouted = activeStops.some(s => isRouteAssigned(s.status));
    
    // Toggle Empty State Visibility
    const isEmptyManager = isManagerView && activeStops.length === 0;
    document.body.classList.toggle('empty-state-active', isEmptyManager);

    const headerActions = document.getElementById('header-actions-wrapper');
    if (headerActions) {
        headerActions.style.display = viewMode === 'inspector' ? 'none' : 'flex';
    }

    const searchContainer = document.getElementById('search-container');
    if (searchContainer) {
        if (isManagerView && activeStops.length === 0) {
            searchContainer.style.display = 'none';
        } else {
            searchContainer.style.display = 'flex';
        }
    }

    const mobileToggle = document.getElementById('mobile-view-toggle');
    if (mobileToggle) {
        mobileToggle.style.display = viewMode === 'managermobilesplit' ? 'flex' : 'none';
    }

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
        
        if (viewMode === 'inspector' && s.hiddenInInspector) {
            item.classList.add('hidden-unrouted');
        }
        
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
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
        let etaTime = s.eta || '--';
        
        if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) {
            etaTime = '--';
        }

        if (isManagerView) {
            item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
            if (inspectors.length > 0) {
                const filteredInspectors = inspectors.filter(i => isTrueInspector(i.isInspector));
                
                const optionsHtml = filteredInspectors.map((insp) => {
                    const originalIdx = inspectors.indexOf(insp);
                    const color = MASTER_PALETTE[originalIdx % MASTER_PALETTE.length];
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
            if (viewMode === 'managermobile' || viewMode === 'managermobilesplit') {
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
            if (viewMode === 'inspector' && s.hiddenInInspector) item.classList.add('hidden-unrouted');
            
            const distFmt = s.dist ? parseFloat(s.dist).toFixed(1) : "0.0";
            const metaDisplay = (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) ? `-- | ${distFmt} mi` : `${etaTime} | ${distFmt} mi`;
            
            item.innerHTML = `
                <div class="stop-sidebar ${urgencyClass}">${displayIndex}</div>
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

            if (urgencyClass && s.status.toLowerCase() !== 'completed') {
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
            const uniqueClusters = [...new Set(routedStops.map(s => s.cluster === 'X' ? 0 : (s.cluster || 0)))].sort();
            uniqueClusters.forEach(clusterId => {
                const cStops = routedStops.filter(s => (s.cluster === 'X' ? 0 : (s.cluster || 0)) === clusterId);
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
        
        if (activeStops.length > 0) {
            activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
        }
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
        initialBounds = bounds; 
        map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate: !isFirstMapRender }); 
        if (isFirstMapRender) isFirstMapRender = false;
    }
    
    updateSelectionUI();
    initSortable(); 
    
    setTimeout(() => { if (map) map.resize(); }, 150);
}

function updateSummary() {
    const active = stops.filter(s => isStopVisible(s, true) && s.status !== 'Completed');

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

async function toggleComplete(e, id) {
    e.stopPropagation();
    pushToHistory();
    const idx = stops.findIndex(s => String(s.id) === String(id));
    const isCurrentlyCompleted = stops[idx].status.toLowerCase() === 'completed';
    const newStatus = isCurrentlyCompleted ? (stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
    stops[idx].status = newStatus;
    render(); drawRoute(); updateSummary();
    
    try {
        let payload = { 
            action: 'updateOrder', 
            rowId: id, 
            driverId: stops[idx].driverId, 
            updates: { status: getStatusCode(newStatus) },
            adminId: adminParam
        };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
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
        const activeStops = stops.filter(s => isStopVisible(s, true));
        selectAllCb.checked = (activeStops.length > 0 && selectedIds.size === activeStops.length);
    }
    
    document.getElementById('bulk-delete-btn').style.display = (has && PERMISSION_MODIFY && isManagerView) ? 'block' : 'none'; 
    document.getElementById('bulk-unroute-btn').style.display = (hasRouted && PERMISSION_MODIFY) ? 'block' : 'none'; 

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
    const layerIds = [
        'route-line-0-clean', 'route-line-0-dirty',
        'route-line-1-out-clean', 'route-line-1-in-clean', 'route-line-1-out-dirty', 'route-line-1-in-dirty',
        'route-line-2-out-clean', 'route-line-2-in-clean', 'route-line-2-out-dirty', 'route-line-2-in-dirty'
    ];
    layerIds.forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
    if (map.getSource('route')) map.removeSource('route');

    const activeStops = stops.filter(s => isStopVisible(s, true) && s.lng && s.lat);

    let routedStops = [];
    if (isManagerView) {
        routedStops = activeStops.filter(s => isRouteAssigned(s.status));
    } else {
        routedStops = activeStops;
    }
    
    if (routedStops.length === 0) return; 

    let visualStops = [...routedStops];

    const features = [];
    const routesMap = new Map();

    visualStops.forEach(s => {
        const key = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 0 : (s.cluster || 0)}`;
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

            let isDirty = dirtyRoutes.has(key) || dirtyRoutes.has('all') || dirtyRoutes.has('endpoints_0');

            if (coords.length > 1) {
                features.push({
                    "type": "Feature",
                    "properties": { "color": style.line, "clusterIdx": clusterIndex, "isDirty": isDirty }, 
                    "geometry": { "type": "LineString", "coordinates": coords }
                });
            }
        }
    });

    map.addSource('route', { "type": "geojson", "data": { "type": "FeatureCollection", "features": features } }); 
    
    map.addLayer({ "id": "route-line-0-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-0-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 

    map.addLayer({ "id": "route-line-1-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-1-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-1-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-1-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 

    map.addLayer({ "id": "route-line-2-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-2-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-2-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-2-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 
}

function openNav(e, la, ln, addr) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { showNavChoice(la, ln, addr); } else { launchMaps(p, la, ln, addr); } }
function showNavChoice(la, ln, addr) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; }
function setNavPref(p, la, ln, addr) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; launchMaps(p, la, ln, addr); }
function launchMaps(p, la, ln, addr) { 
    let safeAddr = encodeURIComponent(addr || "Destination");
    if (p === 'google') {
        window.location.href = `comgooglemaps://?daddr=${la},${ln}+(${safeAddr})&directionsmode=driving`; 
    } else {
        window.location.href = `http://maps.apple.com/?daddr=${la},${ln}&dirflg=d`; 
    }
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
                    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
                    
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            stop.manualCluster = true;
                            if (hasActiveRoutes) {
                                stop.status = 'Routed';
                                stop.routeState = 'Staging';
                                markRouteDirty(dId, stop.cluster);
                            }
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
                            stops[idx].cluster = 'X';
                            stops[idx].manualCluster = false;
                            stops[idx].eta = '';
                            stops[idx].dist = 0;
                            stops[idx].durationSecs = 0;
                            if (viewMode === 'inspector') stops[idx].hiddenInInspector = true;
                        }
                        
                        const overlay = document.getElementById('processing-overlay');
                        if(overlay) overlay.style.display = 'flex';
                        try {
                            let unroutePayload = { 
                                action: 'updateOrder', 
                                rowId: stopId, 
                                driverId: dId, 
                                updates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' },
                                adminId: adminParam
                            };
                            if (!isManagerView) unroutePayload.routeId = routeId;
                            await apiFetch(unroutePayload);
                        } catch (e) { console.error(e); }
                        finally { if(overlay) overlay.style.display = 'none'; }
                    }
                    
                    reorderStopsFromDOM();
                    render(); 
                    drawRoute(); 
                    updateSummary(); 
                    updateRouteTimes();
                    silentSaveRouteState();
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
                delay: 200,
                delayOnTouchOnly: true,
                filter: '.static-endpoint, .list-subheading',
                animation: 150,
                onStart: () => pushToHistory(),
                onEnd: (evt) => {
                    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            stop.manualCluster = true;
                            if (hasActiveRoutes) {
                                stop.status = 'Routed';
                                stop.routeState = 'Staging';
                                markRouteDirty(dId, stop.cluster);
                            }
                        }
                    }

                    reorderStopsFromDOM();
                    render(); 
                    drawRoute(); 
                    updateSummary(); 
                    updateRouteTimes();
                    silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
    }
}

const headerDropzone = document.getElementById('header-csv-upload');
const headerInput = document.getElementById('header-file-input');
if (headerDropzone && headerInput) {
    headerDropzone.onclick = () => headerInput.click();
    headerDropzone.ondragover = (e) => {
        e.preventDefault();
        headerDropzone.classList.add('drag-active');
    };
    headerDropzone.ondragleave = (e) => {
        e.preventDefault();
        headerDropzone.classList.remove('drag-active');
    };
    headerDropzone.ondragleave = (e) => {
        e.preventDefault();
        headerDropzone.classList.remove('drag-active');
    };
    headerDropzone.ondrop = (e) => {
        e.preventDefault();
        headerDropzone.classList.remove('drag-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    };
    headerInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
            headerInput.value = ''; 
        }
    };
}

const mainDropzone = document.getElementById('main-dropzone');
const mainInput = document.getElementById('main-file-input');
if (mainDropzone && mainInput) {
    mainDropzone.onclick = () => mainInput.click();
    mainDropzone.ondragover = (e) => {
        e.preventDefault();
        mainDropzone.style.borderColor = 'var(--blue)';
        mainDropzone.style.backgroundColor = 'var(--bg-hover)';
    };
    mainDropzone.ondragleave = (e) => {
        e.preventDefault();
        mainDropzone.style.borderColor = 'var(--border-color)';
        mainDropzone.style.backgroundColor = 'transparent';
    };
    mainDropzone.ondrop = (e) => {
        e.preventDefault();
        mainDropzone.style.borderColor = 'var(--border-color)';
        mainDropzone.style.backgroundColor = 'transparent';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    };
    mainInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
            mainInput.value = ''; 
        }
    };
}

function openUnmatchedModal() {
    const modal = document.getElementById('unmatched-modal');
    const title = document.getElementById('unmatched-modal-title');
    const origAddr = document.getElementById('unmatched-original-address');
    const latInput = document.getElementById('unmatched-lat');
    const lngInput = document.getElementById('unmatched-lng');
    const correctedInput = document.getElementById('unmatched-corrected');
    const submitBtn = document.getElementById('btn-unmatched-submit');
    const errorMsg = document.getElementById('unmatched-error');

    const currentAddr = unmatchedAddressesQueue[currentUnmatchedIndex];

    title.textContent = `Match Addresses (${currentUnmatchedIndex + 1} of ${unmatchedAddressesQueue.length})`;
    origAddr.textContent = currentAddr;

    latInput.value = '';
    lngInput.value = '';
    correctedInput.value = '';
    errorMsg.style.display = 'none';
    submitBtn.textContent = 'Match Coordinates';

    modal.style.display = 'flex';
}

async function nextUnmatchedAddress() {
    currentUnmatchedIndex++;
    if (currentUnmatchedIndex < unmatchedAddressesQueue.length) {
        openUnmatchedModal();
    } else {
        document.getElementById('unmatched-modal').style.display = 'none';
        
        const toast = document.createElement('div');
        toast.innerText = 'Address matching complete.';
        toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 20px; font-weight: bold; font-size: 14px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.3s;';
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);

        await loadData(); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const correctedInput = document.getElementById('unmatched-corrected');
    if (correctedInput) {
        correctedInput.addEventListener('input', (e) => {
            const submitBtn = document.getElementById('btn-unmatched-submit');
            if (e.target.value.trim() !== '') {
                submitBtn.textContent = 'Update Address';
            } else {
                submitBtn.textContent = 'Match Coordinates';
            }
        });
    }

    const unmatchedSubmitBtn = document.getElementById('btn-unmatched-submit');
    if (unmatchedSubmitBtn) {
        unmatchedSubmitBtn.addEventListener('click', async () => {
            const currentAddr = unmatchedAddressesQueue[currentUnmatchedIndex];
            const lat = document.getElementById('unmatched-lat').value;
            const lng = document.getElementById('unmatched-lng').value;
            const corrected = document.getElementById('unmatched-corrected').value;
            const errorMsg = document.getElementById('unmatched-error');
            const loadingOverlay = document.getElementById('unmatched-loading-overlay');

            errorMsg.style.display = 'none';
            loadingOverlay.style.display = 'flex';

            try {
                const response = await apiFetch({
                    action: 'resolveUnmatchedAddress',
                    driverId: currentUploadDriverId,
                    companyId: companyParam || '',
                    originalAddress: currentAddr,
                    lat: lat,
                    lng: lng,
                    correctedAddress: corrected
                });

                const result = await response.json();

                if (result.success) {
                    loadingOverlay.style.display = 'none';
                    nextUnmatchedAddress();
                } else {
                    loadingOverlay.style.display = 'none';
                    if (result.unresolvable) {
                        errorMsg.textContent = 'Address not found. Please try again or enter coordinates.';
                        errorMsg.style.display = 'block';
                    } else {
                        errorMsg.textContent = result.error || 'Invalid coordinates provided.';
                        errorMsg.style.display = 'block';
                    }
                }
            } catch (err) {
                loadingOverlay.style.display = 'none';
                errorMsg.textContent = 'Network error. Please try again.';
                errorMsg.style.display = 'block';
            }
        });
    }

    const unmatchedSkipBtn = document.getElementById('btn-unmatched-skip');
    if (unmatchedSkipBtn) {
        unmatchedSkipBtn.addEventListener('click', async () => {
            if (await customConfirm("This order will be removed from the list.\n\nPress OK to delete.")) {
                const currentAddr = unmatchedAddressesQueue[currentUnmatchedIndex];
                const loadingOverlay = document.getElementById('unmatched-loading-overlay');
                loadingOverlay.style.display = 'flex';

                try {
                    await apiFetch({
                        action: 'resolveUnmatchedAddress',
                        skip: true,
                        driverId: currentUploadDriverId,
                        originalAddress: currentAddr
                    });
                } catch(e) {
                    console.error("Skip error:", e);
                }

                loadingOverlay.style.display = 'none';
                nextUnmatchedAddress();
            }
        });
    }
});

// Kick off initialization
loadData();
