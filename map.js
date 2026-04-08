/* Dashboard - V15.4 */
/* FILE: map.js */
/* Changes: */
/* 1. Extracted Mapbox GL JS engine logic into a dedicated ES Module. */
/* 2. Encapsulated lasso tool, marker rendering, and route drawing into pure, controllable functions. */
/* 3. Uses callbacks to communicate lasso/click selections back to app.js state. */

import { getVisualStyle, MASTER_PALETTE } from './logic.js';

let map = null;
let markers = [];
let initialBounds = null;
let isFirstMapRender = true;

// Lasso State
let start_pos = null;
let box_el = null;
let canvas = null;
let onSelectionCallback = null; // Callback for when lasso or map click happens

export function initMap(token, config, selectionCallback) {
    mapboxgl.accessToken = token;
    map = new mapboxgl.Map(config);
    onSelectionCallback = selectionCallback;

    map.getContainer().addEventListener('touchend', () => {
        const blocker = document.querySelector('.mapboxgl-touch-pan-blocker');
        if (blocker) {
            blocker.style.transition = 'none';
            blocker.style.opacity = '0';
        }
    }, { passive: true });

    // Click on empty space to clear selection
    map.on('click', (e) => { 
        if (e.originalEvent.target.classList.contains('mapboxgl-canvas')) { 
            if (onSelectionCallback) onSelectionCallback({ action: 'clear' });
        } 
    });

    // Setup Lasso Tool
    canvas = map.getCanvasContainer();
    canvas.addEventListener('mousedown', onCanvasMouseDown, true);

    // --- THE FIX: Add a ResizeObserver ---
    // This constantly watches the map's parent container. If the sidebar 
    // opens, closes, or flexbox shifts, it forces Mapbox to perfectly fill the space.
    const mapContainer = document.getElementById(config.container);
    if (mapContainer && window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            if (map) map.resize();
        });
        ro.observe(mapContainer);
    }

    return map;
}

export function getMapInstance() {
    return map;
}

export function resizeMap() {
    if (map) map.resize();
}

export function focusMapPin(lng, lat) {
    if (map && lng && lat) {
        map.flyTo({ center: [lng, lat] });
    }
}

export function resetMapBounds() {
    if (map && initialBounds) {
        map.fitBounds(initialBounds, { padding: 50, maxZoom: 15 });
    }
}

// --- Marker Rendering ---

export function renderMapMarkers(params) {
    const {
        activeStops, endpointsToDraw, isManagerView, currentInspectorFilter,
        currentRouteCount, allStops, inspectors, onMarkerClick
    } = params;

    markers.forEach(m => m.remove());
    markers = [];
    const bounds = new mapboxgl.LngLatBounds();

    // Draw Stop Markers
    activeStops.forEach((s, index) => {
        if (s.lng && s.lat) {
            const el = document.createElement('div');
            el.className = `marker ${s.status.toLowerCase().replace(' ', '-')}`; 
            
            const style = getVisualStyle(s, isManagerView, currentInspectorFilter, currentRouteCount, allStops, inspectors);
            el.innerHTML = `<div class="pin-visual" style="background-color: ${style.bg}; border: 3px solid ${style.border}; color: ${style.text};"><span>${index + 1}</span></div>`;

            // Urgency warning flags
            const today = new Date(); today.setHours(0,0,0,0);
            let urgencyClass = '';
            if (s.dueDate) {
                const dueTime = new Date(s.dueDate); dueTime.setHours(0,0,0,0);
                if (dueTime < today) urgencyClass = 'past-due';
                else if (dueTime.getTime() === today.getTime()) urgencyClass = 'due-today';
            }

            if (urgencyClass && s.status.toLowerCase() !== 'completed') {
                const w = document.createElement('div'); w.className = 'marker-warning'; 
                w.innerText = (urgencyClass === 'past-due') ? '⚠️' : '❕';
                el.appendChild(w);
            }
            
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onMarkerClick) onMarkerClick(s.id, e.shiftKey);
            });
            
            const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
            m._stopId = s.id; 
            markers.push(m); 
            bounds.extend([s.lng, s.lat]);
        }
    });

    // Draw Endpoint Markers
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

    // Fit Bounds
    if (activeStops.filter(s => s.lng && s.lat).length > 0 || endpointsToDraw.length > 0) { 
        initialBounds = bounds; 
        map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate: !isFirstMapRender }); 
        if (isFirstMapRender) isFirstMapRender = false;
    }
}

export function updateMarkerColorsMap(allStops, isManagerView, currentInspectorFilter, currentRouteCount, inspectors) {
    markers.forEach(m => {
        if (!m._stopId) return; // Skip endpoints
        const stopData = allStops.find(st => String(st.id) === String(m._stopId));
        if (stopData) {
            const visualStyle = getVisualStyle(stopData, isManagerView, currentInspectorFilter, currentRouteCount, allStops, inspectors);
            const pin = m.getElement().querySelector('.pin-visual');
            if (pin) {
                pin.style.backgroundColor = visualStyle.bg;
                pin.style.border = `3px solid ${visualStyle.border}`;
                pin.style.color = visualStyle.text;
            }
        }
    });
}

export function updateMapSelectionStyles(selectedIdsSet) {
    markers.forEach(m => { 
        if(m._stopId) {
            m.getElement().classList.toggle('bulk-selected', selectedIdsSet.has(m._stopId)); 
        }
    }); 
}

// --- Route Drawing ---

export function drawRouteMap(params) {
    const { routedStops, dirtyRoutes, activeEndpoints, isManagerView, currentInspectorFilter, inspectors, allStops, currentRouteCount } = params;
    
    const layerIds = [
        'route-line-0-clean', 'route-line-0-dirty',
        'route-line-1-out-clean', 'route-line-1-in-clean', 'route-line-1-out-dirty', 'route-line-1-in-dirty',
        'route-line-2-out-clean', 'route-line-2-in-clean', 'route-line-2-out-dirty', 'route-line-2-in-dirty'
    ];
    layerIds.forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
    if (map.getSource('route')) map.removeSource('route');

    if (!routedStops || routedStops.length === 0) return; 

    const features = [];
    const routesMap = new Map();

    routedStops.forEach(s => {
        const key = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 0 : (s.cluster || 0)}`;
        if (!routesMap.has(key)) routesMap.set(key, []);
        routesMap.get(key).push(s);
    });

    routesMap.forEach((cStops, key) => {
        if (cStops.length > 0) {
            const style = getVisualStyle(cStops[0], isManagerView, currentInspectorFilter, currentRouteCount, allStops, inspectors);
            let coords = cStops.map(s => [parseFloat(s.lng), parseFloat(s.lat)]);
            
            let dId = key.split('_')[0];
            let clusterIndex = parseInt(key.split('_')[1]);
            let rStart = activeEndpoints.start;
            let rEnd = activeEndpoints.end;

            // Handle All Inspectors override
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
    
    // Core Route
    map.addLayer({ "id": "route-line-0-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-0-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 

    // Route 2
    map.addLayer({ "id": "route-line-1-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-1-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-1-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-1-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 

    // Route 3
    map.addLayer({ "id": "route-line-2-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-2-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-2-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-2-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 
}

// --- Lasso Tool Logic ---

function onCanvasMouseDown(e) { 
    if (e.target.closest('.mapboxgl-marker')) return; 
    if(e.shiftKey) { 
        map.dragPan.disable(); 
        start_pos = mousePos(e); 
        document.addEventListener('mousemove', onMouseMove); 
        document.addEventListener('mouseup', onMouseUp); 
    } 
}

function mousePos(e) { 
    const r = canvas.getBoundingClientRect(); 
    return new mapboxgl.Point(e.clientX - r.left, e.clientY - r.top); 
}

function onMouseMove(e) { 
    const curr = mousePos(e); 
    if(!box_el) { 
        box_el = document.createElement('div'); 
        box_el.className = 'boxdraw'; 
        canvas.appendChild(box_el); 
    } 
    const minX = Math.min(start_pos.x, curr.x), maxX = Math.max(start_pos.x, curr.x);
    const minY = Math.min(start_pos.y, curr.y), maxY = Math.max(start_pos.y, curr.y); 
    box_el.style.left = minX + 'px'; 
    box_el.style.top = minY + 'px'; 
    box_el.style.width = (maxX - minX) + 'px'; 
    box_el.style.height = (maxY - minY) + 'px'; 
}

function onMouseUp(e) { 
    document.removeEventListener('mousemove', onMouseMove); 
    document.removeEventListener('mouseup', onMouseUp); 
    
    if(box_el) { 
        const b = [start_pos, mousePos(e)]; 
        let caughtIds = [];
        markers.filter(m => { 
            const pt = map.project(m.getLngLat()); 
            return pt.x >= Math.min(b[0].x, b[1].x) && pt.x <= Math.max(b[0].x, b[1].x) && 
                   pt.y >= Math.min(b[0].y, b[1].y) && pt.y <= Math.max(b[0].y, b[1].y); 
        }).forEach(m => caughtIds.push(m._stopId)); 
        
        box_el.remove(); 
        box_el = null; 
        
        if (onSelectionCallback) onSelectionCallback({ action: 'lasso', ids: caughtIds });
    } 
    map.dragPan.enable(); 
    start_pos = null; 
}
