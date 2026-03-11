// *
// * Dashboard - V6.5
// * FILE: drag-drop.js
// * Description: SortableJS integration, drag-and-drop mechanics, and live geographic clustering.
// *

import { Config, State, markRouteDirty, pushToHistory, isActiveStop } from './state.js';
import { render, updateSummary, updateRouteTimes, updateMarkerColors, updateSelectionUI } from './ui.js';
import { drawRoute } from './map.js';
import { silentSaveRouteState } from './api.js';

export function reorderStopsFromDOM() {
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
    const otherStops = State.stops.filter(s => !visibleIds.has(s.id));
    
    const newUnrouted = unroutedIds.map(id => State.stops.find(s => s.id === id)).filter(Boolean);
    const newRouted = routedIds.map(id => State.stops.find(s => s.id === id)).filter(Boolean);
    
    State.stops = [...otherStops, ...newUnrouted, ...newRouted];
}

export function initSortable() {
    State.sortableInstances.forEach(inst => inst.destroy());
    State.sortableInstances = [];
    if (State.sortableUnrouted) { State.sortableUnrouted.destroy(); State.sortableUnrouted = null; }

    if (!State.PERMISSION_MODIFY) return;

    if (State.isManagerView && State.currentInspectorFilter !== 'all') {
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
                    
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = State.stops.find(s => s.id === stopId);
                    
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            markRouteDirty(dId, stop.cluster);
                        }
                    }

                    if (evt.to.id === 'unrouted-list') {
                        isMovedToUnrouted = true;
                        const idx = State.stops.findIndex(s => s.id === stopId);
                        if (idx > -1) {
                            State.stops[idx].status = 'Pending'; 
                            State.stops[idx].routeState = 'Pending';
                        }
                    }
                    
                    reorderStopsFromDOM();
                    render(); 
                    silentSaveRouteState();
                    
                    if (isMovedToUnrouted) {
                        drawRoute(); updateSummary(); updateRouteTimes();
                    }
                }
            });
            State.sortableInstances.push(inst);
        });
        
        if (unroutedEl) {
            State.sortableUnrouted = Sortable.create(unroutedEl, {
                group: 'manager-routes',
                sort: false, 
                handle: '.handle',
                filter: '.list-subheading',
                animation: 150,
                onStart: () => pushToHistory()
            });
        }
    } else if (!State.isManagerView) {
        document.querySelectorAll('.routed-group-container, #main-list-container').forEach(el => {
            const inst = Sortable.create(el, {
                handle: '.handle',
                filter: '.static-endpoint, .list-subheading',
                animation: 150,
                onStart: () => pushToHistory(),
                onEnd: (evt) => {
                    const stopId = evt.item.id.replace('item-', '');
                    const stop = State.stops.find(s => s.id === stopId);
                    if (stop) {
                        const dId = stop.driverId;
                        let matchOld = evt.from.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchOld) markRouteDirty(dId, parseInt(matchOld[2]));
                        
                        let matchNew = evt.to.id.match(/(routed|driver)-list-(\d+)/);
                        if (matchNew) {
                            stop.cluster = parseInt(matchNew[2]);
                            markRouteDirty(dId, stop.cluster);
                        }
                    }

                    reorderStopsFromDOM();
                    render(); 
                    silentSaveRouteState();
                }
            });
            State.sortableInstances.push(inst);
        });
    }
}

export function liveClusterUpdate() {
    if(!State.isManagerView || State.currentInspectorFilter === 'all') return;
    
    const k = State.currentRouteCount;
    const w = parseInt(document.getElementById('slider-priority').value) / 100;
    
    const activeStops = State.stops.filter(s => isActiveStop(s) && s.lng && s.lat);
    if(activeStops.length === 0) return;

    const unroutedStops = activeStops.filter(s => {
        const st = (s.status||'').toLowerCase();
        return st !== 'routed' && st !== 'completed' && st !== 'dispatched';
    });

    if(k === 1) {
        unroutedStops.forEach(s => { s.cluster = 0; s.manualCluster = false; });
        updateMarkerColors();
        updateRouteTimes();
        return;
    }

    if (unroutedStops.length === 0) return;

    let centroids = [];
    for(let i=0; i<k; i++) {
        let idx = Math.floor(i * unroutedStops.length / k);
        centroids.push({ lat: unroutedStops[idx].lat, lng: unroutedStops[idx].lng });
    }

    let today = new Date(); 
    today.setHours(0,0,0,0);

    for(let iter=0; iter<10; iter++) {
        unroutedStops.forEach(s => {
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
            let clusterStops = unroutedStops.filter(s => s.cluster === i);
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
