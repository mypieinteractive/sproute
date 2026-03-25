// *
// * Dashboard - V12.4
// * FILE: map.js
// * Changes: Extracted Mapbox GL initialization, drawing features, and shift-select logic.
// *

mapboxgl.accessToken = MAPBOX_TOKEN;
const mapConfig = { 
    container: 'map', 
    style: 'mapbox://styles/mapbox/dark-v11', 
    center: [-96.797, 32.776],
    zoom: 11, 
    attributionControl: false,
    boxZoom: false,
    preserveDrawingBuffer: true,
    cooperativeGestures: (viewMode === 'inspector' || viewMode === 'managermobile' || viewMode === 'managermobilesplit')
};
const map = new mapboxgl.Map(mapConfig);
frontEndApiUsage.mapLoads++; // Log map load

// Force one-finger scroll overlay to disappear immediately on touch end
map.getContainer().addEventListener('touchend', () => {
    const blocker = document.querySelector('.mapboxgl-touch-pan-blocker');
    if (blocker) {
        blocker.style.transition = 'none';
        blocker.style.opacity = '0';
    }
}, { passive: true });

function resetMapView() { 
    if (initialBounds) map.fitBounds(initialBounds, { padding: 50, maxZoom: 15 }); 
}

function focusPin(id) { 
    const tgt = stops.find(s => String(s.id) === String(id)); 
    if (tgt && tgt.lng && tgt.lat) map.flyTo({ center: [tgt.lng, tgt.lat] }); 
}

function updateMarkerColors() {
    markers.forEach(m => {
        const stopData = stops.find(st => String(st.id) === String(m._stopId));
        if (stopData) {
            const visualStyle = getVisualStyle(stopData);
            const pin = m.getElement().querySelector('.pin-visual');
            if(pin) {
                pin.style.backgroundColor = visualStyle.bg;
                pin.style.border = `3px solid ${visualStyle.border}`;
                pin.style.color = visualStyle.text;
            }
            
            const row = document.getElementById(`item-${stopData.id}`);
            if (row) {
                const badge = row.querySelector('.num-badge');
                if (badge) {
                    badge.style.backgroundColor = visualStyle.bg;
                    badge.style.border = `3px solid ${visualStyle.border}`;
                    badge.style.color = visualStyle.text;
                }
            }
        }
    });
}

function drawRoute() { 
    const layerIds = [
        'route-line-0-clean', 'route-line-0-dirty',
        'route-line-1-out-clean', 'route-line-1-in-clean', 'route-line-1-out-dirty', 'route-line-1-in-dirty',
        'route-line-2-out-clean', 'route-line-2-in-clean', 'route-line-2-out-dirty', 'route-line-2-in-dirty'
    ];
    layerIds.forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
    if (map.getSource('route')) map.removeSource('route');

    const activeStops = stops.filter(s => isStopVisible(s, true) && s.lng && s.lat);

    let routedStops = [];
    if (isManagerView) {
        routedStops = activeStops.filter(s => isRouteAssigned(s.status));
    } else {
        routedStops = activeStops;
    }
    
    if (routedStops.length === 0) return; 

    let visualStops = [...routedStops].sort(sortByEta);

    const features = [];
    const routesMap = new Map();

    visualStops.forEach(s => {
        const key = `${s.driverId || 'unassigned'}_${s.cluster === 'X' ? 0 : (s.cluster || 0)}`;
        if (!routesMap.has(key)) routesMap.set(key, []);
        routesMap.get(key).push(s);
    });

    routesMap.forEach((cStops, key) => {
        if (cStops.length > 0) {
            const style = getVisualStyle(cStops[0]);
            let coords = cStops.map(s => [parseFloat(s.lng), parseFloat(s.lat)]);
            
            let dId = key.split('_')[0];
            let clusterIndex = parseInt(key.split('_')[1]);
            let eps = getActiveEndpoints();
            let rStart = eps.start;
            let rEnd = eps.end;

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
    
    map.addLayer({ "id": "route-line-0-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-0-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 0], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 

    map.addLayer({ "id": "route-line-1-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-1-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-1-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-1-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 1], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#000000", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 

    map.addLayer({ "id": "route-line-2-out-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8 } }); 
    map.addLayer({ "id": "route-line-2-in-clean", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", false]], "layout": { "line-join": "round", "line-cap": "round" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1 } }); 
    map.addLayer({ "id": "route-line-2-out-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.8, "line-dasharray": [2, 2] } }); 
    map.addLayer({ "id": "route-line-2-in-dirty", "type": "line", "source": "route", "filter": ["all", ["==", "clusterIdx", 2], ["==", "isDirty", true]], "layout": { "line-join": "round", "line-cap": "butt" }, "paint": { "line-color": "#ffffff", "line-width": 2, "line-opacity": 1, "line-dasharray": [6, 6] } }); 
}

// Map Shift-Click Bounding Box Selection
let start_pos, box_el;
map.on('click', (e) => { 
    if (e.originalEvent.target.classList.contains('mapboxgl-canvas')) { 
        selectedIds.clear(); 
        if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
    } 
});
const canvas = map.getCanvasContainer();

canvas.addEventListener('mousedown', (e) => { 
    if (e.target.closest('.mapboxgl-marker')) return; 
    if(e.shiftKey) { 
        map.dragPan.disable(); start_pos = mousePos(e); 
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); 
    } 
}, true);

function mousePos(e) { 
    const r = canvas.getBoundingClientRect(); 
    return new mapboxgl.Point(e.clientX-r.left, e.clientY-r.top); 
}

function onMouseMove(e) { 
    const curr = mousePos(e); 
    if(!box_el) { 
        box_el=document.createElement('div'); box_el.className='boxdraw'; canvas.appendChild(box_el); 
    } 
    const minX=Math.min(start_pos.x,curr.x), maxX=Math.max(start_pos.x,curr.x), minY=Math.min(start_pos.y,curr.y), maxY=Math.max(start_pos.y,curr.y); 
    box_el.style.left=minX+'px'; box_el.style.top=minY+'px'; box_el.style.width=(maxX-minX)+'px'; box_el.style.height=(maxY-minY)+'px'; 
}

function onMouseUp(e) { 
    document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); 
    if(box_el) { 
        const b=[start_pos, mousePos(e)]; 
        markers.filter(m => { 
            const pt=map.project(m.getLngLat()); 
            return pt.x>=Math.min(b[0].x,b[1].x) && pt.x<=Math.max(b[0].x,b[1].x) && pt.y>=Math.min(b[0].y,b[1].y) && pt.y<=Math.max(b[0].y,b[1].y); 
        }).forEach(m => selectedIds.add(m._stopId)); 
        box_el.remove(); box_el=null; 
        if (typeof updateSelectionUI === 'function') updateSelectionUI(); 
    } 
    map.dragPan.enable(); start_pos=null; 
}
