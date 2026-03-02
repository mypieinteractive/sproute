/**
 * SPROUTE BACKEND - V3.3
 * FILE: Feature_Routing.gs (Optimization & Logistics)
 * Changes: V3.3 - Updated 'runAutoOptimization' to read frontend cluster state.
 * Routes are now properly solved and indexed independently, cascading ETAs to subsequent days.
 */

function processQueuedRouting() {
  console.log("[ROUTING QUEUE] Scanning Optimize_Requests for pending routes...");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const optSheet = ss.getSheetByName("Optimize_Requests");
  if (!optSheet) return;

  const data = optSheet.getDataRange().getValues();
  let processedCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && !data[i][1]) { 
      processedCount++;
      const driverId = String(data[i][5]).trim();
      const userId = String(data[i][6]).trim();
      const targetHandshakeId = userId ? userId : driverId; 

      console.log(`[ROUTING QUEUE] Initiating solver for Row ${i+1} | Driver: ${driverId}`);
      console.time(`Routing_${driverId}`);
      
      const result = runAutoOptimization(driverId, i + 1);
      
      if (result.success) {
        optSheet.getRange(i + 1, 2).setValue("Complete");
        console.log(`[ROUTING QUEUE] Optimization Success. Assigned Route ID: ${result.routeId}`);
      } else {
        optSheet.getRange(i + 1, 2).setValue(`Failed: ${result.error}`);
        console.warn(`[ROUTING QUEUE] Optimization Aborted. Reason: ${result.error}`);
      }
      
      clearGlideRefreshFlag(targetHandshakeId);
      console.timeEnd(`Routing_${driverId}`);
    }
  }
  if (processedCount === 0) console.log("[ROUTING QUEUE] No pending route requests found.");
}

function runAutoOptimization(targetDriverId, optRow) {
  console.log(`[AUTO OPTIMIZER] Building data model for: ${targetDriverId}`);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const optSheet = ss.getSheetByName("Optimize_Requests"), profilesSheet = ss.getSheetByName("Inspectors"), compSheet = ss.getSheetByName("Companies"), ordersSheet = ss.getSheetByName("Orders");
  
  const now = new Date(), routeId = now.getTime().toString();
  const profilesData = profilesSheet.getDataRange().getValues();
  
  const profileRowIdx = profilesData.findIndex(r => String(r[0]).trim() === targetDriverId);
  if (profileRowIdx === -1) return { success: false, error: "Driver Profile not found in Inspectors tab." };
  
  const profile = profilesData[profileRowIdx];
  const compId = String(profile[1]).trim();
  const compData = compSheet ? compSheet.getDataRange().getValues().find(c => String(c[0]).trim() === compId) : null;
  
  const newDashboardLink = `${GITHUB_DASHBOARD_URL}?id=${routeId}&driver=${encodeURIComponent(targetDriverId)}`;
  profilesSheet.getRange(profileRowIdx + 1, 14).setValue(newDashboardLink);

  const allOrders = ordersSheet.getDataRange().getValues();
  if (!allOrders || allOrders.length <= 1) return { success: false, error: "Orders sheet is empty." };

  let routableStops = [];
  for (let i = 1; i < allOrders.length; i++) {
    if (String(allOrders[i][13]).trim() === targetDriverId && allOrders[i][1]) {
      let lat = String(allOrders[i][8] || "").trim();
      let lng = String(allOrders[i][9] || "").trim();
      
      if (!lat || !lng || (lat === "32.776" && lng === "-96.797")) {
        ordersSheet.getRange(i + 1, 16).setValue("Unfound During Optimization"); 
      } else {
        routableStops.push({ $rowID: allOrders[i][0], Name: allOrders[i][1], TBdaH: allOrders[i][2], app: allOrders[i][3], ysPOc: allOrders[i][4], er4q8: allOrders[i][6], wat1P: lat, cLfxZ: lng, as2b3: allOrders[i][15], sheetRowIndex: i + 1 });
      }
    }
  }
  
  if (routableStops.length === 0) return { success: false, error: "No orders found for this Driver with valid coordinates." };

  // Parse any pre-clustered arrays provided by the dashboard UI
  const clustersJson = optSheet.getRange(optRow, 7).getValue();
  let frontendClusters = [];
  try { if (clustersJson) frontendClusters = JSON.parse(clustersJson); } catch(e) {}
  
  let clustersToRoute = [];
  if (frontendClusters && frontendClusters.length > 0) {
      frontendClusters.forEach(fc => {
          let cStops = [];
          fc.forEach(minStop => {
              let found = routableStops.find(rs => String(rs.$rowID).trim() === String(minStop.r).trim());
              if (found) cStops.push(found);
          });
          if (cStops.length > 0) clustersToRoute.push(cStops);
      });
  }
  
  // Fallback to routing everything as a single day if no clusters were passed
  if (clustersToRoute.length === 0) clustersToRoute = [routableStops];

  const start = callStandardGeocodingAPI(profile[3]) || callAddressValidationAPI(profile[3]); 
  const end = profile[4] ? callStandardGeocodingAPI(profile[4]) || callAddressValidationAPI(profile[4]) : start; 
  
  let startTime = compData ? parseInt(compData[6]) : 8;
  let serviceDelay = compData ? parseInt(compData[7]) : 15;
  let time = new Date(); time.setHours(startTime, 0, 0, 0);
  
  let masterSnapshotData = [];
  let globalSequenceId = 1;

  for (let c = 0; c < clustersToRoute.length; c++) {
      let clusterStops = clustersToRoute[c];
      let routeInput = clusterStops.map(s => ({ lat: s.wat1P, lng: s.cLfxZ }));
      
      let optimized = routeInput.length <= 25 ? callStandardRoutingAPI(start, routeInput, end, false) : callMasterRoutingAPI(start, routeInput, end, false, 0);
      
      if (optimized) {
          optimized.forEach((visit) => {
              let originalStop = clusterStops[visit.index];
              time = new Date(time.getTime() + (visit.durationSecs * 1000));
              let eta = Utilities.formatDate(time, Session.getScriptTimeZone(), "MM/dd/yy h:mm a");
              time = new Date(time.getTime() + (serviceDelay * 60 * 1000));
              
              ordersSheet.getRange(originalStop.sheetRowIndex, 6).setValue(eta);
              ordersSheet.getRange(originalStop.sheetRowIndex, 12).setValue(visit.distance);
              ordersSheet.getRange(originalStop.sheetRowIndex, 16).setValue("Routed");

              let rawDate = originalStop.ysPOc;
              let shortDate = rawDate ? Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "MM/dd/yy") : "";
              let shortLat = Number(parseFloat(originalStop.wat1P).toFixed(5));
              let shortLng = Number(parseFloat(originalStop.cLfxZ).toFixed(5));
              
              masterSnapshotData.push({ i: globalSequenceId++, R: "R:" + (c + 1), a: originalStop.Name, c: originalStop.TBdaH, p: originalStop.app, d: shortDate, t: originalStop.er4q8, e: eta, D: visit.distance, l: shortLat, g: shortLng, s: "Routed", u: visit.durationSecs, r: originalStop.$rowID });
          });
          
          // Increment the virtual day so Route 2 processes ETAs for tomorrow, Route 3 for the next day, etc.
          time.setDate(time.getDate() + 1);
          time.setHours(startTime, 0, 0, 0);
      }
  }
  
  if (masterSnapshotData.length === 0) return { success: false, error: "Google API rejected the routing payload for all clusters." };
  
  optSheet.getRange(optRow, 3).setValue(now); 
  optSheet.getRange(optRow, 4).setValue(newDashboardLink); 
  optSheet.getRange(optRow, 5).setValue(JSON.stringify(masterSnapshotData)); 
  
  return { success: true, routeId: routeId }; 
}
