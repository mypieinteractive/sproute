// *
// * Dashboard - V6.5
// * FILE: map.js
// * Description: Mapbox initialization, route lines, and lasso tool logic.
// *

import { Config, State, hexToRgba } from './state.js';
import { updateSelectionUI, focusTile, getActiveEndpoints, getVisualStyle } from './ui.js';

mapboxgl.accessToken = Config.MAPBOX_TOKEN;
export const map = new mapboxgl.Map({ 
    container: 'map', 
    style: 'mapbox://styles/mapbox/dark-v11', 
    center: [-96.797, 32.776],
    zoom: 11, 
    attributionControl: false,
    boxZoom: false,
    preserveDrawingBuffer: true 
});

export function drawRoute() { 
    if (map.getLayer('route-line-0')) map.removeLayer('route-line-0');
    if (map.getLayer('route-line-1')) map.removeLayer('route-line-1');
    if (map.getLayer('route-line-2')) map.removeLayer('route-line-2');
    if (map.getSource('route')) map.removeSource('route');

    const activeStops = State.stops.filter(s => {
        const status = (s.status || '').toLowerCase().trim();
        const routeState = (s.routeState || '').toLowerCase().trim();
        if (State.isManagerView && (routeState === 'dispatched' || status === 'dispatched' || status === 's')) return false;
        if (State.isManagerView) return (status === 'pending' || status === 'routed' || status === 'completed');
        let active = status !== 'cancelled' && status !== 'deleted' && !status.includes('failed') && status !== 'unfound';
        if (s.hiddenInInspector) active = false;
        return active;
    }).filter(s => s.lng && s.lat);
    
    let routedStops = [];
    
    if (State.isManagerView) {
        routedStops = activeStops.filter(s => (s.status||'').toLowerCase() === 'routed' || (s.status||'').toLowerCase() === 'completed' || (s.status||'').toLowerCase() === 'dispatched');
    } else {
        routedStops = activeStops;
    }
    
    if (routedStops.length === 0) return; 

    routedStops.sort((a, b) => {
        let tA = a.eta ? new Date(a.eta).getTime() : 0;
        let tB = b.eta ? new Date(b.eta).getTime() : 0;
        return tA - tB;
    });

    const features = [];
    const routesMap = new Map();

    routedStops.forEach(s => {
        const key = `${s.driverId || 'unassigned'}_${s.cluster || 0}`;
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

            if (State.isManagerView && State.currentInspectorFilter === 'all' && dId !== 'unassigned') {
                const insp = State.inspectors.find(i => i.id === dId);
                if (insp) {
                    rStart = { lng: insp.startLng, lat: insp.startLat };
                    rEnd = { lng: insp.endLng || insp.startLng, lat: insp.endLat || insp.startLat };
                }
            }

            if (rStart && rStart.lng && rStart.lat) coords.unshift([parseFloat(rStart.lng), parseFloat(rStart.lat)]);
            if (rEnd && rEnd.lng && rEnd.lat) coords.push([parseFloat(rEnd.lng), parseFloat(rEnd.lat)]);

            if (coords.length > 1) {
                features.push({
                    "type": "Feature",
                    "properties": { "color": style.line, "clusterIdx": clusterIndex }, 
                    "geometry": { "type": "LineString", "coordinates": coords }
                });
            }
        }
    });

    map.addSource('route', { "type": "geojson", "data": { "type": "FeatureCollection", "features": features } }); 
    
    map.addLayer({ 
        "id": "route-line-0", "type": "line", "source": "route", "filter": ["==", "clusterIdx", 0],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6 } 
    }); 
    
    map.addLayer({ 
        "id": "route-line-1", "type": "line", "source": "route", "filter": ["==", "clusterIdx", 1],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-dasharray": [2, 2] } 
    }); 
    
    map.addLayer({ 
        "id": "route-line-2", "type": "line", "source": "route", "filter": ["==", "clusterIdx", 2],
        "layout": { "line-join": "round", "line-cap": "round" }, 
        "paint": { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-dasharray": [0.5, 2] } 
    }); 
}

export function focusPin(id) { 
    const tgt = State.stops.find(s=>s.id==id); 
    if(tgt && tgt.lng && tgt.lat) map.flyTo({ center: [tgt.lng, tgt.lat] }); 
}

export function resetMapView() { 
    if (State.initialBounds) map.fitBounds(State.initialBounds, { padding: 50, maxZoom: 15 }); 
}

export function initLasso() {
    let start_pos, box_el;
    map.on('click', (e) => { if (e.originalEvent.target.classList.contains('mapboxgl-canvas')) { State.selectedIds.clear(); updateSelectionUI(); } });
    const canvas = map.getCanvasContainer();

    canvas.addEventListener('mousedown', (e) => { 
        if (e.target.closest('.mapboxgl-marker')) return; 
        if(e.shiftKey) { 
            map.dragPan.disable(); start_pos = mousePos(e); 
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); 
        } 
    }, true);

    function mousePos(e) { const r = canvas.getBoundingClientRect(); return new mapboxgl.Point(e.clientX-r.left, e.clientY-r.top); }

    function onMouseMove(e) { 
        const curr = mousePos(e); 
        if(!box_el) { box_el=document.createElement('div'); box_el.className='boxdraw'; canvas.appendChild(box_el); } 
        const minX=Math.min(start_pos.x,curr.x), maxX=Math.max(start_pos.x,curr.x), minY=Math.min(start_pos.y,curr.y), maxY=Math.max(start_pos.y,curr.y); 
        box_el.style.left=minX+'px'; box_el.style.top=minY+'px'; box_el.style.width=(maxX-minX)+'px'; box_el.style.height=(maxY-minY)+'px'; 
    }

    function onMouseUp(e) { 
        document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); 
        if(box_el) { 
            const b=[start_pos, mousePos(e)]; 
            State.markers.filter(m => { 
                const pt=map.project(m.getLngLat()); 
                return pt.x>=Math.min(b[0].x,b[1].x) && pt.x<=Math.max(b[0].x,b[1].x) && pt.y>=Math.min(b[0].y,b[1].y) && pt.y<=Math.max(b[0].y,b[1].y); 
            }).forEach(m=>State.selectedIds.add(m._stopId)); 
            box_el.remove(); box_el=null; updateSelectionUI(); 
        } 
        map.dragPan.enable(); start_pos=null; 
    }
}
