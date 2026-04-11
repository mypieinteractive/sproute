/* Dashboard - V18.15 */
/* FILE: ui.js */
/* Changes: */
/* 1. Appended `margin: auto;` to all modal injection HTML wrappers to guarantee exact centering inside absolute overlays. */
/* 2. Modified `updateSummary` to hide #global-summary-stats ONLY when there are absolutely 0 orders loaded in the system, leaving the right-aligned [+ Add] button visible naturally. */

import { AppState, Config, pushToHistory, triggerFullRender, markRouteDirty, silentSaveRouteState, apiFetch, getActiveEndpoints, loadData } from './app.js';
import { isStopVisible, getVisualStyle, MASTER_PALETTE, isRouteAssigned, isTrueInspector } from './logic.js';
import { drawRouteMap, resizeMap, focusMapPin, resetMapBounds, getMapInstance, renderMapMarkers, filterMarkersMap, updateMapSelectionStyles } from './map.js';

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
            <div style="background: var(--bg-panel); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: var(--text-main); text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;">
                <h3 style="margin-top:0; font-weight: 400;">Alert</h3>
                <p style="font-size: 15px; margin-bottom: 20px; font-weight: 400;">${msg}</p>
                <div style="display:flex; justify-content:flex-end;">
                    <button class="modal-primary-btn" id="modal-alert-ok">OK</button>
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
            <div style="background: var(--bg-panel); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: var(--text-main); text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;">
                <h3 style="margin-top:0; font-weight: 400;">Confirm</h3>
                <p style="font-size: 15px; margin-bottom: 20px; font-weight: 400;">${msg}</p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button style="padding:10px 20px; border: 1px solid var(--border-color); border-radius:6px; background:var(--bg-hover); color:var(--text-main); cursor:pointer; font-weight: 400;" id="modal-confirm-cancel">Cancel</button>
                    <button class="modal-primary-btn" id="modal-confirm-ok">OK</button>
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
            filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: 400;">${i.name}</option>`; 
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
    const paramContainer = document.getElementById('parameters-container');
    const actionBtns = document.getElementById('routing-action-buttons');
    
    const btnPending = document.getElementById('action-group-pending');
    const btnStaging = document.getElementById('action-group-staging');
    const btnReady = document.getElementById('action-group-ready');

    if(routingControls) routingControls.style.display = 'none';
    if(paramContainer) paramContainer.style.display = 'none';
    if(btnPending) btnPending.style.display = 'none';
    if(btnStaging) btnStaging.style.display = 'none';
    if(btnReady) btnReady.style.display = 'none';
    if(actionBtns) actionBtns.style.borderLeft = 'none';
    
    updatePrioritySliderUI();

    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') {
        const routeToggles = document.getElementById('route-view-toggles');
        if (routeToggles) routeToggles.style.display = 'none';
        AppState.currentRoutingState = 'Ready'; 
        return;
    }

    let targetStops = Config.isManagerView ? AppState.stops.filter(s => String(s.driverId) === String(AppState.currentInspectorFilter)) : AppState.stops;
    targetStops = targetStops.filter(s => s.status !== 'Deleted' && s.status !== 'Cancelled');

    if (targetStops.length === 0) {
        AppState.currentRoutingState = 'Pending';
        return;
    }

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
    
    AppState.currentRoutingState = currentState;

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

    const sendBtnText = document.getElementById('btn-header-send-route-text');
    if (sendBtnText) sendBtnText.innerText = AppState.currentRouteCount > 1 ? "Send Routes" : "Send Route";

    if (Config.isManagerView) {
        if (routingControls) routingControls.style.display = 'flex';
        if (currentState === 'Pending') {
            if (paramContainer) paramContainer.style.display = 'flex';
            if (actionBtns) { actionBtns.style.width = '140px'; actionBtns.style.borderLeft = 'none'; }
            if (btnPending) btnPending.style.display = 'flex';
        } else if (currentState === 'Staging') {
            if (actionBtns) actionBtns.style.width = '100%';
            if (btnStaging) btnStaging.style.display = 'flex';
        } else if (currentState === 'Ready') {
            if (actionBtns) actionBtns.style.width = '100%';
            if (btnReady) btnReady.style.display = 'flex';
            const restoreBtn = document.getElementById('btn-header-restore');
            if (restoreBtn) restoreBtn.style.display = AppState.isAlteredRoute ? 'flex' : 'none';
        }
    } else {
        if (currentState === 'Staging') {
            if (routingControls) routingControls.style.display = 'flex';
            if (actionBtns) actionBtns.style.width = '100%';
            if (btnStaging) btnStaging.style.display = 'flex';
        } else if (AppState.isAlteredRoute && currentState === 'Ready') {
            if (routingControls) routingControls.style.display = 'flex';
            if (actionBtns) actionBtns.style.width = '100%';
            if (btnReady) btnReady.style.display = 'flex';
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
    return AppState.currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--accent);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--accent);"></i>';
}

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
        
        const sortIcon = (col) => isAllInspectors ? getSortIcon(col) : '';
        const sortClass = isAllInspectors ? 'sortable' : '';
        const sortClick = (col) => isAllInspectors ? `onclick="sortTable('${col}')"` : '';

        header.innerHTML = `
            <div class="col-num"><input type="checkbox" id="bulk-select-all" class="grey-checkbox" onchange="toggleSelectAll(this)"></div>
            <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">ETA</div>
            <div class="col-due ${sortClass}" ${sortClick('dueDate')}>Due ${sortIcon('dueDate')}</div>
            
            <div class="col-addr" style="display:flex; align-items:center; flex-direction:row; padding-left:8px; padding-right:6px; flex:1 1 auto; min-width:0;">
                <div class="address-search-wrapper" style="position:relative; flex: 1; display:flex; align-items:center; height:30px;">
                    <input type="text" id="address-search-input" placeholder="ADDRESS" oninput="filterListDOM(this.value)" class="address-header-input">
                    <i class="fa-solid fa-magnifying-glass search-icon" id="search-glass-icon" style="position: absolute; right: 8px; color: var(--row-text-muted); font-size: 12px; pointer-events: none;"></i>
                    <i class="fa-solid fa-xmark clear-search-icon" id="clear-search-icon" onclick="clearAddressSearch()" style="display:none; position: absolute; right: 8px; z-index: 5;"></i>
                    <div class="custom-tooltip">Click to search orders</div>
                </div>
                <div class="${sortClass}" ${sortClick('address')} style="margin-left:auto; padding:4px; flex-shrink:0; display:flex; align-items:center; width: 20px; justify-content: center;">${sortIcon('address')}</div>
            </div>

            <div class="col-app ${sortClass}" ${sortClick('app')}>App ${sortIcon('app')}</div>
            <div class="col-client ${sortClass}" ${sortClick('client')}>Client ${sortIcon('client')}</div>
            <div class="col-insp ${sortClass}" ${sortClick('driverName')} style="display: ${isSingleInspector ? 'none' : 'flex'}; justify-content: center;">Inspector ${sortIcon('driverName')}</div>
        `;
        
        const headerContainer = document.getElementById('list-header-container');
        if (headerContainer) {
            headerContainer.innerHTML = '';
            headerContainer.appendChild(header);
        } else {
            listContainer.appendChild(header);
        }

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
            let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'flex'}; justify-content: center;">${s.driverName || Config.driverParam || 'Unassigned'}</div>`;
            
            if (AppState.inspectors.length > 0) {
                const optionsHtml = AppState.inspectors.filter(i => isTrueInspector(i.isInspector)).map((insp) => {
                    const originalIdx = AppState.inspectors.indexOf(insp);
                    const color = MASTER_PALETTE[originalIdx % MASTER_PALETTE.length];
                    return `<option value="${insp.id}" style="color: ${color}; font-weight: 400;" ${String(s.driverId) === String(insp.id) ? 'selected' : ''}>${insp.name}</option>`;
                }).join('');
                
                let currentInspColor = 'var(--text-main)';
                if (s.driverId) {
                    const dIdx = AppState.inspectors.findIndex(i => String(i.id) === String(s.driverId));
                    if (dIdx > -1) currentInspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
                }

                inspectorHtml = `
                    <div class="col-insp" onclick="event.stopPropagation()" style="display: ${isSingleInspector ? 'none' : 'block'};">
                        <select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" style="color: ${currentInspColor}; font-weight: 400;" ${!AppState.PERMISSION_MODIFY ? 'disabled' : ''}>
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
                    <div class="stop-addr-title">${(s.address||'').split(',')[0]}</div>
                    <div class="row-meta">${metaDisplay}</div>
                    <div class="row-details">${s.type || ''}</div>
                </div>
                <div class="due-date-container ${urgencyClass}">${dueFmt}</div>
                <div class="stop-actions">
                    <i class="fa-solid fa-circle-check icon-btn" style="color:var(--accent)" onclick="toggleComplete(event, '${s.id}')"></i>
                    <i class="fa-solid fa-location-arrow icon-btn" style="color:var(--accent)" onclick="openNav(event, '${s.lat}','${s.lng}', '${(s.address || '').replace(/'/g, "\\'")}')"></i>
                </div>
            `;
        }
        
        item.onclick = (e) => {
            const isMacCmd = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? e.metaKey : e.ctrlKey;
            
            if (e.shiftKey && window.lastSelectedId) {
                const activeForSelection = AppState.stops.filter(st => isStopVisible(st, true, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter));
                const idx1 = activeForSelection.findIndex(st => String(st.id) === String(window.lastSelectedId));
                const idx2 = activeForSelection.findIndex(st => String(st.id) === String(s.id));
                if (idx1 > -1 && idx2 > -1) {
                    const start = Math.min(idx1, idx2);
                    const end = Math.max(idx1, idx2);
                    AppState.selectedIds.clear();
                    for(let i = start; i <= end; i++) {
                        AppState.selectedIds.add(activeForSelection[i].id);
                    }
                }
            } else if (isMacCmd) {
                AppState.selectedIds.has(s.id) ? AppState.selectedIds.delete(s.id) : AppState.selectedIds.add(s.id);
                window.lastSelectedId = s.id;
            } else {
                AppState.selectedIds.clear();
                AppState.selectedIds.add(s.id);
                window.lastSelectedId = s.id;
            }

            updateSelectionUI();
            
            if (!e.shiftKey && !isMacCmd) {
                document.getElementById(`item-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
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

    const globalSummary = document.getElementById('global-summary-stats');
    if (globalSummary) {
        if (AppState.stops.length === 0) {
            globalSummary.style.visibility = 'hidden'; 
        } else {
            globalSummary.style.visibility = 'visible'; 
        }
    }

    const summaryMetrics = document.getElementById('summary-metrics');
    if (summaryMetrics) {
        if (Config.isManagerView && AppState.currentInspectorFilter === 'all') {
            summaryMetrics.style.display = 'none';
        } else {
            summaryMetrics.style.display = 'block';
            summaryMetrics.style.visibility = (AppState.currentRoutingState === 'Pending' || AppState.currentRoutingState === 'Staging') ? 'hidden' : 'visible';
        }
    }
}

export function updateRouteTimes() {
    if (Config.isManagerView && AppState.currentInspectorFilter === 'all') return;
    const activeStops = AppState.stops.filter(s => isStopVisible(s, false, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter) && s.cluster !== 'X');
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
    
    const isAllInspectors = Config.isManagerView && AppState.currentInspectorFilter === 'all';
    const dummySort = isAllInspectors ? '<i class="fa-solid fa-sort" style="margin-left:4px;"></i>' : '';
    
    const el = document.createElement('div');
    el.className = 'stop-item static-endpoint';
    
    el.innerHTML = `
        <div class="col-num" style="display:flex; justify-content:center; align-items:center; color:var(--row-text-muted); font-size:16px;">
            ${icon}
        </div>
        <div class="col-eta" style="color:var(--row-text-muted); font-weight:400; display:${isAllInspectors ? 'none' : 'flex'}; justify-content:center; align-items:center; text-align:center;">
            ${labelText}
        </div>
        <div class="col-due"></div>
        <div class="col-addr" style="display:flex; align-items:center; flex-direction:row; padding-left:8px; padding-right:6px; flex:1 1 auto; min-width:0;">
            <div style="position:relative; flex: 1; display:flex; align-items:center; height:30px;">
                <input type="text" id="input-endpoint-${type}" class="endpoint-input" data-nodrag="true" value="${displayAddr}" placeholder="${placeholder}" onfocus="this.select()" oninput="handleEndpointInput(event, '${type}')" onkeydown="handleEndpointKeyDown(event, '${type}')" onblur="handleEndpointBlur('${type}', this)">
                <i class="fa-solid fa-pencil" style="position: absolute; right: 8px; color: var(--row-text-muted); font-size: 12px; pointer-events: none;"></i>
            </div>
            <div style="margin-left:auto; padding:4px; flex-shrink:0; display:flex; align-items:center; visibility: hidden; width: 20px;"></div>
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

    if (typeof updateMapSelectionStyles === 'function') {
        updateMapSelectionStyles(AppState.selectedIds);
    }

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

let sortableInstances = [];
let sortableUnrouted = null;

export function initSortable() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
    if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

    if (!AppState.PERMISSION_MODIFY) return;

    if (AppState.currentRoutingState === 'Pending') return;

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

let geocodeTimeout;

export async function handleEndpointInput(e, type) {
    clearTimeout(geocodeTimeout);
    const val = e.target.value;
    let dropdown = document.getElementById(`autocomplete-${type}`);
    
    if (!val.trim()) { 
        if (dropdown) dropdown.innerHTML = ''; 
        AppState.latestSuggestions[type] = null; return; 
    }
    
    geocodeTimeout = setTimeout(async () => {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${Config.MAPBOX_TOKEN}&country=us&types=address,poi`;
        try {
            AppState.frontEndApiUsage.geocode++;
            const res = await fetch(url);
            const data = await res.json();
            AppState.latestSuggestions[type] = data.features.length > 0 ? data.features[0] : null;
            renderAutocomplete(data.features, e.target, type);
        } catch (err) { console.error("Autocomplete Error:", err); }
    }, 300);
}

function renderAutocomplete(features, inputEl, type) {
    let dropdown = document.getElementById(`autocomplete-${type}`);
    if (!dropdown) {
        dropdown = document.createElement('div'); dropdown.id = `autocomplete-${type}`; dropdown.className = 'autocomplete-dropdown';
        dropdown.style.position = 'absolute'; dropdown.style.background = 'var(--bg-panel)'; dropdown.style.border = '1px solid var(--border-color)';
        dropdown.style.zIndex = '1000'; dropdown.style.width = '100%'; dropdown.style.maxHeight = '200px'; dropdown.style.overflowY = 'auto';
        dropdown.style.borderRadius = '4px'; dropdown.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        inputEl.parentNode.appendChild(dropdown);
    }
    dropdown.innerHTML = '';
    if (features.length === 0) return;
    
    features.forEach(f => {
        const item = document.createElement('div');
        item.style.padding = '8px 10px'; item.style.cursor = 'pointer'; item.style.borderBottom = '1px solid var(--border-color)';
        item.style.color = 'var(--text-main)'; item.style.fontSize = '13px'; item.innerText = f.place_name;
        
        item.onmouseenter = () => item.style.background = 'var(--bg-hover)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onmousedown = (e) => {
            e.preventDefault(); 
            AppState.latestSuggestions[type] = f; 
            inputEl.value = f.place_name; dropdown.innerHTML = '';
            selectEndpoint(type, f.place_name, f.center[1], f.center[0], inputEl);
        };
        dropdown.appendChild(item);
    });
}

async function selectEndpoint(type, address, lat, lng, inputEl) {
    const inspId = Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam;
    const insp = AppState.inspectors.find(i => String(i.id) === String(inspId));
    
    let epObj = { address, lat, lng };
    if (type === 'start') AppState.routeStart = epObj;
    if (type === 'end') AppState.routeEnd = epObj;

    if (insp) {
        if (type === 'start') { insp.startAddress = address; insp.startLat = lat; insp.startLng = lng; }
        if (type === 'end') { insp.endAddress = address; insp.endLat = lat; insp.endLng = lng; }
    }
    
    markRouteDirty('endpoints', 0); 
    triggerFullRender();
    silentSaveRouteState();
    saveEndpointToBackend(type, address, lat, lng);
}

async function saveEndpointToBackend(type, address, lat, lng) {
    const inspId = Config.isManagerView ? AppState.currentInspectorFilter : Config.driverParam;
    const activeStops = AppState.stops.filter(s => isActiveStop(s, Config.isManagerView));
    const hasRouted = activeStops.some(s => String(s.driverId) === String(inspId) && isRouteAssigned(s.status));
    
    pushToHistory(); showOverlay();
    let payload = { action: hasRouted ? 'updateEndpoint' : 'updateInspectorDefault', type, address, lat, lng, driverId: inspId };
    if (!Config.isManagerView) payload.routeId = Config.routeId; 
    
    try {
        const res = await apiFetch(payload);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        console.error("Endpoint update failed:", e);
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally { hideOverlay(); }
}

export function showAddOrderModal() {
    const m = document.getElementById('modal-overlay'); const mc = document.getElementById('modal-content');
    mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none';

    let isIndividual = document.body.classList.contains('tier-individual');
    let selectedInspector = isIndividual ? (Config.adminParam || Config.driverParam) : (Config.isManagerView && AppState.currentInspectorFilter !== 'all' ? AppState.currentInspectorFilter : (!Config.isManagerView ? Config.driverParam : null));
    let selectedApp = null;

    let inspectorHtml = '';
    if (Config.isManagerView && !isIndividual) {
        let inspBtns = AppState.inspectors.filter(i => isTrueInspector(i.isInspector)).map(insp => {
            let activeClass = (AppState.currentInspectorFilter !== 'all' && String(insp.id) === String(AppState.currentInspectorFilter)) ? 'active' : '';
            return `<div class="pill-btn add-insp-pill ${activeClass}" data-val="${insp.id}">${insp.name}</div>`;
        }).join('');
        inspectorHtml = `<div class="form-group"><label>Inspector</label><div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-insp-container">${inspBtns}</div></div>`;
    }

    let appBtns = AppState.availableCsvTypes.map(app => `<div class="pill-btn add-app-pill" data-val="${app}">${app}</div>`).join('');
    let appHtml = `<div class="form-group"><label>App</label><div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-app-container">${appBtns}</div></div>`;

    mc.innerHTML = `
        <div style="background: var(--bg-panel); padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: var(--text-main); text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;"><h3 style="margin: 0; font-size: 18px; font-weight: 400;">Add Order</h3><i class="fa-solid fa-xmark" style="cursor:pointer; color: var(--text-muted); font-size: 20px;" id="add-close-icon"></i></div>
            ${inspectorHtml} ${appHtml}
            <div class="form-group"><label>Address</label><input type="text" id="add-address" class="form-control" placeholder="123 Main St, City, ST 12345"></div>
            <div class="grid-2-col">
                <div class="form-group"><label>Latitude</label><input type="number" step="any" id="add-lat" class="form-control" placeholder="e.g. 32.776"></div>
                <div class="form-group"><label>Longitude</label><input type="number" step="any" id="add-lng" class="form-control" placeholder="e.g. -96.797"></div>
            </div>
            <div class="form-group"><label>Due Date</label><input type="date" id="add-due" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
            <div class="grid-2-col">
                <div class="form-group"><label>Client</label><input type="text" id="add-client" class="form-control" placeholder="Client Name"></div>
                <div class="form-group"><label>Order Type</label><input type="text" id="add-type" class="form-control" placeholder="e.g. Install"></div>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-start; margin-top: 10px;">
                <button id="btn-submit-add" class="modal-primary-btn" disabled>Add Order</button>
                <button id="btn-cancel-add" style="padding: 10px 24px; background: transparent; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; font-size: 14px; font-weight: 400; cursor: pointer; transition: 0.2s;">Cancel</button>
            </div>
        </div>`;
    m.style.display = 'flex';

    const checkValidity = () => {
        const btn = document.getElementById('btn-submit-add');
        if (selectedInspector && document.getElementById('add-address').value.trim() && document.getElementById('add-due').value) {
            btn.disabled = false;
        } else { btn.disabled = true; }
    };

    document.querySelectorAll('.add-insp-pill').forEach(el => { el.onclick = () => { document.querySelectorAll('.add-insp-pill').forEach(e => e.classList.remove('active')); el.classList.add('active'); selectedInspector = el.getAttribute('data-val'); checkValidity(); }; });
    document.querySelectorAll('.add-app-pill').forEach(el => { el.onclick = () => { if (el.classList.contains('active')) { el.classList.remove('active'); selectedApp = null; } else { document.querySelectorAll('.add-app-pill').forEach(e => e.classList.remove('active')); el.classList.add('active'); selectedApp = el.getAttribute('data-val'); } checkValidity(); }; });
    document.getElementById('add-address').addEventListener('input', checkValidity); document.getElementById('add-due').addEventListener('input', checkValidity);
    document.getElementById('add-close-icon').onclick = () => m.style.display = 'none'; document.getElementById('btn-cancel-add').onclick = () => m.style.display = 'none';

    document.getElementById('btn-submit-add').onclick = () => {
        m.style.display = 'none';
        const file = new File([['Address', 'Latitude', 'Longitude', 'Due Date', 'Client', 'Order Type'].join(',') + '\n' + [document.getElementById('add-address').value.trim(), document.getElementById('add-lat').value, document.getElementById('add-lng').value, document.getElementById('add-due').value, document.getElementById('add-client').value.trim(), document.getElementById('add-type').value.trim()].map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',')], "manual_order.csv", { type: "text/csv" });
        
        const uploadEvent = new CustomEvent('sproute-trigger-upload', {
            detail: { file: file, inspectorId: selectedInspector, csvType: selectedApp || '' }
        });
        document.dispatchEvent(uploadEvent);
    };
    checkValidity();
}

export function showUploadModal(file) {
    const m = document.getElementById('modal-overlay'); const mc = document.getElementById('modal-content');
    mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none';

    let isIndividual = document.body.classList.contains('tier-individual');
    let selectedInspector = isIndividual ? (Config.adminParam || Config.driverParam) : (Config.isManagerView && AppState.currentInspectorFilter !== 'all' ? AppState.currentInspectorFilter : (!Config.isManagerView ? Config.driverParam : null));
    let selectedCsvType = null;

    let inspectorHtml = '';
    if (Config.isManagerView && !isIndividual) {
        let inspBtns = AppState.inspectors.filter(i => isTrueInspector(i.isInspector)).map(insp => {
            let activeClass = (AppState.currentInspectorFilter !== 'all' && String(insp.id) === String(AppState.currentInspectorFilter)) ? 'active' : '';
            return `<div class="pill-btn insp-pill ${activeClass}" data-val="${insp.id}">${insp.name}</div>`;
        }).join('');
        inspectorHtml = `<div style="margin-bottom: 20px;"><div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: 400;">Inspector</div><div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-insp-container">${inspBtns}</div></div>`;
    }

    let appBtns = AppState.availableCsvTypes.map(app => `<div class="pill-btn app-pill" data-val="${app}">${app}</div>`).join('');

    mc.innerHTML = `
        <div style="background: var(--bg-panel); padding: 24px; border-radius: 8px; width: 500px; max-width: 90vw; color: var(--text-main); text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;"><h3 style="margin: 0; font-size: 18px; font-weight: 400;">CSV Import: ${file.name}</h3><i class="fa-solid fa-xmark" style="cursor:pointer; color: var(--text-muted); font-size: 20px;" id="upload-close-icon"></i></div>
            ${inspectorHtml}
            <div style="margin-bottom: 30px;"><div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: 400;">App</div><div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-app-container">${appBtns}</div></div>
            <div style="display: flex; gap: 12px; justify-content: flex-start;">
                <button id="btn-submit-upload" class="modal-primary-btn" disabled>Submit</button>
                <button id="btn-cancel-upload" style="padding: 10px 24px; background: transparent; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; font-size: 14px; font-weight: 400; cursor: pointer; transition: 0.2s;">Cancel</button>
            </div>
        </div>`;
    m.style.display = 'flex';

    const checkValidity = () => {
        const btn = document.getElementById('btn-submit-upload');
        if (selectedInspector && selectedCsvType) { btn.disabled = false; } 
        else { btn.disabled = true; }
    };

    document.querySelectorAll('.insp-pill').forEach(el => { el.onclick = () => { document.querySelectorAll('.insp-pill').forEach(e => e.classList.remove('active')); el.classList.add('active'); selectedInspector = el.getAttribute('data-val'); checkValidity(); }; });
    document.querySelectorAll('.app-pill').forEach(el => { el.onclick = () => { document.querySelectorAll('.app-pill').forEach(e => e.classList.remove('active')); el.classList.add('active'); selectedCsvType = el.getAttribute('data-val'); checkValidity(); }; });
    document.getElementById('upload-close-icon').onclick = () => m.style.display = 'none'; document.getElementById('btn-cancel-upload').onclick = () => m.style.display = 'none';

    document.getElementById('btn-submit-upload').onclick = () => {
        m.style.display = 'none';
        
        const uploadEvent = new CustomEvent('sproute-trigger-upload', {
            detail: { file: file, inspectorId: selectedInspector, csvType: selectedCsvType }
        });
        document.dispatchEvent(uploadEvent);
    };
}

export function handleOpenEmailModal() {
    if (AppState.currentRouteViewFilter !== 'all') { window.setRouteViewFilter('all'); }
    const insp = AppState.inspectors.find(i => String(i.id) === String(AppState.currentInspectorFilter));
    if (!insp) return;

    const m = document.getElementById('modal-overlay'); const mc = document.getElementById('modal-content');
    mc.style.padding = '0'; mc.style.background = 'transparent'; mc.style.border = 'none'; m.style.display = 'flex';
    
    mc.innerHTML = `
        <div style="background: var(--bg-panel); padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: var(--text-main); text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;">
            <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 18px; font-weight: 400;">Customize Email Message</h3>
            <textarea id="email-body-text" style="width: 100%; min-height: 150px; background: var(--bg-base); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; font-family: inherit; font-size: 15px; line-height: 1.5; margin-bottom: 24px; box-sizing: border-box; resize: none;">${AppState.defaultEmailMessage}</textarea>
            <div style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" id="cc-company-checkbox" ${AppState.ccCompanyDefault ? 'checked' : ''} style="margin-top: 4px; transform: scale(1.2);"><label for="cc-company-checkbox" style="font-size: 16px; cursor: pointer; color: var(--text-main);">CC the Company Email<br><span style="font-size: 14px; color: var(--text-muted);">${AppState.companyEmail || 'Company Email Not Found'}</span></label></div>
            <div style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" id="cc-me-checkbox" checked style="margin-top: 4px; transform: scale(1.2);"><label for="cc-me-checkbox" style="font-size: 16px; cursor: pointer; color: var(--text-main);">CC Me<br><span style="font-size: 14px; color: var(--text-muted);">${AppState.adminEmail || '[Email not provided]'}</span></label></div>
            <div style="margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px;"><label for="additional-cc-email" style="font-size: 16px; color: var(--text-main);">Additional CC</label><input type="email" id="additional-cc-email" placeholder="email@example.com" style="width: 100%; background: var(--bg-base); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; padding: 10px 12px; font-size: 15px; box-sizing: border-box;"></div>
            <div style="background: var(--bg-hover); border: 1px solid var(--border-color); padding: 16px; border-radius: 6px; font-size: 15px; color: var(--text-main); margin-bottom: 24px; line-height: 1.5;">A list of orders and the map image will be sent to <span style="color: var(--accent); font-weight: 400;">${insp.name}</span> at <span style="color: var(--accent); font-weight: 400;">${insp.email || '[Email not provided]'}</span>, along with a direct link to open the interactive map on their device.</div>
            <div style="display: flex; gap: 12px; justify-content: flex-start;"><button id="btn-submit-dispatch" class="modal-primary-btn">Submit</button><button id="btn-cancel-dispatch" style="padding: 12px 24px; background: transparent; color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px; font-size: 15px; font-weight: 400; cursor: pointer; transition: 0.2s;">Cancel</button></div>
        </div>`;

    document.getElementById('btn-cancel-dispatch').onclick = () => m.style.display = 'none';

    document.getElementById('btn-submit-dispatch').onclick = async () => {
        const btn = document.getElementById('btn-submit-dispatch');
        btn.innerText = 'Dispatching...'; btn.disabled = true;

        const mapContainer = document.getElementById('map-container');
        const overlaysToHide = mapContainer.querySelectorAll('.map-overlay-btns, #map-hint');
        const originalDisplays = []; overlaysToHide.forEach((el, index) => { originalDisplays[index] = el.style.display; el.style.display = 'none'; });

        // Temporarily move the global summary stats onto the map container to ensure they are captured in the screenshot.
        const statsSource = document.getElementById('global-summary-stats');
        let statsClone = null;
        if (statsSource) {
            statsClone = statsSource.cloneNode(true);
            statsClone.style.position = 'absolute';
            statsClone.style.top = '15px';
            statsClone.style.left = '50%';
            statsClone.style.transform = 'translateX(-50%)';
            statsClone.style.zIndex = '10';
            statsClone.style.background = 'rgba(23, 23, 23, 0.85)';
            statsClone.style.padding = '8px 16px';
            statsClone.style.borderRadius = '6px';
            statsClone.style.border = '1px solid var(--border-color)';
            statsClone.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
            mapContainer.appendChild(statsClone);
        }

        const bounds = new mapboxgl.LngLatBounds();
        let lats = [], lngs = [];
        AppState.stops.filter(s => isStopVisible(s, false, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter) && String(s.driverId) === String(AppState.currentInspectorFilter) && isRouteAssigned(s.status)).forEach(s => { if(s.lng && s.lat) { bounds.extend([s.lng, s.lat]); lngs.push(s.lng); lats.push(s.lat); } });
        
        let finalWidth = 800, finalHeight = 450;
        if (lats.length > 1) {
            const dLat = Math.max(...lats) - Math.min(...lats); const dLng = (Math.max(...lngs) - Math.min(...lngs)) * Math.cos(((Math.max(...lats) + Math.min(...lats)) / 2) * Math.PI / 180);
            if (dLat > 0.00001 && dLng > 0.00001) { let ratio = dLng / dLat; if (ratio > 1) { finalWidth = 800; finalHeight = Math.max(350, Math.floor(800 / ratio)); } else { finalHeight = 800; finalWidth = Math.max(350, Math.floor(800 * ratio)); } }
        }

        const mapWrapper = document.getElementById('map-wrapper');
        const originalWrapperStyle = mapWrapper.style.cssText;
        mapWrapper.style.cssText = `width: ${finalWidth}px !important; height: ${finalHeight}px !important; position: absolute !important; top: 0; left: 0; z-index: 0;`;
        const map = getMapInstance();
        if (map) {
            map.resize(); if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, animate: false });
            await new Promise(resolve => { map.once('idle', resolve); setTimeout(resolve, 1200); });
        }

        let mapBase64 = '';
        try { mapBase64 = (await html2canvas(mapContainer, { useCORS: true, backgroundColor: '#171717', scale: 1 })).toDataURL('image/jpeg', 0.85); } catch(e) { console.error(e); }

        mapWrapper.style.cssText = originalWrapperStyle;
        if (map) { map.resize(); if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, animate: false }); }
        overlaysToHide.forEach((el, index) => el.style.display = originalDisplays[index]);
        if (statsClone) statsClone.remove();

        try {
            const res = await apiFetch({
                action: "dispatchRoute", driverId: AppState.currentInspectorFilter, companyId: Config.companyParam || '', routeId: Config.isManagerView ? null : Config.routeId,
                customBody: document.getElementById('email-body-text').value, ccCompany: document.getElementById('cc-company-checkbox').checked, addCc: document.getElementById('cc-me-checkbox').checked ? AppState.adminEmail : '', ccEmail: document.getElementById('additional-cc-email').value, mapBase64
            });
            const result = await res.json();
            
            if (result.success) {
                m.style.display = 'none';
                AppState.stops.forEach(s => { if (String(s.driverId) === String(AppState.currentInspectorFilter) && isRouteAssigned(s.status)) { s.routeState = 'Dispatched'; s.status = 'Dispatched'; } });
                if (Config.isManagerView) { const filterEl = document.getElementById('inspector-filter'); if (filterEl) filterEl.value = 'all'; window.handleInspectorFilterChange('all'); } else { triggerFullRender(); }
                const toast = document.createElement('div'); toast.innerText = 'Route Sent!'; toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 20px; font-weight: 400; font-size: 14px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.3s;'; document.body.appendChild(toast);
                setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 1000);
            } else throw new Error("Dispatch failed");
        } catch (e) {
            btn.innerText = 'Submit'; btn.disabled = false;
            await customAlert("Failed to dispatch route. Please try again.");
        }
    };
}

export function openUnmatchedModal() {
    const modal = document.getElementById('unmatched-modal');
    document.getElementById('unmatched-modal-title').textContent = `Match Addresses (${AppState.currentUnmatchedIndex + 1} of ${AppState.unmatchedAddressesQueue.length})`;
    document.getElementById('unmatched-original-address').textContent = AppState.unmatchedAddressesQueue[AppState.currentUnmatchedIndex];
    document.getElementById('unmatched-lat').value = '';
    document.getElementById('unmatched-lng').value = '';
    document.getElementById('unmatched-corrected').value = '';
    document.getElementById('unmatched-error').style.display = 'none';
    document.getElementById('btn-unmatched-submit').textContent = 'Match Coordinates';
    modal.style.display = 'flex';
}

async function nextUnmatchedAddress() {
    AppState.currentUnmatchedIndex++;
    if (AppState.currentUnmatchedIndex < AppState.unmatchedAddressesQueue.length) openUnmatchedModal();
    else {
        document.getElementById('unmatched-modal').style.display = 'none';
        const toast = document.createElement('div'); toast.innerText = 'Address matching complete.'; toast.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 24px; border-radius: 20px; font-weight: 400; font-size: 14px; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.3s;'; document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
        await loadData(); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('unmatched-corrected')) document.getElementById('unmatched-corrected').addEventListener('input', (e) => { document.getElementById('btn-unmatched-submit').textContent = e.target.value.trim() !== '' ? 'Update Address' : 'Match Coordinates'; });
    if (document.getElementById('btn-unmatched-submit')) {
        document.getElementById('btn-unmatched-submit').addEventListener('click', async () => {
            document.getElementById('unmatched-error').style.display = 'none'; document.getElementById('unmatched-loading-overlay').style.display = 'flex';
            try {
                const response = await apiFetch({ action: 'resolveUnmatchedAddress', driverId: AppState.currentUploadDriverId, companyId: Config.companyParam || '', originalAddress: AppState.unmatchedAddressesQueue[AppState.currentUnmatchedIndex], lat: document.getElementById('unmatched-lat').value, lng: document.getElementById('unmatched-lng').value, correctedAddress: document.getElementById('unmatched-corrected').value });
                const result = await response.json();
                document.getElementById('unmatched-loading-overlay').style.display = 'none';
                if (result.success) nextUnmatchedAddress();
                else { document.getElementById('unmatched-error').textContent = result.unresolvable ? 'Address not found. Please try again or enter coordinates.' : (result.error || 'Invalid coordinates provided.'); document.getElementById('unmatched-error').style.display = 'block'; }
            } catch (err) { document.getElementById('unmatched-loading-overlay').style.display = 'none'; document.getElementById('unmatched-error').textContent = 'Network error. Please try again.'; document.getElementById('unmatched-error').style.display = 'block'; }
        });
    }
    if (document.getElementById('btn-unmatched-skip')) {
        document.getElementById('btn-unmatched-skip').addEventListener('click', async () => {
            if (await customConfirm("This order will be removed from the list.\n\nPress OK to delete.")) {
                document.getElementById('unmatched-loading-overlay').style.display = 'flex';
                try { await apiFetch({ action: 'resolveUnmatchedAddress', skip: true, driverId: AppState.currentUploadDriverId, originalAddress: AppState.unmatchedAddressesQueue[AppState.currentUnmatchedIndex] }); } catch(e) { console.error("Skip error:", e); }
                document.getElementById('unmatched-loading-overlay').style.display = 'none'; nextUnmatchedAddress();
            }
        });
    }
});

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

window.openNav = function(e, la, ln, addr) { e.stopPropagation(); let p = localStorage.getItem('navPref'); if (!p) { const m = document.getElementById('modal-overlay'); m.style.display = 'flex'; document.getElementById('modal-content').innerHTML = `<div style="background: var(--bg-panel); padding: 20px; border-radius: 8px; width: 400px; max-width: 90vw; color: var(--text-main); text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto;"><h3 style="margin-top:0; font-weight:400;">Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button class="modal-primary-btn" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:10px 24px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-hover); color:var(--text-main); cursor:pointer; font-weight:400;" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div></div>`; } else { window.launchMaps(p, la, ln, addr); } };
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

const mainDropzone = document.getElementById('main-dropzone'); 
const mainInput = document.getElementById('main-file-input');
const hiddenFileInput = document.getElementById('hidden-global-file-input');

function handleFileSelection(file) {
    if (AppState.inspectors.length === 0 || AppState.availableCsvTypes.length === 0) { customAlert("Before you can upload your first CSV file, you need to set up your Inspector and CSV Column Matching Settings."); return; }
    if (file.name.toLowerCase().endsWith('.csv')) showUploadModal(file); else customAlert("Please upload a valid CSV file.");
}

if (mainDropzone && mainInput) {
    mainDropzone.onclick = () => mainInput.click();
    mainDropzone.ondragover = (e) => { e.preventDefault(); mainDropzone.style.borderColor = 'var(--accent)'; mainDropzone.style.backgroundColor = 'var(--bg-hover)'; };
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

const resizerEl = document.getElementById('resizer'); const sidebarEl = document.getElementById('sidebar'); const mapWrapEl = document.getElementById('map-wrapper');
let isResizing = false;
function startResize(e) { if(!Config.isManagerView) return; isResizing = true; resizerEl.classList.add('active'); document.body.style.cursor = Config.viewMode === 'managermobile' ? 'row-resize' : 'col-resize'; mapWrapEl.style.pointerEvents = 'none'; }
resizerEl.addEventListener('mousedown', startResize); resizerEl.addEventListener('touchstart', (e) => { startResize(e.touches[0]); }, {passive: false});

function performResize(e) {
    if (!isResizing) return;
    let clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0); let clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    
    let containerHeight = document.body.clientHeight;
    
    if (Config.viewMode === 'managermobile') {
        let newHeight = containerHeight - clientY; 
        if (newHeight < 200) newHeight = 200; 
        if (newHeight > containerHeight - 200) newHeight = containerHeight - 200;
        sidebarEl.style.height = newHeight + 'px'; sidebarEl.style.flex = 'none'; mapWrapEl.style.height = (containerHeight - newHeight - resizerEl.offsetHeight) + 'px'; mapWrapEl.style.flex = 'none';
    } else {
        let newWidth = window.innerWidth - clientX; 
        
        let maxListWidth = Math.max(450, window.innerWidth - 620);
        if (newWidth > maxListWidth) newWidth = maxListWidth;
        if (newWidth < 450) newWidth = 450;
        
        sidebarEl.style.width = newWidth + 'px';
        
        const hlZone = document.getElementById('header-list-zone');
        if (hlZone) hlZone.style.width = newWidth + 'px';
    }
}

document.addEventListener('mousemove', performResize); document.addEventListener('touchmove', performResize, {passive: false});
function stopResize() { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizerEl.classList.remove('active'); mapWrapEl.style.pointerEvents = 'auto'; resizeMap(); } }
document.addEventListener('mouseup', stopResize); document.addEventListener('touchend', stopResize);

function syncBodyHeight() {
    document.body.style.height = window.innerHeight + 'px';
    const mapWrapper = document.getElementById('map-wrapper');
    const sidebar = document.getElementById('sidebar');
    if (mapWrapper) mapWrapper.style.minHeight = '0';
    if (sidebar) sidebar.style.minHeight = '0';
    const map = getMapInstance();
    if (map) map.resize();
}
window.addEventListener('resize', syncBodyHeight);
document.addEventListener('DOMContentLoaded', syncBodyHeight);
syncBodyHeight();
