// *
// * Dashboard - V12.4
// * FILE: routing.js
// * Changes: Extracted route calculation, history stacking, and live clustering logic.
// *

function markRouteDirty(driverId, clusterIdx) {
    dirtyRoutes.add(`${driverId || 'unassigned'}_${clusterIdx || 0}`);
}

function pushToHistory() {
    historyStack.push({
        stops: JSON.parse(JSON.stringify(stops)),
        dirty: new Set(dirtyRoutes)
    });
    if (historyStack.length > 20) historyStack.shift();
    if (typeof updateUndoUI === 'function') updateUndoUI();
}

async function undoLastAction() {
    if (historyStack.length === 0) return;
    const last = historyStack.pop();

    const resurrectedStops = last.stops.filter(oldStop => !stops.some(currentStop => String(currentStop.id) === String(oldStop.id)));

    stops = last.stops;
    dirtyRoutes = new Set(last.dirty);

    if (resurrectedStops.length > 0) {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = 'flex';
        try {
            let payload = {
                action: 'recreateOrders',
                driverId: isManagerView ? currentInspectorFilter : driverParam,
                orders: resurrectedStops
            };
            if (!isManagerView) payload.routeId = routeId;

            await apiFetch(payload);
        } catch (e) {
            console.error("Failed to resurrect orders:", e);
        } finally {
            if (overlay) overlay.style.display = 'none';
        }
    }

    if (typeof render === 'function') render(); 
    if (typeof drawRoute === 'function') drawRoute(); 
    if (typeof updateSummary === 'function') updateSummary(); 
    updateRouteTimes(); 
    if (typeof updateUndoUI === 'function') updateUndoUI();
    if (typeof silentSaveRouteState === 'function') silentSaveRouteState(); 
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

function setRoutes(num) {
    currentRouteCount = num;
    document.body.setAttribute('data-route-count', num);
    
    for(let i=1; i<=3; i++) {
        const btn = document.getElementById(`rbtn-${i}`);
        if(btn) btn.classList.toggle('active', i === num);
    }
    const headerGenBtnText = document.getElementById('btn-header-generate-text');
    if (headerGenBtnText) headerGenBtnText.innerText = "Optimize";
    
    stops.forEach(s => s.manualCluster = false); 
    liveClusterUpdate();
    if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
}

function moveSelectedToRoute(cIdx) {
    pushToHistory();
    let movedStops = [];
    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
    
    selectedIds.forEach(id => {
        const s = stops.find(st => String(st.id) === String(id));
        if (s) {
            if (isRouteAssigned(s.status)) {
                markRouteDirty(s.driverId, s.cluster); 
            }
            s.cluster = cIdx;
            s.manualCluster = true; 
            
            if (hasActiveRoutes) {
                s.status = 'Routed';
                s.routeState = 'Staging';
                markRouteDirty(s.driverId, s.cluster); 
            }
            movedStops.push(s);
        }
    });
    
    stops = stops.filter(s => !selectedIds.has(s.id));
    stops.push(...movedStops);
    
    selectedIds.clear();
    
    if (typeof render === 'function') render(); 
    if (typeof drawRoute === 'function') drawRoute();
    if (typeof updateSummary === 'function') updateSummary();
    updateRouteTimes();
    if (typeof silentSaveRouteState === 'function') silentSaveRouteState();
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

function liveClusterUpdate() {
    if (isManagerView && currentInspectorFilter === 'all') return;
    
    const k = currentRouteCount;
    const w = parseInt(document.getElementById('slider-priority').value) / 100;
    
    const activeStops = stops.filter(s => isStopVisible(s, false) && s.lng && s.lat);
    if(activeStops.length === 0) return;

    const hasActiveRoutes = stops.some(st => isRouteAssigned(st.status));
    
    const unroutedStops = activeStops.filter(s => {
        if (isRouteAssigned(s.status)) return false;
        if (hasActiveRoutes && s.cluster === 'X') return false;
        return true;
    });

    if(k === 1) {
        unroutedStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        if (typeof updateMarkerColors === 'function') updateMarkerColors();
        updateRouteTimes();
        return;
    }

    if (unroutedStops.length === 0) return;

    let today = new Date(); 
    today.setHours(0,0,0,0);

    unroutedStops.forEach(s => {
        s._urgency = 0;
        if (s.dueDate) {
            let d = new Date(s.dueDate);
            d.setHours(0,0,0,0);
            if (d < today) s._urgency = 2;
            else if (d.getTime() === today.getTime()) s._urgency = 1;
        }
    });

    let centroids = [];
    for(let i=0; i<k; i++) {
        let idx = Math.floor(i * unroutedStops.length / k);
        centroids.push({ lat: unroutedStops[idx].lat, lng: unroutedStops[idx].lng });
    }

    for(let iter=0; iter<5; iter++) {
        unroutedStops.forEach(s => {
            let bestD = Infinity, bestC = 0;
            centroids.forEach((c, cIdx) => {
                let d = Math.sqrt(Math.pow(s.lat - c.lat, 2) + Math.pow(s.lng - c.lng, 2));
                if (d < bestD) { bestD = d; bestC = cIdx; }
            });
            s._tempCluster = bestC;
        });
        for(let i=0; i<k; i++) {
            let cStops = unroutedStops.filter(s => s._tempCluster === i);
            if(cStops.length > 0) {
                centroids[i].lat = cStops.reduce((sum, s) => sum + s.lat, 0) / cStops.length;
                centroids[i].lng = cStops.reduce((sum, s) => sum + s.lng, 0) / cStops.length;
            }
        }
    }

    let clusterUrgency = new Array(k).fill(0);
    unroutedStops.forEach(s => { clusterUrgency[s._tempCluster] += s._urgency; });
    let bestClusterIdx = 0, maxUrg = -1;
    for(let i=0; i<k; i++) {
        if (clusterUrgency[i] > maxUrg) { maxUrg = clusterUrgency[i]; bestClusterIdx = i; }
    }
    let temp = centroids[0];
    centroids[0] = centroids[bestClusterIdx];
    centroids[bestClusterIdx] = temp;

    let capacity = Math.ceil(unroutedStops.length / k);
    
    let maxGeoDist = 0.0001;
    unroutedStops.forEach(s => {
        centroids.forEach(c => {
            let d = Math.sqrt(Math.pow(s.lat - c.lat, 2) + Math.pow(s.lng - c.lng, 2));
            if (d > maxGeoDist) maxGeoDist = d;
        });
    });

    const pullMultiplier = maxGeoDist * 2.5; 

    unroutedStops.forEach(s => {
        if (s.manualCluster) return;

        let dist0 = Math.sqrt(Math.pow(s.lat - centroids[0].lat, 2) + Math.pow(s.lng - centroids[0].lng, 2));
        let bestAltDist = Infinity;
        let bestAltIdx = 0;

        for(let i=1; i<k; i++) {
            let d = Math.sqrt(Math.pow(s.lat - centroids[i].lat, 2) + Math.pow(s.lng - centroids[i].lng, 2));
            if (d < bestAltDist) { bestAltDist = d; bestAltIdx = i; }
        }

        let effectiveDist0 = dist0 - ((s._urgency / 2) * w * pullMultiplier);
        s._dist0 = dist0;
        s._bestAltDist = bestAltDist;
        s._bestAltIdx = bestAltIdx;
        s._effectiveDist0 = effectiveDist0;
        s._affinity0 = bestAltDist - effectiveDist0;
    });

    let sortedStops = [...unroutedStops].filter(s => !s.manualCluster).sort((a, b) => b._affinity0 - a._affinity0);

    let route0Count = 0;
    let altCounts = new Array(k).fill(0);

    sortedStops.forEach(s => {
        let wants0 = s._affinity0 > 0;
        if (wants0) {
            if (route0Count < capacity) {
                s.cluster = 0;
                route0Count++;
            } else if (s._effectiveDist0 < 0) {
                s.cluster = 0;
                route0Count++;
            } else {
                s.cluster = s._bestAltIdx;
                altCounts[s._bestAltIdx]++;
            }
        } else {
            s.cluster = s._bestAltIdx;
            altCounts[s._bestAltIdx]++;
        }
    });

    unroutedStops.forEach(s => {
        delete s._urgency;
        delete s._tempCluster;
        delete s._dist0;
        delete s._bestAltDist;
        delete s._bestAltIdx;
        delete s._effectiveDist0;
        delete s._affinity0;
    });
    
    if (typeof updateMarkerColors === 'function') updateMarkerColors();
    updateRouteTimes();
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
        if (hasActiveRoutes) {
            stopsToOptimize = stopsToOptimize.filter(s => s.cluster !== 'X');
        }
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

    stopsToOptimize.forEach(s => {
        s.routeState = 'Queued';
    });
    if (typeof render === 'function') render(); 

    try {
        let payload = { 
            action: 'generateRoute', 
            inspectorName: insp.name, 
            driverId: insp.id, 
            stops: flatStopsPayload, 
            startAddr: sAddr, 
            endAddr: eAddr, 
            routeState: 'Queued' 
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.updatedStops || (data.stops && Array.isArray(data.stops))) {
            let optimizedData = data.updatedStops || data.stops;
            const returnedStopsMap = new Map();
            optimizedData.forEach(s => {
                let exp = expandStop(s);
                let backendCluster = exp.cluster;
                let mappedCluster = backendCluster;

                if (sentClusters.length > 0) {
                    if (sentClusters.includes(backendCluster)) {
                        mappedCluster = backendCluster; 
                    } else if (backendCluster < sentClusters.length) {
                        mappedCluster = sentClusters[backendCluster]; 
                    } else if (sentClusters.length === 1) {
                        mappedCluster = sentClusters[0]; 
                    }
                }

                returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
            });

            stops = stops.map(s => {
                if (returnedStopsMap.has(String(s.id))) return returnedStopsMap.get(String(s.id));
                if (s.routeState === 'Queued') s.routeState = 'Ready';
                return s;
            });

            stops.sort((a, b) => {
                let cA = a.cluster === 'X' ? 999 : (a.cluster || 0);
                let cB = b.cluster === 'X' ? 999 : (b.cluster || 0);
                if (cA !== cB) return cA - cB;
                return timeToMins(a.eta) - timeToMins(b.eta);
            });

            isPollingForRoute = false;
            dirtyRoutes.clear();
            if (typeof render === 'function') render(); 
            if (typeof drawRoute === 'function') drawRoute(); 
            if (typeof updateSummary === 'function') updateSummary();
            if (typeof silentSaveRouteState === 'function') silentSaveRouteState(); 
        } else if (data.status === 'queued' || data.success) {
            let pqPayload = { action: 'processQueue', driverId: insp.id };
            if (!isManagerView) pqPayload.routeId = routeId;
            
            apiFetch(pqPayload).catch(err => console.log("Ignored expected timeout from processQueue", err));
            
            isPollingForRoute = true;
            pollRetries = 0;
            setTimeout(loadData, 5000);
        } else {
            await loadData();
        }
    } catch (e) {
        if(overlay) overlay.style.display = 'none';
        if (typeof customAlert === 'function') await customAlert("Generation encountered an error. Please wait a moment and try again.");
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
            if (hasActiveRoutes) {
                stopsToCalculate = stopsToCalculate.filter(s => s.cluster !== 'X');
            }
        } else {
            stopsToCalculate = activeStops.filter(s => {
                if (hasActiveRoutes && s.cluster === 'X') return false;
                const routeKey = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 'X' : (s.cluster || 0)}`;
                return dirtyRoutes.has(routeKey);
            });
        }

        if (stopsToCalculate.length === 0) { 
            if (overlay) overlay.style.display = 'none';
            dirtyRoutes.clear();
            if (typeof render === 'function') render(); 
            if (typeof drawRoute === 'function') drawRoute(); 
            if (typeof updateSummary === 'function') updateSummary();
            return; 
        }
        
        let sentClusters = [...new Set(stopsToCalculate.map(s => s.cluster))].filter(c => c !== 'X').sort();

        const eps = getActiveEndpoints();

        let payload = {
            action: 'calculate',
            driverId: isManagerView ? currentInspectorFilter : driverParam,
            driver: driverParam,
            startTime: currentStartTime,
            startAddr: eps.start?.address || null,
            endAddr: eps.end?.address || null,
            isManager: isManagerView,
            stops: stopsToCalculate.map(s => {
                let outC = s.cluster === 'X' ? 'X' : (s.cluster || 0) + 1;
                return minifyStop(s, outC);
            })
        };
        if (!isManagerView) payload.routeId = routeId;

        const res = await apiFetch(payload);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        const returnedStopsMap = new Map();
        data.updatedStops.forEach(s => {
            let exp = expandStop(s);
            let backendCluster = exp.cluster;
            let mappedCluster = backendCluster;

            if (sentClusters.length > 0) {
                if (sentClusters.includes(backendCluster)) {
                    mappedCluster = backendCluster;
                } else if (backendCluster < sentClusters.length) {
                    mappedCluster = sentClusters[backendCluster];
                } else if (sentClusters.length === 1) {
                    mappedCluster = sentClusters[0];
                }
            }

            returnedStopsMap.set(exp.rowId || exp.id, { ...exp, id: exp.rowId || exp.id, cluster: mappedCluster, manualCluster: false });
        });

        stops = stops.map(s => {
            if (returnedStopsMap.has(String(s.id))) {
                return returnedStopsMap.get(String(s.id));
            }
            return s;
        });

        if (!isManagerView) isAlteredRoute = true;
        historyStack = []; 
        dirtyRoutes.clear();
        originalStops = JSON.parse(JSON.stringify(stops)); 
        if (typeof render === 'function') render(); 
        if (typeof drawRoute === 'function') drawRoute(); 
        if (typeof updateSummary === 'function') updateSummary();
        if (typeof silentSaveRouteState === 'function') silentSaveRouteState();

    } catch (e) { 
        if (overlay) overlay.style.display = 'none';
        if (typeof customAlert === 'function') await customAlert("Error calculating the route. Please try again."); 
    } finally { 
        if (overlay) overlay.style.display = 'none'; 
    }
}

async function handleRestoreOriginal() {
    if(typeof customConfirm === 'function' && !(await customConfirm("Restore the original route layout planned by the manager?"))) return;
    
    const overlay = document.getElementById('processing-overlay');
    if(overlay) overlay.style.display = 'flex';

    try {
        const inspId = isManagerView ? currentInspectorFilter : driverParam;
        let payload = { action: 'restoreOriginalRoute', driverId: inspId };
        if (!isManagerView) payload.routeId = routeId;

        await apiFetch(payload);
        
        if (typeof loadData === 'function') await loadData(); 
    } catch(e) {
        if(overlay) overlay.style.display = 'none';
        if (typeof customAlert === 'function') await customAlert("Error restoring the route. Please try again."); 
        console.error(e);
    } finally {
        if(overlay) overlay.style.display = 'none'; 
    }
}
