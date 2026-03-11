// *
// * Dashboard - V6.6
// * FILE: api.js
// * Description: Handles all Fetch requests to the Apps Script backend.
// *

import { Config, State, expandStop, minifyStop, getStatusCode, markRouteDirty, getStatusText, isActiveStop } from './state.js';
import { render, updateSummary, updateUndoUI, updateInspectorDropdown, updateRouteButtonColors, getActiveEndpoints, updateSelectionUI, updateRouteTimes, customAlert, customConfirm } from './ui.js';
import { drawRoute, map } from './map.js';
import { initSortable, reorderStopsFromDOM } from './drag-drop.js';

export function silentSaveRouteState() {
    if (!State.routeId) return;
    const inspId = State.isManagerView ? State.currentInspectorFilter : State.driverParam;
    if (inspId === 'all') return;
    
    let routeStops = State.stops.filter(s => s.routeTargetId === String(State.routeId) && s.status.toLowerCase() !== 'deleted' && s.status.toLowerCase() !== 'cancelled');
    if (routeStops.length === 0) return;

    let minified = routeStops.map(s => {
        let rNum = (s.cluster || 0) + 1;
        let outEta = s.eta;
        let outDist = s.dist;
        let outDur = s.durationSecs;
        
        const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
        if (State.dirtyRoutes.has(routeKey) || State.dirtyRoutes.has('all') || s.status.toLowerCase() === 'pending') {
            outEta = ''; outDist = ''; outDur = 0;
        }

        return [
            s.rowId || s.id || "", Number(s.seq) || 0, 'R:' + rNum, s.address || "", s.client || "", s.app || "",                                            
            s.dueDate || "", s.type || "", outEta || "", outDist || "", s.lat ? Number(parseFloat(s.lat).toFixed(5)) : 0,       
            s.lng ? Number(parseFloat(s.lng).toFixed(5)) : 0, getStatusCode(s.status), Number(outDur) || 0                             
        ];
    });
    
    fetch(Config.WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveRoute', routeId: State.routeId, stops: minified })
    }).catch(e => console.log("Silent save error", e));
}

export async function loadData() {
    let queryParams = '';
    if (State.companyParam) queryParams = `?company=${State.companyParam}`;
    else if (State.driverParam) queryParams = `?driver=${State.driverParam}`;
    else if (State.routeId) queryParams = `?id=${State.routeId}`;
    else {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`${Config.WEB_APP_URL}${queryParams}`);
        const data = await res.json();
        
        if (data.status === 'processing' || data.status === 'queued') {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'flex';
            setTimeout(loadData, 5000);
            return; 
        }

        if (data.routeId) State.routeId = data.routeId;
        if (data.needsRecalculation) { State.isAlteredRoute = true; State.dirtyRoutes.add('all'); }

        State.routeStart = data.routeStart || null;
        State.routeEnd = data.routeEnd || null;
        if (data.isAlteredRoute) State.isAlteredRoute = true;

        let rawStops = Array.isArray(data) ? data : (data.stops || []);
        
        State.stops = rawStops.map(s => {
            let exp = expandStop(s);
            return {
                ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster || 0,
                manualCluster: false, _hasExplicitCluster: s.R !== undefined, hiddenInInspector: false,
                routeState: exp.routeState || s.routeState || 'Pending', routeTargetId: exp.routeTargetId || s.routeTargetId || null
            };
        });

        State.stops.forEach(s => {
            if (s.routeState === 'Staging' && s.driverId) {
                if (!s.eta || s.eta === '--' || s.eta === '') markRouteDirty(s.driverId, s.cluster);
            }
        });

        if (State.isPollingForRoute) {
            const driverHasRouted = State.stops.some(s => s.driverId === State.currentInspectorFilter && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched'));
            if (!driverHasRouted && State.pollRetries < 15) {
                State.pollRetries++;
                const overlay = document.getElementById('processing-overlay');
                if (overlay) overlay.style.display = 'flex';
                setTimeout(loadData, 5000);
                return;
            } else {
                State.isPollingForRoute = false; 
                State.dirtyRoutes.clear(); 
            }
        }

        const getLocalDateStr = (etaStr) => {
            if (!etaStr) return "";
            const d = new Date(etaStr);
            return isNaN(d.getTime()) ? String(etaStr).split(' ')[0] : d.toDateString();
        };

        let activeDates = [...new Set(State.stops.filter(s => s.eta && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')).map(s => getLocalDateStr(s.eta)))];
        activeDates = activeDates.filter(Boolean).sort((a, b) => new Date(a) - new Date(b));

        State.stops.forEach(s => {
            if (!s._hasExplicitCluster && s.eta && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')) {
                s.cluster = Math.max(0, activeDates.indexOf(getLocalDateStr(s.eta)));
            }
        });

        if (activeDates.length > 0) {
            State.currentRouteCount = activeDates.length;
            const cappedCount = Math.min(3, activeDates.length);
            for(let i=1; i<=3; i++) {
                const btn = document.getElementById(`rbtn-${i}`);
                if(btn) btn.classList.toggle('active', i === cappedCount);
            }
        }
        document.body.setAttribute('data-route-count', State.currentRouteCount);

        State.originalStops = JSON.parse(JSON.stringify(State.stops)); 
        if (State.stops.length > 0 && State.stops[0].eta) State.currentStartTime = State.stops[0].eta;
        State.historyStack = [];

        if (!Array.isArray(data)) {
            if (data.defaultEmailMessage) State.defaultEmailMessage = data.defaultEmailMessage;
            if (data.companyEmail) State.companyEmail = data.companyEmail;
            if (data.managerEmail) State.managerEmail = data.managerEmail;

            State.inspectors = data.inspectors || []; 
            State.inspectors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (data.serviceDelay !== undefined) State.COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay) || 0; 
            if (data.permissions) {
                if (typeof data.permissions.modify !== 'undefined') State.PERMISSION_MODIFY = data.permissions.modify;
                if (typeof data.permissions.reoptimize !== 'undefined') State.PERMISSION_REOPTIMIZE = data.permissions.reoptimize;
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

            if (State.isManagerView && data.tier && data.tier.toLowerCase() !== 'individual') {
                if (sidebarDriverEl) sidebarDriverEl.style.display = 'none';
                if (sidebarLogo) sidebarLogo.style.display = 'none'; 
                if (filterSelect) filterSelect.style.display = 'block';
                updateInspectorDropdown(); 
            } else {
                if (sidebarDriverEl) sidebarDriverEl.innerText = displayName;
            }
            updateRouteButtonColors();
            
            let hasValidStops = State.stops.filter(s => isActiveStop(s) && s.lng && s.lat).length > 0;
            if (!hasValidStops && data.companyAddress) {
                const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.companyAddress)}.json?access_token=${Config.MAPBOX_TOKEN}`;
                fetch(geoUrl).then(r => r.json()).then(geo => {
                    if (geo.features && geo.features.length > 0) map.flyTo({ center: geo.features[0].center, zoom: 11 });
                }).catch(err => console.error("Geocoding failed for company address.", err));
            }
        }

        render(); drawRoute(); updateSummary(); initSortable();

    } catch (e) { 
        console.error("Error loading data:", e); 
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay && !State.isPollingForRoute) overlay.style.display = 'none';
        updateUndoUI();
    }
}

export async function handleCalculate() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const activeStops = State.stops.filter(s => isActiveStop(s) && s.lng && s.lat);
        const inspId = State.isManagerView ? State.currentInspectorFilter : State.driverParam;
        let validStops = [];

        if (State.isManagerView && inspId !== 'all') {
            validStops = activeStops.filter(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched' || (s.status||'').toLowerCase() === 'completed'));
        } else {
            validStops = activeStops.filter(s => ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched' || (s.status||'').toLowerCase() === 'completed'));
        }

        let stopsToCalculate = validStops.filter(s => {
            const routeKey = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
            return State.dirtyRoutes.has(routeKey) || State.dirtyRoutes.has('all');
        });

        if (stopsToCalculate.length === 0 && !State.dirtyRoutes.has('endpoints_0')) { 
            if (overlay) overlay.style.display = 'none';
            return; 
        }

        const eps = getActiveEndpoints();
        let payload = {
            action: 'calculate', routeId: State.routeId, driver: State.driverParam,
            startTime: State.currentStartTime, startAddr: eps.start?.address || null, endAddr: eps.end?.address || null,
            isManager: State.isManagerView, stops: validStops.map(s => minifyStop(s, (s.cluster || 0) + 1))
        };

        const res = await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s);
            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: exp.cluster || 0, manualCluster: false });
        });

        State.stops = State.stops.map(s => {
            if (returnedStopsMap.has(s.id)) {
                let updated = returnedStopsMap.get(s.id);
                updated.routeState = 'Ready'; 
                return updated;
            }
            return s;
        });

        if (!State.isManagerView) State.isAlteredRoute = true;
        State.historyStack = []; 
        State.dirtyRoutes.clear();
        State.originalStops = JSON.parse(JSON.stringify(State.stops)); 
        render(); drawRoute(); updateSummary();

    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error calculating the route. Please try again."); 
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

export async function handleGenerateRoute() {
    if (State.currentInspectorFilter === 'all') return;
    const insp = State.inspectors.find(i => i.id === State.currentInspectorFilter);
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    let clusteredArrays = [];
    for(let i = 0; i < State.currentRouteCount; i++) {
        let itemsInCluster = State.stops.filter(s => isActiveStop(s) && s.lng && s.lat && s.cluster === i && (s.status||'').toLowerCase() !== 'routed' && (s.status||'').toLowerCase() !== 'completed' && (s.status||'').toLowerCase() !== 'dispatched');
        if (itemsInCluster.length > 0) {
            clusteredArrays.push(itemsInCluster.map(s => minifyStop(s, i + 1)));
        }
    }

    const eps = getActiveEndpoints();
    let sAddr = eps.start ? eps.start.address : '';
    let eAddr = eps.end ? eps.end.address : '';

    try {
        const res = await fetch(Config.WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'generateRoute', inspectorName: insp.name, driverId: insp.id, routeClusters: clusteredArrays, startAddr: sAddr, endAddr: eAddr })
        });
        const data = await res.json();
        
        if (data.status === 'queued' || data.success) {
            fetch(Config.WEB_APP_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'processQueue', routeId: State.routeId, driverId: insp.id })
            }).catch(err => { console.log("Ignored expected timeout from processQueue"); });
            
            State.isPollingForRoute = true;
            State.pollRetries = 0;
            setTimeout(loadData, 5000);
        } else { await loadData(); }
    } catch (e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Generation encountered an error. Please wait a moment and try again.");
    } 
}

export async function finalizeSync(type, directStart = null, directEnd = null) {
    const eps = getActiveEndpoints();
    const startAddr = directStart !== null ? directStart : (document.getElementById('input-endpoint-start')?.value || '');
    const endAddr = directEnd !== null ? directEnd : (document.getElementById('input-endpoint-end')?.value || '');
    
    const modal = document.getElementById('modal-overlay');
    if(modal) modal.style.display = 'none';
    
    let sLat = State.routeStart && State.routeStart.lat ? State.routeStart.lat : eps.start?.lat || null;
    let sLng = State.routeStart && State.routeStart.lng ? State.routeStart.lng : eps.start?.lng || null;
    let eLat = State.routeEnd && State.routeEnd.lat ? State.routeEnd.lat : eps.end?.lat || null;
    let eLng = State.routeEnd && State.routeEnd.lng ? State.routeEnd.lng : eps.end?.lng || null;

    let payload = { 
        action: type, routeId: State.routeId, driver: State.driverParam, 
        startTime: State.currentStartTime, startAddr: startAddr, endAddr: endAddr,
        startLat: sLat, startLng: sLng, endLat: eLat, endLng: eLng,
        isManager: State.isManagerView
    };

    if (State.isManagerView && State.currentInspectorFilter !== 'all') {
        let clusteredArrays = [];
        for(let i = 0; i < State.currentRouteCount; i++) {
            let itemsInCluster = State.stops.filter(s => s.cluster === i);
            if (itemsInCluster.length > 0) clusteredArrays.push(itemsInCluster.map(s => minifyStop(s, i + 1)));
        }
        payload.routeClusters = clusteredArrays;
        payload.priorityLevel = document.getElementById('slider-priority') ? document.getElementById('slider-priority').value : 0;
    } else {
        payload.stops = State.stops.map(s => minifyStop(s, (s.cluster || 0) + 1));
    }

    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const res = await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json(); 
        State.stops = data.updatedStops.map(s => {
            let exp = expandStop(s);
            return { ...exp, id: exp.rowId || exp.id, cluster: exp.cluster || 0, manualCluster: false, routeState: 'Ready' };
        });
        
        if (!State.isManagerView) State.isAlteredRoute = true;
        State.historyStack = [];
        State.dirtyRoutes.clear();
        render(); drawRoute(); updateSummary();
    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error updating locations. Please try again."); 
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

export async function toggleComplete(e, id) {
    import('./ui.js').then(ui => ui.pushToHistory());
    e.stopPropagation();
    const idx = State.stops.findIndex(s => s.id == id);
    const isCurrentlyCompleted = State.stops[idx].status.toLowerCase() === 'completed';
    const newStatus = isCurrentlyCompleted ? (State.stops[idx].routeState === 'Dispatched' ? 'Dispatched' : 'Routed') : 'Completed';
    State.stops[idx].status = newStatus;
    render(); drawRoute(); updateSummary();
    
    try {
        await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'updateOrder', rowId: id, updates: { status: getStatusCode(newStatus) } }) });
    } catch(err) { console.error("Toggle Complete Error", err); }
}

export async function triggerBulkComplete() { 
    if(!(await customConfirm("Mark selected orders as completed?"))) return;
    import('./ui.js').then(ui => ui.pushToHistory());
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        const completePromises = Array.from(State.selectedIds).map(id => {
            const idx = State.stops.findIndex(s => s.id === id);
            if (idx > -1) State.stops[idx].status = 'Completed';
            return fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'updateOrder', rowId: id, updates: { status: 'C' } }) });
        });
        await Promise.all(completePromises);
        State.selectedIds.clear(); 
        render(); drawRoute(); updateSummary(); updateRouteTimes();
        silentSaveRouteState();
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error completing orders. Please try again.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

export async function triggerBulkDelete() { 
    if(!(await customConfirm("Delete selected orders?"))) return;
    import('./ui.js').then(ui => ui.pushToHistory());
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        State.selectedIds.forEach(id => {
            const s = State.stops.find(st => st.id === id);
            if (s && ((s.status || '').toLowerCase() === 'routed' || (s.status || '').toLowerCase() === 'dispatched')) markRouteDirty(s.driverId, s.cluster);
        });

        const deletePromises = Array.from(State.selectedIds).map(id => {
            const idx = State.stops.findIndex(s => s.id === id);
            if (idx > -1) State.stops[idx].status = 'Deleted';
            return fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'markOrderDeleted', rowId: id }) });
        });
        
        await Promise.all(deletePromises);
        State.selectedIds.clear(); 
        updateInspectorDropdown(); 
        reorderStopsFromDOM(); render(); drawRoute(); updateSummary(); updateRouteTimes();
        silentSaveRouteState();
    } catch (err) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error deleting orders. Please try again.");
    } finally {
        if(overlay) overlay.style.display = 'none';
    }
}

export async function triggerBulkUnroute() { 
    if(!(await customConfirm("Remove selected orders from route?"))) return;
    import('./ui.js').then(ui => ui.pushToHistory());
    
    State.selectedIds.forEach(id => {
        const idx = State.stops.findIndex(s => s.id === id);
        if (idx > -1) {
            if ((State.stops[idx].status || '').toLowerCase() === 'routed' || (State.stops[idx].status || '').toLowerCase() === 'dispatched') {
                markRouteDirty(State.stops[idx].driverId, State.stops[idx].cluster);
            }
            State.stops[idx].status = 'Pending';
            if (!State.isManagerView) State.stops[idx].hiddenInInspector = true; 
        }
    });
    
    State.selectedIds.clear(); 
    reorderStopsFromDOM(); render(); drawRoute(); updateSummary(); updateRouteTimes();
    silentSaveRouteState();
}

export async function processReassignDriver(rowId, newDriverName, newDriverId) {
    const stopIdx = State.stops.findIndex(s => s.id === rowId);
    if (stopIdx > -1) { State.stops[stopIdx].driverName = newDriverName; State.stops[stopIdx].driverId = newDriverId; }
    const payload = { action: 'updateOrder', rowId: rowId, updates: { driverName: newDriverName, driverId: newDriverId } };
    return fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
}

export async function handleInspectorChange(e, rowId, selectEl) {
    e.stopPropagation(); 
    const newDriverId = selectEl.value;
    const newDriverName = selectEl.options[selectEl.selectedIndex].text;
    
    let idsToUpdate = [rowId];
    if (State.selectedIds.has(rowId) && State.selectedIds.size > 1) {
        if (await customConfirm(`Reassign all ${State.selectedIds.size} selected orders to ${newDriverName}?`)) {
            idsToUpdate = Array.from(State.selectedIds);
        } else { render(); return; }
    }
    
    import('./ui.js').then(ui => ui.pushToHistory());
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try { 
        idsToUpdate.forEach(id => {
            const s = State.stops.find(st => st.id === id);
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

export async function handleEndpointOptimize() {
    const eps = getActiveEndpoints();
    let sVal = document.getElementById('input-endpoint-start')?.value || eps.start?.address;
    let eVal = document.getElementById('input-endpoint-end')?.value || eps.end?.address;
    
    if (State.routeStart) State.routeStart.address = sVal; else State.routeStart = { address: sVal, lat: eps.start?.lat, lng: eps.start?.lng };
    if (State.routeEnd) State.routeEnd.address = eVal; else State.routeEnd = { address: eVal, lat: eps.end?.lat, lng: eps.end?.lng };

    await finalizeSync('optimize', sVal, eVal);
    
    if(State.routeId) {
        let sPayload = { action: 'updateEndpoint', routeId: State.routeId, type: 'start', address: sVal };
        if (State.routeStart && State.routeStart.lat) { sPayload.lat = State.routeStart.lat; sPayload.lng = State.routeStart.lng; }
        fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(sPayload) }).catch(()=>{});
        
        let ePayload = { action: 'updateEndpoint', routeId: State.routeId, type: 'end', address: eVal };
        if (State.routeEnd && State.routeEnd.lat) { ePayload.lat = State.routeEnd.lat; ePayload.lng = State.routeEnd.lng; }
        fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(ePayload) }).catch(()=>{});
    }
    
    State.dirtyRoutes.delete('endpoints_0');
    render();
}

export async function handleStartOver() {
    if(!(await customConfirm("Clear All Routes For This Inspector?"))) return;
    const insp = State.inspectors.find(i => i.id === State.currentInspectorFilter);
    if (!insp) return;
    await executeRouteReset(insp.id);
}

export async function executeRouteReset(driverId) {
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'resetRoute', driverId: driverId, routeId: State.routeId }) });
        State.historyStack = []; 
        State.stops.forEach(s => {
            if (s.driverId === driverId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'dispatched')) {
                s.eta = ''; s.dist = ''; s.status = 'Pending'; s.routeState = 'Pending';
            }
        });
        State.routeStart = null; State.routeEnd = null;
        State.dirtyRoutes.clear();
        render(); drawRoute(); updateSummary(); updateUndoUI();
    } catch(e) { 
        await customAlert("Error resetting the route."); 
    } finally { 
        if(overlay) overlay.style.display = 'none'; 
    }
}

export async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'restoreOriginalRoute', routeId: State.routeId }) });
        await loadData(); 
    } catch(e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error restoring the route. Please try again."); 
    } finally {
        if(overlay) overlay.style.display = 'none'; 
    }
}

export async function saveEndpointToBackend(type, address, lat, lng) {
    const inspId = State.isManagerView ? State.currentInspectorFilter : State.driverParam;
    const activeStops = State.stops.filter(s => isActiveStop(s));
    const hasRouted = activeStops.some(s => s.driverId === inspId && ((s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched'));
    
    import('./ui.js').then(ui => ui.pushToHistory());
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    let action = hasRouted ? 'updateEndpoint' : 'updateInspectorDefault';
    let payload = { action, type, address, lat, lng };
    
    if (hasRouted) payload.routeId = State.routeId; 
    else payload.driverId = inspId;
    
    try {
        const res = await fetch(Config.WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}
