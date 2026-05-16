/* Dashboard - V15.8 */
/* FILE: map.js */
/* Changes: */
/* 1. Added touchstart, touchmove, and touchend listeners for mobile map selection (lasso). */
/* 2. Respects window.toggleMobileLasso state set by the new Pan/Select rocker switch. */

import { getVisualStyle } from './logic.js';

let map;
let markers = {};
let lassoBox = null;
let startPoint = null;
let currentLassoPolygon = null;
let currentHoverId = null;
let isDrawing = false;
let mapboxToken = '';
let onSelectionChange = null;

// Track the active state of the mobile lasso
window.mobileLassoActive = false;
window.toggleMobileLasso = function(isActive) {
    window.mobileLassoActive = isActive;
    if (map) {
        const canvasContainer = map.getCanvasContainer();
        if (isActive) {
            canvasContainer.classList.add('interactive-select');
            map.dragPan.disable();
        } else {
            canvasContainer.classList.remove('interactive-select');
            map.dragPan.enable();
        }
    }
};

export function initMap(token, config, selectionCallback) {
    mapboxToken = token;
    mapboxgl.accessToken = token;
    onSelectionChange = selectionCallback;
    map = new mapboxgl.Map(config);
    
    map.on('load', () => {
        lassoBox = document.createElement('div');
        lassoBox.classList.add('boxdraw');
        document.getElementById('map-wrapper').appendChild(lassoBox);

        const canvasContainer = map.getCanvasContainer();

        // Mouse Events (Desktop)
        canvasContainer.addEventListener('mousedown', mouseDown);
        
        // Touch Events (Mobile)
        canvasContainer.addEventListener('touchstart', touchStart, { passive: false });
        
        // Prevent default touch actions while selecting to avoid zooming/scrolling glitches
        canvasContainer.addEventListener('touchmove', (e) => {
            if (window.mobileLassoActive) { e.preventDefault(); }
        }, { passive: false });
    });

    map.on('click', (e) => {
        if (onSelectionChange && !e.originalEvent.shiftKey && !window.mobileLassoActive) {
            if (!e.originalEvent.defaultPrevented) onSelectionChange({ action: 'clear' });
        }
    });
}

export function getMapInstance() { return map; }

function getMousePos(e) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    return new mapboxgl.Point(
        e.clientX - rect.left - map.getCanvasContainer().clientLeft,
        e.clientY - rect.top - map.getCanvasContainer().clientTop
    );
}

function getTouchPos(e) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    const touch = e.touches[0];
    return new mapboxgl.Point(
        touch.clientX - rect.left - map.getCanvasContainer().clientLeft,
        touch.clientY - rect.top - map.getCanvasContainer().clientTop
    );
}

/* --- MOUSE HANDLERS (Desktop Shift+Drag) --- */
function mouseDown(e) {
    if (!e.shiftKey || e.button !== 0) return;
    map.dragPan.disable();
    isDrawing = true;
    startPoint = getMousePos(e);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
}

function mouseMove(e) {
    if (!isDrawing) return;
    const currentPoint = getMousePos(e);
    drawBox(startPoint, currentPoint);
}

function mouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    lassoBox.style.width = '0';
    lassoBox.style.height = '0';
    document.removeEventListener('mousemove', mouseMove);
    document.removeEventListener('mouseup', mouseUp);
    map.dragPan.enable();

    if (currentLassoPolygon) {
        let selectedIds = [];
        Object.keys(markers).forEach(id => {
            if (markers[id].style.display !== 'none') {
                const lngLat = markers[id].getLngLat();
                const pt = [lngLat.lng, lngLat.lat];
                if (pointInPolygon(pt, currentLassoPolygon)) selectedIds.push(id);
            }
        });
        if (selectedIds.length > 0 && onSelectionChange) onSelectionChange({ action: 'lasso', ids: selectedIds });
        currentLassoPolygon = null;
    }
}

/* --- TOUCH HANDLERS (Mobile Select Mode) --- */
function touchStart(e) {
    if (!window.mobileLassoActive || e.touches.length > 1) return;
    isDrawing = true;
    startPoint = getTouchPos(e);
    
    // Attach move and end listeners directly to the document to catch escapes
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
}

function touchMove(e) {
    if (!isDrawing) return;
    const currentPoint = getTouchPos(e);
    drawBox(startPoint, currentPoint);
}

function touchEnd(e) {
    if (!isDrawing) return;
    isDrawing = false;
    lassoBox.style.width = '0';
    lassoBox.style.height = '0';
    
    document.removeEventListener('touchmove', touchMove);
    document.removeEventListener('touchend', touchEnd);

    if (currentLassoPolygon) {
        let selectedIds = [];
        Object.keys(markers).forEach(id => {
            if (markers[id].style.display !== 'none') {
                const lngLat = markers[id].getLngLat();
                const pt = [lngLat.lng, lngLat.lat];
                if (pointInPolygon(pt, currentLassoPolygon)) selectedIds.push(id);
            }
        });
        if (selectedIds.length > 0 && onSelectionChange) onSelectionChange({ action: 'lasso', ids: selectedIds });
        currentLassoPolygon = null;
    }
}

function drawBox(p1, p2) {
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
    lassoBox.style.transform = `translate(${minX}px, ${minY}px)`;
    lassoBox.style.width = `${maxX - minX}px`;
    lassoBox.style.height = `${maxY - minY}px`;

    const pt1 = map.unproject([minX, minY]), pt2 = map.unproject([maxX, minY]);
    const pt3 = map.unproject([maxX, maxY]), pt4 = map.unproject([minX, maxY]);
    currentLassoPolygon = [ [pt1.lng, pt1.lat], [pt2.lng, pt2.lat], [pt3.lng, pt3.lat], [pt4.lng, pt4.lat], [pt1.lng, pt1.lat] ];
}

function pointInPolygon(point, vs) {
    let x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i][0], yi = vs[i][1];
        let xj = vs[j][0], yj = vs[j][1];
        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function renderMapMarkers({ activeStops, endpointsToDraw, isManagerView, currentInspectorFilter, currentRouteCount, allStops, inspectors, onMarkerClick }) {
    if (!map) return;
    Object.values(markers).forEach(m => m.remove()); markers = {};

    activeStops.forEach((s, idx) => {
        if (!s.lng || !s.lat) return;
        
        const el = document.createElement('div');
        el.className = 'marker';
        if (s.status.toLowerCase() === 'completed') el.classList.add('completed');
        
        const style = getVisualStyle(s, isManagerView, currentInspectorFilter, currentRouteCount, allStops, inspectors);
        
        const visual = document.createElement('div');
        visual.className = 'pin-visual';
        visual.style.backgroundColor = style.bg;
        visual.style.border = `3px solid ${style.border}`;
        visual.style.color = style.text;
        visual.innerText = idx + 1;
        el.appendChild(visual);

        if (s.dueDate) {
            const dueTime = new Date(s.dueDate); dueTime.setHours(0,0,0,0);
            const today = new Date(); today.setHours(0,0,0,0);
            if (dueTime < today || dueTime.getTime() === today.getTime()) {
                const warn = document.createElement('i');
                warn.className = 'fa-solid fa-circle-exclamation marker-warning';
                warn.style.color = dueTime < today ? 'var(--red)' : 'var(--orange)';
                el.appendChild(warn);
            }
        }

        const marker = new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
        markers[s.id] = marker;

        el.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault();
            
            // Allow clicking markers to select them in mobile Select mode just like shift-click
            const isShiftOrSelect = e.shiftKey || window.mobileLassoActive;
            if (onMarkerClick) onMarkerClick(s.id, isShiftOrSelect);
        });
    });

    endpointsToDraw.forEach(ep => {
        const el = document.createElement('div');
        el.className = 'marker endpoint-marker';
        const visual = document.createElement('div');
        visual.className = 'pin-visual';
        visual.style.backgroundColor = '#151515';
        visual.style.border = '2px solid #555';
        visual.style.color = '#fff';
        
        let iconHtml = '';
        if (ep.isStart && ep.isEnd) iconHtml = '<i class="fa-solid fa-arrows-left-right-to-line"></i>';
        else if (ep.isStart) iconHtml = '<i class="fa-solid fa-location-dot"></i>';
        else if (ep.isEnd) iconHtml = '<i class="fa-solid fa-flag-checkered"></i>';
        
        visual.innerHTML = iconHtml;
        el.appendChild(visual);

        new mapboxgl.Marker({ element: el }).setLngLat([ep.lng, ep.lat]).addTo(map);
    });
}

export function drawRouteMap({ routedStops, dirtyRoutes, activeEndpoints, isManagerView, currentInspectorFilter, inspectors, allStops, currentRouteCount }) {
    if (!map || !map.isStyleLoaded()) return;

    const sourceId = 'routes-source';
    if (map.getSource(sourceId)) {
        map.removeLayer('routes-layer');
        map.removeSource(sourceId);
    }

    const uniqueClusters = [...new Set(routedStops.map(s => s.cluster === 'X' ? 0 : (s.cluster || 0)))].sort();
    let features = [];

    uniqueClusters.forEach(clusterId => {
        let cStops = routedStops.filter(s => (s.cluster === 'X' ? 0 : (s.cluster || 0)) === clusterId);
        cStops.sort((a,b) => {
            const timeA = a.eta ? parseFloat(a.eta.split(':')[0]) * 60 + parseFloat(a.eta.split(':')[1]) : 0;
            const timeB = b.eta ? parseFloat(b.eta.split(':')[0]) * 60 + parseFloat(b.eta.split(':')[1]) : 0;
            return timeA - timeB;
        });
        
        if (cStops.length > 0) {
            let coords = [];
            const driverIdForRoute = cStops[0].driverId;
            const epStart = getEndpointForDriver(activeEndpoints, driverIdForRoute, inspectors, isManagerView, 'start');
            if (epStart && epStart.lng && epStart.lat) coords.push([parseFloat(epStart.lng), parseFloat(epStart.lat)]);
            
            cStops.forEach(s => { if (s.lng && s.lat) coords.push([parseFloat(s.lng), parseFloat(s.lat)]); });
            
            const epEnd = getEndpointForDriver(activeEndpoints, driverIdForRoute, inspectors, isManagerView, 'end');
            if (epEnd && epEnd.lng && epEnd.lat) coords.push([parseFloat(epEnd.lng), parseFloat(epEnd.lat)]);

            let inspIdx = 0;
            if (isManagerView && currentInspectorFilter === 'all') {
                const insp = inspectors.find(i => String(i.id) === String(driverIdForRoute));
                if (insp) inspIdx = inspectors.indexOf(insp);
            }

            let baseColor = MASTER_PALETTE[inspIdx % MASTER_PALETTE.length];
            if ((isManagerView && currentInspectorFilter !== 'all') || (!isManagerView)) {
                if (currentRouteCount > 1) {
                    if (clusterId === 0) baseColor = MASTER_PALETTE[0];
                    if (clusterId === 1) baseColor = '#000000';
                    if (clusterId === 2) baseColor = '#ffffff';
                }
            }

            const driverKey = driverIdForRoute || 'unassigned';
            const rKey = `${driverKey}_${clusterId}`;
            const isDirty = dirtyRoutes.has(rKey) || dirtyRoutes.has('all');

            if (coords.length > 1 && !isDirty) {
                features.push({
                    type: 'Feature',
                    properties: { color: baseColor },
                    geometry: { type: 'LineString', coordinates: coords }
                });
            }
        }
    });

    if (features.length > 0) {
        map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: features } });
        map.addLayer({
            id: 'routes-layer', type: 'line', source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 }
        }, Object.keys(markers).length > 0 ? Object.keys(markers)[0] : undefined);
    }
}

function getEndpointForDriver(activeEndpoints, driverId, inspectors, isManagerView, type) {
    if (isManagerView && AppState.currentInspectorFilter === 'all') {
        const insp = inspectors.find(i => String(i.id) === String(driverId));
        if (insp) {
            if (type === 'start') return { lng: insp.startLng, lat: insp.startLat };
            if (type === 'end') return { lng: insp.endLng || insp.startLng, lat: insp.endLat || insp.startLat };
        }
    } else {
        if (type === 'start') return activeEndpoints.start;
        if (type === 'end') return activeEndpoints.end;
    }
    return null;
}

export function filterMarkersMap(q) {
    Object.keys(markers).forEach(id => {
        const s = AppState.stops.find(st => String(st.id) === String(id));
        if (!s) return;
        const searchStr = `${(s.address||'').toLowerCase()} ${(s.client||'').toLowerCase()}`;
        if (searchStr.includes(q)) markers[id].getElement().style.display = 'flex';
        else markers[id].getElement().style.display = 'none';
    });
}

export function updateMapSelectionStyles(selectedIds) {
    Object.keys(markers).forEach(id => {
        if (selectedIds.has(id)) markers[id].getElement().classList.add('bulk-selected');
        else markers[id].getElement().classList.remove('bulk-selected');
    });
}

export function focusMapPin(lat, lng) {
    if (map && lat && lng) map.flyTo({ center: [lng, lat], zoom: 15, essential: true });
}

export function resizeMap() { if (map) setTimeout(() => map.resize(), 50); }

export function resetMapBounds() {
    if (!map) return;
    const activeStops = AppState.stops.filter(s => isStopVisible(s, false, Config.isManagerView, AppState.currentInspectorFilter, AppState.currentRouteViewFilter));
    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    
    activeStops.forEach(s => { if (s.lng && s.lat) { bounds.extend([parseFloat(s.lng), parseFloat(s.lat)]); hasPoints = true; } });
    let eps = getActiveEndpoints();
    if (eps.start && eps.start.lng && eps.start.lat) { bounds.extend([parseFloat(eps.start.lng), parseFloat(eps.start.lat)]); hasPoints = true; }
    if (eps.end && eps.end.lng && eps.end.lat) { bounds.extend([parseFloat(eps.end.lng), parseFloat(eps.end.lat)]); hasPoints = true; }

    if (hasPoints) map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
}
