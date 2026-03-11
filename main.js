// *
// * Dashboard - V6.5
// * FILE: main.js
// * Description: Application entry point, global module binder for HTML templates.
// *

import { State, undoLastAction } from './state.js';
import * as MapCtrl from './map.js';
import * as UI from './ui.js';
import * as API from './api.js';
import * as DragDrop from './drag-drop.js';

// Expose globally required functions to the window object for inline HTML handlers
window.resetMapView = MapCtrl.resetMapView;
window.triggerBulkComplete = API.triggerBulkComplete; 
window.triggerBulkUnroute = API.triggerBulkUnroute;
window.triggerBulkDelete = API.triggerBulkDelete;
window.moveSelectedToRoute = UI.moveSelectedToRoute;
window.handleInspectorFilterChange = UI.handleInspectorFilterChange;
window.handleRestoreOriginal = API.handleRestoreOriginal;
window.handleStartOver = API.handleStartOver;
window.handleCalculate = API.handleCalculate;
window.handleGenerateRoute = API.handleGenerateRoute;
window.setRoutes = UI.setRoutes;
window.liveClusterUpdate = DragDrop.liveClusterUpdate;
window.filterList = UI.filterList;
window.setDisplayMode = UI.setDisplayMode;
window.undoLastAction = undoLastAction;
window.toggleSelectAll = UI.toggleSelectAll;
window.sortTable = UI.sortTable;
window.handleInspectorChange = API.handleInspectorChange;
window.toggleComplete = API.toggleComplete;
window.openNav = UI.openNav;
window.setNavPref = UI.setNavPref;
window.handleEndpointInput = UI.handleEndpointInput;
window.handleEndpointKeyDown = UI.handleEndpointKeyDown;
window.handleEndpointBlur = UI.handleEndpointBlur;
window.handleEndpointOptimize = UI.handleEndpointOptimize;
window.checkEndpointModified = UI.checkEndpointModified;

// Event Listeners for Mapbox Lasso Tool & Resize Handlers
document.addEventListener('keydown', (e) => { if (e.key === 'Shift') UI.updateShiftCursor(true); });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') UI.updateShiftCursor(false); });
document.addEventListener('mousemove', (e) => { UI.updateShiftCursor(e.shiftKey); });

UI.initResizer();
MapCtrl.initLasso();

document.body.className = `view-${State.viewMode} manager-all-inspectors`;

// Start the Dashboard
API.loadData();
