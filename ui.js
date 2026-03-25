/* * */
/* * Dashboard - V12.7 */
/* * FILE: ui.js */
/* * Changes: Re-integrated Testing UI panel building and window logic. */
/* * */

document.body.className = `view-${viewMode} manager-all-inspectors`;
if (viewMode === 'managermobilesplit') document.body.classList.add('split-show-map');

function updateShiftCursor(isShiftDown) {
    const wrap = document.getElementById('map-wrapper');
    if (wrap) {
        if (isShiftDown && !wrap.classList.contains('shift-down')) wrap.classList.add('shift-down');
        else if (!isShiftDown && wrap.classList.contains('shift-down')) wrap.classList.remove('shift-down');
    }
}

document.addEventListener('keydown', (e) => { 
    if (e.key === 'Shift') updateShiftCursor(true); 
    if (viewMode === 'manager' && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.getElementById('modal-overlay').style.display === 'flex') return;
        if (selectedIds.size > 0 && PERMISSION_MODIFY) triggerBulkDelete();
    }
});

document.addEventListener('keyup', (e) => { if (e.key === 'Shift') updateShiftCursor(false); });
document.addEventListener('mousemove', (e) => { updateShiftCursor(e.shiftKey); });

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

if (resizerEl) {
    resizerEl.addEventListener('mousedown', startResize);
    resizerEl.addEventListener('touchstart', (e) => { startResize(e.touches[0]); }, {passive: false});
}

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
        isResizing = false; document.body.style.cursor = ''; resizerEl.classList.remove('active'); mapWrapEl.style.pointerEvents = 'auto';
        if(map) map.resize(); 
    }
}
document.addEventListener('mouseup', stopResize);
document.addEventListener('touchend', stopResize);

function customAlert(msg) {
    return new Promise(resolve => {
        const m = document.getElementById('modal-overlay');
        const mc = document.getElementById('modal-content');
        mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none'; m.style.display = 'flex';
        mc.innerHTML = `<div style="background: var(--bg-panel, #1E293B); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: white; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><h3 style="margin-top:0;">Alert</h3><p style="font-size: 15px; margin-bottom: 20px;">${msg}</p><div style="display:flex; justify-content:flex-end;"><button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-alert-ok">OK</button></div></div>`;
        document.getElementById('modal-alert-ok').onclick = () => { m.style.display = 'none'; resolve(); };
    });
}

function customConfirm(msg) {
    return new Promise(resolve => {
        const m = document.getElementById('modal-overlay');
        const mc = document.getElementById('modal-content');
        mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none'; m.style.display = 'flex';
        mc.innerHTML = `<div style="background: var(--bg-panel, #1E293B); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: white; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><h3 style="margin-top:0;">Confirm</h3><p style="font-size: 15px; margin-bottom: 20px;">${msg}</p><div style="display:flex; gap:10px; justify-content:flex-end;"><button style="padding:10px 20px; border:none; border-radius:6px; background:#444; color:white; cursor:pointer;" id="modal-confirm-cancel">Cancel</button><button style="padding:10px 20px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold; cursor:pointer;" id="modal-confirm-ok">OK</button></div></div>`;
        document.getElementById('modal-confirm-ok').onclick = () => { m.style.display = 'none'; resolve(true); };
        document.getElementById('modal-confirm-cancel').onclick = () => { m.style.display = 'none'; resolve(false); };
    });
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
    stops.forEach(s => { if (isActiveStop(s) && s.driverId) validInspectorIds.add(String(s.driverId)); });

    if (currentInspectorFilter !== 'all' && !validInspectorIds.has(String(currentInspectorFilter))) {
        currentInspectorFilter = 'all';
        sessionStorage.setItem('sproute_inspector_filter', 'all');
        document.body.classList.add('manager-all-inspectors');
        document.body.classList.remove('manager-single-inspector');
    }

    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(String(i.id))) {
            if (i.isInspector === true || String(i.isInspector).toLowerCase() === 'true') {
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

window.handleInspectorFilterChange = function(val) {
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
    if (val !== 'all' && typeof liveClusterUpdate === 'function') liveClusterUpdate();
    updateRouteButtonColors();
    render(); 
    if (typeof drawRoute === 'function') drawRoute(); 
    if (typeof updateSummary === 'function') updateSummary(); 
    initSortable();
};

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

function updateRoutingUI() {
    const isDirty = dirtyRoutes.size > 0;
    const routingControls = document.getElementById('routing-controls');
    const hintEl = document.getElementById('inspector-select-hint');

    const btnGen = document.getElementById('btn-header-generate');
    const btnRecalc = document.getElementById('btn-header-recalc');
    const btnRestore = document.getElementById('btn-header-restore');
    const optInspBtn = document.getElementById('btn-header-optimize-insp');
    const btnSend = document.getElementById('btn-header-send-route');

    [btnGen, btnRecalc, btnRestore, optInspBtn, btnSend].forEach(btn => { if (btn) btn.style.display = 'none'; });

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
            if (allValidStops.filter(s => String(s.driverId) === String(insp.id)).length > 2) { showHint = true; break; }
        }
        if (hintEl) hintEl.style.display = (showHint && viewMode !== 'managermobile' && viewMode !== 'managermobilesplit') ? 'block' : 'none';
        return;
    }

    if (hintEl) hintEl.style.display = 'none';

    let currentState = 'Pending';
    let targetStops = isManagerView ? stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter)) : stops.filter(s => isActiveStop(s));
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

    if (isDirty && hasActiveRoutesUI) currentState = dirtyRoutes.has('endpoints_0') ? 'Staging-endpoint' : 'Staging';

    let maxCluster = -1;
    targetStops.forEach(s => { if (isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster; });

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
        if (currentRouteViewFilter === 'all') isCurrentViewDirty = true;
        else {
            let inspKey = isManagerView ? currentInspectorFilter : driverParam;
            let rKey = `${inspKey}_${currentRouteViewFilter}`;
            if (dirtyRoutes.has(rKey) || dirtyRoutes.has('endpoints_0') || dirtyRoutes.has('all')) isCurrentViewDirty = true;
        }
    }

    if (isManagerView) {
        const unroutedCount = targetStops.filter(s => !isRouteAssigned(s.status)).length;
        if (currentState === 'Pending') {
            if (unroutedCount > 0 && btnGen) btnGen.style.display = 'flex';
            const headerGenBtnText = document.getElementById('btn-header-generate-text');
            if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
        } else if (currentState === 'Ready') {
            if (btnSend && !isCurrentViewDirty) btnSend.style.display = 'flex';
        } else if (currentState === 'Staging' || currentState === 'Staging-endpoint') {
            if (isCurrentViewDirty) {
                if (btnRecalc) btnRecalc.style.display = 'flex';
                if (optInspBtn) optInspBtn.style.display = 'flex';
            }
        }
        if (routingControls) routingControls.style.display = (currentState === 'Pending' && unroutedCount > 0) ? 'flex' : 'none';
    } else {
        if(routingControls) routingControls.style.display = 'flex';
        let showRecalc = false, showOpt = false, showRestore = false;
        if (isDirty) {
            showRecalc = true;
            if (dirtyRoutes.has('endpoints_0') || PERMISSION_REOPTIMIZE) showOpt = true;
        } else if (isAlteredRoute) {
            if(btnRestore) btnRestore.style.display = 'flex'; 
            showRestore = true;
        }
        if(btnRecalc) btnRecalc.style.display = showRecalc ? 'flex' : 'none';
        if(optInspBtn) optInspBtn.style.display = showOpt ? 'flex' : 'none';
        if (!showRecalc && !showOpt && !showRestore && routingControls) routingControls.style.display = 'none';
        const sidebarBrand = document.getElementById('sidebar-brand');
        if (sidebarBrand) sidebarBrand.style.display = (showRecalc || showOpt || showRestore) ? 'flex' : 'none';
    }
}

function updateSummary() {
    const active = stops.filter(s => isStopVisible(s, true) && s.status !== 'Completed');
    let totalMi = 0; let totalSecs = 0;
    
    active.forEach(s => {
        const distVal = parseFloat(s.dist || 0);
        if (!isNaN(distVal)) totalMi += distVal;
        totalSecs += parseFloat(s.durationSecs || 0);
    });
    
    let totalHrs = active.length > 0 ? ((totalSecs + (active.length * COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
    document.getElementById('sum-dist').innerText = `${totalMi.toFixed(1)} mi`;
    document.getElementById('sum-time').innerText = `${totalHrs} hrs`;
    
    const totalOrders = active.length;
    let dueToday = 0; let pastDue = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    active.forEach(s => {
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++; else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    const statTotalEl = document.getElementById('stat-total');
    const statDueEl = document.getElementById('stat-due');
    const statPastEl = document.getElementById('stat-past');
    if(statTotalEl) statTotalEl.innerText = `${totalOrders} Orders`;
    if(statDueEl) statDueEl.innerText = `${dueToday} Due Today`;
    if(statPastEl) statPastEl.innerText = `${pastDue} Past Due`;
}

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
            if (s && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== val) hiddenIds.push(id);
        });
        hiddenIds.forEach(id => selectedIds.delete(id));
    }
    render(); if (typeof drawRoute === 'function') drawRoute(); updateSummary();
};

window.setMobileSplitView = function(viewType) {
    document.getElementById('toggle-map').classList.toggle('active', viewType === 'map');
    document.getElementById('toggle-list').classList.toggle('active', viewType === 'list');
    if (viewType === 'map') {
        document.body.classList.add('split-show-map'); document.body.classList.remove('split-show-list');
        setTimeout(() => { if(typeof map !== 'undefined') map.resize(); }, 100);
    } else {
        document.body.classList.add('split-show-list'); document.body.classList.remove('split-show-map');
    }
};

window.toggleSelectAll = function(cb) {
    selectedIds.clear();
    if (cb.checked) stops.filter(s => isStopVisible(s, true)).forEach(s => selectedIds.add(s.id));
    if (typeof updateSelectionUI === 'function') updateSelectionUI();
};

window.updateSelectionUI = function() { 
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
                    if (s && s.cluster !== (i - 1)) allInTargetRoute = false;
                });
                btn.style.display = allInTargetRoute ? 'none' : 'block';
            } else btn.style.display = 'none';
        }
    }
};

window.triggerBulkDelete = async function() { 
    if(!(await customConfirm("Delete selected orders?"))) return;
    if (typeof pushToHistory === 'function') pushToHistory(); 
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        let idsToDelete = Array.from(selectedIds);
        idsToDelete.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status)) { if (typeof markRouteDirty === 'function') markRouteDirty(s.driverId, s.cluster); }
        });

        let payload = { action: 'deleteMultipleOrders', rowIds: idsToDelete };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
        
        stops = stops.filter(s => !selectedIds.has(s.id));
        selectedIds.clear(); updateInspectorDropdown(); 
        
        if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
        render(); if (typeof drawRoute === 'function') drawRoute(); updateSummary(); 
        if (typeof updateRouteTimes === 'function') updateRouteTimes();
        if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error deleting orders. Please try again.");
    } finally { if(overlay) overlay.style.display = 'none'; }
};

window.triggerBulkUnroute = async function() { 
    if(!(await customConfirm("Remove selected orders from route?"))) return;
    if (typeof pushToHistory === 'function') pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        let updatesArray = [];
        Array.from(selectedIds).forEach(id => {
            const idx = stops.findIndex(s => String(s.id) === String(id));
            let dId = null;
            if (idx > -1) {
                dId = stops[idx].driverId;
                if (isRouteAssigned(stops[idx].status)) { if (typeof markRouteDirty === 'function') markRouteDirty(stops[idx].driverId, stops[idx].cluster); }
                stops[idx].status = 'Pending'; stops[idx].cluster = 'X'; stops[idx].manualCluster = false; stops[idx].eta = ''; stops[idx].dist = 0; stops[idx].durationSecs = 0;
                if (viewMode === 'inspector') stops[idx].hiddenInInspector = true; 
            }
            updatesArray.push({ rowId: id, driverId: dId });
        });
        
        let payload = { action: 'updateMultipleOrders', updatesList: updatesArray, sharedUpdates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' }, adminId: adminParam };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
        
        selectedIds.clear(); 
        if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
        render(); if (typeof drawRoute === 'function') drawRoute(); updateSummary(); 
        if (typeof updateRouteTimes === 'function') updateRouteTimes();
        if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error removing orders from the route. Please try again.");
    } finally { if(overlay) overlay.style.display = 'none'; }
};

window.handleInspectorChange = async function(e, rowId, selectEl) {
    e.stopPropagation(); 
    const newDriverId = selectEl.value;
    const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    
    let idsToUpdate = [rowId];
    if (selectedIds.has(rowId) && selectedIds.size > 1) {
        if (await customConfirm(`Reassign all ${selectedIds.size} selected orders to ${newDriverName}?`)) idsToUpdate = Array.from(selectedIds);
        else { render(); return; }
    }
    
    if (typeof pushToHistory === 'function') pushToHistory();
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try { 
        idsToUpdate.forEach(id => {
            const s = stops.find(st => String(st.id) === String(id));
            if (s) {
                if (isRouteAssigned(s.status)) { if (typeof markRouteDirty === 'function') markRouteDirty(s.driverId, s.cluster); }
                s.driverName = newDriverName; s.driverId = newDriverId; s.status = 'Pending'; s.routeState = 'Pending'; s.cluster = 'X'; s.manualCluster = false; s.eta = ''; s.dist = 0; s.durationSecs = 0;
                if (viewMode === 'inspector') s.hiddenInInspector = true;
            }
        });

        let payload = { action: 'updateMultipleOrders', updatesList: idsToUpdate.map(id => ({ rowId: id })), sharedUpdates: { driverName: newDriverName, driverId: newDriverId, status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X', cluster: 'X' }, adminId: adminParam };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
        
        selectedIds.clear(); updateInspectorDropdown(); 
        render(); if (typeof drawRoute === 'function') drawRoute(); updateSummary();
        if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
    } catch (err) { 
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error reassigning orders. Please try again."); 
    } finally { if(overlay) overlay.style.display = 'none'; }
};

window.sortTable = function(col) {
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
};

function getSortIcon(col) {
    if (currentSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:0.3; margin-left:4px;"></i>';
    return currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--blue);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--blue);"></i>';
}

window.setDisplayMode = function(mode) {
    currentDisplayMode = mode;
    document.getElementById('btn-detailed').classList.toggle('active', mode === 'detailed');
    document.getElementById('btn-compact').classList.toggle('active', mode === 'compact');
    document.querySelectorAll('.stop-item, .glide-row').forEach(el => {
        if (mode === 'compact') { el.classList.add('compact'); el.classList.remove('detailed'); } 
        else { el.classList.add('detailed'); el.classList.remove('compact'); }
    });
};

window.focusTile = function(id) { document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
window.filterList = function() { 
    const q = document.getElementById('search-input').value.toLowerCase(); 
    document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); 
};

window.openNav = function(e, la, ln, addr) { 
    e.stopPropagation(); let p = localStorage.getItem('navPref'); 
    if (!p) { showNavChoice(la, ln, addr); } else { launchMaps(p, la, ln, addr); } 
};
function showNavChoice(la, ln, addr) { 
    const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; 
    document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; 
}
window.setNavPref = function(p, la, ln, addr) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; launchMaps(p, la, ln, addr); };
function launchMaps(p, la, ln, addr) { 
    let safeAddr = encodeURIComponent(addr || "Destination");
    if (p === 'google') window.location.href = `comgooglemaps://?daddr=${la},${ln}+(${safeAddr})&directionsmode=driving`; 
    else window.location.href = `http://maps.apple.com/?daddr=${la},${ln}&dirflg=d`; 
}

window.initSortable = function() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
    if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

    if (!PERMISSION_MODIFY) return;

    if (isManagerView && currentInspectorFilter !== 'all') {
        const unroutedEl = document.getElementById('unrouted-list');

        document.querySelectorAll('.routed-group-container').forEach(routedEl => {
            const inst = Sortable.create(routedEl, {
                group: 'manager-routes', handle: '.handle', filter: '.static-endpoint, .list-subheading', animation: 150,
                onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); },
                onEnd: async (evt) => {
                    let isMovedToUnrouted = false;
                    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld && typeof markRouteDirty === 'function') markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]); stop.manualCluster = true;
                            if (hasActiveRoutes) { stop.status = 'Routed'; stop.routeState = 'Staging'; if (typeof markRouteDirty === 'function') markRouteDirty(dId, stop.cluster); }
                        }
                    }

                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
                        const idx = stops.findIndex(s => String(s.id) === String(stopId));
                        let dId = null;
                        if (idx > -1) {
                            dId = stops[idx].driverId; stops[idx].status = 'Pending'; stops[idx].routeState = 'Pending'; stops[idx].cluster = 'X'; stops[idx].manualCluster = false; stops[idx].eta = ''; stops[idx].dist = 0; stops[idx].durationSecs = 0;
                            if (viewMode === 'inspector') stops[idx].hiddenInInspector = true;
                        }
                        
                        const overlay = document.getElementById('processing-overlay');
                        if(overlay) overlay.style.display = 'flex';
                        try {
                            let unroutePayload = { action: 'updateOrder', rowId: stopId, driverId: dId, updates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' }, adminId: adminParam };
                            if (!isManagerView) unroutePayload.routeId = routeId;
                            await apiFetch(unroutePayload);
                        } catch (e) { console.error(e); } finally { if(overlay) overlay.style.display = 'none'; }
                    }
                    
                    if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
                    render(); if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
                    if (isMovedToUnrouted) { if (typeof drawRoute === 'function') drawRoute(); updateSummary(); if (typeof updateRouteTimes === 'function') updateRouteTimes(); }
                }
            });
            sortableInstances.push(inst);
        });
        
        if (unroutedEl) {
            sortableUnrouted = Sortable.create(unroutedEl, { group: 'manager-routes', sort: false, handle: '.handle', filter: '.list-subheading', animation: 150, onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); } });
        }
    } else if (!isManagerView) {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                delay: 200, delayOnTouchOnly: true, filter: '.static-endpoint, .list-subheading', animation: 150,
                onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); },
                onEnd: (evt) => {
                    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = stops.find(s => String(s.id) === String(stopId));
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld && typeof markRouteDirty === 'function') markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) { stop.cluster = parseInt(matchNew[2]); stop.manualCluster = true; if (hasActiveRoutes) { stop.status = 'Routed'; stop.routeState = 'Staging'; if (typeof markRouteDirty === 'function') markRouteDirty(dId, stop.cluster); } }
                    }
                    if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
                    render(); if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
    }
};

window.render = function() {
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
    
    const headerActions = document.getElementById('header-actions-wrapper');
    if (headerActions) headerActions.style.display = viewMode === 'inspector' ? 'none' : 'flex';

    const searchContainer = document.getElementById('search-container');
    if (searchContainer) searchContainer.style.display = (isManagerView && activeStops.length === 0) ? 'none' : 'flex';

    const mobileToggle = document.getElementById('mobile-view-toggle');
    if (mobileToggle) mobileToggle.style.display = viewMode === 'managermobilesplit' ? 'flex' : 'none';

    if (isManagerView) {
        const header = document.createElement('div');
        header.className = 'glide-table-header';
        header.style.position = 'sticky'; header.style.top = '0'; header.style.zIndex = '20'; header.style.marginTop = '-1px';
        
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
        
        if (viewMode === 'inspector' && s.hiddenInInspector) item.classList.add('hidden-unrouted');
        
        const due = s.dueDate ? new Date(s.dueDate) : null;
        let urgencyClass = '';
        if (due) {
            const dueTime = new Date(due); dueTime.setHours(0, 0, 0, 0); 
            if (dueTime < today) urgencyClass = 'past-due'; 
            else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today'; 
        }
        const dueFmt = due ? `${due.getMonth()+1}/${due.getDate()}` : "N/A";

        const isRoutedStop = isRouteAssigned(s.status);
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
        let etaTime = s.eta || '--';
        if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) etaTime = '--';

        if (isManagerView) {
            item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
            if (inspectors.length > 0) {
                const filteredInspectors = inspectors.filter(i => i.isInspector === true || String(i.isInspector).toLowerCase() === 'true');
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

                inspectorHtml = `<div class="col-insp" onclick="event.stopPropagation()" style="display: ${isSingleInspector ? 'none' : 'block'};"><select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" style="color: ${currentInspColor}; font-weight: bold;" ${disableSelectAttr}>${defaultPlaceholder}${optionsHtml}</select></div>`;
            }

            const style = getVisualStyle(s);
            const handleHtml = `<div class="col-handle ${showHandle ? 'handle' : ''}" style="visibility:${showHandle ? 'visible' : 'hidden'};">${showHandle ? '<i class="fa-solid fa-grip-lines"></i>' : ''}</div>`;

            let metaHtml = '';
            if (viewMode === 'managermobile' || viewMode === 'managermobilesplit') metaHtml = `<div class="meta-text">${s.app || '--'} | ${s.client || '--'}</div>`;

            item.innerHTML = `
                <div class="col-num"><div class="num-badge" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};">${displayIndex}</div></div>
                <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">${etaTime}</div>
                <div class="col-due ${urgencyClass}">${dueFmt}</div>
                ${inspectorHtml}
                <div class="col-addr"><div class="addr-text">${(s.address||'').split(',')[0]}</div>${metaHtml}<div class="type-text">${s.type || ''}</div></div>
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
                <div class="stop-content"><b>${(s.address||'').split(',')[0]}</b><div class="row-meta">${metaDisplay}</div><div class="row-details">${s.type || ''}</div></div>
                <div class="due-date-container ${urgencyClass}">${dueFmt}</div>
                <div class="stop-actions"><i class="fa-solid fa-circle-check icon-btn" style="color:var(--green)" onclick="toggleComplete(event, '${s.id}')"></i><i class="fa-solid fa-location-arrow icon-btn" style="color:var(--blue)" onclick="openNav(event, '${s.lat}','${s.lng}', '${(s.address || '').replace(/'/g, "\\'")}')"></i></div>
            `;
        }
        
        item.onclick = (e) => {
            if (!e.shiftKey) selectedIds.clear();
            selectedIds.has(s.id) ? selectedIds.delete(s.id) : selectedIds.add(s.id);
            if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
            if (typeof focusPin === 'function') focusPin(s.id);
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
                if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
                if (typeof focusTile === 'function') focusTile(s.id);
            });
            
            const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
            m._stopId = s.id; markers.push(m); bounds.extend([s.lng, s.lat]);
        }
        return item;
    };

    if (isSingleInspector || !isManagerView) {
        const unroutedStops = activeStops.filter(s => !isRouteAssigned(s.status));
        const routedStops = activeStops.filter(s => isRouteAssigned(s.status));
        let eps = null;
        if (typeof getActiveEndpoints === 'function') eps = getActiveEndpoints();
        if (eps && eps.start) listContainer.appendChild(createEndpointRow('start', eps.start));

        if (activeStops.length === 0 && isManagerView) listContainer.appendChild(createDropzone());

        if (unroutedStops.length > 0) {
            const unroutedDiv = document.createElement('div'); unroutedDiv.id = 'unrouted-list'; unroutedDiv.style.minHeight = '30px'; 
            listContainer.appendChild(unroutedDiv);
            if (isManagerView) { const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS'; unroutedDiv.appendChild(el); }
            unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1, hasRouted)); });
        }
        
        if (routedStops.length > 0) {
            const uniqueClusters = [...new Set(routedStops.map(s => s.cluster === 'X' ? 0 : (s.cluster || 0)))].sort();
            uniqueClusters.forEach(clusterId => {
                const cStops = routedStops.filter(s => (s.cluster === 'X' ? 0 : (s.cluster || 0)) === clusterId);
                if (cStops.length > 0) {
                    const routedDiv = document.createElement('div');
                    routedDiv.id = isManagerView ? `routed-list-${clusterId}` : `driver-list-${clusterId}`;
                    routedDiv.className = 'routed-group-container'; routedDiv.style.minHeight = '30px';
                    listContainer.appendChild(routedDiv);
                    routedDiv.appendChild(createRouteSubheading(clusterId, cStops)); 
                    cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1, true)); });
                }
            });
        }
        if (eps && eps.end) listContainer.appendChild(createEndpointRow('end', eps.end));
        
    } else {
        const mainDiv = document.createElement('div'); mainDiv.id = 'main-list-container'; listContainer.appendChild(mainDiv);
        if (activeStops.length === 0 && isManagerView) mainDiv.appendChild(createDropzone());
        else activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
    }

    let endpointsToDraw = [];
    const pushEndpoint = (lng, lat, dId, type) => {
        if (lng && lat) {
            let existing = endpointsToDraw.find(e => e.lng === lng && e.lat === lat && String(e.driverId) === String(dId));
            if (existing) {
                if (type === 'start') existing.isStart = true;
                if (type === 'end') existing.isEnd = true;
            } else endpointsToDraw.push({ lng, lat, driverId: dId, isStart: type === 'start', isEnd: type === 'end' });
        }
    };

    if (isAllInspectors) {
        const activeDriverIds = new Set(activeStops.map(s => String(s.driverId)));
        inspectors.forEach(insp => {
            if (activeDriverIds.has(String(insp.id))) {
                let sLng = insp.startLng; let sLat = insp.startLat; let eLng = insp.endLng || insp.startLng; let eLat = insp.endLat || insp.startLat;
                pushEndpoint(parseFloat(sLng), parseFloat(sLat), insp.id, 'start');
                pushEndpoint(parseFloat(eLng), parseFloat(eLat), insp.id, 'end');
            }
        });
    } else {
        let eps = null;
        if (typeof getActiveEndpoints === 'function') eps = getActiveEndpoints();
        let cInsp = inspectors.find(i => String(i.id) === String(isManagerView ? currentInspectorFilter : driverParam));
        let dId = cInsp ? cInsp.id : null;
        if (eps && eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), dId, 'start');
        if (eps && eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), dId, 'end');
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
        
        const el = document.createElement('div'); el.className = 'marker start-end-marker';
        el.innerHTML = `<div class="pin-visual" style="background-color: ${inspColor}; border: none; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>${emojisHtml}`;
        const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([ep.lng, ep.lat]).addTo(map);
        markers.push(m); bounds.extend([ep.lng, ep.lat]);
    });

    if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
        initialBounds = bounds; 
        map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate: !isFirstMapRender }); 
        if (isFirstMapRender) isFirstMapRender = false;
    }
    
    if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
    if (typeof initSortable === 'function') initSortable(); 
    setTimeout(() => { if (typeof map !== 'undefined') map.resize(); }, 150);
};

window.toggleComplete = async function(e, id) {
    e.stopPropagation();
    if (typeof pushToHistory === 'function') pushToHistory();
    const idx = stops.findIndex(s => String(s.id) === String(id));
    const isCurrentlyCompleted = stops[idx].status.toLowerCase() === 'completed';
    const newStatus = isCurrentlyCompleted ? (stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
    stops[idx].status = newStatus;
    render(); 
    if (typeof drawRoute === 'function') drawRoute(); 
    if (typeof updateSummary === 'function') updateSummary();
    
    try {
        let payload = { action: 'updateOrder', rowId: id, driverId: stops[idx].driverId, updates: { status: getStatusCode(newStatus) }, adminId: adminParam };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
    } catch(err) { console.error("Toggle Complete Error", err); }
};

// --- V12.7: Testing UI Injection ---
window.logToTestConsole = function(title, data) {
    if (!isTestingMode) return;
    const container = document.getElementById('test-log-container');
    if (!container) return;
    
    const entry = document.createElement('div');
    entry.style.cssText = 'background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px; overflow-x: auto; font-size: 11px;';
    
    const time = new Date().toLocaleTimeString();
    let dataStr = '';
    try { dataStr = JSON.stringify(data, null, 2); } catch(e) { dataStr = String(data); }

    entry.innerHTML = `<div style="color: #79c0ff; font-weight: bold; margin-bottom: 6px; border-bottom: 1px dashed #30363d; padding-bottom: 4px;">[${time}] ${title}</div><pre style="margin:0; color:#e6edf3;">${dataStr}</pre>`;
    container.prepend(entry);
};

function initTestingModeUI() {
    document.body.style.flexDirection = 'row'; 
    const testHeader = document.createElement('div');
    testHeader.id = 'test-mode-header';
    testHeader.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 45px; background: repeating-linear-gradient(45deg, #8b0000, #8b0000 10px, #a50000 10px, #a50000 20px); border-bottom: 2px solid #ff4d4d; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; z-index: 999999; gap: 20px; box-sizing: border-box; box-shadow: 0 4px 10px rgba(0,0,0,0.5);';
    
    const titleSpan = document.createElement('span');
    titleSpan.innerHTML = '<i class="fa-solid fa-flask"></i> TESTING MODE ACTIVE';
    titleSpan.style.textShadow = '1px 1px 2px #000';
    titleSpan.style.letterSpacing = '1px';
    
    const btnAppScript = document.createElement('button');
    btnAppScript.innerText = 'Apps Script';
    btnAppScript.style.cssText = `padding: 6px 12px; cursor: pointer; border: 2px solid #fff; border-radius: 20px; font-weight: bold; font-size: 13px; transition: 0.2s; background: ${activeTestingBackend === 'appscript' ? '#fff' : 'transparent'}; color: ${activeTestingBackend === 'appscript' ? '#8b0000' : '#fff'}; box-shadow: ${activeTestingBackend === 'appscript' ? '0 0 8px rgba(255,255,255,0.8)' : 'none'};`;
    btnAppScript.onclick = () => { sessionStorage.setItem('sproute_testing_backend', 'appscript'); location.reload(); };

    const btnFirestore = document.createElement('button');
    btnFirestore.innerText = 'Firestore';
    btnFirestore.style.cssText = `padding: 6px 12px; cursor: pointer; border: 2px solid #fff; border-radius: 20px; font-weight: bold; font-size: 13px; transition: 0.2s; background: ${activeTestingBackend === 'firestore' ? '#fff' : 'transparent'}; color: ${activeTestingBackend === 'firestore' ? '#8b0000' : '#fff'}; box-shadow: ${activeTestingBackend === 'firestore' ? '0 0 8px rgba(255,255,255,0.8)' : 'none'};`;
    btnFirestore.onclick = () => { sessionStorage.setItem('sproute_testing_backend', 'firestore'); location.reload(); };

    testHeader.appendChild(titleSpan); testHeader.appendChild(btnAppScript); testHeader.appendChild(btnFirestore);
    document.body.appendChild(testHeader);

    const adjustContainer = (id) => {
        const el = document.getElementById(id);
        if (el) { el.style.marginTop = '45px'; el.style.height = 'calc(100vh - 45px)'; }
    };

    adjustContainer('map-wrapper'); adjustContainer('sidebar'); adjustContainer('resizer');
    
    const consolePanel = document.createElement('div');
    consolePanel.id = 'test-console-panel';
    consolePanel.style.cssText = 'width: 350px; height: calc(100vh - 45px); margin-top: 45px; background: #0d1117; border-right: 2px solid #30363d; overflow-y: auto; color: #c9d1d9; font-family: "Courier New", Courier, monospace; font-size: 12px; padding: 10px; box-sizing: border-box; flex: none; display: flex; flex-direction: column; gap: 10px; z-index: 50; position: relative;';
    
    const consoleTitle = document.createElement('div');
    consoleTitle.innerHTML = '<div style="color:#58a6ff; font-size:14px; border-bottom:1px solid #30363d; padding-bottom:8px; margin-bottom:5px; font-weight:bold; display:flex; justify-content:space-between; align-items:center;"><span><i class="fa-solid fa-terminal"></i> Data Inspector</span><button onclick="document.getElementById(\'test-log-container\').innerHTML=\'\'" style="background:transparent; border:1px solid #555; color:#888; border-radius:4px; cursor:pointer; font-size:11px; padding:2px 6px;">Clear</button></div>';
    consolePanel.appendChild(consoleTitle);

    const logContainer = document.createElement('div');
    logContainer.id = 'test-log-container';
    logContainer.style.display = 'flex'; logContainer.style.flexDirection = 'column'; logContainer.style.gap = '10px';
    consolePanel.appendChild(logContainer);

    document.body.insertBefore(consolePanel, document.body.firstChild);
}

// Setup Header Dropzone Listeners
const headerDropzone = document.getElementById('header-csv-upload');
const headerInput = document.getElementById('header-file-input');
if (headerDropzone && headerInput) {
    headerDropzone.onclick = () => headerInput.click();
    headerDropzone.ondragover = (e) => { e.preventDefault(); headerDropzone.classList.add('drag-active'); };
    headerDropzone.ondragleave = (e) => { e.preventDefault(); headerDropzone.classList.remove('drag-active'); };
    headerDropzone.ondrop = (e) => { e.preventDefault(); headerDropzone.classList.remove('drag-active'); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]); };
    headerInput.onchange = (e) => { if (e.target.files && e.target.files.length > 0) { handleFileSelection(e.target.files[0]); headerInput.value = ''; } };
}

// INITIALIZATION
if (isTestingMode) initTestingModeUI();
if (typeof loadData === 'function') loadData();
