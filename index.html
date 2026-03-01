<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Sproute Dashboard</title>
    <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css" rel="stylesheet">
    <script src="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    
    <link rel="stylesheet" href="styles.css">
</head>
<body class="view-driver manager-all-inspectors">

<div id="processing-overlay">Processing...</div>

<div id="map-wrapper">
    <div id="map-brand" class="floating-brand">
        <span id="map-driver-name" style="font-size: 18px; font-weight: bold; color: var(--text-main); letter-spacing: 0.5px;"></span>
        <img id="brand-logo-map" src="https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png" style="height: 28px; width: auto;" alt="Brand Logo">
    </div>

    <div id="map-hint">Shift-drag or Shift-click to select multiple</div>
    <div class="map-overlay-btns">
        <button id="reset-view-btn" class="floating-btn" onclick="resetMapView()">
            <i class="fa-solid fa-expand"></i> Reset View
        </button>
        <button id="bulk-complete-btn" class="floating-btn" onclick="triggerBulkComplete()">
            <i class="fa-solid fa-circle-check"></i> Mark selected as completed
        </button>
        <button id="bulk-unroute-btn" class="floating-btn" onclick="triggerBulkUnroute()">
            <i class="fa-solid fa-route"></i> Remove selected from route
        </button>
        <button id="bulk-delete-btn" class="floating-btn" onclick="triggerBulkDelete()">
            <i class="fa-solid fa-trash-can"></i> Delete selected
        </button>
        
        <button id="move-r1-btn" class="floating-btn manual-move" onclick="moveSelectedToRoute(0)" style="border-left: 4px solid #2563eb;">
            Move to Route 1
        </button>
        <button id="move-r2-btn" class="floating-btn manual-move" onclick="moveSelectedToRoute(1)" style="border-left: 4px solid #10b981;">
            Move to Route 2
        </button>
        <button id="move-r3-btn" class="floating-btn manual-move" onclick="moveSelectedToRoute(2)" style="border-left: 4px solid #f1c40f;">
            Move to Route 3
        </button>
    </div>
    <div id="map"></div>
</div>

<div id="resizer"></div>

<div id="sidebar">
    <div id="sidebar-brand" style="padding: 12px 15px; background: var(--bg-header); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between;">
        <span id="sidebar-driver-name" style="font-size: 20px; font-weight: bold; color: var(--text-main); letter-spacing: 0.5px;"></span>
        <select id="inspector-filter" class="insp-select" onchange="handleInspectorFilterChange(this.value)" style="display:none; font-size: 15px; padding: 8px 30px 8px 12px; width: auto; max-width: 65%; font-weight: bold;"></select>
        <img id="brand-logo-sidebar" src="https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png" style="height: 36px; width: auto;" alt="Brand Logo">
    </div>

    <div id="routing-controls">
        <div id="route-divider-group" style="display:flex; gap:8px;">
            <div class="route-btn active" onclick="setRoutes(1)" id="rbtn-1" style="--route-color: #2563eb;">
                <div class="rbtn-title">1 Route</div>
                <div class="rbtn-time" id="rtime-1">-- hrs</div>
            </div>
            <div class="route-btn" onclick="setRoutes(2)" id="rbtn-2" style="--route-color: #10b981;">
                <div class="rbtn-title">2 Routes</div>
                <div class="rbtn-time" id="rtime-2">-- hrs</div>
            </div>
            <div class="route-btn" onclick="setRoutes(3)" id="rbtn-3" style="--route-color: #f1c40f;">
                <div class="rbtn-title">3 Routes</div>
                <div class="rbtn-time" id="rtime-3">-- hrs</div>
            </div>
        </div>

        <div style="display:flex; align-items:flex-end; gap:15px; margin-top:15px;">
            <div id="priority-container" style="flex:1; display:flex; flex-direction:column;">
                <label style="font-size:13px; font-weight:bold; color:var(--text-main); margin-bottom:6px;">Priority Weighting</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:12px; color:var(--text-muted);">Efficiency</span>
                    <input type="range" id="slider-priority" min="0" max="100" value="0" oninput="liveClusterUpdate()">
                    <span style="font-size:12px; color:var(--text-muted);">Due Dates</span>
                </div>
            </div>
            
            <button id="btn-generate-route" class="btn-generate" onclick="handleGenerateRoute()">
                <i class="fa-solid fa-route"></i> Generate Route(s)
            </button>
        </div>
    </div>

    <div id="route-summary">
        <div class="summary-left">
            <div id="summary-metrics"><span id="sum-dist">-- mi</span> | <span id="sum-time">-- hrs</span></div>
        </div>
        <div class="summary-right">
            <div id="order-stats">
                <span id="stat-total">0 Orders</span> | 
                <span id="stat-due" style="color:var(--orange)">0 Due Today</span> | 
                <span id="stat-past" style="color:var(--red)">0 Past Due</span>
            </div>
        </div>
    </div>
    
    <div id="search-container">
        <input type="text" id="search-input" placeholder="Search address or client..." onkeyup="filterList()">
        <div class="rocker">
            <div id="btn-detailed" class="active" onclick="setDisplayMode('detailed')">Detailed</div>
            <div id="btn-compact" onclick="setDisplayMode('compact')">Compact</div>
        </div>
    </div>
    
    <div id="controls">
        <div style="text-align: center; font-weight: bold; color: var(--red); font-size: 12px; margin-bottom: 4px;">CHANGES MADE - SYNC REQUIRED</div>
        <div class="ctrl-row">
            <button id="btn-reoptimize" class="btn-glide" onclick="handleOptimize()" style="background:var(--blue); color:white; font-weight:bold;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Re-Optimize
            </button>
            <button id="btn-recalc" class="btn-glide" style="background:#444; color:white;" onclick="handleCalculate()">
                <i class="fa-solid fa-calculator"></i> Re-Calculate
            </button>
            <button class="btn-glide" style="background:var(--bg-panel); color:var(--text-main); border:1px solid var(--border-color);" onclick="handleUndo()">
                <i class="fa-solid fa-rotate-left"></i> Undo
            </button>
        </div>
    </div>
    
    <div id="stop-list"></div>
</div>

<div id="modal-overlay"><div class="modal-box" id="modal-content"></div></div>

<script src="app.js"></script>
</body>
</html>
