// *
// * Dashboard - V6.6
// * FILE: ui.js
// * Description: DOM rendering, visual interactions, and layout management.
// *

import { Config, State, isActiveStop, getVisualStyle, markRouteDirty } from './state.js';
import { map, drawRoute, focusPin, focusTile } from './map.js';
import { initSortable, reorderStopsFromDOM, liveClusterUpdate } from './drag-drop.js';
import { silentSaveRouteState } from './api.js';

export function updateShiftCursor(isShiftDown) {
    const wrap = document.getElementById('map-wrapper');
    if (wrap) {
        if (isShiftDown && !wrap.classList.contains('shift-down')) wrap.classList.add('shift-down');
        else if (!isShiftDown && wrap.classList.contains('shift-down')) wrap.classList.remove('shift-down');
    }
}

export function customAlert(msg) {
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
        document.getElementById('modal-alert-ok').onclick = () => { m.style.display = 'none'; resolve(); };
    });
}

export function customConfirm(msg) {
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

export function pushToHistory() {
    State.historyStack.push({ stops: JSON.parse(JSON.stringify(State.stops)), dirty: new Set(State.dirtyRoutes) });
    if (State.historyStack.length > 20) State.historyStack.shift();
    updateUndoUI();
}

export function undoLastAction() {
    if (State.historyStack.length === 0) return;
    const last = State.historyStack.pop();
    State.stops = last.stops; State.dirtyRoutes = new Set(last.dirty);
    render(); drawRoute(); updateSummary(); updateRouteTimes(); updateUndoUI();
    silentSaveRouteState();
}

export function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = State.historyStack.length === 0;
}

export function sortTable(col) {
    if (State.currentSort.col === col) State.currentSort.asc = !State.currentSort.asc;
    else { State.currentSort.col = col; State.currentSort.asc = true; }

    State.stops.sort((a, b) => {
        let valA = a[col] || ''; let valB = b[col] || '';
        if (col === 'dueDate') {
            valA = valA ? new Date(valA).getTime() : Number.MAX_SAFE_INTEGER;
            valB = valB ? new Date(valB).getTime() : Number.MAX_SAFE_INTEGER;
        } else {
            valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
        }
        if (valA < valB) return State.currentSort.asc ? -1 : 1;
        if (valA > valB) return State.currentSort.asc ? 1 : -1;
        return 0;
    });
    render(); 
}

export function getSortIcon(col) {
    if (State.currentSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:0.3; margin-left:4px;"></i>';
    return State.currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--blue);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--blue);"></i>';
}

export function setDisplayMode(mode) {
    State.currentDisplayMode = mode;
    document.getElementById('btn-detailed').classList.toggle('active', mode === 'detailed');
    document.getElementById('btn-compact').classList.toggle('active', mode === 'compact');
    render();
}

export function toggleSelectAll(cb) {
    State.selectedIds.clear();
    if (cb.checked) {
        State.stops.filter(s => isActiveStop(s)).forEach(s => State.selectedIds.add(s.id));
    }
    updateSelectionUI();
}

export function filterList() { 
    const q = document.getElementById('search-input').value.toLowerCase(); 
    document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); 
}

export function getActiveEndpoints() {
    if (State.isManagerView && State.currentInspectorFilter === 'all') return { start: null, end: null };
    
    const inspId = State.isManagerView ? State.currentInspectorFilter : State.driverParam;
    const insp = State.inspectors.find(i => i.id === inspId);
    const activeStops = State.stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
    let start = null; let end = null;
    
    if (hasRouted && State.routeStart && State.routeStart.address) start = State.routeStart;
    else if (insp) start = { address: insp.startAddress || insp.start || '', lat: insp.startLat, lng: insp.startLng };
    
    if (hasRouted && State.routeEnd && State.routeEnd.address) end = State.routeEnd;
    else if (insp) end = { address: insp.endAddress || insp.end || insp.startAddress || insp.start || '', lat: insp.endLat || insp.startLat, lng: insp.endLng || insp.startLng };
    
    return { start, end };
}

export function setRoutes(num) {
    State.currentRouteCount = num;
    document.body.setAttribute('data-route-count', num);
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if(btn) btn.classList.toggle('active', i === num);
    }
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    if (headerGenBtnText) headerGenBtnText.innerText = State.currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
    
    State.stops.forEach(s => s.manualCluster = false); 
    liveClusterUpdate();
    updateSelectionUI(); 
}

export function moveSelectedToRoute(cIdx) {
    pushToHistory();
    State.selectedIds.forEach(id => {
        const s = State.stops.find(st => st.id === id);
        if (s) {
            if ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched') markRouteDirty(s.driverId, s.cluster); 
            s.cluster = cIdx; s.manualCluster = true; 
            markRouteDirty(s.driverId, s.cluster); 
        }
    });
    State.selectedIds.clear();
    
    reorderStopsFromDOM(); render(); drawRoute(); updateSummary(); updateRouteTimes(); silentSaveRouteState();
}

export function checkEndpointModified() {
    const sVal = document.getElementById('input-endpoint-start')?.value || '';
    const eVal = document.getElementById('input-endpoint-end')?.value || '';
    const eps = getActiveEndpoints();
    const modified = (sVal.trim() !== (eps.start?.address || '').trim()) || (eVal.trim() !== (eps.end?.address || '').trim());
    if (modified) markRouteDirty('endpoints', 0);
    updateRoutingUI();
}

let geocodeTimeout;
export function handleEndpointInput(e, type) {
    checkEndpointModified();
    clearTimeout(geocodeTimeout);
    const val = e.target.value;
    const dropdownId = `autocomplete-${type}`;
    let dropdown = document.getElementById(dropdownId);
    
    if (!val.trim()) { 
        if (dropdown) dropdown.innerHTML = ''; 
        State.latestSuggestions[type] = null;
        return; 
    }
    
    geocodeTimeout = setTimeout(async () => {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${Config.MAPBOX_TOKEN}&country=us&types=address,poi`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            State.latestSuggestions[type] = data.features.length > 0 ? data.features[0] : null;
            renderAutocomplete(data.features, e.target, type);
        } catch (err) { console.error("Autocomplete Error:", err); }
    }, 300);
}

export function renderAutocomplete(features, inputEl, type) {
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
            State.latestSuggestions[type] = f; 
            inputEl.value = f.place_name;
            dropdown.innerHTML = '';
            import('./api.js').then(api => api.selectEndpoint(type, f.place_name, f.center[1], f.center[0], inputEl));
        };
        dropdown.appendChild(item);
    });
}

export function commitTopSuggestion(type, inputEl) {
    const eps = getActiveEndpoints();
    const currentSaved = type === 'start' ? eps.start?.address : eps.end?.address;

    if (inputEl.value.trim() !== '' && inputEl.value !== currentSaved) {
        if (State.latestSuggestions[type]) {
            const top = State.latestSuggestions[type];
            inputEl.value = top.place_name;
            import('./api.js').then(api => api.selectEndpoint(type, top.place_name, top.center[1], top.center[0], inputEl));
        }
    }
}

export function handleEndpointKeyDown(e, type) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }

export function handleEndpointBlur(type, inputEl) {
    setTimeout(() => {
        commitTopSuggestion(type, inputEl);
        const dropdown = document.getElementById(`autocomplete-${type}`);
        if (dropdown) dropdown.innerHTML = ''; 
    }, 200);
}

export function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-filter');
    if (!filterSelect || !State.isManagerView || State.inspectors.length === 0) return;

    const validInspectorIds = new Set();
    State.stops.forEach(s => {
        const status = (s.status || '').toLowerCase();
        if (status !== 'cancelled' && status !== 'deleted' && s.driverId) validInspectorIds.add(s.driverId);
    });

    const currentVal = filterSelect.value || 'all';
    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    State.inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(i.id)) {
            const color = Config.MASTER_PALETTE[idx % Config.MASTER_PALETTE.length];
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
            const inspIdx = State.inspectors.findIndex(i => i.id === currentVal);
            if (inspIdx > -1) filterSelect.style.color = Config.MASTER_PALETTE[inspIdx % Config.MASTER_PALETTE.length];
        } else {
            filterSelect.style.color = 'var(--text-main)';
        }
    }
}

export function handleInspectorFilterChange(val) {
    State.currentInspectorFilter = val;
    document.body.classList.toggle('manager-all-inspectors', val === 'all');
    document.body.classList.toggle('manager-single-inspector', val !== 'all');
    State.selectedIds.clear();
    
    const filterSelect = document.getElementById('inspector-filter');
    if (filterSelect) {
        if (val === 'all') filterSelect.style.color = 'var(--text-main)';
        else {
            const inspIdx = State.inspectors.findIndex(i => i.id === val);
            if (inspIdx > -1) filterSelect.style.color = Config.MASTER_PALETTE[inspIdx % Config.MASTER_PALETTE.length];
        }
    }

    if (val !== 'all') liveClusterUpdate();
    
    updateRouteButtonColors(); render(); drawRoute(); updateSummary();
}

export function updateRouteButtonColors() {
    if (!State.isManagerView) return;
    
    let baseColor = Config.MASTER_PALETTE[0];
    if (State.currentInspectorFilter !== 'all') {
        const inspIdx = State.inspectors.findIndex(i => i.id === State.currentInspectorFilter);
        if (inspIdx > -1) baseColor = Config.MASTER_PALETTE[inspIdx % Config.MASTER_PALETTE.length];
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
                import('./state.js').then(st => circle.style.backgroundColor = st.hexToRgba(bgHex, 0.75)); 
                circle.style.border = `2px solid ${baseColor}`;
                ind.appendChild(circle);
            }
        }
    }
}

export function updateRouteTimes() {
    if(!State.isManagerView || State.currentInspectorFilter === 'all') return;
    const activeStops = State.stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    for(let i=0; i<3; i++) {
        const clusterStops = activeStops.filter(s => s.cluster === i);
        const count = clusterStops.length;
        let totalSecs = 0;
        clusterStops.forEach(s => totalSecs += parseFloat(s.durationSecs || 0));
        
        const hrs = count > 0 ? ((totalSecs + (count * State.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
        const timeEl = document.getElementById(`rtime-${i+1}`);
        if(timeEl) timeEl.innerText = count > 0 ? `${hrs} hrs` : '-- hrs';
    }
}

export function updateMarkerColors() {
    State.markers.forEach(m => {
        const stopData = State.stops.find(st => st.id === m._stopId);
        if (stopData) {
            import('./state.js').then(st => {
                const visualStyle = st.getVisualStyle(stopData);
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
            });
        }
    });
}

export function updateSelectionUI() { 
    document.querySelectorAll('.stop-item, .glide-row').forEach(el=>el.classList.remove('selected')); 
    State.markers.forEach(m=>{ 
        if(m._stopId) {
            m.getElement().classList.toggle('bulk-selected', State.selectedIds.has(m._stopId)); 
            if(State.selectedIds.has(m._stopId)) { const row = document.getElementById(`item-${m._stopId}`); if (row) row.classList.add('selected'); } 
        }
    }); 
    
    const has = State.selectedIds.size>0; 
    let hasRouted = false;
    
    State.selectedIds.forEach(id => {
        const s = State.stops.find(st => st.id === id);
        if (s && ((s.status || '').toLowerCase() === 'routed' || (s.status || '').toLowerCase() === 'dispatched')) hasRouted = true;
    });

    const selectAllCb = document.getElementById('bulk-select-all');
    if (selectAllCb) {
        const activeStops = State.stops.filter(s => isActiveStop(s));
        selectAllCb.checked = (activeStops.length > 0 && State.selectedIds.size === activeStops.length);
    }
    
    document.getElementById('bulk-delete-btn').style.display = (has && State.PERMISSION_MODIFY && State.isManagerView) ? 'block' : 'none'; 
    document.getElementById('bulk-unroute-btn').style.display = (hasRouted && State.PERMISSION_MODIFY) ? 'block' : 'none'; 
    
    const completeBtn = document.getElementById('bulk-complete-btn');
    if (completeBtn) completeBtn.style.display = (has && !State.isManagerView) ? 'block' : 'none'; 

    const hintEl = document.getElementById('map-hint');
    if (hintEl) hintEl.style.opacity = has ? '0' : '1';
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`move-r${i}-btn`);
        if(btn) {
            if(State.isManagerView && State.currentInspectorFilter !== 'all' && has && i <= State.currentRouteCount && State.currentRouteCount > 1) {
                let allInTargetRoute = true;
                State.selectedIds.forEach(id => {
                    const s = State.stops.find(st => st.id === id);
                    if (s && s.cluster !== (i - 1)) allInTargetRoute = false;
                });
                btn.style.display = allInTargetRoute ? 'none' : 'block';
            } else {
                btn.style.display = 'none';
            }
        }
    }
}

export function updateSummary() {
    const active = State.stops.filter(s => isActiveStop(s) && s.status !== 'Completed');
    let totalMi = 0; let totalSecs = 0;
    
    active.forEach(s => {
        const distVal = parseFloat(String(s.dist || '0').replace(/[^0-9.]/g, ''));
        if (!isNaN(distVal)) totalMi += distVal;
        totalSecs += parseFloat(s.durationSecs || 0);
    });
    
    let totalHrs = active.length > 0 ? ((totalSecs + (active.length * State.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
    
    document.getElementById('sum-dist').innerText = `${totalMi.toFixed(1)} mi`;
    document.getElementById('sum-time').innerText = `${totalHrs} hrs`;
    
    let dueToday = 0; let pastDue = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    active.forEach(s => {
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    const statTotalEl = document.getElementById('stat-total');
    const statDueEl = document.getElementById('stat-due');
    const statPastEl = document.getElementById('stat-past');

    if(statTotalEl) statTotalEl.innerText = `${active.length} Orders`;
    if(statDueEl) statDueEl.innerText = `${dueToday} Due Today`;
    if(statPastEl) statPastEl.innerText = `${pastDue} Past Due`;
}

export function updateRoutingUI() {
    const activeStops = State.stops.filter(s => isActiveStop(s));
    const routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');
    const routedCount = routedStops.length;
    const unroutedCount = activeStops.length - routedCount;
    const isDirty = State.dirtyRoutes.size > 0;

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
        sendBtn.onclick = () => import('./api.js').then(api => api.handleOpenEmailModal());
        if (routingControls) routingControls.appendChild(sendBtn);
    }

    if (!document.getElementById('btn-header-optimize-insp')) {
        const optBtn = document.createElement('button');
        optBtn.id = 'btn-header-optimize-insp';
        optBtn.className = 'header-action-btn';
        optBtn.style.cssText = 'background: #2C3D4F; color: white; display: none;';
        optBtn.innerHTML = '<span>Re-Optimize</span>';
        optBtn.onclick = () => import('./api.js').then(api => api.handleEndpointOptimize());
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

    if (State.isManagerView && State.currentInspectorFilter === 'all') {
        if(routingControls) routingControls.style.display = 'none';
        let showHint = false;
        const allValidStops = State.stops.filter(s => {
            const status = (s.status || '').toLowerCase();
            return status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        });

        for (const insp of State.inspectors) {
            if (allValidStops.filter(s => s.driverId === insp.id).length > 2) { showHint = true; break; }
        }
        if (hintEl) hintEl.style.display = (showHint && State.viewMode !== 'managermobile') ? 'block' : 'none';
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    if (State.isManagerView) {
        if (unroutedCount > 25) {
            if(routingControls) routingControls.style.display = 'flex';
        } else {
            if(routingControls) routingControls.style.display = 'none';
        }

        const activeInspStops = State.stops.filter(s => isActiveStop(s) && s.driverId === State.currentInspectorFilter && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched'));
        const isStaging = activeInspStops.some(s => s.routeState === 'Staging') || isDirty;

        if (unroutedCount > 0 && routedCount === 0) {
            if(btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = State.currentRouteCount > 1 ? "Generate Routes" : "Generate Route";
        } 
        
        if (isDirty || (State.viewMode !== 'managermobile' && isStaging)) {
            if(btnRecalc) btnRecalc.style.display = 'flex';
            if(btnStartOver) btnStartOver.style.display = 'flex';
        } else if (routedCount > 0) {
            if(btnStartOver) btnStartOver.style.display = 'flex';
        }

        if (routedCount > 0 && !isDirty && !isStaging) {
            if(btnSend) btnSend.style.display = 'flex';
        }

    } else {
        if(routingControls) routingControls.style.display = 'flex';
        let showRecalc = false; let showOpt = false; let showBadge = false;

        if (isDirty) {
            showRecalc = true; showBadge = true;
            if (State.dirtyRoutes.has('endpoints_0') || State.PERMISSION_REOPTIMIZE) showOpt = true;
        } else if (State.isAlteredRoute) {
            if(btnRestore) btnRestore.style.display = 'flex'; 
        }
        
        if(btnRecalc) btnRecalc.style.display = showRecalc ? 'flex' : 'none';
        if(optInspBtn) optInspBtn.style.display = showOpt ? 'flex' : 'none';
        if(badgeChanges) badgeChanges.style.display = showBadge ? 'flex' : 'none';

        if (!showRecalc && !showOpt && !State.isAlteredRoute) {
            if(routingControls) routingControls.style.display = 'none';
        }
    }
}

export function createRouteSubheading(clusterNum, clusterStops) {
    let totalMi = 0; let dueToday = 0; let pastDue = 0; let totalSecs = 0;
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

    let hrs = clusterStops.length > 0 ? ((totalSecs + (clusterStops.length * State.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : 0;
    let dueText = pastDue > 0 ? `<span style="color:var(--red)">${pastDue} Past Due</span>` : (dueToday > 0 ? `<span style="color:var(--orange)">${dueToday} Due Today</span>` : `0 Due`);
    
    const el = document.createElement('div');
    el.className = 'list-subheading';
    el.innerHTML = `<span>ROUTE ${clusterNum + 1}</span><span class="route-summary-text">${totalMi.toFixed(1)} mi | ${hrs} hrs | ${clusterStops.length} stops | ${dueText}</span>`;
    return el;
}

export function createEndpointRow(type, endpointData) {
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

export function render() {
    updateRoutingUI();
    const listContainer = document.getElementById('stop-list');
    listContainer.innerHTML = ''; 
    State.markers.forEach(m => m.remove()); 
    State.markers = [];
    import('./state.js').then(st => {
        const bounds = new mapboxgl.LngLatBounds();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const isSingleInspector = State.isManagerView && State.currentInspectorFilter !== 'all';
        const isAllInspectors = State.isManagerView && State.currentInspectorFilter === 'all';
        const activeStops = State.stops.filter(s => isActiveStop(s));
        const hasRouted = activeStops.some(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');

        if (State.isManagerView) {
            const header = document.createElement('div');
            header.className = 'glide-table-header';
            const sortIcon = (col) => isAllInspectors ? getSortIcon(col) : '';
            const sortClick = (col) => isAllInspectors ? `onclick="sortTable('${col}')"` : '';
            const sortClass = isAllInspectors ? 'sortable' : '';
            const appSortClass = isAllInspectors ? 'sortable' : '';
            const appSortClick = isAllInspectors ? `onclick="sortTable('app')"` : '';
            const appSortIcon = isAllInspectors ? getSortIcon('app') : '';

            header.innerHTML = `
                <div class="col-num"><input type="checkbox" id="bulk-select-all" class="grey-checkbox" onchange="toggleSelectAll(this)"></div>
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
                const dueTime = new Date(due); dueTime.setHours(0, 0, 0, 0); 
                if (dueTime < today) urgencyClass = 'past-due'; else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today'; 
            }
            const dueFmt = due ? `${due.getMonth()+1}/${due.getDate()}` : "N/A";

            const extractTime = (dateStr) => {
                if (!dateStr) return '--';
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) return d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
                const match = String(dateStr).match(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
                return match ? match[0].toUpperCase() : '--';
            };
            
            let etaTime = extractTime(s.eta);
            const statusStr = (s.status||'').toLowerCase();
            const isRoutedStop = statusStr === 'routed' || statusStr === 'completed' || statusStr === 'dispatched';
            const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
            
            if (!isRoutedStop || State.dirtyRoutes.has(routeKey) || State.dirtyRoutes.has('all')) etaTime = '--';

            if (State.isManagerView) {
                item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${State.currentDisplayMode}`;
                let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || State.driverParam || 'Unassigned'}</div>`;
                
                if (State.inspectors.length > 0) {
                    const optionsHtml = State.inspectors.map((insp, idx) => {
                        const color = Config.MASTER_PALETTE[idx % Config.MASTER_PALETTE.length];
                        return `<option value="${insp.id}" style="color: ${color}; font-weight: bold;" ${s.driverId === insp.id ? 'selected' : ''}>${insp.name}</option>`;
                    }).join('');
                    const defaultPlaceholder = !s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : '';
                    const disableSelectAttr = !State.PERMISSION_MODIFY ? 'disabled' : '';

                    let currentInspColor = 'var(--text-main)';
                    if (s.driverId) {
                        const dIdx = State.inspectors.findIndex(i => i.id === s.driverId);
                        if (dIdx > -1) currentInspColor = Config.MASTER_PALETTE[dIdx % Config.MASTER_PALETTE.length];
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
                if (State.viewMode === 'managermobile') metaHtml = `<div class="meta-text">${s.app || '--'} | ${s.client || '--'}</div>`;

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
                item.className = `stop-item ${s.status.toLowerCase().replace(' ', '-')} ${State.currentDisplayMode}`;
                const metaDisplay = (!isRoutedStop || State.dirtyRoutes.has(routeKey) || State.dirtyRoutes.has('all')) ? `-- | ${s.client || '--'}` : `${etaTime} | ${s.client || '--'}`;
                const handleHtml = State.PERMISSION_MODIFY ? `<div class="handle">☰</div>` : ``;
                
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
                if (!e.shiftKey) State.selectedIds.clear();
                State.selectedIds.has(s.id) ? State.selectedIds.delete(s.id) : State.selectedIds.add(s.id);
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
                    if (!e.shiftKey) State.selectedIds.clear();
                    State.selectedIds.has(s.id) ? State.selectedIds.delete(s.id) : State.selectedIds.add(s.id);
                    updateSelectionUI(); focusTile(s.id);
                });
                
                const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
                m._stopId = s.id; State.markers.push(m); bounds.extend([s.lng, s.lat]);
            }
            return item;
        };

        if (isSingleInspector || !State.isManagerView) {
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
                
                if (State.isManagerView) {
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
                        routedDiv.id = State.isManagerView ? `routed-list-${clusterId}` : `driver-list-${clusterId}`;
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
                } else endpointsToDraw.push({ lng, lat, driverId: dId, isStart: type === 'start', isEnd: type === 'end' });
            }
        };

        if (isAllInspectors) {
            const activeDriverIds = new Set(activeStops.map(s => s.driverId));
            State.inspectors.forEach(insp => {
                if (activeDriverIds.has(insp.id)) {
                    let sLng = insp.startLng; let sLat = insp.startLat;
                    let eLng = insp.endLng || insp.startLng; let eLat = insp.endLat || insp.startLat;
                    pushEndpoint(parseFloat(sLng), parseFloat(sLat), insp.id, 'start');
                    pushEndpoint(parseFloat(eLng), parseFloat(eLat), insp.id, 'end');
                }
            });
        } else {
            let eps = getActiveEndpoints();
            let cInsp = State.inspectors.find(i => i.id === (State.isManagerView ? State.currentInspectorFilter : State.driverParam));
            let dId = cInsp ? cInsp.id : null;
            if (eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), dId, 'start');
            if (eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), dId, 'end');
        }

        endpointsToDraw.forEach(ep => {
            let inspColor = '#ffffff';
            if (ep.driverId) {
                const dIdx = State.inspectors.findIndex(i => i.id === ep.driverId);
                if (dIdx > -1) inspColor = Config.MASTER_PALETTE[dIdx % Config.MASTER_PALETTE.length];
            } else if (State.currentInspectorFilter !== 'all') {
                const dIdx = State.inspectors.findIndex(i => i.id === State.currentInspectorFilter);
                if (dIdx > -1) inspColor = Config.MASTER_PALETTE[dIdx % Config.MASTER_PALETTE.length];
            }
            
            let emojisHtml = '';
            if (ep.isStart) emojisHtml += `<div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 16px;">🏠</div>`;
            if (ep.isEnd) emojisHtml += `<div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 16px;">🏁</div>`;
            
            const el = document.createElement('div');
            el.className = 'marker start-end-marker';
            
            el.innerHTML = `
                <div class="pin-visual" style="background-color: ${inspColor}; border: 2px solid #ffffff; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>
                ${emojisHtml}
            `;
            
            const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([ep.lng, ep.lat]).addTo(map);
            State.markers.push(m);
            bounds.extend([ep.lng, ep.lat]);
        });

        if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
            State.initialBounds = bounds; map.fitBounds(bounds, { padding: 50, maxZoom: 15 }); 
        }
        
        updateSelectionUI();
        initSortable(); 
        
        setTimeout(() => { if (map) map.resize(); }, 150);
    });
}

export function openNav(e, la, ln, addr) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { showNavChoice(la, ln, addr); } else { launchMaps(p, la, ln, addr); } }
export function showNavChoice(la, ln, addr) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; }
export function setNavPref(p, la, ln, addr) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; launchMaps(p, la, ln, addr); }
export function launchMaps(p, la, ln, addr) { 
    let destination = `${la},${ln}`;
    if (addr) {
        const parts = addr.split(',');
        const street = parts[0].trim();
        const zipMatch = addr.match(/\b\d{5}(?:-\d{4})?\b/);
        if (zipMatch) destination = encodeURIComponent(`${street}, ${zipMatch[0]}`);
        else destination = encodeURIComponent(addr);
    }
    window.location.href = p === 'google' ? `http://googleusercontent.com/maps.google.com/?daddr=${destination}` : `https://maps.apple.com/?daddr=${destination}`; 
}

export function initResizer() {
    const resizerEl = document.getElementById('resizer');
    const sidebarEl = document.getElementById('sidebar');
    const mapWrapEl = document.getElementById('map-wrapper');
    let isResizing = false;

    function startResize(e) {
        if(!State.isManagerView) return;
        isResizing = true;
        resizerEl.classList.add('active');
        document.body.style.cursor = State.viewMode === 'managermobile' ? 'row-resize' : 'col-resize';
        mapWrapEl.style.pointerEvents = 'none'; 
    }

    resizerEl.addEventListener('mousedown', startResize);
    resizerEl.addEventListener('touchstart', (e) => { startResize(e.touches[0]); }, {passive: false});

    function performResize(e) {
        if (!isResizing) return;
        let clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
        let clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
        
        if (State.viewMode === 'managermobile') {
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
}
