/* * */
/* * Dashboard - V12.7 */
/* * FILE: config.js */
/* * Changes: Re-implemented the Testing Mode logic triggered by backend=testing parameter. */
/* * */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibXlwaWVpbnRlcmFjdGl2ZSIsImEiOiJjbWx2ajk5Z2MwOGZlM2VwcDBkc295dzI1In0.eGIhcRPrj_Hx_PeoFAYxBA';

const params = new URLSearchParams(window.location.search);
let routeId = params.get('id');
const driverParam = params.get('driver');
const companyParam = params.get('company');
const adminParam = params.get('admin');
const backendParam = params.get('backend'); 

// --- A/B Testing Mode Configuration ---
let WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzgh2KCzfdWbOmdVq_edpuI_m6HxkfErzYAEHySfKkq1zgLtwuiUT3GCS5Xor9GgjFa/exec';
let isTestingMode = (backendParam === 'testing');
let activeTestingBackend = sessionStorage.getItem('sproute_testing_backend') || 'appscript';

if (isTestingMode) {
    if (activeTestingBackend === 'firestore') {
        WEB_APP_URL = 'https://glidewebhooksync-761669621272.us-south1.run.app';
        console.log("🔥 Testing Mode: API requests routed to Firestore (Cloud Run).");
    } else {
        console.log("🟢 Testing Mode: API requests routed to Apps Script.");
    }
}
// --------------------------------------

let frontEndApiUsage = { geocode: 0, mapLoads: 0 };
const viewMode = (params.get('view') || 'inspector').toLowerCase(); 
const isManagerView = (viewMode === 'manager' || viewMode === 'managermobile' || viewMode === 'managermobilesplit'); 

const STATUS_MAP_TO_TEXT = { 'P': 'Pending', 'R': 'Routed', 'C': 'Completed', 'D': 'Deleted', 'V': 'Validation Failed', 'O': 'Optimization Failed', 'S': 'Dispatched' };
const STATUS_MAP_TO_CODE = { 'pending': 'P', 'routed': 'R', 'completed': 'C', 'deleted': 'D', 'validation failed': 'V', 'optimization failed': 'O', 'dispatched': 'S' };

let COMPANY_SERVICE_DELAY = 0; 
let PERMISSION_MODIFY = true;
let PERMISSION_REOPTIMIZE = true;
let sortableInstances = [];
let sortableUnrouted = null;
let currentRouteCount = 1; 

let availableCsvTypes = [];
let currentInspectorFilter = sessionStorage.getItem('sproute_inspector_filter') || 'all';

const currentQuery = window.location.search;
const lastQuery = sessionStorage.getItem('sproute_last_query');
let isFreshGlideRefresh = false;

if (lastQuery && currentQuery !== lastQuery) {
    if (currentQuery.includes('Upload-')) {
        isFreshGlideRefresh = true;
    }
}
sessionStorage.setItem('sproute_last_query', currentQuery);

let pageLoadRetries = 0;
const MAX_RETRIES = 5;

let defaultEmailMessage = "";
let companyEmail = "";
let managerEmail = "";
let adminEmail = ""; 
let ccCompanyDefault = true;

let routeStart = null;
let routeEnd = null;

let dirtyRoutes = new Set(); 
let historyStack = [];
let isAlteredRoute = false;

let isPollingForRoute = false;
let isPollingForUpload = false;
let pollRetries = 0;

let currentRouteViewFilter = 'all';
let isFirstMapRender = true;
let latestSuggestions = { start: null, end: null };

let stops = [], originalStops = [], inspectors = [], markers = [], initialBounds = null, selectedIds = new Set(), currentDisplayMode = 'detailed', currentStartTime = "8:00 AM";
let currentSort = { col: null, asc: true };

const MASTER_PALETTE = [
    '#4363d8', '#ffd8b1', '#469990', '#808000', '#000075', 
    '#bfef45', '#fffac8', '#f58231', '#42d4f4', '#3cb44b', 
    '#a9a9a9', '#800000', '#aaffc3', '#f032e6', '#ffe119', 
    '#e6194B', '#9A6324', '#fabed4', '#dcbeff', '#911eb4'
];

let start_pos, box_el;
let geocodeTimeout;
