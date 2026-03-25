/* * */
/* * Dashboard - V12.5 */
/* * FILE: api.js */
/* * Changes: Extracted network payloads, endpoints, and Testing API logging. */
/* * */

function apiFetch(payload) {
    payload.frontEndApiUsage = { geocode: frontEndApiUsage.geocode, mapLoads: frontEndApiUsage.mapLoads };
    frontEndApiUsage.geocode = 0;
    frontEndApiUsage.mapLoads = 0;
    return fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
}

async function loadData() {
    let queryParams = '';
    if (routeId) queryParams = `?id=${routeId}`;
    else if (companyParam) queryParams = `?company=${companyParam}`;
    else if (driverParam) queryParams = `?driver=${driverParam}`;
    if (adminParam) queryParams += (queryParams ? '&' : '?') + `admin=${adminParam}`;
    queryParams += (queryParams ? '&' : '?') + `isManager=${isManagerView}`;

    if (!queryParams) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'none';
        return;
    }

    try {
        let fetchUrl = `${WEB_APP_URL}${queryParams}&_t=${new Date().getTime()}`;
        const res = await fetch(fetchUrl);
        const data = await res.json();
        
        if (isTestingMode) logToTestConsole(`GET loadData() [${activeTestingBackend}]`, data);

        if (data.confirmHijack) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            
            const proceed = await customConfirm(data.message || "The previous admin's session has expired. Do you want to take over and overwrite this Inspector's route?");
            if (overlay) overlay.style.display = 'flex'; 
            
            if (proceed) {
                apiFetch({ action: 'executeHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter }).catch(e => console.log('Hijack execute failed:', e));
            } else {
                apiFetch({ action: 'cancelHijack', adminId: adminParam, driverId: data.driverId || currentInspectorFilter }).catch(e => console.log('Hijack cancel failed:', e));
            }
            setTimeout(loadData, 2000); 
            return;
        }

        if (data.uploadError) {
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'none';
            isFreshGlideRefresh = false;
            await customAlert(data.message || "Upload cancelled. Another admin is currently modifying this Inspector's route.");
            if (adminParam) apiFetch({ action: 'clearAlert', adminId: adminParam }).catch(e => console.log('Clear alert silent error', e));
            return;
        }

        let rawStops = Array.isArray(data) ? data : (data.stops || []);
        let currentSnapshot = JSON.stringify(rawStops);
        let preUploadSnapshot = sessionStorage.getItem('sproute_snapshot');

        if (isFreshGlideRefresh && preUploadSnapshot && (currentSnapshot === preUploadSnapshot || rawStops.length === 0) && pageLoadRetries < MAX_RETRIES) {
            pageLoadRetries++;
            const overlay = document.getElementById('processing-overlay');
            if (overlay) overlay.style.display = 'flex';
            setTimeout(loadData, 3000); 
            return; 
        }
        
        if (isFreshGlideRefresh && preUploadSnapshot && currentSnapshot !== preUploadSnapshot) {
            try {
                const oldStops = JSON.parse(preUploadSnapshot);
                let diffStop = rawStops.find(n => {
                    let oldStr = oldStops.find(o => (o.rowId || o.id || o[0]) === (n.rowId || n.id || n[0]));
                    if (!oldStr) return true; 
                    return JSON.stringify(oldStr) !== JSON.stringify(n);
                });
                if (diffStop) {
                    let expandedDiff = expandStop(diffStop);
                    if (expandedDiff.driverId && isManagerView) {
                        currentInspectorFilter = String(expandedDiff.driverId);
                        sessionStorage.setItem('sproute_inspector_filter', currentInspectorFilter);
                    }
                }
            } catch(e) { console.error("Snapshot diff error:", e); }
        }

        isFreshGlideRefresh = false; 
        if (!data.uploadError && !data.confirmHijack) sessionStorage.setItem('sproute_snapshot', currentSnapshot);
        if (data.routeId) routeId = data.routeId;
        if (data.needsRecalculation) { isAlteredRoute = true; dirtyRoutes.add('all'); }

        routeStart = data.routeStart || null;
        routeEnd = data.routeEnd || null;
        if (data.isAlteredRoute) isAlteredRoute = true;

        let globalRouteState = data.routeState || 'Pending';
        let globalDriverId = data.driverId || (isManagerView && currentInspectorFilter !== 'all' ? currentInspectorFilter : driverParam);
        if (data.adminEmail) adminEmail = data.adminEmail;
        if (data.csvTypes && Array.isArray(data.csvTypes)) availableCsvTypes = data.csvTypes;

        if (isPollingForRoute) {
            let fetchedMap = new Map();
            rawStops.forEach(s => {
                let exp = expandStop(s);
                fetchedMap.set(String(exp.rowId || exp.id), { ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster, manualCluster: false, hiddenInInspector: false, routeState: exp.routeState || s.routeState || globalRouteState, driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: routeId || null });
            });

            stops = stops.map(s => {
                if (fetchedMap.has(String(s.id))) return fetchedMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready'; 
                return s;
            });
            
            stops.forEach(s => {
                if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster);
            });

            const driverHasRouted = stops.some(s => String(s.driverId) === String(currentInspectorFilter) && (isRouteAssigned(s.status) || s.routeState === 'Ready'));
            
            if (!driverHasRouted && pollRetries < 15) {
                pollRetries++;
                const overlay = document.getElementById('processing-overlay');
                if (overlay) overlay.style.display = 'flex';
                setTimeout(loadData, 5000);
                return;
            } else {
                isPollingForRoute = false; dirtyRoutes.clear(); silentSaveRouteState();
            }
        } else {
            stops = rawStops.map(s => {
                let exp = expandStop(s);
                return { ...exp, id: exp.rowId || exp.id, status: getStatusText(exp.status), cluster: exp.cluster, manualCluster: false, hiddenInInspector: false, routeState: exp.routeState || s.routeState || globalRouteState, driverId: exp.driverId || s.driverId || globalDriverId, routeTargetId: routeId || null };
            });

            stops.forEach(s => {
                if ((s.routeState === 'Staging' || s.routeState === 'Staging-endpoint') && s.driverId) markRouteDirty(s.driverId, s.cluster);
            });
        }

        stops.sort((a, b) => {
            let cA = a.cluster === 'X' ? 999 : (a.cluster || 0);
            let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
            if (cA !== cB) return cA - cB;
            return timeToMins(a.eta) - timeToMins(b.eta);
        });

        let maxCluster = 0;
        stops.forEach(s => { if (s.cluster !== 'X' && s.cluster > maxCluster) maxCluster = s.cluster; });
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

        document.body.classList.remove('tier-individual', 'tier-company');
        let acctType = data.accountType ? data.accountType.toLowerCase() : (data.tier ? data.tier.toLowerCase() : 'company');
        document.body.classList.add('tier-' + acctType);
        document.body.classList.toggle('manager-all-inspectors', currentInspectorFilter === 'all');
        document.body.classList.toggle('manager-single-inspector', currentInspectorFilter !== 'all');

        if (!Array.isArray(data)) {
            if (data.defaultEmailMessage) defaultEmailMessage = data.defaultEmailMessage;
            if (data.companyEmail) companyEmail = data.companyEmail;
            if (data.managerEmail) managerEmail = data.managerEmail;
            if (typeof data.ccCompanyDefault !== 'undefined') ccCompanyDefault = !!data.ccCompanyDefault;
            inspectors = data.inspectors || []; inspectors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            if (data.serviceDelay !== undefined) COMPANY_SERVICE_DELAY = parseInt(data.serviceDelay) || 0; 
            if (data.permissions) {
                if (typeof data.permissions.modify !== 'undefined') PERMISSION_MODIFY = data.permissions.modify;
                if (typeof data.permissions.reoptimize !== 'undefined') PERMISSION_REOPTIMIZE = data.permissions.reoptimize;
            }

            const mapLogo = document.getElementById('brand-logo-map');
            const isCompanyTier = document.body.classList.contains('tier-company');
            if (isCompanyTier && data.companyLogo) { if (mapLogo) mapLogo.src = data.companyLogo; } 
            else { const sprouteLogoUrl = 'https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png'; if (mapLogo) mapLogo.src = sprouteLogoUrl; }
            
            let displayName = data.displayName || 'Sproute'; 
            const mapDriverEl = document.getElementById('map-driver-name');
            if (mapDriverEl) mapDriverEl.innerText = displayName;
            const sidebarDriverEl = document.getElementById('sidebar-driver-name');
            if (sidebarDriverEl && !isCompanyTier) sidebarDriverEl.innerText = displayName;

            updateInspectorDropdown(); updateRouteButtonColors();
            
            let hasValidStops = stops.filter(s => isActiveStop(s) && s.lng && s.lat).length > 0;
            if (!hasValidStops && data.companyAddress) {
                const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.companyAddress)}.json?access_token=${MAPBOX_TOKEN}`;
                try {
                    frontEndApiUsage.geocode++;
                    const geoRes = await fetch(geoUrl);
                    const geo = await geoRes.json();
                    if (geo.features && geo.features.length > 0) map.jumpTo({ center: geo.features[0].center, zoom: 11 });
                } catch (err) { console.error("Geocoding failed for company address.", err); }
            }
        }
        render(); drawRoute(); updateSummary(); initSortable();
    } catch (e) { 
        console.error("Error loading data:", e); isFreshGlideRefresh = false;
    } finally {
        const overlay = document.getElementById('processing-overlay');
        if (overlay && !isPollingForRoute && !isFreshGlideRefresh) overlay.style.display = 'none';
        updateUndoUI();
    }
}

async function performUpload(file, inspectorId, csvType, overrideLock = false) {
    const overlay = document.getElementById('processing-overlay');
    const loadingText = overlay.querySelector('.loading-text');
    const subText = overlay.querySelector('.loading-subtext');
    
    if (loadingText) loadingText.innerText = "Uploading CSV...";
    if (subText) subText.innerText = "Processing order data locally";
    overlay.style.display = 'flex';
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        try {
            if (loadingText) loadingText.innerText = "Syncing...";
            if (subText) subText.innerText = "Sending data to server";
            
            let payload = { action: 'uploadCsv', csvData: text, adminId: adminParam, driverId: inspectorId, companyId: companyParam || '', csvType: csvType };
            if (!isManagerView) payload.routeId = routeId;
            if (overrideLock) payload.overrideLock = true;
            
            if (isTestingMode) logToTestConsole(`POST performUpload() [${activeTestingBackend}]`, payload);
            
            const res = await apiFetch(payload);
            const data = await res.json();
            
            if (data.success) { await loadData(); } 
            else if (data.status === 'size_limit') {
                overlay.style.display = 'none';
                await customAlert("The uploaded file is too large. Please reduce the number of rows and try again.");
            } else if (data.status === 'confirm_hijack') {
                overlay.style.display = 'none';
                const proceed = await customConfirm(data.message || "This route is currently locked by another admin. Do you want to take over and overwrite it?");
                if (proceed) performUpload(file, inspectorId, csvType, true); 
            } else { throw new Error(data.error || "Upload failed"); }
        } catch (err) {
            console.error(err); overlay.style.display = 'none';
            await customAlert("An error occurred during the upload. Please try again.");
        } finally {
            if (loadingText) loadingText.innerText = "Processing...";
            if (subText) subText.innerText = "Syncing data with the server";
        }
    };
    reader.readAsText(file);
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
    if (!isManagerView) payload.routeId = routeId; 
    
    try {
        const res = await apiFetch(payload);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    } catch (e) {
        console.error("Endpoint update failed:", e);
        await customAlert("Failed to sync new address to server. Ensure connection is stable.");
    } finally { if (overlay) overlay.style.display = 'none'; }
}

async function executeRouteReset(driverId) {
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    
    try {
        let payload = { action: 'resetRoute', driverId: driverId };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
        
        historyStack = []; 
        stops.forEach(s => {
            if (String(s.driverId) === String(driverId) && isRouteAssigned(s.status)) { s.eta = ''; s.dist = ''; s.status = 'Pending'; s.routeState = 'Pending'; }
        });
        routeStart = null; routeEnd = null; dirtyRoutes.clear();
        render(); drawRoute(); updateSummary(); updateUndoUI();
    } catch(e) { await customAlert("Error resetting the route."); } 
    finally { if(overlay) overlay.style.display = 'none'; }
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

    let minified = routedStops.map(s => minifyStop(s, s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1));
    let macroState = 'Ready';
    if (dirtyRoutes.has('endpoints_0')) macroState = 'Staging-endpoint';
    else if (dirtyRoutes.size > 0) macroState = 'Staging';
    
    let payload = { action: 'saveRoute', driverId: inspId, stops: minified, routeState: macroState };
    if (!isManagerView) payload.routeId = routeId;

    apiFetch(payload).catch(e => console.log("Silent save error", e));
}

async function handleGenerateRoute() {
    if (currentInspectorFilter === 'all') return;
    const insp = inspectors.find(i => String(i.id) === String(currentInspectorFilter));
    if (!insp) return;

    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    let stopsToOptimize = [];
    const isEndpointsDirty = dirtyRoutes.has('endpoints_0');
    const hasActiveRoutes = stops.some(s => isRouteAssigned(s.status));

    if (isEndpointsDirty) {
        stopsToOptimize = stops.filter(s => isActiveStop(s) && s.lng && s.lat && String(s.driverId) === String(insp.id));
        if (hasActiveRoutes) stopsToOptimize = stopsToOptimize.filter(s => s.cluster !== 'X');
    } else {
        stopsToOptimize = stops.filter(s => {
            if (!isActiveStop(s) || !s.lng || !s.lat || String(s.driverId) !== String(insp.id)) return false;
            if (hasActiveRoutes && s.cluster === 'X') return false;
            const routeKey = `${s.driverId}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
            return dirtyRoutes.has(routeKey) || !isRouteAssigned(s.status);
        });
    }
    
    let sentClusters = [...new Set(stopsToOptimize.map(s => s.cluster))].filter(c => c !== 'X').sort();

    let flatStopsPayload = stopsToOptimize.map(s => {
        let outCluster = s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1;
        return minifyStop(s, outCluster);
    });

    const eps = getActiveEndpoints();
    let sAddr = eps.start ? eps.start.address : '';
    let eAddr = eps.end ? eps.end.address : '';

    stopsToOptimize.forEach(s => { s.routeState = 'Queued'; });
    render(); 

    try {
        let payload = { action: 'generateRoute', inspectorName: insp.name, driverId: insp.id, stops: flatStopsPayload, startAddr: sAddr, endAddr: eAddr, routeState: 'Queued' };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.updatedStops || (data.stops && Array.isArray(data.stops))) {
            let optimizedData = data.updatedStops || data.stops;
            const returnedStopsMap = new Map();
            optimizedData.forEach(s => {
                let exp = expandStop(s); let backendCluster = exp.cluster; let mappedCluster = backendCluster;
                if (sentClusters.length > 0) {
                    if (sentClusters.includes(backendCluster)) mappedCluster = backendCluster; 
                    else if (backendCluster < sentClusters.length) mappedCluster = sentClusters[backendCluster]; 
                    else if (sentClusters.length === 1) mappedCluster = sentClusters[0]; 
                }
                returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
            });

            stops = stops.map(s => {
                if (returnedStopsMap.has(String(s.id))) return returnedStopsMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready';
                return s;
            });

            stops.sort((a, b) => {
                let cA = a.cluster === 'X' ? 999 : (a.cluster || 0); let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
                if (cA !== cB) return cA - cB; return timeToMins(a.eta) - timeToMins(b.eta);
            });

            isPollingForRoute = false; dirtyRoutes.clear();
            render(); drawRoute(); updateSummary(); silentSaveRouteState(); 
        } else if (data.status === 'queued' || data.success) {
            let pqPayload = { action: 'processQueue', driverId: insp.id };
            if (!isManagerView) pqPayload.routeId = routeId;
            apiFetch(pqPayload).catch(err => console.log("Ignored expected timeout from processQueue", err));
            isPollingForRoute = true; pollRetries = 0; setTimeout(loadData, 5000);
        } else { await loadData(); }
    } catch (e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Generation encountered an error. Please wait a moment and try again.");
    } 
}

async function handleCalculate() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
        const activeStops = stops.filter(s => isStopVisible(s, false) && s.lng && s.lat);
        const isEndpointsDirty = dirtyRoutes.has('endpoints_0');
        const hasActiveRoutes = stops.some(s => isRouteAssigned(s.status));
        let stopsToCalculate = [];

        if (isEndpointsDirty) {
            stopsToCalculate = activeStops;
            if (hasActiveRoutes) stopsToCalculate = stopsToCalculate.filter(s => s.cluster !== 'X');
        } else {
            stopsToCalculate = activeStops.filter(s => {
                if (hasActiveRoutes && s.cluster === 'X') return false;
                const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
                return dirtyRoutes.has(routeKey);
            });
        }

        if (stopsToCalculate.length === 0) { 
            if (overlay) overlay.style.display = 'none';
            dirtyRoutes.clear(); render(); drawRoute(); updateSummary(); return; 
        }
        
        let sentClusters = [...new Set(stopsToCalculate.map(s => s.cluster))].filter(c => c !== 'X').sort();
        const eps = getActiveEndpoints();
        let payload = {
            action: 'calculate', driverId: isManagerView ? currentInspectorFilter : driverParam, driver: driverParam,
            startTime: currentStartTime, startAddr: eps.start?.address || null, endAddr: eps.end?.address || null, isManager: isManagerView,
            stops: stopsToCalculate.map(s => { let outC = s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1; return minifyStop(s, outC); })
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s); let backendCluster = exp.cluster; let mappedCluster = backendCluster;
            if (sentClusters.length > 0) {
                if (sentClusters.includes(backendCluster)) mappedCluster = backendCluster;
                else if (backendCluster < sentClusters.length) mappedCluster = sentClusters[backendCluster];
                else if (sentClusters.length === 1) mappedCluster = sentClusters[0];
            }
            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
        });

        stops = stops.map(s => {
            if (returnedStopsMap.has(String(s.id))) return returnedStopsMap.get(String(s.id));
            return s;
        });

        if (!isManagerView) isAlteredRoute = true;
        historyStack = []; dirtyRoutes.clear(); originalStops = JSON.parse(JSON.stringify(stops)); 
        render(); drawRoute(); updateSummary(); silentSaveRouteState();
    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        await customAlert("Error calculating the route. Please try again."); 
    } finally { if (overlay) overlay.style.display = 'none'; }
}

async function handleRestoreOriginal() {
    if(!(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';
    try {
        const inspId = isManagerView ? currentInspectorFilter : driverParam;
        let payload = { action: 'restoreOriginalRoute', driverId: inspId };
        if (!isManagerView) payload.routeId = routeId;
        await apiFetch(payload);
        await loadData(); 
    } catch(e) {
        if(overlay) overlay.style.display = 'none';
        await customAlert("Error restoring the route. Please try again."); 
        console.error(e);
    } finally { if(overlay) overlay.style.display = 'none'; }
}
