// // *
// // * Dashboard - V12.4
// // * FILE: ui.js
// // * Changes: Centralized DOM manipulation, event listeners, sorting, filtering, and initialization.
// // *

// function updateUndoUI() {
//     const undoBtn = document.getElementById('btn-undo-incremental');
//     if (undoBtn) undoBtn.disabled = historyStack.length === 0;
// }

// window.setMobileSplitView = function(viewType) {
//     document.getElementById('toggle-map').classList.toggle('active', viewType === 'map');
//     document.getElementById('toggle-list').classList.toggle('active', viewType === 'list');
    
//     if (viewType === 'map') {
//         document.body.classList.add('split-show-map');
//         document.body.classList.remove('split-show-list');
//         setTimeout(() => { if(typeof map !== 'undefined') map.resize(); }, 100);
//     } else {
//         document.body.classList.add('split-show-list');
//         document.body.classList.remove('split-show-map');
//     }
// };

// window.setRouteViewFilter = function(val) {
//     currentRouteViewFilter = val;
//     document.getElementById('view-rall-btn').classList.toggle('active', val === 'all');
//     document.getElementById('view-r0-btn').classList.toggle('active', val === 0);
//     document.getElementById('view-r1-btn').classList.toggle('active', val === 1);
//     document.getElementById('view-r2-btn').classList.toggle('active', val === 2);
    
//     if (val !== 'all') {
//         const hiddenIds = [];
//         selectedIds.forEach(id => {
//             const s = stops.find(st => String(st.id) === String(id));
//             if (s && isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster !== val) {
//                 hiddenIds.push(id);
//             }
//         });
//         hiddenIds.forEach(id => selectedIds.delete(id));
//     }

//     render();
//     if (typeof drawRoute === 'function') drawRoute();
//     if (typeof updateSummary === 'function') updateSummary();
// };

// function updateHeaderUI() {
//     if (!isManagerView) return;
//     const sidebarDriverEl = document.getElementById('sidebar-driver-name');
//     const filterSelectWrap = document.getElementById('inspector-dropdown-wrapper');
//     const isCompanyTier = document.body.classList.contains('tier-company');

//     if (isCompanyTier) {
//         if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
//         if (filterSelectWrap) filterSelectWrap.style.display = 'block';
//     } else {
//         if (sidebarDriverEl) sidebarDriverEl.style.display = 'block';
//         if (filterSelectWrap) filterSelectWrap.style.display = 'none';
//     }
// }

// function updateInspectorDropdown() {
//     const filterSelect = document.getElementById('inspector-filter');
//     if (!filterSelect || !isManagerView) return;

//     const validInspectorIds = new Set();
//     stops.forEach(s => {
//         if (isActiveStop(s) && s.driverId) {
//             validInspectorIds.add(String(s.driverId));
//         }
//     });

//     if (currentInspectorFilter !== 'all' && !validInspectorIds.has(String(currentInspectorFilter))) {
//         currentInspectorFilter = 'all';
//         sessionStorage.setItem('sproute_inspector_filter', 'all');
//         document.body.classList.add('manager-all-inspectors');
//         document.body.classList.remove('manager-single-inspector');
//     }

//     let filterHtml = '<option value="all" style="color: var(--text-main);">All Inspectors</option>';
    
//     inspectors.forEach((i, idx) => { 
//         if (validInspectorIds.has(String(i.id))) {
//             const isInsp = i.isInspector === true || String(i.isInspector).toLowerCase() === 'true';
//             if (isInsp) {
//                 const color = MASTER_PALETTE[idx % MASTER_PALETTE.length];
//                 filterHtml += `<option value="${i.id}" style="color: ${color}; font-weight: bold;">${i.name}</option>`; 
//             }
//         }
//     });
    
//     filterSelect.innerHTML = filterHtml;
//     filterSelect.value = currentInspectorFilter;
    
//     if (currentInspectorFilter !== 'all') {
//         const inspIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
//         if (inspIdx > -1) filterSelect.style.color = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
//     } else {
//         filterSelect.style.color = 'var(--text-main)';
//     }
// }

// window.handleInspectorFilterChange = function(val) {
//     currentInspectorFilter = val;
//     sessionStorage.setItem('sproute_inspector_filter', val);
//     document.body.classList.toggle('manager-all-inspectors', val === 'all');
//     document.body.classList.toggle('manager-single-inspector', val !== 'all');
//     selectedIds.clear();
    
//     currentRouteViewFilter = 'all';
//     document.getElementById('view-rall-btn').classList.add('active');
//     document.getElementById('view-r0-btn').classList.remove('active');
//     document.getElementById('view-r1-btn').classList.remove('active');
//     document.getElementById('view-r2-btn').classList.remove('active');
    
//     updateInspectorDropdown();
    
//     if (val !== 'all' && typeof liveClusterUpdate === 'function') liveClusterUpdate();
    
//     updateRouteButtonColors();
//     render(); 
//     if (typeof drawRoute === 'function') drawRoute(); 
//     if (typeof updateSummary === 'function') updateSummary(); 
//     initSortable();
// };

// function updateRouteButtonColors() {
//     if (!isManagerView) return;
    
//     let baseColor = MASTER_PALETTE[0];
//     if (currentInspectorFilter !== 'all') {
//         const inspIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
//         if (inspIdx > -1) baseColor = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
//     }

//     const mr1 = document.getElementById('move-r1-btn');
//     const mr2 = document.getElementById('move-r2-btn');
//     const mr3 = document.getElementById('move-r3-btn');
//     if (mr1) mr1.style.borderLeftColor = baseColor;
//     if (mr2) mr2.style.borderLeftColor = '#000000';
//     if (mr3) mr3.style.borderLeftColor = '#ffffff';

//     for(let i=1; i<=3; i++) {
//         const btn = document.getElementById(`rbtn-${i}`);
//         if (btn) btn.style.setProperty('--route-color', baseColor);
        
//         const ind = document.getElementById(`rbtn-ind-${i}`);
//         if (ind) {
//             ind.innerHTML = '';
//             for(let c=0; c<i; c++) {
//                 let bgHex = baseColor;
//                 if (c === 1) bgHex = '#000000';
//                 if (c === 2) bgHex = '#ffffff';
                
//                 const circle = document.createElement('div');
//                 circle.className = 'rbtn-circle';
//                 circle.style.backgroundColor = hexToRgba(bgHex, 0.75); 
//                 circle.style.border = `2px solid ${baseColor}`;
//                 ind.appendChild(circle);
//             }
//         }
//     }
// }

// function updateRoutingUI() {
//     const isDirty = dirtyRoutes.size > 0;

//     const routingControls = document.getElementById('routing-controls');
//     const hintEl = document.getElementById('inspector-select-hint');

//     const btnGen = document.getElementById('btn-header-generate');
//     const btnRecalc = document.getElementById('btn-header-recalc');
//     const btnRestore = document.getElementById('btn-header-restore');
//     const optInspBtn = document.getElementById('btn-header-optimize-insp');
//     const btnSend = document.getElementById('btn-header-send-route');

//     [btnGen, btnRecalc, btnRestore, optInspBtn, btnSend].forEach(btn => {
//         if (btn) btn.style.display = 'none';
//     });

//     if (isManagerView && currentInspectorFilter === 'all') {
//         if(routingControls) routingControls.style.display = 'none';
//         const routeToggles = document.getElementById('route-view-toggles');
//         if(routeToggles) routeToggles.style.display = 'none';
        
//         let showHint = false;
//         const allValidStops = stops.filter(s => {
//             const status = (s.status || '').toLowerCase();
//             return status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
//         });

//         for (const insp of inspectors) {
//             if (allValidStops.filter(s => String(s.driverId) === String(insp.id)).length > 2) {
//                 showHint = true; 
//                 break;
//             }
//         }
//         if (hintEl) hintEl.style.display = (showHint && viewMode !== 'managermobile' && viewMode !== 'managermobilesplit') ? 'block' : 'none';
//         return;
//     }

//     if (hintEl) hintEl.style.display = 'none';

//     let currentState = 'Pending';
    
//     let targetStops = [];
//     if (isManagerView) {
//         targetStops = stops.filter(s => isActiveStop(s) && String(s.driverId) === String(currentInspectorFilter));
//     } else {
//         targetStops = stops.filter(s => isActiveStop(s));
//     }
    
//     const hasActiveRoutesUI = targetStops.some(s => isRouteAssigned(s.status));
    
//     if (targetStops.length > 0) {
//         const routedStops = targetStops.filter(s => isRouteAssigned(s.status));
//         const targetStop = routedStops.length > 0 ? routedStops[0] : targetStops[0];
//         let rs = (targetStop.routeState || 'Pending').toLowerCase();
        
//         if (rs === 'queued') currentState = 'Queued';
//         else if (rs === 'ready') currentState = 'Ready';
//         else if (rs === 'staging') currentState = 'Staging';
//         else if (rs === 'staging-endpoint') currentState = 'Staging-endpoint';
//         else currentState = 'Pending';
//     }

//     if (isDirty && hasActiveRoutesUI) {
//         currentState = dirtyRoutes.has('endpoints_0') ? 'Staging-endpoint' : 'Staging';
//     }

//     let maxCluster = -1;
//     targetStops.forEach(s => {
//         if (isRouteAssigned(s.status) && s.cluster !== 'X' && s.cluster > maxCluster) {
//             maxCluster = s.cluster;
//         }
//     });

//     const togglesEl = document.getElementById('route-view-toggles');
//     if (maxCluster > 0) {
//         if(togglesEl) togglesEl.style.display = 'flex';
//         const b1 = document.getElementById('view-r1-btn');
//         const b2 = document.getElementById('view-r2-btn');
//         if (b1) b1.style.display = maxCluster >= 1 ? 'block' : 'none';
//         if (b2) b2.style.display = maxCluster >= 2 ? 'block' : 'none';
//     } else {
//         if(togglesEl) togglesEl.style.display = 'none';
//         if (currentRouteViewFilter !== 'all') {
//             currentRouteViewFilter = 'all';
//             const rAll = document.getElementById('view-rall-btn');
//             if (rAll) rAll.classList.add('active');
//             for(let i=0; i<=2; i++) {
//                 const rBtn = document.getElementById(`view-r${i}-btn`);
//                 if (rBtn) rBtn.classList.remove('active');
//             }
//         }
//     }

//     let isCurrentViewDirty = false;
//     if (isDirty) {
//         if (currentRouteViewFilter === 'all') {
//             isCurrentViewDirty = true;
//         } else {
//             let inspKey = isManagerView ? currentInspectorFilter : driverParam;
//             let rKey = `${inspKey}_${currentRouteViewFilter}`;
//             if (dirtyRoutes.has(rKey) || dirtyRoutes.has('endpoints_0') || dirtyRoutes.has('all')) {
//                 isCurrentViewDirty = true;
//             }
//         }
//     }

//     if (isManagerView) {
//         const unroutedCount = targetStops.filter(s => !isRouteAssigned(s.status)).length;

//         if (currentState === 'Pending') {
//             if (unroutedCount > 0 && btnGen) btnGen.style.display = 'flex';
//             const headerGenBtnText = document.getElementById('btn-header-generate-text');
//             if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
//         } else if (currentState === 'Queued') {
//             // Processing
//         } else if (currentState === 'Ready') {
//             if (btnSend && !isCurrentViewDirty) btnSend.style.display = 'flex';
//         } else if (currentState === 'Staging') {
//             if (isCurrentViewDirty) {
//                 if (btnRecalc) btnRecalc.style.display = 'flex';
//                 if (optInspBtn) optInspBtn.style.display = 'flex';
//             }
//         } else if (currentState === 'Staging-endpoint') {
//             if (isCurrentViewDirty) {
//                 if (btnRecalc) btnRecalc.style.display = 'flex';
//                 if (optInspBtn) optInspBtn.style.display = 'flex';
//             }
//         }

//         if (routingControls) {
//             routingControls.style.display = (currentState === 'Pending' && unroutedCount > 0) ? 'flex' : 'none';
//         }

//     } else {
//         if(routingControls) routingControls.style.display = 'flex';
        
//         let showRecalc = false;
//         let showOpt = false;
//         let showRestore = false;

//         if (isDirty) {
//             showRecalc = true;
//             if (dirtyRoutes.has('endpoints_0') || PERMISSION_REOPTIMIZE) showOpt = true;
//         } else if (isAlteredRoute) {
//             if(btnRestore) btnRestore.style.display = 'flex'; 
//             showRestore = true;
//         }
        
//         if(btnRecalc) btnRecalc.style.display = showRecalc ? 'flex' : 'none';
//         if(optInspBtn) optInspBtn.style.display = showOpt ? 'flex' : 'none';

//         if (!showRecalc && !showOpt && !showRestore) {
//             if(routingControls) routingControls.style.display = 'none';
//         }

//         const sidebarBrand = document.getElementById('sidebar-brand');
//         if (sidebarBrand) {
//             sidebarBrand.style.display = (showRecalc || showOpt || showRestore) ? 'flex' : 'none';
//         }
//     }
// }

// window.toggleSelectAll = function(cb) {
//     selectedIds.clear();
//     if (cb.checked) {
//         stops.filter(s => isStopVisible(s, true)).forEach(s => selectedIds.add(s.id));
//     }
//     updateSelectionUI();
// };

// window.triggerBulkDelete = async function() { 
//     if(!(await customConfirm("Delete selected orders?"))) return;
    
//     if (typeof pushToHistory === 'function') pushToHistory(); 
    
//     const overlay = document.getElementById('processing-overlay');
//     if(overlay) overlay.style.display = 'flex';

//     try {
//         let idsToDelete = Array.from(selectedIds);
//         idsToDelete.forEach(id => {
//             const s = stops.find(st => String(st.id) === String(id));
//             if (s && isRouteAssigned(s.status)) {
//                 if (typeof markRouteDirty === 'function') markRouteDirty(s.driverId, s.cluster);
//             }
//         });

//         let payload = { action: 'deleteMultipleOrders', rowIds: idsToDelete };
//         if (!isManagerView) payload.routeId = routeId;
        
//         await apiFetch(payload);
        
//         stops = stops.filter(s => !selectedIds.has(s.id));
        
//         selectedIds.clear(); 
//         updateInspectorDropdown(); 
        
//         if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
//         render(); 
//         if (typeof drawRoute === 'function') drawRoute(); 
//         if (typeof updateSummary === 'function') updateSummary(); 
//         if (typeof updateRouteTimes === 'function') updateRouteTimes();
//         if (typeof silentSaveRouteState === 'function') silentSaveRouteState();

//     } catch (err) {
//         if(overlay) overlay.style.display = 'none';
//         await customAlert("Error deleting orders. Please try again.");
//     } finally {
//         if(overlay) overlay.style.display = 'none';
//     }
// };

// window.triggerBulkUnroute = async function() { 
//     if(!(await customConfirm("Remove selected orders from route?"))) return;
//     if (typeof pushToHistory === 'function') pushToHistory();
    
//     const overlay = document.getElementById('processing-overlay');
//     if(overlay) overlay.style.display = 'flex';

//     try {
//         let updatesArray = [];
//         Array.from(selectedIds).forEach(id => {
//             const idx = stops.findIndex(s => String(s.id) === String(id));
//             let dId = null;
//             if (idx > -1) {
//                 dId = stops[idx].driverId;
//                 if (isRouteAssigned(stops[idx].status)) {
//                     if (typeof markRouteDirty === 'function') markRouteDirty(stops[idx].driverId, stops[idx].cluster);
//                 }
//                 stops[idx].status = 'Pending';
//                 stops[idx].cluster = 'X';
//                 stops[idx].manualCluster = false;
//                 stops[idx].eta = '';
//                 stops[idx].dist = 0;
//                 stops[idx].durationSecs = 0;
//                 if (viewMode === 'inspector') stops[idx].hiddenInInspector = true; 
//             }
//             updatesArray.push({ rowId: id, driverId: dId });
//         });
        
//         let payload = { 
//             action: 'updateMultipleOrders', 
//             updatesList: updatesArray, 
//             sharedUpdates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' },
//             adminId: adminParam 
//         };
//         if (!isManagerView) payload.routeId = routeId;
        
//         await apiFetch(payload);
        
//         selectedIds.clear(); 
        
//         if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
//         render(); 
//         if (typeof drawRoute === 'function') drawRoute(); 
//         if (typeof updateSummary === 'function') updateSummary(); 
//         if (typeof updateRouteTimes === 'function') updateRouteTimes();
//         if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
        
//     } catch (err) {
//         if(overlay) overlay.style.display = 'none';
//         await customAlert("Error removing orders from the route. Please try again.");
//     } finally {
//         if(overlay) overlay.style.display = 'none';
//     }
// };

// window.handleInspectorChange = async function(e, rowId, selectEl) {
//     e.stopPropagation(); 
//     const newDriverId = selectEl.value;
//     const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    
//     let idsToUpdate = [rowId];
//     if (selectedIds.has(rowId) && selectedIds.size > 1) {
//         if (await customConfirm(`Reassign all ${selectedIds.size} selected orders to ${newDriverName}?`)) {
//             idsToUpdate = Array.from(selectedIds);
//         } else { 
//             render(); return; 
//         }
//     }
    
//     if (typeof pushToHistory === 'function') pushToHistory();
//     const overlay = document.getElementById('processing-overlay');
//     if(overlay) overlay.style.display = 'flex';
    
//     try { 
//         idsToUpdate.forEach(id => {
//             const s = stops.find(st => String(st.id) === String(id));
//             if (s) {
//                 if (isRouteAssigned(s.status)) {
//                     if (typeof markRouteDirty === 'function') markRouteDirty(s.driverId, s.cluster); 
//                 }
                
//                 s.driverName = newDriverName; 
//                 s.driverId = newDriverId; 
//                 s.status = 'Pending';
//                 s.routeState = 'Pending';
//                 s.cluster = 'X';
//                 s.manualCluster = false;
//                 s.eta = '';
//                 s.dist = 0;
//                 s.durationSecs = 0;
//                 if (viewMode === 'inspector') s.hiddenInInspector = true;
//             }
//         });

//         let payload = { 
//             action: 'updateMultipleOrders', 
//             updatesList: idsToUpdate.map(id => ({ rowId: id })), 
//             sharedUpdates: { 
//                 driverName: newDriverName, 
//                 driverId: newDriverId,
//                 status: 'P',
//                 eta: '',
//                 dist: 0,
//                 durationSecs: 0,
//                 routeNum: 'X',
//                 cluster: 'X'
//             },
//             adminId: adminParam
//         };
        
//         if (!isManagerView) payload.routeId = routeId;

//         await apiFetch(payload);
        
//         selectedIds.clear();
//         updateInspectorDropdown(); 
        
//         render(); 
//         if (typeof drawRoute === 'function') drawRoute(); 
//         if (typeof updateSummary === 'function') updateSummary();
//         if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
        
//     } catch (err) { 
//         if(overlay) overlay.style.display = 'none';
//         await customAlert("Error reassigning orders. Please try again."); 
//     } finally {
//         if(overlay) overlay.style.display = 'none';
//     }
// };

// window.sortTable = function(col) {
//     if (currentSort.col === col) currentSort.asc = !currentSort.asc;
//     else { currentSort.col = col; currentSort.asc = true; }

//     stops.sort((a, b) => {
//         let valA = a[col] || ''; let valB = b[col] || '';
//         if (col === 'dueDate') {
//             valA = valA ? new Date(valA).getTime() : Number.MAX_SAFE_INTEGER;
//             valB = valB ? new Date(valB).getTime() : Number.MAX_SAFE_INTEGER;
//         } else {
//             valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
//         }
//         if (valA < valB) return currentSort.asc ? -1 : 1;
//         if (valA > valB) return currentSort.asc ? 1 : -1;
//         return 0;
//     });
//     render(); 
// };

// function getSortIcon(col) {
//     if (currentSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:0.3; margin-left:4px;"></i>';
//     return currentSort.asc ? '<i class="fa-solid fa-sort-up" style="margin-left:4px; color:var(--blue);"></i>' : '<i class="fa-solid fa-sort-down" style="margin-left:4px; color:var(--blue);"></i>';
// }

// window.setDisplayMode = function(mode) {
//     currentDisplayMode = mode;
//     document.getElementById('btn-detailed').classList.toggle('active', mode === 'detailed');
//     document.getElementById('btn-compact').classList.toggle('active', mode === 'compact');
    
//     document.querySelectorAll('.stop-item, .glide-row').forEach(el => {
//         if (mode === 'compact') {
//             el.classList.add('compact');
//             el.classList.remove('detailed');
//         } else {
//             el.classList.add('detailed');
//             el.classList.remove('compact');
//         }
//     });
// };

// function createRouteSubheading(clusterNum, clusterStops) {
//     let totalMi = 0;
//     let dueToday = 0;
//     let pastDue = 0;
//     let totalSecs = 0;
    
//     const today = new Date(); today.setHours(0,0,0,0);

//     clusterStops.forEach(s => {
//         const distVal = parseFloat(s.dist || 0);
//         if (!isNaN(distVal)) totalMi += distVal;

//         totalSecs += parseFloat(s.durationSecs || 0);

//         if(s.dueDate) {
//             const dueTime = new Date(s.dueDate); dueTime.setHours(0, 0, 0, 0);
//             if(dueTime < today) pastDue++;
//             else if(dueTime.getTime() === today.getTime()) dueToday++;
//         }
//     });

//     let hrs = clusterStops.length > 0 ? ((totalSecs + (clusterStops.length * COMPANY_SERVICE_DELAY * 60)) / 3600).toFixed(1) : 0;
//     let dueText = pastDue > 0 ? `<span style="color:var(--red)">${pastDue} Past Due</span>` : (dueToday > 0 ? `<span style="color:var(--orange)">${dueToday} Due Today</span>` : `0 Due`);
    
//     const el = document.createElement('div');
//     el.className = 'list-subheading';
//     el.innerHTML = `<span>ROUTE ${clusterNum + 1}</span><span class="route-summary-text">${totalMi.toFixed(1)} mi | ${hrs} hrs | ${clusterStops.length} stops | ${dueText}</span>`;
//     return el;
// }

// window.checkEndpointModified = function() {
//     const sVal = document.getElementById('input-endpoint-start')?.value || '';
//     const eVal = document.getElementById('input-endpoint-end')?.value || '';
    
//     let eps = null;
//     if (typeof getActiveEndpoints === 'function') eps = getActiveEndpoints();
//     if (!eps) return;

//     const sOrig = eps.start?.address || '';
//     const eOrig = eps.end?.address || '';
    
//     const modified = (sVal.trim() !== sOrig.trim()) || (eVal.trim() !== eOrig.trim());
//     if (modified && typeof markRouteDirty === 'function') markRouteDirty('endpoints', 0);
    
//     updateRoutingUI();
// };

// function createEndpointRow(type, endpointData) {
//     const displayAddr = endpointData && endpointData.address ? endpointData.address : '';
//     const placeholder = type === 'start' ? 'Search Start Address...' : 'Search End Address...';
//     const inputId = `input-endpoint-${type}`;
//     const rowIcon = type === 'start' ? '🏠' : '🏁';
    
//     const el = document.createElement('div');
//     el.className = 'stop-item static-endpoint compact';
//     el.innerHTML = `
//         <div class="stop-sidebar" style="background:var(--bg-header); color:var(--text-main); font-size:18px;">${rowIcon}</div>
//         <div class="stop-content" style="padding: 0 10px; flex-direction:row; align-items:center; display:flex;">
//             <div style="position:relative; width:100%; flex:1;">
//                 <input type="text" id="${inputId}" class="endpoint-input" style="font-size: 14px; width: 100%;" value="${displayAddr}" placeholder="${placeholder}" onfocus="this.select()" onmouseup="return false;" oninput="handleEndpointInput(event, '${type}')" onkeydown="handleEndpointKeyDown(event, '${type}')" onblur="handleEndpointBlur('${type}', this)">
//             </div>
//         </div>
//         <div class="stop-actions" style="width: 40px;"></div>
//     `;
//     return el;
// }

// window.showAddOrderModal = function() {
//     const m = document.getElementById('modal-overlay');
//     const mc = document.getElementById('modal-content');
//     mc.style.padding = '0';
//     mc.style.background = 'transparent';
//     mc.style.border = 'none';

//     let isIndividual = document.body.classList.contains('tier-individual');
//     let selectedInspector = null;
//     let selectedApp = null;

//     if (isIndividual) {
//         selectedInspector = adminParam || driverParam;
//     } else if (isManagerView && currentInspectorFilter !== 'all') {
//         selectedInspector = currentInspectorFilter;
//     } else if (!isManagerView) {
//         selectedInspector = driverParam;
//     }

//     let inspectorHtml = '';
//     if (isManagerView && currentInspectorFilter === 'all' && !isIndividual) {
//         const filteredInspectors = inspectors.filter(i => i.isInspector === true || String(i.isInspector).toLowerCase() === 'true');
//         let inspBtns = filteredInspectors.map(insp => `<div class="pill-btn add-insp-pill" data-val="${insp.id}">${insp.name}</div>`).join('');
//         inspectorHtml = `
//             <div class="form-group">
//                 <label>Inspector <span style="float:right; font-weight:normal;">Required</span></label>
//                 <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-insp-container">
//                     ${inspBtns}
//                 </div>
//             </div>
//         `;
//     }

//     let appBtns = availableCsvTypes.map(app => `<div class="pill-btn add-app-pill" data-val="${app}">${app}</div>`).join('');
//     let appHtml = `
//         <div class="form-group">
//             <label>App <span style="float:right; font-weight:normal;">Optional</span></label>
//             <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="add-app-container">
//                 ${appBtns}
//             </div>
//         </div>
//     `;

//     const todayStr = new Date().toISOString().split('T')[0];

//     const modalHtml = `
//         <div style="background: #202123; padding: 24px; border-radius: 8px; width: 600px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto;">
//             <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
//                 <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Add Order</h3>
//                 <i class="fa-solid fa-xmark" style="cursor:pointer; color: #888; font-size: 20px;" id="add-close-icon"></i>
//             </div>

//             ${inspectorHtml}
//             ${appHtml}

//             <div class="form-group">
//                 <label>Address <span style="float:right; font-weight:normal;">Required</span></label>
//                 <input type="text" id="add-address" class="form-control" placeholder="123 Main St, City, ST 12345">
//             </div>

//             <div class="grid-2-col">
//                 <div class="form-group">
//                     <label>Latitude <span style="float:right; font-weight:normal;">Optional</span></label>
//                     <input type="number" step="any" id="add-lat" class="form-control" placeholder="e.g. 32.776">
//                 </div>
//                 <div class="form-group">
//                     <label>Longitude <span style="float:right; font-weight:normal;">Optional</span></label>
//                     <input type="number" step="any" id="add-lng" class="form-control" placeholder="e.g. -96.797">
//                 </div>
//             </div>

//             <div class="form-group">
//                 <label>Due Date <span style="float:right; font-weight:normal;">Required</span></label>
//                 <input type="date" id="add-due" class="form-control" value="${todayStr}">
//             </div>

//             <div class="grid-2-col">
//                 <div class="form-group">
//                     <label>Client <span style="float:right; font-weight:normal;">Optional</span></label>
//                     <input type="text" id="add-client" class="form-control" placeholder="Client Name">
//                 </div>
//                 <div class="form-group">
//                     <label>Order Type <span style="float:right; font-weight:normal;">Optional</span></label>
//                     <input type="text" id="add-type" class="form-control" placeholder="e.g. Install">
//                 </div>
//             </div>

//             <div style="display: flex; gap: 12px; justify-content: flex-start; margin-top: 10px;">
//                 <button id="btn-submit-add" style="padding: 10px 24px; background: #35475b; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0.5;" disabled>Add Order</button>
//                 <button id="btn-cancel-add" style="padding: 10px 24px; background: transparent; color: white; border: 1px solid #555; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer;">Cancel</button>
//             </div>
//         </div>
//     `;

//     mc.innerHTML = modalHtml;
//     m.style.display = 'flex';

//     const checkValidity = () => {
//         const submitBtn = document.getElementById('btn-submit-add');
//         const addr = document.getElementById('add-address').value.trim();
//         const due = document.getElementById('add-due').value;

//         if (selectedInspector && addr && due) {
//             submitBtn.disabled = false;
//             submitBtn.style.opacity = '1';
//             submitBtn.style.background = 'var(--green)';
//         } else {
//             submitBtn.disabled = true;
//             submitBtn.style.opacity = '0.5';
//             submitBtn.style.background = '#35475b';
//         }
//     };

//     document.querySelectorAll('.add-insp-pill').forEach(el => {
//         el.onclick = () => {
//             document.querySelectorAll('.add-insp-pill').forEach(e => e.classList.remove('active'));
//             el.classList.add('active');
//             selectedInspector = el.getAttribute('data-val');
//             checkValidity();
//         };
//     });

//     document.querySelectorAll('.add-app-pill').forEach(el => {
//         el.onclick = () => {
//             if (el.classList.contains('active')) {
//                 el.classList.remove('active');
//                 selectedApp = null;
//             } else {
//                 document.querySelectorAll('.add-app-pill').forEach(e => e.classList.remove('active'));
//                 el.classList.add('active');
//                 selectedApp = el.getAttribute('data-val');
//             }
//             checkValidity();
//         };
//     });

//     document.getElementById('add-address').addEventListener('input', checkValidity);
//     document.getElementById('add-due').addEventListener('input', checkValidity);

//     const closeModal = () => { m.style.display = 'none'; };
//     document.getElementById('add-close-icon').onclick = closeModal;
//     document.getElementById('btn-cancel-add').onclick = closeModal;

//     document.getElementById('btn-submit-add').onclick = () => {
//         closeModal();
        
//         const addr = document.getElementById('add-address').value.trim();
//         const lat = document.getElementById('add-lat').value;
//         const lng = document.getElementById('add-lng').value;
//         const due = document.getElementById('add-due').value;
//         const client = document.getElementById('add-client').value.trim();
//         const type = document.getElementById('add-type').value.trim();

//         const escapeCsv = (val) => '"' + String(val || '').replace(/"/g, '""') + '"';
        
//         const headers = ['Address', 'Latitude', 'Longitude', 'Due Date', 'Client', 'Order Type'];
//         const values = [addr, lat, lng, due, client, type];
//         const csvContent = headers.join(',') + '\n' + values.map(escapeCsv).join(',');
        
//         const file = new File([csvContent], "manual_order.csv", { type: "text/csv" });
//         if (typeof performUpload === 'function') performUpload(file, selectedInspector, selectedApp || '');
//     };

//     checkValidity();
// };

// window.showUploadModal = function(file) {
//     const m = document.getElementById('modal-overlay');
//     const mc = document.getElementById('modal-content');

//     mc.style.padding = '0';
//     mc.style.background = 'transparent';
//     mc.style.border = 'none';

//     let isIndividual = document.body.classList.contains('tier-individual');
//     let selectedInspector = null;

//     if (isIndividual) {
//         selectedInspector = adminParam || driverParam;
//     } else if (isManagerView && currentInspectorFilter !== 'all') {
//         selectedInspector = currentInspectorFilter;
//     } else if (!isManagerView) {
//         selectedInspector = driverParam;
//     }

//     let selectedCsvType = null;

//     let inspectorHtml = '';
//     if (isManagerView && currentInspectorFilter === 'all' && !isIndividual) {
//         const filteredInspectors = inspectors.filter(i => i.isInspector === true || String(i.isInspector).toLowerCase() === 'true');
//         let inspBtns = filteredInspectors.map(insp => `<div class="pill-btn insp-pill" data-val="${insp.id}">${insp.name}</div>`).join('');
//         inspectorHtml = `
//             <div style="margin-bottom: 20px;">
//                 <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">Inspector <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
//                 <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-insp-container">
//                     ${inspBtns}
//                 </div>
//             </div>
//         `;
//     }

//     let appBtns = availableCsvTypes.map(app => `<div class="pill-btn app-pill" data-val="${app}">${app}</div>`).join('');

//     const modalHtml = `
//         <div style="background: #202123; padding: 24px; border-radius: 8px; width: 500px; max-width: 90vw; color: white; text-align: left; box-sizing: border-box; font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
//             <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
//                 <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Process CSV File</h3>
//                 <i class="fa-solid fa-xmark" style="cursor:pointer; color: #888; font-size: 20px;" id="upload-close-icon"></i>
//             </div>

//             <div style="margin-bottom: 20px;">
//                 <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">File <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
//                 <div style="background: #2a2b2d; border: 1px solid #333; padding: 12px 16px; border-radius: 6px; color: #ccc; display: flex; align-items: center; gap: 10px; font-size: 14px;">
//                     <i class="fa-solid fa-file-csv" style="font-size: 18px;"></i> ${file.name}
//                 </div>
//             </div>

//             ${inspectorHtml}

//             <div style="margin-bottom: 30px;">
//                 <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px; font-weight: bold;">App <span style="float:right; font-size: 12px; font-weight: normal;">Required</span></div>
//                 <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="upload-app-container">
//                     ${appBtns}
//                 </div>
//             </div>

//             <div style="display: flex; gap: 12px; justify-content: flex-start;">
//                 <button id="btn-submit-upload" style="padding: 10px 24px; background: #35475b; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0.5;" disabled>Submit</button>
//                 <button id="btn-cancel-upload" style="padding: 10px 24px; background: transparent; color: white; border: 1px solid #555; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer;">Cancel</button>
//             </div>
//         </div>
//     `;

//     mc.innerHTML = modalHtml;
//     m.style.display = 'flex';

//     const checkValidity = () => {
//         const submitBtn = document.getElementById('btn-submit-upload');
//         if (selectedInspector && selectedCsvType) {
//             submitBtn.disabled = false;
//             submitBtn.style.opacity = '1';
//             submitBtn.style.background = 'var(--blue)';
//         } else {
//             submitBtn.disabled = true;
//             submitBtn.style.opacity = '0.5';
//             submitBtn.style.background = '#35475b';
//         }
//     };

//     document.querySelectorAll('.insp-pill').forEach(el => {
//         el.onclick = () => {
//             document.querySelectorAll('.insp-pill').forEach(e => e.classList.remove('active'));
//             el.classList.add('active');
//             selectedInspector = el.getAttribute('data-val');
//             checkValidity();
//         };
//     });

//     document.querySelectorAll('.app-pill').forEach(el => {
//         el.onclick = () => {
//             document.querySelectorAll('.app-pill').forEach(e => e.classList.remove('active'));
//             el.classList.add('active');
//             selectedCsvType = el.getAttribute('data-val');
//             checkValidity();
//         };
//     });

//     const closeModal = () => { m.style.display = 'none'; };
//     document.getElementById('upload-close-icon').onclick = closeModal;
//     document.getElementById('btn-cancel-upload').onclick = closeModal;

//     document.getElementById('btn-submit-upload').onclick = () => {
//         closeModal();
//         if (typeof performUpload === 'function') performUpload(file, selectedInspector, selectedCsvType);
//     };
// };

// function handleFileSelection(file) {
//     if (inspectors.length === 0 || availableCsvTypes.length === 0) {
//         customAlert("Before you can upload your first CSV file, you need to set up your Inspector and CSV Column Matching Settings.");
//         return;
//     }
//     if (file.name.toLowerCase().endsWith('.csv')) {
//         showUploadModal(file);
//     } else {
//         customAlert("Please upload a valid CSV file.");
//     }
// }

// function createDropzone() {
//     const dropzone = document.createElement('div');
//     dropzone.className = 'upload-dropzone';
//     dropzone.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; text-align: center; border: 2px dashed var(--border-color); border-radius: 8px; margin: 20px; cursor: pointer; transition: all 0.2s; min-height: 250px;';
    
//     const input = document.createElement('input');
//     input.type = 'file';
//     input.accept = '.csv';
//     input.style.display = 'none';
    
//     dropzone.innerHTML = `
//         <div style="background: rgba(255,255,255,0.05); padding: 25px; border-radius: 50%; margin-bottom: 15px; pointer-events: none;">
//             <i class="fa-solid fa-cloud-arrow-up" style="font-size: 48px; color: var(--blue);"></i>
//         </div>
//         <div style="font-size: 18px; font-weight: bold; color: var(--text-main); margin-bottom: 8px; pointer-events: none;">Ready to Route</div>
//         <div style="font-size: 14px; color: var(--text-muted); max-width: 250px; line-height: 1.5; pointer-events: none;">Drag and drop a CSV here, or click to select a file.</div>
//     `;
    
//     dropzone.appendChild(input);
    
//     dropzone.onclick = () => input.click();
    
//     dropzone.ondragover = (e) => {
//         e.preventDefault();
//         dropzone.style.backgroundColor = 'var(--bg-hover)';
//         dropzone.style.borderColor = 'var(--blue)';
//     };
    
//     dropzone.ondragleave = (e) => {
//         e.preventDefault();
//         dropzone.style.backgroundColor = 'transparent';
//         dropzone.style.borderColor = 'var(--border-color)';
//     };
    
//     dropzone.ondrop = (e) => {
//         e.preventDefault();
//         dropzone.style.backgroundColor = 'transparent';
//         dropzone.style.borderColor = 'var(--border-color)';
//         if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
//             handleFileSelection(e.dataTransfer.files[0]);
//         }
//     };
    
//     input.onchange = (e) => {
//         if (e.target.files && e.target.files.length > 0) {
//             handleFileSelection(e.target.files[0]);
//             headerInput.value = ''; // Reset input
//         }
//     };
    
//     return dropzone;
// }

// window.render = function() {
//     updateHeaderUI();
//     updateRoutingUI();
    
//     const listContainer = document.getElementById('stop-list');
//     listContainer.innerHTML = ''; 
//     markers.forEach(m => m.remove()); 
//     markers = [];
//     const bounds = new mapboxgl.LngLatBounds();
    
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const isSingleInspector = isManagerView && currentInspectorFilter !== 'all';
//     const isAllInspectors = isManagerView && currentInspectorFilter === 'all';
    
//     const activeStops = stops.filter(s => isStopVisible(s, true));
//     const hasRouted = activeStops.some(s => isRouteAssigned(s.status));
    
//     const headerActions = document.getElementById('header-actions-wrapper');
//     if (headerActions) {
//         headerActions.style.display = viewMode === 'inspector' ? 'none' : 'flex';
//     }

//     const searchContainer = document.getElementById('search-container');
//     if (searchContainer) {
//         if (isManagerView && activeStops.length === 0) {
//             searchContainer.style.display = 'none';
//         } else {
//             searchContainer.style.display = 'flex';
//         }
//     }

//     const mobileToggle = document.getElementById('mobile-view-toggle');
//     if (mobileToggle) {
//         mobileToggle.style.display = viewMode === 'managermobilesplit' ? 'flex' : 'none';
//     }

//     if (isManagerView) {
//         const header = document.createElement('div');
//         header.className = 'glide-table-header';
//         header.style.position = 'sticky';
//         header.style.top = '0';
//         header.style.zIndex = '20';
//         header.style.marginTop = '-1px';
        
//         const sortIcon = (col) => isAllInspectors ? getSortIcon(col) : '';
//         const sortClick = (col) => isAllInspectors ? `onclick="sortTable('${col}')"` : '';
//         const sortClass = isAllInspectors ? 'sortable' : '';
        
//         const appSortClass = isAllInspectors ? 'sortable' : '';
//         const appSortClick = isAllInspectors ? `onclick="sortTable('app')"` : '';
//         const appSortIcon = isAllInspectors ? getSortIcon('app') : '';

//         header.innerHTML = `
//             <div class="col-num">
//                 <input type="checkbox" id="bulk-select-all" class="grey-checkbox" onchange="toggleSelectAll(this)">
//             </div>
//             <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">ETA</div>
//             <div class="col-due ${sortClass}" ${sortClick('dueDate')}>Due ${sortIcon('dueDate')}</div>
//             <div class="col-insp ${sortClass}" ${sortClick('driverName')} style="display: ${isSingleInspector ? 'none' : 'block'};">Inspector ${sortIcon('driverName')}</div>
//             <div class="col-addr ${sortClass}" ${sortClick('address')}>Address ${sortIcon('address')}</div>
//             <div class="col-app ${appSortClass}" ${appSortClick}>App ${appSortIcon}</div>
//             <div class="col-client ${sortClass}" ${sortClick('client')}>Client ${sortIcon('client')}</div>
//             <div class="col-handle" style="visibility:${hasRouted ? 'visible' : 'hidden'};"><i class="fa-solid fa-grip-lines"></i></div>
//         `;
//         listContainer.appendChild(header);
//     }
    
//     const processStop = (s, displayIndex, showHandle) => {
//         const item = document.createElement('div');
//         item.id = `item-${s.id}`;
//         item.setAttribute('data-search', `${(s.address||'').toLowerCase()} ${(s.client||'').toLowerCase()}`);
        
//         if (viewMode === 'inspector' && s.hiddenInInspector) {
//             item.classList.add('hidden-unrouted');
//         }
        
//         const due = s.dueDate ? new Date(s.dueDate) : null;
//         let urgencyClass = '';
        
//         if (due) {
//             const dueTime = new Date(due);
//             dueTime.setHours(0, 0, 0, 0); 
//             if (dueTime < today) urgencyClass = 'past-due'; 
//             else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today'; 
//         }
        
//         const dueFmt = due ? `${due.getMonth()+1}/${due.getDate()}` : "N/A";

//         const isRoutedStop = isRouteAssigned(s.status);
//         const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
//         let etaTime = s.eta || '--';
        
//         if (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) {
//             etaTime = '--';
//         }

//         if (isManagerView) {
//             item.className = `glide-row ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
//             let inspectorHtml = `<div class="col-insp" style="display: ${isSingleInspector ? 'none' : 'block'};">${s.driverName || driverParam || 'Unassigned'}</div>`;
            
//             if (inspectors.length > 0) {
//                 const filteredInspectors = inspectors.filter(i => i.isInspector === true || String(i.isInspector).toLowerCase() === 'true');
                
//                 const optionsHtml = filteredInspectors.map((insp) => {
//                     const originalIdx = inspectors.indexOf(insp);
//                     const color = MASTER_PALETTE[originalIdx % MASTER_PALETTE.length];
//                     return `<option value="${insp.id}" style="color: ${color}; font-weight: bold;" ${String(s.driverId) === String(insp.id) ? 'selected' : ''}>${insp.name}</option>`;
//                 }).join('');
                
//                 const defaultPlaceholder = !s.driverId ? `<option value="" disabled selected hidden>Select Inspector...</option>` : '';
//                 const disableSelectAttr = !PERMISSION_MODIFY ? 'disabled' : '';

//                 let currentInspColor = 'var(--text-main)';
//                 if (s.driverId) {
//                     const dIdx = inspectors.findIndex(i => String(i.id) === String(s.driverId));
//                     if (dIdx > -1) currentInspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
//                 }

//                 inspectorHtml = `
//                     <div class="col-insp" onclick="event.stopPropagation()" style="display: ${isSingleInspector ? 'none' : 'block'};">
//                         <select class="insp-select" onchange="handleInspectorChange(event, '${s.id}', this)" style="color: ${currentInspColor}; font-weight: bold;" ${disableSelectAttr}>
//                             ${defaultPlaceholder}
//                             ${optionsHtml}
//                         </select>
//                     </div>
//                 `;
//             }

//             const style = getVisualStyle(s);
//             const handleHtml = `<div class="col-handle ${showHandle ? 'handle' : ''}" style="visibility:${showHandle ? 'visible' : 'hidden'};">${showHandle ? '<i class="fa-solid fa-grip-lines"></i>' : ''}</div>`;

//             let metaHtml = '';
//             if (viewMode === 'managermobile' || viewMode === 'managermobilesplit') {
//                 metaHtml = `<div class="meta-text">${s.app || '--'} | ${s.client || '--'}</div>`;
//             }

//             item.innerHTML = `
//                 <div class="col-num"><div class="num-badge" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};">${displayIndex}</div></div>
//                 <div class="col-eta" style="display: ${isAllInspectors ? 'none' : 'flex'}; justify-content: center; text-align: center;">${etaTime}</div>
//                 <div class="col-due ${urgencyClass}">${dueFmt}</div>
//                 ${inspectorHtml}
//                 <div class="col-addr">
//                     <div class="addr-text">${(s.address||'').split(',')[0]}</div>
//                     ${metaHtml}
//                     <div class="type-text">${s.type || ''}</div>
//                 </div>
//                 <div class="col-app">${s.app || '--'}</div>
//                 <div class="col-client">${s.client || '--'}</div>
//                 ${handleHtml}
//             `;
//         } else {
//             item.className = `stop-item ${s.status.toLowerCase().replace(' ', '-')} ${currentDisplayMode}`;
//             if (viewMode === 'inspector' && s.hiddenInInspector) item.classList.add('hidden-unrouted');
            
//             const distFmt = s.dist ? parseFloat(s.dist).toFixed(1) : "0.0";
//             const metaDisplay = (!isRoutedStop || dirtyRoutes.has(routeKey) || dirtyRoutes.has('all')) ? `-- | ${distFmt} mi` : `${etaTime} | ${distFmt} mi`;
            
//             item.innerHTML = `
//                 <div class="stop-sidebar ${urgencyClass}">${displayIndex}</div>
//                 <div class="csv-box">${(s.app || "--").substring(0,2).toUpperCase()}</div>
//                 <div class="stop-content">
//                     <b>${(s.address||'').split(',')[0]}</b>
//                     <div class="row-meta">${metaDisplay}</div>
//                     <div class="row-details">${s.type || ''}</div>
//                 </div>
//                 <div class="due-date-container ${urgencyClass}">${dueFmt}</div>
//                 <div class="stop-actions">
//                     <i class="fa-solid fa-circle-check icon-btn" style="color:var(--green)" onclick="toggleComplete(event, '${s.id}')"></i>
//                     <i class="fa-solid fa-location-arrow icon-btn" style="color:var(--blue)" onclick="openNav(event, '${s.lat}','${s.lng}', '${(s.address || '').replace(/'/g, "\\'")}')"></i>
//                 </div>
//             `;
//         }
        
//         item.onclick = (e) => {
//             if (!e.shiftKey) selectedIds.clear();
//             selectedIds.has(s.id) ? selectedIds.delete(s.id) : selectedIds.add(s.id);
//             if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
//             if (typeof focusPin === 'function') focusPin(s.id);
//         };

//         if(s.lng && s.lat) {
//             const el = document.createElement('div');
//             el.className = `marker ${s.status.toLowerCase().replace(' ', '-')}`; 
            
//             const style = getVisualStyle(s);
//             el.innerHTML = `<div class="pin-visual" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};"><span>${displayIndex}</span></div>`;

//             if (urgencyClass && s.status.toLowerCase() !== 'completed') {
//                 const w = document.createElement('div'); w.className = 'marker-warning'; 
//                 w.innerText = (urgencyClass === 'past-due') ? '⚠️' : '❕';
//                 el.appendChild(w);
//             }
            
//             el.addEventListener('click', (e) => {
//                 e.stopPropagation();
//                 if (!e.shiftKey) selectedIds.clear();
//                 selectedIds.has(s.id) ? selectedIds.delete(s.id) : selectedIds.add(s.id);
//                 if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
//                 focusTile(s.id);
//             });
            
//             const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
//             m._stopId = s.id; markers.push(m); bounds.extend([s.lng, s.lat]);
//         }
//         return item;
//     };

//     if (isSingleInspector || !isManagerView) {
//         const unroutedStops = activeStops.filter(s => !isRouteAssigned(s.status));
//         const routedStops = activeStops.filter(s => isRouteAssigned(s.status));

//         let eps = null;
//         if (typeof getActiveEndpoints === 'function') eps = getActiveEndpoints();
//         if (eps && eps.start) listContainer.appendChild(createEndpointRow('start', eps.start));

//         if (activeStops.length === 0) {
//             if (isManagerView) {
//                 listContainer.appendChild(createDropzone());
//             }
//         }

//         if (unroutedStops.length > 0) {
//             const unroutedDiv = document.createElement('div');
//             unroutedDiv.id = 'unrouted-list';
//             unroutedDiv.style.minHeight = '30px'; 
//             listContainer.appendChild(unroutedDiv);
            
//             if (isManagerView) {
//                 const el = document.createElement('div'); el.className = 'list-subheading'; el.innerText = 'UNROUTED ORDERS';
//                 unroutedDiv.appendChild(el); 
//             }
            
//             unroutedStops.forEach((s, i) => { unroutedDiv.appendChild(processStop(s, i + 1, hasRouted)); });
//         }
        
//         if (routedStops.length > 0) {
//             const uniqueClusters = [...new Set(routedStops.map(s => s.cluster === 'X' ? 0 : (s.cluster || 0)))].sort();
//             uniqueClusters.forEach(clusterId => {
//                 const cStops = routedStops.filter(s => (s.cluster === 'X' ? 0 : (s.cluster || 0)) === clusterId);
//                 if (cStops.length > 0) {
//                     const routedDiv = document.createElement('div');
//                     routedDiv.id = isManagerView ? `routed-list-${clusterId}` : `driver-list-${clusterId}`;
//                     routedDiv.className = 'routed-group-container';
//                     routedDiv.style.minHeight = '30px';
//                     listContainer.appendChild(routedDiv);
                    
//                     routedDiv.appendChild(createRouteSubheading(clusterId, cStops)); 
                    
//                     cStops.forEach((s, i) => { routedDiv.appendChild(processStop(s, i + 1, true)); });
//                 }
//             });
//         }
        
//         if (eps && eps.end) listContainer.appendChild(createEndpointRow('end', eps.end));
        
//     } else {
//         const mainDiv = document.createElement('div');
//         mainDiv.id = 'main-list-container';
//         listContainer.appendChild(mainDiv);
        
//         if (activeStops.length === 0) {
//             if (isManagerView) {
//                 mainDiv.appendChild(createDropzone());
//             }
//         } else {
//             activeStops.forEach((s, i) => mainDiv.appendChild(processStop(s, i + 1, false)));
//         }
//     }

//     let endpointsToDraw = [];
    
//     const pushEndpoint = (lng, lat, dId, type) => {
//         if (lng && lat) {
//             let existing = endpointsToDraw.find(e => e.lng === lng && e.lat === lat && String(e.driverId) === String(dId));
//             if (existing) {
//                 if (type === 'start') existing.isStart = true;
//                 if (type === 'end') existing.isEnd = true;
//             } else {
//                 endpointsToDraw.push({ lng, lat, driverId: dId, isStart: type === 'start', isEnd: type === 'end' });
//             }
//         }
//     };

//     if (isAllInspectors) {
//         const activeDriverIds = new Set(activeStops.map(s => String(s.driverId)));
//         inspectors.forEach(insp => {
//             if (activeDriverIds.has(String(insp.id))) {
//                 let sLng = insp.startLng; let sLat = insp.startLat;
//                 let eLng = insp.endLng || insp.startLng; let eLat = insp.endLat || insp.startLat;
//                 pushEndpoint(parseFloat(sLng), parseFloat(sLat), insp.id, 'start');
//                 pushEndpoint(parseFloat(eLng), parseFloat(eLat), insp.id, 'end');
//             }
//         });
//     } else {
//         let eps = null;
//         if (typeof getActiveEndpoints === 'function') eps = getActiveEndpoints();
//         let cInsp = inspectors.find(i => String(i.id) === String(isManagerView ? currentInspectorFilter : driverParam));
//         let dId = cInsp ? cInsp.id : null;
//         if (eps && eps.start && eps.start.lng && eps.start.lat) pushEndpoint(parseFloat(eps.start.lng), parseFloat(eps.start.lat), dId, 'start');
//         if (eps && eps.end && eps.end.lng && eps.end.lat) pushEndpoint(parseFloat(eps.end.lng), parseFloat(eps.end.lat), dId, 'end');
//     }

//     endpointsToDraw.forEach(ep => {
//         let inspColor = '#ffffff';
//         if (ep.driverId) {
//             const dIdx = inspectors.findIndex(i => String(i.id) === String(ep.driverId));
//             if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
//         } else if (currentInspectorFilter !== 'all') {
//             const dIdx = inspectors.findIndex(i => String(i.id) === String(currentInspectorFilter));
//             if (dIdx > -1) inspColor = MASTER_PALETTE[dIdx % MASTER_PALETTE.length];
//         }
        
//         let emojisHtml = '';
//         if (ep.isStart) emojisHtml += `<div style="position: absolute; top: -14px; left: -5px; font-size: 16px;">🏠</div>`;
//         if (ep.isEnd) emojisHtml += `<div style="position: absolute; top: -14px; right: -5px; font-size: 16px;">🏁</div>`;
        
//         const el = document.createElement('div');
//         el.className = 'marker start-end-marker';
        
//         el.innerHTML = `
//             <div class="pin-visual" style="background-color: ${inspColor}; border: none; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>
//             ${emojisHtml}
//         `;
        
//         const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([ep.lng, ep.lat]).addTo(map);
//         markers.push(m);
//         bounds.extend([ep.lng, ep.lat]);
//     });

//     if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
//         initialBounds = bounds; 
//         map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate: !isFirstMapRender }); 
//         if (isFirstMapRender) isFirstMapRender = false;
//     }
    
//     if (typeof updateSelectionUI === 'function') updateSelectionUI();
//     initSortable(); 
    
//     setTimeout(() => { if (typeof map !== 'undefined') map.resize(); }, 150);
// };

// window.toggleComplete = async function(e, id) {
//     e.stopPropagation();
//     if (typeof pushToHistory === 'function') pushToHistory();
//     const idx = stops.findIndex(s => String(s.id) === String(id));
//     const isCurrentlyCompleted = stops[idx].status.toLowerCase() === 'completed';
//     const newStatus = isCurrentlyCompleted ? (stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
//     stops[idx].status = newStatus;
//     render(); 
//     if (typeof drawRoute === 'function') drawRoute(); 
//     if (typeof updateSummary === 'function') updateSummary();
    
//     try {
//         let payload = { 
//             action: 'updateOrder', 
//             rowId: id, 
//             driverId: stops[idx].driverId, 
//             updates: { status: getStatusCode(newStatus) },
//             adminId: adminParam
//         };
//         if (!isManagerView) payload.routeId = routeId;
//         await apiFetch(payload);
//     } catch(err) { console.error("Toggle Complete Error", err); }
// };

// window.updateSelectionUI = function() { 
//     document.querySelectorAll('.stop-item, .glide-row').forEach(el=>el.classList.remove('selected')); 
//     markers.forEach(m=>{ 
//         if(m._stopId) {
//             m.getElement().classList.toggle('bulk-selected', selectedIds.has(m._stopId)); 
//             if(selectedIds.has(m._stopId)) { const row = document.getElementById(`item-${m._stopId}`); if (row) row.classList.add('selected'); } 
//         }
//     }); 
    
//     const has = selectedIds.size>0; 
//     let hasRouted = false;
    
//     selectedIds.forEach(id => {
//         const s = stops.find(st => String(st.id) === String(id));
//         if (s && isRouteAssigned(s.status)) hasRouted = true;
//     });

//     const selectAllCb = document.getElementById('bulk-select-all');
//     if (selectAllCb) {
//         const activeStops = stops.filter(s => isStopVisible(s, true));
//         selectAllCb.checked = (activeStops.length > 0 && selectedIds.size === activeStops.length);
//     }
    
//     document.getElementById('bulk-delete-btn').style.display = (has && PERMISSION_MODIFY && isManagerView) ? 'block' : 'none'; 
//     document.getElementById('bulk-unroute-btn').style.display = (hasRouted && PERMISSION_MODIFY) ? 'block' : 'none'; 

//     for(let i=1; i<=3; i++) {
//         const btn = document.getElementById(`move-r${i}-btn`);
//         if(btn) {
//             if(isManagerView && currentInspectorFilter !== 'all' && has && i <= currentRouteCount && currentRouteCount > 1) {
//                 let allInTargetRoute = true;
//                 selectedIds.forEach(id => {
//                     const s = stops.find(st => String(st.id) === String(id));
//                     if (s && s.cluster !== (i - 1)) {
//                         allInTargetRoute = false;
//                     }
//                 });
//                 btn.style.display = allInTargetRoute ? 'none' : 'block';
//             } else {
//                 btn.style.display = 'none';
//             }
//         }
//     }
// };

// window.focusTile = function(id) { 
//     document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
// };

// window.filterList = function() { 
//     const q = document.getElementById('search-input').value.toLowerCase(); 
//     document.querySelectorAll('.stop-item, .glide-row').forEach(el => el.style.display = el.getAttribute('data-search').includes(q) ? 'flex' : 'none'); 
// };

// window.openNav = function(e, la, ln, addr) { 
//     e.stopPropagation(); 
//     let p = localStorage.getItem('navPref'); 
//     if (!p) { showNavChoice(la, ln, addr); } 
//     else { launchMaps(p, la, ln, addr); } 
// };

// function showNavChoice(la, ln, addr) { 
//     const m = document.getElementById('modal-overlay'); 
//     m.style.display = 'flex'; 
//     document.getElementById('modal-content').innerHTML = `<h3>Maps Preference:</h3><div style="display:flex; flex-direction:column; gap:8px;"><button style="padding:12px; border:none; border-radius:6px; background:var(--blue); color:white; font-weight:bold;" onclick="setNavPref('google','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Google Maps</button><button style="padding:12px; border:none; border-radius:6px; background:#444; color:#fff" onclick="setNavPref('apple','${la}','${ln}','${(addr||'').replace(/'/g,"\\'")}')">Apple Maps</button></div>`; 
// }

// window.setNavPref = function(p, la, ln, addr) { 
//     localStorage.setItem('navPref', p); 
//     document.getElementById('modal-overlay').style.display = 'none'; 
//     launchMaps(p, la, ln, addr); 
// };

// function launchMaps(p, la, ln, addr) { 
//     let safeAddr = encodeURIComponent(addr || "Destination");
//     if (p === 'google') {
//         window.location.href = `comgooglemaps://?daddr=${la},${ln}+(${safeAddr})&directionsmode=driving`; 
//     } else {
//         window.location.href = `http://maps.apple.com/?daddr=${la},${ln}&dirflg=d`; 
//     }
// }

// window.initSortable = function() {
//     sortableInstances.forEach(inst => inst.destroy());
//     sortableInstances = [];
//     if (sortableUnrouted) { sortableUnrouted.destroy(); sortableUnrouted = null; }

//     if (!PERMISSION_MODIFY) return;

//     if (isManagerView && currentInspectorFilter !== 'all') {
//         const unroutedEl = document.getElementById('unrouted-list');

//         document.querySelectorAll('.routed-group-container').forEach(routedEl => {
//             const inst = Sortable.create(routedEl, {
//                 group: 'manager-routes',
//                 handle: '.handle',
//                 filter: '.static-endpoint, .list-subheading',
//                 animation: 150,
//                 onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); },
//                 onEnd: async (evt) => {
//                     let isMovedToUnrouted = false;
//                     const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
                    
//                     const stopId = evt.item.id.replace('item-', '');
//                     const stop = stops.find(s => String(s.id) === String(stopId));
                    
//                     if (stop) {
//                         const dId = stop.driverId;
//                         let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
//                         if (matchOld && typeof markRouteDirty === 'function') markRouteDirty(dId, parseInt(matchOld[2]));
                        
//                         let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
//                         if (matchNew) {
//                             stop.cluster = parseInt(matchNew[2]);
//                             stop.manualCluster = true;
//                             if (hasActiveRoutes) {
//                                 stop.status = 'Routed';
//                                 stop.routeState = 'Staging';
//                                 if (typeof markRouteDirty === 'function') markRouteDirty(dId, stop.cluster);
//                             }
//                         }
//                     }

//                     if (evt.to.id === 'unrouted-list') {
//                         isMovedToUnrouted = true;
//                         const idx = stops.findIndex(s => String(s.id) === String(stopId));
//                         let dId = null;
//                         if (idx > -1) {
//                             dId = stops[idx].driverId;
//                             stops[idx].status = 'Pending'; 
//                             stops[idx].routeState = 'Pending';
//                             stops[idx].cluster = 'X';
//                             stops[idx].manualCluster = false;
//                             stops[idx].eta = '';
//                             stops[idx].dist = 0;
//                             stops[idx].durationSecs = 0;
//                             if (viewMode === 'inspector') stops[idx].hiddenInInspector = true;
//                         }
                        
//                         const overlay = document.getElementById('processing-overlay');
//                         if(overlay) overlay.style.display = 'flex';
//                         try {
//                             let unroutePayload = { 
//                                 action: 'updateOrder', 
//                                 rowId: stopId, 
//                                 driverId: dId, 
//                                 updates: { status: 'P', eta: '', dist: 0, durationSecs: 0, routeNum: 'X' },
//                                 adminId: adminParam
//                             };
//                             if (!isManagerView) unroutePayload.routeId = routeId;
//                             await apiFetch(unroutePayload);
//                         } catch (e) { console.error(e); }
//                         finally { if(overlay) overlay.style.display = 'none'; }
//                     }
                    
//                     if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
//                     render(); 
//                     if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
                    
//                     if (isMovedToUnrouted) {
//                         if (typeof drawRoute === 'function') drawRoute(); 
//                         if (typeof updateSummary === 'function') updateSummary(); 
//                         if (typeof updateRouteTimes === 'function') updateRouteTimes();
//                     }
//                 }
//             });
//             sortableInstances.push(inst);
//         });
        
//         if (unroutedEl) {
//             sortableUnrouted = Sortable.create(unroutedEl, {
//                 group: 'manager-routes',
//                 sort: false, 
//                 handle: '.handle',
//                 filter: '.list-subheading',
//                 animation: 150,
//                 onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); }
//             });
//         }
//     } else if (!isManagerView) {
//         document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
//             const inst = Sortable.create(el, {
//                 delay: 200,
//                 delayOnTouchOnly: true,
//                 filter: '.static-endpoint, .list-subheading',
//                 animation: 150,
//                 onStart: () => { if (typeof pushToHistory === 'function') pushToHistory(); },
//                 onEnd: (evt) => {
//                     const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
//                     const stopId = evt.item.id.replace('item-', '');
//                     const stop = stops.find(s => String(s.id) === String(stopId));
//                     if (stop) {
//                         const dId = stop.driverId;
//                         let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
//                         if (matchOld && typeof markRouteDirty === 'function') markRouteDirty(dId, parseInt(matchOld[2]));
                        
//                         let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
//                         if (matchNew) {
//                             stop.cluster = parseInt(matchNew[2]);
//                             stop.manualCluster = true;
//                             if (hasActiveRoutes) {
//                                 stop.status = 'Routed';
//                                 stop.routeState = 'Staging';
//                                 if (typeof markRouteDirty === 'function') markRouteDirty(dId, stop.cluster);
//                             }
//                         }
//                     }

//                     if (typeof reorderStopsFromDOM === 'function') reorderStopsFromDOM();
//                     render(); 
//                     if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
//                 }
//             });
//             sortableInstances.push(inst);
//         });
//     }
// };

// // Setup Header Dropzone Listeners
// const headerDropzone = document.getElementById('header-csv-upload');
// const headerInput = document.getElementById('header-file-input');
// if (headerDropzone && headerInput) {
//     headerDropzone.onclick = () => headerInput.click();
//     headerDropzone.ondragover = (e) => {
//         e.preventDefault();
//         headerDropzone.classList.add('drag-active');
//     };
//     headerDropzone.ondragleave = (e) => {
//         e.preventDefault();
//         headerDropzone.classList.remove('drag-active');
//     };
//     headerDropzone.ondrop = (e) => {
//         e.preventDefault();
//         headerDropzone.classList.remove('drag-active');
//         if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
//             handleFileSelection(e.dataTransfer.files[0]);
//         }
//     };
//     headerInput.onchange = (e) => {
//         if (e.target.files && e.target.files.length > 0) {
//             handleFileSelection(e.target.files[0]);
//             headerInput.value = ''; // Reset input
//         }
//     };
// }

// // INITIALIZATION
// if (isTestingMode && typeof initTestingModeUI === 'function') {
//     initTestingModeUI();
// }

// if (typeof loadData === 'function') {
//     loadData();
// }
