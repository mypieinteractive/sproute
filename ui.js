/* Dashboard - V15.9.12 */
/* FILE: ui.js */
/* Changes: */
/* 1. Completely scrubbed duplicated backend logic out of this file to fix the execution crash and restore button click functionality. */
/* 2. Maintained pure UI logic: layout toggling, sortable rules, dynamic resizing, and rendering execution. */

import { AppState, Config, pushToHistory, triggerFullRender, markRouteDirty, silentSaveRouteState, apiFetch, getActiveEndpoints, loadData } from './app.js';
import { isStopVisible, getVisualStyle, MASTER_PALETTE, isRouteAssigned, isTrueInspector } from './logic.js';
import { drawRouteMap, resizeMap, focusMapPin, resetMapBounds, getMapInstance, renderMapMarkers, filterMarkersMap } from './map.js';

// --- Overlays & Modals ---

export function showOverlay(title = "Processing...", subtext = "Syncing data with the server") {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) {
        const titleEl = overlay.querySelector('.loading-text');
        const subtextEl = overlay.querySelector('.loading-subtext');
        if (titleEl) titleEl.innerText = title;
        if (subtextEl) subtextEl.innerText = subtext;
        overlay.style.display = 'flex';
    }
}

export function hideOverlay() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'none';
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

export function updateUndoUI() {
    const undoBtn = document.getElementById('btn-undo-incremental');
    if (undoBtn) undoBtn.disabled = AppState.historyStack.length === 0;
}

export function updateHeaderUI() {
    if (!Config.isManagerView) return;
    const filterSelectWrap = document.getElementById('inspector-dropdown-wrapper');
    const isCompanyTier = document.body.classList.contains('tier-company');
    if (filterSelectWrap) {
        filterSelectWrap.style.display = isCompanyTier ? 'block' : 'none';
    }
}

export function updateInspectorDropdown() {
    const filterSelect = document.getElementById('inspector-filter');
    if (!filterSelect || !Config.isManagerView) return;

    const validInspectorIds = new Set();
    AppState.stops.forEach(s => {
        if (s.driverId) validInspectorIds.add(String(s.driverId));
    });

    if (AppState.currentInspectorFilter !== 'all' && !validInspectorIds.has(String(AppState.currentInspectorFilter))) {
        AppState.currentInspectorFilter = 'all';
        sessionStorage.setItem('sproute_inspector_filter', 'all');
        document.body.classList.add('manager-all-inspectors');
        document.body.classList.remove('manager-single-inspector');
    }

    let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
    AppState.inspectors.forEach((i, idx) => { 
        if (validInspectorIds.has(String(i.id)) && isTrueInspector(i.isInspector)) {
            const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
            filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
        }
    });
    
    filterSelect.innerHTML = filterHtml;
    filterSelect.value = AppState.currentInspectorFilter;
    
    if (AppState.currentInspectorFilter !== 'all') {
        const inspIdx = AppState.inspectors.findIndex(i => String(i.id) === String(AppState.currentInspectorFilter));
        if (inspIdx > -1) filterSelect.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
    } else {
        filterSelect.style.color = 'var(--text-main)';
    }
}

export function updateRouteButtonColors() {
    if (!Config.isManagerView) return;
    
    let baseColor = MASTER_PALETTE[0];
    if (AppState.currentInspectorFilter !== 'all') {
        const inspIdx = AppState.inspectors.findIndex(i => String(i.id) === String(AppState.currentInspectorFilter));
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
                circle.style.backgroundColor = bgHex; 
                circle.style.border = `2px solid ${baseColor}`;
                ind.appendChild(circle);
            }
        }
    }
}

export function updatePrioritySliderUI() {
    const priorityContainer = document.getElementById('priority-container');
    const sliderPriority = document.getElementById('slider-priority');
    if (priorityContainer && sliderPriority) {
        if (AppState.currentRouteCount === 1) {
            priorityContainer.style.opacity = '0.4';
            priorityContainer.style.pointerEvents = 'none';
            sliderPriority.disabled = true;
        } else {
            priorityContainer.style.opacity = '1';
            priorityContainer.style.pointerEvents = 'auto';
            sliderPriority.disabled = false;
        }
    }
}

export function updateRoutingUI() {
    const routingControls = document.getElementById('routing-controls');
    const routingModuleWrapper = document.getElementById('routing-module-wrapper');
    const routingModuleCore = document.getElementById('routing-module-core');
    const startOverOverlay = document.getElementById('start-over-overlay');
    const stagedActionGroup = document.getElementById('staged-action-group');
    
    const btnGen = document.getElementById('btn-header-generate');
    const btnRestore = document.getElementById('btn-header-restore');
    const btnSend = document.getElementById('btn-header-send-route');

    // 1. Hide everything initially
    [btnGen, btnRestore, btnSend, stagedActionGroup, routingModuleWrapper].forEach(el => { if (el) el.style.display = 'none'; });
    if (routingControls) routingControls.style.display = 'none';
    if (routingModuleCore) routingModuleCore.classList.remove('staging-locked');
    if (startOverOverlay) startOverOverlay.classList.remove('active');
    updatePrioritySliderUI();

    // 2. Global "All Inspectors" check (Managers only)
    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') {
        const routeToggles = document.getElementById('route-view-toggles');
        if (routeToggles) routeToggles.style.display = 'none';
        return;
    }

    // 3. Filter target stops based on view
    let targetStops = Config.isManagerView ? AppState.stops.filter(s => String(s.driverId) === String(AppState.currentInspectorFilter)) : AppState.stops;
    targetStops = targetStops.filter(s => s.status !== 'Deleted' && s.status !== 'Cancelled');

    if (targetStops.length === 0) return;

    // 4. Determine True State (Pending, Staging, Ready)
    const unroutedCount = targetStops.filter(s => !isRouteAssigned(s.status)).length;
    let isDirty = false;
    
    let inspKey = Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam;
    if (AppState.dirtyRoutes.has('all') || AppState.dirtyRoutes.has('endpoints_0')) {
        isDirty = true;
    } else {
        for (let i = 0; i <= AppState.currentRouteCount; i++) {
            if (AppState.dirtyRoutes.has(`${inspKey}_${i}`)) isDirty = true;
        }
    }

    let currentState = 'Ready';
    if (unroutedCount === targetStops.length) {
        currentState = 'Pending';
    } else if (isDirty) {
        currentState = 'Staging';
    }

    // 5. Route View Toggles Update
    let maxCluster = -1;
    targetStops.forEach(s => {
        if (isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster;
    });
    const togglesEl = document.getElementById('route-view-toggles');
    if (maxCluster > 0) {
        if (togglesEl) togglesEl.style.display = 'flex';
        if (document.getElementById('view-r1-btn')) document.getElementById('view-r1-btn').style.display = maxCluster >= 1 ? 'block' : 'none';
        if (document.getElementById('view-r2-btn')) document.getElementById('view-r2-btn').style.display = maxCluster >= 2 ? 'block' : 'none';
    } else {
        if (togglesEl) togglesEl.style.display = 'none';
        if (AppState.currentRouteViewFilter !== 'all') {
            AppState.currentRouteViewFilter = 'all';
            document.getElementById('view-rall-btn')?.classList.add('active');
            for(let i = 0; i <= 2; i++) document.getElementById(`view-r${i}-btn`)?.classList.remove('active');
        }
    }

    // 6. Enforce UI Rules based on strict state
    if (Config.isManagerView) {
        if (currentState === 'Pending') {
            if (routingControls) routingControls.style.display = 'flex';
            if (routingModuleWrapper) routingModuleWrapper.style.display = 'flex';
            if (btnGen) {
                btnGen.style.display = 'flex';
                document.getElementById('btn-header-generate-text').innerText = "Optimize";
            }
        } else if (currentState === 'Staging') {
            if (routingControls) routingControls.style.display = 'flex';
            if (routingModuleWrapper) routingModuleWrapper.style.display = 'flex';
            if (routingModuleCore) routingModuleCore.classList.add('staging-locked');
            if (startOverOverlay) startOverOverlay.classList.add('active');
            if (stagedActionGroup) stagedActionGroup.style.display = 'flex';
        } else if (currentState === 'Ready') {
            if (routingControls) routingControls.style.display = 'flex';
            if (routingModuleWrapper) routingModuleWrapper.style.display = 'flex';
            if (routingModuleCore) routingModuleCore.classList.add('staging-locked'); // Lock in Ready state
            if (startOverOverlay) startOverOverlay.classList.add('active'); // Add overlay in Ready state
            if (btnSend) btnSend.style.display = 'flex';
            if (AppState.isAlteredRoute && btnRestore) btnRestore.style.display = 'flex';
        }
    } else {
        // Inspector View (Never sees routing module core, only action buttons if applicable)
        if (currentState === 'Staging') {
            if (routingControls) routingControls.style.display = 'flex';
            if (stagedActionGroup) stagedActionGroup.style.display = 'flex';
        } else if (AppState.isAlteredRoute && currentState === 'Ready') {
            if (routingControls) routingControls.style.display = 'flex';
            if (btnRestore) btnRestore.style.display = 'flex';
        }
    }
}

export function drawRoute() {
    drawRouteMap({
        routedStops: Config.isManagerView ? AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter) && isRouteAssigned(s.status)) : AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter)),
        dirtyRoutes: AppState.dirtyRoutes,
        activeEndpoints: getActiveEndpoints(),
        isManagerView: Config.isManagerView,
        currentInspectorFilter: AppState.currentInspectorFilter,
        inspectors: AppState.inspectors,
        allStops: AppState.stops,
        currentRouteCount: AppState.currentRouteCount
    });
}

export function getSortIcon(col) {
    if (AppState.currentSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:0.3; margin-left:4px;"></i>';
    return AppState.currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--blue);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--blue);"></i>';
}

// --- Rendering Engine ---

export function render() {
    updateHeaderUI();
    
    const listContainer = document.getElementById('stop-list');
    listContainer.innerHTML = ''; 
    
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isSingleInspector = Config.isManagerView && AppState.currentInspectorFilter !== 'all';
    const isAllInspectors = Config.isManagerView && AppState.currentInspectorFilter === 'all';
    const activeStops = AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter));
    const hasRouted = activeStops.some(s => isRouteAssigned(s.status));
    
    document.body.classList.toggle('empty-state-active', Config.isManagerView && activeStops.length === 0);
    
    const addMenuWrapper = document.getElementById('add-menu-wrapper');
    if (addMenuWrapper) addMenuWrapper.style.display = Config.viewMode === 'inspector' ? 'none' : 'block';

    updateRoutingUI();

    if (Config.isManagerView) {
        const header = document.createElement('div');
        header.className = 'glide-table-header';
        header.style.position = 'sticky'; header.style.top = '0'; header.style.zIndex = '20'; header.style.marginTop = '-1px';
        
        const sortIcon = (col) => isAllInspectors ? getSortIcon(col) : '';
        const sortClass = isAllInspectors ? 'sortable' : '';
        const sortClick = (col) => isAllInspectors ? `onclick="sortTable('${col}')"` : '';

        header.innerHTML = `
            <div class="col-num"><input type="checkbox" id="bulk-select-all" class="grey-checkbox" onchange="toggleSelectAll(this)"></div>
            <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">ETA</div>
            <div class="col-due ${sortClass}" ${sortClick('dueDate')}>Due ${sortIcon('dueDate')}</div>
            
            <div class="col-addr" style="display:flex; align-items:center; flex-direction:row;">
                <div class="address-search-wrapper" style="position:relative; flex:1; display:flex; align-items:center; min-width:0;">
                    <input type="text" id="address-search-input" placeholder="ADDRESS" oninput="filterListDOM(this.value)" class="address-header-input" style="border-bottom: 1px solid var(--border-color); background: transparent;">
                    <i class="fa-solid fa-magnifying-glass search-icon" id="search-glass-icon" style="position: absolute; right: 8px; color: var(--text-muted); font-size: 12px; pointer-events: none;"></i>
                    <i class="fa-solid fa-xmark clear-search-icon" id="clear-search-icon" onclick="clearAddressSearch()" style="display:none; position: absolute; right: 8px; z-index: 5;"></i>
                    <div class="custom-tooltip">Click to search orders</div>
                </div>
                <div class="${sortClass}" ${sortClick('address')} style="margin-left:auto; padding:4px; flex-shrink:0; display:flex; align-items:center;">${sortIcon('address')}</div>
            </div>

            <div class="col-app ${sortClass}" ${sortClick('app')}>App ${sortIcon('app')}</div>
            <div class="col-client ${sortClass}" ${sortClick('client')}>Client ${sortIcon('client')}</div>
            <div class="col-insp ${sortClass}" ${sortClick('driverName')} style="display: ${isSingleInspector ? 'none' : 'block'};">Inspector ${sortIcon('driverName')}</div>
        `;
        listContainer.appendChild(header);

        const searchInput = document.getElementById('address-search-input');
        if (searchInput && window.lastAddressSearchValue) {
            searchInput.value = window.lastAddressSearchValue;
            const clearIcon = document.getElementById('clear-search-icon');
            const glassIcon = document.getElementById('search-glass-icon');
            if (clearIcon) clearIcon.style.display = window.lastAddressSearchValue ? 'block' : 'none';
            if (glassIcon) glassIcon.style.display = window.lastAddressSearchValue ? 'none' : 'block';
        }
    }

    const processStop = (s, displayIndex) => {
        const item = document.createElement('div');
        item.id = `item-${s.id}`;
        item.setAttribute('data-search', `${(s.address||'').toLowerCase()} ${(s.client||'').toLowerCase()}`);
        if (Config.viewMode === 'inspector' && s.hiddenInInspector) item.classList.add('hidden-unrouted');
        
        let urgencyClass = '';
        if (s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0); 
            if (dueTime < today) urgencyClass = 'past-due'; 
            else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today'; 
        }
        const dueFmt = s.dueDate ? `${new Date(s.dueDate).getMonth()+1}/${new Date(s.dueDate).getDate()}` : "N/A";
        const isRoutedStop = isRouteAssigned(s.status);
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
        let etaTime = (!isRoutedStop || AppState.dirtyRoutes.has(routeKey) || AppState.dirtyRoutes.has('all')) ? '--' : (s.eta || '--');

        if (Config.isManagerView) {
            item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${AppState.currentDisplayMode}`;
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || Config.driverParam || 'Unassigned'}</div>`;
            
            if (AppState.inspectors.length > 0) {
                const optionsHtml = AppState.inspectors.filter(i => isTrueInspector(i.isInspector)).map((insp) => {
                    const originalIdx = AppState.inspectors.indexOf(insp);
                    const color = MASTER_PALETTE[originalIdx % MASTER_PALETTE.length];
                    return `<option value="${insp.id}" style="color: ${color}; font-weight: bold;" ${String(s.driverId) === String(insp.id) ? 'selected' : ''}>${insp.name}</option>`;
                }).join('');
                
                let currentInspColor = 'var(--text-main)';
                if (s.driverId) {
                    const dIdx = AppState.inspectors.findIndex(i => String(i.id) === String(s.driverId));
                    if (dIdx > -1) currentInspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
                }

                inspectorHtml = `
                    <div class="col-insp" onclick="event.stopPropagation()" style="display: ${isSingleInspector ? 'none' : 'block'};">
                        <select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" style="color: ${currentInspColor}; font-weight: bold;" ${!AppState.PERMISSION_MODIFY ? 'disabled' : ''}>
                            ${!s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : ''}
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            }

            const style = getVisualStyle(s, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteCount, AppState.stops, AppState.inspectors);
            let metaHtml = (Config.viewMode === 'managermobile' || Config.viewMode === 'managermobilesplit') ? `<div class="meta-text">${s.app || '--'} | ${s.client || '--'}</div>` : '';

            item.innerHTML = `
                <div class="col-num"><div class="num-badge" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};">${displayIndex}</div></div>
                <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">${etaTime}</div>
                <div class="col-due ${urgencyClass}">${dueFmt}</div>
                <div class="col-addr">
                    <div class="addr-text">${(s.address||'').split(',')[0]}</div>
                    ${metaHtml}
                    <div class="type-text">${s.type || ''}</div>
                </div>
                <div class="col-app">${s.app || '--'}</div>
                <div class="col-client">${s.client || '--'}</div>
                ${inspectorHtml}
            `;
        } else {
            item.className = `stop-item ${s.status.toLowerCase().replace(' ', '-')} ${AppState.currentDisplayMode}`;
            const distFmt = s.dist ? parseFloat(s.dist).toFixed(1) : "0.0";
            const metaDisplay = (!isRoutedStop || AppState.dirtyRoutes.has(routeKey) || AppState.dirtyRoutes.has('all')) ? `-- | ${distFmt} mi` : `${etaTime} | ${distFmt} mi`;
            
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
            if (!e.shiftKey) AppState.selectedIds.clear();
            AppState.selectedIds.has(s.id) ? AppState.selectedIds.delete(s.id) : AppState.selectedIds.add(s.id);
            updateSelectionUI(); document.getElementById(`item-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        return item;
    };

    if (isSingleInspector || !Config.isManagerView) {
        const unroutedStops = activeStops.filter(s => !isRouteAssigned(s.status));
        const routedStops = activeStops.filter(s => isRouteAssigned(s.status));
        let eps = getActiveEndpoints();

        listContainer.appendChild(createEndpointRow('start', eps.start));

        if (unroutedStops.length > 0) {
            const unroutedDiv = document.createElement('div');
            unroutedDiv.id = 'unrouted-list'; unroutedDiv.style.minHeight = '30px'; 
            listContainer.appendChild(unroutedDiv);
            if (Config.isManagerView) {
                const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS';
                unroutedDiv.appendChild(el); 
            }
            unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1)); });
        }
        
        if (routedStops.length > 0) {
            const uniqueClusters = [...new Set(routedStops.map(s => s.cluster === 'X' ? 0 : (s.cluster || 0)))].sort();
            uniqueClusters.forEach(clusterId => {
                const cStops = routedStops.filter(s => (s.cluster === 'X' ? 0 : (s.cluster || 0)) === clusterId);
                if (cStops.length > 0) {
                    const routedDiv = document.createElement('div');
                    routedDiv.id = Config.isManagerView ? `routed-list-${clusterId}` : `driver-list-${clusterId}`;
                    routedDiv.className = 'routed-group-container'; routedDiv.style.minHeight = '30px';
                    listContainer.appendChild(routedDiv);
                    routedDiv.appendChild(createRouteSubheading(clusterId, cStops)); 
                    cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1)); });
                }
            });
        }
        listContainer.appendChild(createEndpointRow('end', eps.end));
    } else {
        const mainDiv = document.createElement('div');
        mainDiv.id = 'main-list-container';
        listContainer.appendChild(mainDiv);
        if (activeStops.length > 0) activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1)));
    }

    setTimeout(() => { 
        const map = getMapInstance();
        if (map) map.resize();

        renderMapMarkers({
            activeStops, 
            endpointsToDraw: buildEndpointsToDraw(activeStops),
            isManagerView: Config.isManagerView, 
            currentInspectorFilter: AppState.currentInspectorFilter,
            currentRouteCount: AppState.currentRouteCount, 
            allStops: AppState.stops, 
            inspectors: AppState.inspectors,
            onMarkerClick: (id, isShift) => {
                if (!isShift) AppState.selectedIds.clear();
                AppState.selectedIds.has(id) ? AppState.selectedIds.delete(id) : AppState.selectedIds.add(id);
                updateSelectionUI();
                document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        updateSelectionUI();
        
        if (window.lastAddressSearchValue) { window.filterListDOM(window.lastAddressSearchValue); }

        resizeMap(); 
        
        const hlZone = document.getElementById('header-list-zone');
        const sidebar = document.getElementById('sidebar');
        if (hlZone && sidebar) {
            hlZone.style.width = sidebar.offsetWidth + 'px';
        }
    }, 20); 
}

function buildEndpointsToDraw(activeStops) {
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

    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') {
        const activeDriverIds = new Set(activeStops.map(s => String(s.driverId)));
        AppState.inspectors.forEach(insp => {
            if (activeDriverIds.has(String(insp.id))) {
                pushEndpoint(parseFloat(insp.startLng), parseFloat(insp.startLat), insp.id, 'start');
                pushEndpoint(parseFloat(insp.endLng || insp.startLng), parseFloat(insp.endLat || insp.startLat), insp.id, 'end');
            }
        });
    } else {
        let eps = getActiveEndpoints();
        let cInsp = AppState.inspectors.find(i => String(i.id) === String(Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam));
        if (eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), cInsp?.id, 'start');
        if (eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), cInsp?.id, 'end');
    }
    return endpointsToDraw;
}

export function updateSummary() {
    const active = AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter) && s.status !== 'Completed');

    let totalMi = 0, totalSecs = 0, dueToday = 0, pastDue = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    active.forEach(s => {
        const distVal = parseFloat(s.dist || 0);
        if (!isNaN(distVal)) totalMi += distVal;
        totalSecs += parseFloat(s.durationSecs || 0);
        
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });
    
    let totalHrs = active.length > 0 ? ((totalSecs + (active.length * AppState.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
    
    if (document.getElementById('sum-dist')) document.getElementById('sum-dist').innerText = `${totalMi.toFixed(1)} mi`;
    if (document.getElementById('sum-time')) document.getElementById('sum-time').innerText = `${totalHrs} hrs`;
    if (document.getElementById('stat-total')) document.getElementById('stat-total').innerText = `${active.length} Orders`;
    if (document.getElementById('stat-due')) document.getElementById('stat-due').innerText = `${dueToday} Due Today`;
    if (document.getElementById('stat-past')) document.getElementById('stat-past').innerText = `${pastDue} Past Due`;
}

export function updateRouteTimes() {
    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') return;
    const activeStops = AppState.stops.filter(s => isStopVisible(s, false, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter) && s.lng && s.lat);
    for(let i=0; i<3; i++) {
        const clusterStops = activeStops.filter(s => s.cluster === i);
        let totalSecs = 0;
        clusterStops.forEach(s => totalSecs += parseFloat(s.durationSecs || 0));
        const hrs = clusterStops.length > 0 ? ((totalSecs + (clusterStops.length * AppState.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : '--';
        if(document.getElementById(`rtime-${i+1}`)) document.getElementById(`rtime-${i+1}`).innerText = clusterStops.length > 0 ? `${hrs} hrs` : '-- hrs';
    }
}

export function createRouteSubheading(clusterNum, clusterStops) {
    let totalMi = 0, dueToday = 0, pastDue = 0, totalSecs = 0;
    const today = new Date(); today.setHours(0,0,0,0);

    clusterStops.forEach(s => {
        if (!isNaN(parseFloat(s.dist || 0))) totalMi += parseFloat(s.dist);
        totalSecs += parseFloat(s.durationSecs || 0);
        if(s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
            if(dueTime < today) pastDue++;
            else if(dueTime.getTime() === today.getTime()) dueToday++;
        }
    });

    let hrs = clusterStops.length > 0 ? ((totalSecs + (clusterStops.length * AppState.COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : 0;
    let dueText = pastDue > 0 ? `<span style="color:var(--red)">${pastDue} Past Due</span>` : (dueToday > 0 ? `<span style="color:var(--orange)">${dueToday} Due Today</span>` : `0 Due`);
    
    const el = document.createElement('div');
    el.className = 'list-subheading';
    el.innerHTML = `<span>ROUTE ${clusterNum + 1}</span><span class="route-summary-text">${totalMi.toFixed(1)} mi | ${hrs} hrs | ${clusterStops.length} stops | ${dueText}</span>`;
    return el;
}

export function createEndpointRow(type, endpointData) {
    const displayAddr = endpointData && endpointData.address ? endpointData.address : '';
    const placeholder = type === 'start' ? 'Search Start Address...' : 'Search End Address...';
    const icon = type === 'start' ? '<i class="fa-solid fa-location-dot"></i>' : '<i class="fa-solid fa-flag-checkered"></i>';
    const labelText = type === 'start' ? 'START' : 'END';
    
    const el = document.createElement('div');
    el.className = 'stop-item static-endpoint';
    
    el.innerHTML = `
        <div class="col-num" style="display:flex; justify-content:center; align-items:center; color:var(--text-muted); font-size:16px;">
            ${icon}
        </div>
        <div class="col-eta" style="color:var(--text-muted); font-weight:bold; display:${Config.isManagerView && AppState.currentInspectorFilter === 'all' ? 'none' : 'flex'}; justify-content:center; align-items:center; text-align:center;">
            ${labelText}
        </div>
        <div class="col-due"></div>
        <div class="col-addr" style="display:flex; align-items:center; padding-left:8px; padding-right:6px; flex:1 1 auto; min-width:0;">
            <div style="position:relative; width:100%; display:flex; align-items:center;">
                <input type="text" id="input-endpoint-${type}" class="endpoint-input" style="background:transparent;" value="${displayAddr}" placeholder="${placeholder}" onfocus="this.select()" onmouseup="return false;" oninput="handleEndpointInput(event, '${type}')" onkeydown="handleEndpointKeyDown(event, '${type}')" onblur="handleEndpointBlur('${type}', this)">
            </div>
        </div>
        <div class="col-app"></div>
        <div class="col-client"></div>
        <div class="col-insp" style="display:${Config.isManagerView && AppState.currentInspectorFilter !== 'all' ? 'none' : 'flex'};"></div>
    `;
    return el;
}

export function updateSelectionUI() { 
    document.querySelectorAll('.stop-item, .glide-row').forEach(el=>el.classList.remove('selected')); 
    AppState.selectedIds.forEach(id => {
        const row = document.getElementById(`item-${id}`); 
        if (row) row.classList.add('selected');
    });

    const has = AppState.selectedIds.size > 0; 
    let hasRouted = false;
    AppState.selectedIds.forEach(id => {
        const s = AppState.stops.find(st => String(st.id) === String(id));
        if (s && isRouteAssigned(s.status)) hasRouted = true;
    });

    const selectAllCb = document.getElementById('bulk-select-all');
    if (selectAllCb) {
        const activeStops = AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter));
        selectAllCb.checked = (activeStops.length > 0 && AppState.selectedIds.size === activeStops.length);
    }
    
    if (document.getElementById('bulk-delete-btn')) document.getElementById('bulk-delete-btn').style.display = (has && AppState.PERMISSION_MODIFY && Config.isManagerView) ? 'block' : 'none'; 
    if (document.getElementById('bulk-unroute-btn')) document.getElementById('bulk-unroute-btn').style.display = (hasRouted && AppState.PERMISSION_MODIFY) ? 'block' : 'none'; 

    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`move-r${i}-btn`);
        if(btn) {
            if(Config.isManagerView && AppState.currentInspectorFilter !== 'all' && has && i <= AppState.currentRouteCount && AppState.currentRouteCount > 1) {
                let allInTargetRoute = true;
                AppState.selectedIds.forEach(id => {
                    const s = AppState.stops.find(st => String(st.id) === String(id));
                    if (s && s.cluster !== (i - 1)) allInTargetRoute = false;
                });
                btn.style.display = allInTargetRoute ? 'none' : 'block';
            } else {
                btn.style.display = 'none';
            }
        }
    }
}

// --- SortableJS Integration ---

let sortableInstances = [];
let sortableUnrouted = null;

export function initSortable() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
    if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

    if (!AppState.PERMISSION_MODIFY) return;

    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') {
        return; 
    } else if (Config.isManagerView && AppState.currentInspectorFilter !== 'all') {
        const unroutedEl = document.getElementById('unrouted-list');

        document.querySelectorAll('.routed-group-container').forEach(routedEl => {
            const inst = Sortable.create(routedEl, {
                group: 'manager-routes', delay: 200, delayOnTouchOnly: false, filter: '.static-endpoint, .list-subheading', animation: 150,
                onStart: () => pushToHistory(),
                onEnd: async (evt) => {
                    const hasActiveRoutes = AppState.stops.some(st => isRouteAssigned(st.status));
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = AppState.stops.find(s => String(s.id) === String(stopId));
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            stop.manualCluster = true;
                            if (hasActiveRoutes) {
                                stop.status = 'Routed'; stop.routeState = 'Staging';
                                markRouteDirty(dId, stop.cluster);
                            }
                        }
                    }

                    if (evt.to.id === 'unrouted-list') {
                        const idx = AppState.stops.findIndex(s => String(s.id) === String(stopId));
                        let dId = null;
                        if (idx > -1) {
                            dId = AppState.stops[idx].driverId;
                            AppState.stops[idx].status = 'Pending'; AppState.stops[idx].routeState = 'Pending';
                            AppState.stops[idx].cluster = 'X'; AppState.stops[idx].manualCluster = false;
                            AppState.stops[idx].eta = ''; AppState.stops[idx].dist = 0; AppState.stops[idx].durationSecs = 0;
                            if (Config.viewMode === 'inspector') AppState.stops[idx].hiddenInInspector = true;
                        }
                        
                        showOverlay();
                        try {
                            let unroutePayload = { 
                                action: 'updateOrder', rowId: stopId, driverId: dId, 
                                updates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' }, adminId: Config.adminParam
                            };
                            if (!Config.isManagerView) unroutePayload.routeId = Config.routeId;
                            await apiFetch(unroutePayload);
                        } catch (e) { console.error(e); }
                        finally { hideOverlay(); }
                    }
                    
                    reorderStopsFromDOM(); triggerFullRender(); updateRouteTimes(); silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
        
        if (unroutedEl) {
            sortableUnrouted = Sortable.create(unroutedEl, {
                group: 'manager-routes', sort: false, delay: 200, delayOnTouchOnly: false, filter: '.list-subheading', animation: 150, onStart: () => pushToHistory()
            });
        }
    } else if (!Config.isManagerView) {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                delay: 200, delayOnTouchOnly: false, filter: '.static-endpoint, .list-subheading', animation: 150, onStart: () => pushToHistory(),
                onEnd: (evt) => {
                    const hasActiveRoutes = AppState.stops.some(st => isRouteAssigned(st.status));
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = AppState.stops.find(s => String(s.id) === String(stopId));
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]); stop.manualCluster = true;
                            if (hasActiveRoutes) { stop.status = 'Routed'; stop.routeState = 'Staging'; markRouteDirty(dId, stop.cluster); }
                        }
                    }
                    reorderStopsFromDOM(); triggerFullRender(); updateRouteTimes(); silentSaveRouteState();
                }
            });
            sortableInstances.push(inst);
        });
    }
}

export function reorderStopsFromDOM() {
    let unroutedIds = []; let routedIds = [];
    if (document.getElementById('unrouted-list')) unroutedIds = Array.from(document.getElementById('unrouted-list').children).map(el => el.id.replace('item-', '')).filter(Boolean);
    document.querySelectorAll('.routed-group-container').forEach(cont => {
        const rIds = Array.from(cont.children).map(el => el.id.replace('item-', '')).filter(Boolean);
        routedIds = routedIds.concat(rIds);
    });
    if (unroutedIds.length === 0 && routedIds.length === 0 && document.getElementById('main-list-container')) {
        routedIds = Array.from(document.getElementById('main-list-container').children).map(el => el.id.replace('item-', '')).filter(Boolean);
    }
    const visibleIds = new Set([...unroutedIds, ...routedIds]);
    const otherStops = AppState.stops.filter(s => !visibleIds.has(s.id));
    const newUnrouted = unroutedIds.map(id => AppState.stops.find(s => String(s.id) === String(id))).filter(Boolean);
    const newRouted = routedIds.map(id => AppState.stops.find(s => String(s.id) === String(id))).filter(Boolean);
    AppState.stops = [...otherStops, ...newUnrouted, ...newRouted];
}

// --- UI Utilities Bound to Window ---

window.setDisplayMode = function(mode) {
    AppState.currentDisplayMode = mode;
    document.querySelectorAll('.stop-item:not(.static-endpoint), .glide-row').forEach(el => { el.classList.remove('compact', 'detailed'); el.classList.add(mode); });
};

window.setRouteViewFilter = function(val) {
    AppState.currentRouteViewFilter = val;
    document.getElementById('view-rall-btn')?.classList.toggle('active', val === 'all');
    for(let i=0; i<=2; i++) document.getElementById(`view-r${i}-btn`)?.classList.toggle('active', val === i);
    if (val !== 'all') {
        const hiddenIds = [];
        AppState.selectedIds.forEach(id => {
            const s = AppState.stops.find(st => String(st.id) === String(id));
            if (s && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== val) hiddenIds.push(id);
        });
        hiddenIds.forEach(id => AppState.selectedIds.delete(id));
    }
    triggerFullRender();
};

window.handleInspectorFilterChange = function(val) {
    AppState.currentInspectorFilter = val; sessionStorage.setItem('sproute_inspector_filter', val);
    document.body.classList.toggle('manager-all-inspectors', val === 'all'); document.body.classList.toggle('manager-single-inspector', val !== 'all');
    AppState.selectedIds.clear(); AppState.currentRouteViewFilter = 'all';
    document.getElementById('view-rall-btn')?.classList.add('active');
    for(let i=0; i<=2; i++) document.getElementById(`view-r${i}-btn`)?.classList.remove('active');
    updateInspectorDropdown(); 
    updateRouteButtonColors(); triggerFullRender();
};

window.toggleSelectAll = function(cb) {
    AppState.selectedIds.clear();
    if (cb.checked) AppState.stops.filter(s => isStopVisible(s, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter)).forEach(s => AppState.selectedIds.add(s.id));
    updateSelectionUI();
};

window.handleInspectorChange = async function(e, rowId, selectEl) {
    e.stopPropagation(); 
    const newDriverId = selectEl.value; const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    let idsToUpdate = [rowId];
    if (AppState.selectedIds.has(rowId) && AppState.selectedIds.size > 1) {
        if (await customConfirm(`Reassign all ${AppState.selectedIds.size} selected orders to ${newDriverName}?`)) idsToUpdate = Array.from(AppState.selectedIds); else return;
    }
    pushToHistory(); showOverlay();
    try { 
        idsToUpdate.forEach(id => {
            const s = AppState.stops.find(st => String(st.id) === String(id));
            if (s) {
                if (isRouteAssigned(s.status)) markRouteDirty(s.driverId, s.cluster); 
                s.driverName = newDriverName; s.driverId = newDriverId; s.status = 'Pending'; s.routeState = 'Pending'; s.cluster = 'X'; s.manualCluster = false; s.eta = ''; s.dist = 0; s.durationSecs = 0;
            }
        });
        let payload = { action: 'updateMultipleOrders', updatesList: idsToUpdate.map(id => ({ rowId: id })), sharedUpdates: { driverName: newDriverName, driverId: newDriverId, status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X', cluster: 'X' }, adminId: Config.adminParam };
        if (!Config.isManagerView) payload.routeId = Config.routeId;
        await apiFetch(payload); AppState.selectedIds.clear(); updateInspectorDropdown(); triggerFullRender(); silentSaveRouteState();
    } catch (err) { hideOverlay(); await customAlert("Error reassigning orders. Please try again."); } 
    finally { hideOverlay(); }
};

window.openNav = function(e, la, ln, addr) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; } else { window.launchMaps(p, la, ln, addr); } };
window.setNavPref = function(p, la, ln, addr) { localStorage.setItem('navPref', p); document.getElementById('modal-overlay').style.display = 'none'; window.launchMaps(p, la, ln, addr); };
window.launchMaps = function(p, la, ln, addr) { let safeAddr = encodeURIComponent(addr || "Destination"); if (p === 'google') window.location.href = `comgooglemaps://?daddr=${la},${ln}+(${safeAddr})&directionsmode=driving`; else window.location.href = `http://maps.apple.com/?daddr=${la},${ln}&dirflg=d`; };

window.handleEndpointInput = handleEndpointInput;
window.handleEndpointKeyDown = function(e, type) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
window.handleEndpointBlur = function(type, inputEl) { setTimeout(() => { document.getElementById(`autocomplete-${type}`)?.remove(); }, 200); };
window.showAddOrderModal = showAddOrderModal;
window.handleOpenEmailModal = handleOpenEmailModal;
window.resetMapView = resetMapBounds;

window.filterListDOM = function(val) {
    window.lastAddressSearchValue = val; 
    const q = val.toLowerCase();
    document.querySelectorAll('.stop-item, .glide-row').forEach(el => {
        const searchAttr = el.getAttribute('data-search') || '';
        el.style.display = searchAttr.includes(q) ? 'flex' : 'none';
    });
    const clearIcon = document.getElementById('clear-search-icon');
    const glassIcon = document.getElementById('search-glass-icon');
    if(clearIcon) clearIcon.style.display = q ? 'block' : 'none';
    if(glassIcon) glassIcon.style.display = q ? 'none' : 'block';
    filterMarkersMap(q);
};

window.clearAddressSearch = function() {
    window.lastAddressSearchValue = '';
    const inp = document.getElementById('address-search-input');
    if(inp) inp.value = '';
    window.filterListDOM('');
};

// --- Drag & Drop Initialization ---
const mainDropzone = document.getElementById('main-dropzone'); 
const mainInput = document.getElementById('main-file-input');
const hiddenFileInput = document.getElementById('hidden-global-file-input');

function handleFileSelection(file) {
    if (AppState.inspectors.length === 0 || AppState.availableCsvTypes.length === 0) { customAlert("Before you can upload your first CSV file, you need to set up your Inspector and CSV Column Matching Settings."); return; }
    if (file.name.toLowerCase().endsWith('.csv')) showUploadModal(file); else customAlert("Please upload a valid CSV file.");
}

if (mainDropzone && mainInput) {
    mainDropzone.onclick = () => mainInput.click();
    mainDropzone.ondragover = (e) => { e.preventDefault(); mainDropzone.style.borderColor = 'var(--blue)'; mainDropzone.style.backgroundColor = 'var(--bg-hover)'; };
    mainDropzone.ondragleave = (e) => { e.preventDefault(); mainDropzone.style.borderColor = 'var(--border-color)'; mainDropzone.style.backgroundColor = 'transparent'; };
    mainDropzone.ondrop = (e) => { e.preventDefault(); mainDropzone.style.borderColor = 'var(--border-color)'; mainDropzone.style.backgroundColor = 'transparent'; if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]); };
    mainInput.onchange = (e) => { if (e.target.files && e.target.files.length > 0) { handleFileSelection(e.target.files[0]); mainInput.value = ''; } };
}

if (hiddenFileInput) {
    hiddenFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
            hiddenFileInput.value = '';
        }
    });
}

let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) document.body.classList.add('drag-override-empty');
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) document.body.classList.remove('drag-override-empty');
});

document.addEventListener('dragover', (e) => { e.preventDefault(); });

document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('drag-override-empty');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]);
});

// --- Resizer Logic ---
const resizerEl = document.getElementById('resizer'); const sidebarEl = document.getElementById('sidebar'); const mapWrapEl = document.getElementById('map-wrapper');
let isResizing = false;
function startResize(e) { if(!Config.isManagerView) return; isResizing = true; resizerEl.classList.add('active'); document.body.style.cursor = Config.viewMode === 'managermobile' ? 'row-resize' : 'col-resize'; mapWrapEl.style.pointerEvents = 'none'; }
resizerEl.addEventListener('mousedown', startResize); resizerEl.addEventListener('touchstart', (e) => { startResize(e.touches[0]); }, {passive: false});

function performResize(e) {
    if (!isResizing) return;
    let clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0); let clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    if (Config.viewMode === 'managermobile') {
        let newHeight = window.innerHeight - clientY; if (newHeight < 200) newHeight = 200; if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
        sidebarEl.style.height = newHeight + 'px'; sidebarEl.style.flex = 'none'; mapWrapEl.style.height = (window.innerHeight - newHeight - resizerEl.offsetHeight) + 'px'; mapWrapEl.style.flex = 'none';
    } else {
        let newWidth = window.innerWidth - clientX; if (newWidth < 300) newWidth = 300; if (newWidth > window.innerWidth - 300) newWidth = window.innerWidth - 300;
        sidebarEl.style.width = newWidth + 'px';
        
        // Ensure the List Zone in the global header precisely mirrors the sidebar width
        const hlZone = document.getElementById('header-list-zone');
        if (hlZone) hlZone.style.width = newWidth + 'px';
    }
}

document.addEventListener('mousemove', performResize); document.addEventListener('touchmove', performResize, {passive: false});
function stopResize() { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizerEl.classList.remove('active'); mapWrapEl.style.pointerEvents = 'auto'; resizeMap(); } }
document.addEventListener('mouseup', stopResize); document.addEventListener('touchend', stopResize);
