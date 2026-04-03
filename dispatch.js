/**
 * SPROUTE BACKEND - V0.4
 * FILE: Enterprise.gs (Hybrid Cloud Foundation)
 * Changes: 
 * V0.4 - Node.js Relay Update. The doPost function now strictly reads the route data 
 * (stagingJsonStr and endpointsObj) directly from the incoming Node.js payload. 
 * This ensures the email is generated from the live Firestore truth rather than the 
 * stale Google Sheet. Removed logic that cleared the staging bay, as Node.js now 
 * handles all Firestore DB wiping.
 */

const GLIDE_TOKEN = '77804d07-3b60-415c-a8f8-4f84f33b974a';
const GLIDE_APP_ID = 'aEJcMQuIZlzTMRgkbgSh';
const GLIDE_PROFILES_TABLE = 'Driver_Profiles'; 
const GITHUB_DASHBOARD_URL = 'https://mypieinteractive.github.io/prospect-dashboard/';

// ==========================================
// CORE SYSTEM UTILITIES
// ==========================================

function getCompanyIdFromDriver(driverId) {
  try {
    const profiles = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Users").getDataRange().getValues();
    const profile = profiles.find(r => String(r[0]).trim() === String(driverId).trim());
    return profile ? profile[1] : null;
  } catch (e) { 
    console.error("[CORE SYSTEM] Error fetching company ID: " + e.message);
    return null; 
  }
}

function sendInstantDispatchEmail(payload, ss) {
    console.log("[CORE SYSTEM] Generating Instant Dispatch Email for Driver: " + payload.driverId);
    let driverId = payload.driverId;
    let companyId = payload.companyId;
    let customBody = payload.customBody || "";
    let mapBase64 = payload.mapBase64 || "";

    let profiles = ss.getSheetByName("Users").getDataRange().getValues();
    let companies = ss.getSheetByName("Companies").getDataRange().getValues();

    let profile = profiles.find(r => String(r[0]).trim() === String(driverId).trim());
    if (!profile || !profile[7]) throw new Error("Inspector email not found.");

    let driverName = profile[2] || "Inspector";
    let driverEmail = profile[7];

    let compData = companies.find(c => String(c[0]).trim() === String(companyId).trim());
    let compName = compData ? compData[1] : "Your Company";
    let compAddress = compData ? compData[2] : "";
    let compEmail = compData ? compData[3] : "noreply@routeapp.com";
    let compLogo = compData ? compData[4] : "";
    let compServiceDelay = compData && compData[7] !== "" ? parseInt(compData[7]) || 0 : 0;

    let latestRouteStops = [];
    let latestDashboardLink = payload.dashboardLink || ""; 

    if (payload.stagingJsonStr) { 
        let rawStops = [];
        try { rawStops = JSON.parse(payload.stagingJsonStr); } catch(e){}
        latestRouteStops = rawStops.map(s => {
            if (Array.isArray(s)) return { r: s[0], R: s[1], a: s[2], c: s[3], p: s[4], d: s[5], t: s[6], e: s[7], D: s[8], l: s[9], g: s[10], s: s[11], u: s[12] };
            return s; 
        });
    }

    let inlineImagesObj = {};
    let mapImageHtml = "";

    if (mapBase64 && mapBase64.includes("base64,")) {
        try {
            let base64Data = mapBase64.split(",")[1];
            let mapBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/png", "routeMap.png");
            inlineImagesObj['routeMap'] = mapBlob;

            let linkStart = latestDashboardLink ? `<a href="${latestDashboardLink}" target="_blank" style="text-decoration:none; display:block; text-align:center;">` : `<div style="text-align:center;">`;
            let linkEnd = latestDashboardLink ? `</a>` : `</div>`;
            mapImageHtml = `
              <div style="margin-bottom: 25px;">
                ${linkStart}
                  <div style="font-size: 15px; font-weight: bold; color: #2563eb; margin-bottom: 10px; font-family: Arial, sans-serif;">Click to open your interactive route ➔</div>
                  <img src="cid:routeMap" style="width: 100%; max-width: 600px; border-radius: 8px; border: 1px solid #d1d5db; margin: 0 auto; display: inline-block;" alt="Route Map">
                ${linkEnd}
              </div>`;
        } catch(e) { console.error("[CORE SYSTEM] Base64 Decode Error: " + e.message); }
    }

    let totalMiles = 0, dueToday = 0, pastDue = 0, totalOrders = latestRouteStops.length, totalSecs = 0;
    let routesMap = {};
    
    latestRouteStops.forEach(s => {
        let rLabel = s.R || 1; 
        if(!routesMap[rLabel]) routesMap[rLabel] = [];
        routesMap[rLabel].push(s);
        totalSecs += parseFloat(s.u || 0);
    });
    
    let totalHrs = totalOrders > 0 ? ((totalSecs + (totalOrders * compServiceDelay * 60)) / 3600).toFixed(1) : 0;
    
    let routeKeys = Object.keys(routesMap).sort((a, b) => {
        let numA = parseInt(String(a).replace(/\D/g, '')) || 0;
        let numB = parseInt(String(b).replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    let tableRows = "";
    const hexColors = { "1": "#000075", "2": "#4363d8", "3": "#469990" };
    let today = new Date(); today.setHours(0,0,0,0);
    
    routeKeys.forEach(rKey => {
        let rStops = routesMap[rKey];
        let routeNumStr = String(rKey).replace("R:", "");
        let rColor = hexColors[routeNumStr] || "#374151";
        
        rStops.sort((a, b) => {
            const timeToMins = (tStr) => {
                if (!tStr || tStr === '--') return 99999; 
                let match = String(tStr).match(/(\d+):(\d+)\s*(AM|PM)/i);
                if (!match) return 99999;
                let hrs = parseInt(match[1], 10), mins = parseInt(match[2], 10), ampm = match[3].toUpperCase();
                if (hrs === 12 && ampm === 'AM') hrs = 0;
                if (hrs !== 12 && ampm === 'PM') hrs += 12;
                return (hrs * 60) + mins;
            };
            return timeToMins(a.e) - timeToMins(b.e);
        });

        if (routeKeys.length > 1) {
            tableRows += `<tr style="background-color: #f3f4f6;"><td colspan="7" style="padding: 8px 10px; font-weight: bold; color: ${rColor}; font-size: 11px; text-align: left; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db;">ROUTE ${routeNumStr}</td></tr>`;
        }
        
        let localSeq = 1;
        rStops.forEach((s) => {
           let mi = parseFloat(s.D || 0);
           if(!isNaN(mi)) totalMiles += mi;
           
           let dueBg = "#374151", dueFmt = '--';
           if (s.d) {
              let dueTime = new Date(s.d);
              dueTime.setHours(0,0,0,0);
              dueFmt = `${dueTime.getMonth()+1}/${dueTime.getDate()}`;
              if (dueTime < today) { pastDue++; dueBg = "#ef4444"; } 
              else if (dueTime.getTime() === today.getTime()) { dueToday++; dueBg = "#f59e0b"; }
           }

           let appVal = (s.p || '--').substring(0,2).toUpperCase();
           let appHtml = `<div style="background-color:#374151; color:#ffffff; width:28px; height:28px; border-radius:4px; text-align:center; line-height:28px; font-size:11px; font-weight:bold; margin:0 auto;">${appVal}</div>`;
           let dueHtml = `<div style="background-color:${dueBg}; color:#ffffff; padding:4px 8px; border-radius:4px; text-align:center; font-size:11px; display:inline-block; font-weight:bold;">${dueFmt}</div>`;

           let timeOnly = s.e || '--'; 

           let shortAddr = s.a ? s.a.split(',')[0] : '--'; 
           let mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.a || '')}`;
           let addrHtml = `<a href="${mapsLink}" style="color:#111827; text-decoration:none; font-weight:bold;">${shortAddr}</a>`;

           tableRows += `<tr>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center; color:#111827; font-weight:bold;">${localSeq}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">${timeOnly}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center;">${appHtml}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">${dueHtml}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${addrHtml}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${s.c || '--'}</td>
               <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${s.t || '--'}</td>
             </tr>`;
           localSeq++;
        });
    });

    let htmlSignature = `
      <table style="border-collapse: collapse; width: 100%; border-bottom: 2px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 20px;"><tr>
          ${compLogo ? `<td style="padding-right: 15px; width: 60px; vertical-align: middle;"><img src="${compLogo}" width="60" style="border-radius: 4px; display: block;"></td>` : ''}
          <td style="padding-left: 0px; font-family: Arial, sans-serif; font-size: 13px; line-height: 1.4; color: #333; vertical-align: middle;">
            <strong style="color: #111; font-size: 16px;">${compName}</strong><br><span style="color: #666;">${compAddress}</span><br><a href="mailto:${compEmail}" style="color: #2563eb; text-decoration: none;">${compEmail}</a>
          </td></tr></table>`;

    const sprouteLogoUrl = 'https://raw.githubusercontent.com/mypieinteractive/prospect-dashboard/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png';

    let htmlBody = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 800px;">
        ${htmlSignature}
        <p>${driverName},</p><p>${customBody.replace(/\n/g, '<br>')}</p>
        ${mapImageHtml}
        <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px;">
            <table style="width: 100%; font-family: Arial, sans-serif; font-size: 13px; font-weight: bold; color: #374151; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
                <tr>
                    <td style="text-align: left; vertical-align: top;">
                        <div style="margin-bottom: 6px;">TOTAL MILES: <span style="color:#111827">${totalMiles.toFixed(1)} mi</span></div>
                        <div>EST TIME: <span style="color:#111827">${totalHrs} hrs</span></div>
                    </td>
                    <td style="text-align: right; vertical-align: top;">
                        <div style="margin-bottom: 6px;">ORDERS: <span style="background-color:#111827; color:#ffffff; padding: 2px 6px; border-radius: 4px;">${totalOrders}</span></div>
                        ${(dueToday > 0 || pastDue > 0) ? `<div>${dueToday > 0 ? `<span style="margin-right: ${pastDue > 0 ? '10px' : '0'};">DUE TODAY: <span style="background-color:#f59e0b; color:#ffffff; padding: 2px 6px; border-radius: 4px;">${dueToday}</span></span>` : ''}${pastDue > 0 ? `<span>PAST DUE: <span style="background-color:#ef4444; color:#ffffff; padding: 2px 6px; border-radius: 4px;">${pastDue}</span></span>` : ''}</div>` : ''}
                    </td>
                </tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; color: #374151;">
                <thead><tr style="background-color: #f3f4f6; text-align: left;">
                    <th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db; text-align:center;">#</th><th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db;">ETA</th>
                    <th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db; text-align:center;">APP</th><th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db;">DUE</th>
                    <th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db;">ADDRESS</th><th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db;">CLIENT</th><th style="padding: 10px 8px; border-bottom: 2px solid #d1d5db;">ORDER TYPE</th>
                </tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #6b7280; font-family: Arial, sans-serif;">
            Generated by<br>
            <a href="https://sproute.io" target="_blank"><img src="${sprouteLogoUrl}" alt="Sproute" style="height: 20px; margin-top: 8px; opacity: 0.8;"></a>
        </div>
      </div>`;
    
    let textBody = `${driverName},\n\n${customBody}\n\nThank you,\n${compName}`;
    
    let ccList = [];
    if (payload.ccCompany && compEmail) ccList.push(compEmail);
    if (payload.addCc && String(payload.addCc).trim() !== '') ccList.push(String(payload.addCc).trim());
    if (payload.ccEmail && String(payload.ccEmail).trim() !== '') ccList.push(String(payload.ccEmail).trim());

    let emailOptions = { htmlBody: htmlBody, from: "sprouteapp@gmail.com", replyTo: compEmail, name: compName };
    if (Object.keys(inlineImagesObj).length > 0) emailOptions.inlineImages = inlineImagesObj;
    if (ccList.length > 0) emailOptions.cc = ccList.join(',');

    GmailApp.sendEmail(driverEmail, "Route Ready", textBody, emailOptions); 
    console.log("[CORE SYSTEM] Instant Dispatch Email Sent successfully.");
    return true;
}

function processEmailUpdates() {
  console.log("[CORE SYSTEM] Starting processEmailUpdates...");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const profilesSheet = ss.getSheetByName("Users");
  
  if (!profilesSheet) {
    console.warn("[CORE SYSTEM] Users sheet not found. Aborting processEmailUpdates.");
    return;
  }

  const data = profilesSheet.getDataRange().getValues();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; 
  let updatesProcessed = 0;

  for (let i = 1; i < data.length; i++) {
    const rowId = data[i][0]; 
    const newEmailRaw = data[i][8]; // Col I (Index 8)

    if (newEmailRaw && String(newEmailRaw).trim() !== "") {
      const newEmail = String(newEmailRaw).trim();
      console.log(`[CORE SYSTEM] Found pending email update in Row ${i + 1} for ID: ${rowId} -> Target Email: ${newEmail}`);

      if (emailRegex.test(newEmail)) {
        const glideSuccess = updateGlideUserProfileEmail(rowId, newEmail);
        if (glideSuccess) {
          profilesSheet.getRange(i + 1, 8).setValue(newEmail); // Col H (Index 7)
          profilesSheet.getRange(i + 1, 9).clearContent(); // Col I (Index 8)
          updatesProcessed++;
        }
      }
    }
  }

  if (updatesProcessed > 0) {
    SpreadsheetApp.flush();
    console.log(`[CORE SYSTEM] processEmailUpdates completed. Total updates: ${updatesProcessed}`);
  }
}

function updateGlideUserProfileEmail(glideRowId, newEmail) {
  console.log(`[API CONNECTOR] Requesting Glide API Mutation | RowID: ${glideRowId} | Target: ${newEmail}`);
  try {
    const url = 'https://api.glideapp.io/api/function/mutateTables';
    const payload = {
      "appID": GLIDE_APP_ID,
      "mutations": [
        {
          "kind": "set-columns-in-row",
          "tableName": GLIDE_PROFILES_TABLE,
          "columnValues": {
            "Email": newEmail
          },
          "rowID": glideRowId
        }
      ]
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": {
        "Authorization": `Bearer ${GLIDE_TOKEN}`
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    const resText = response.getContentText();
    
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      console.log(`[API CONNECTOR] Glide API Mutation Success for RowID: ${glideRowId}`);
      return true;
    } else {
      console.error(`[API CONNECTOR] Glide API Mutation Failed: ${resText}`);
      return false;
    }
  } catch (e) {
    console.error(`[API CONNECTOR] Glide API Try-Catch Error: ${e.message}`);
    return false;
  }
}

function doOptions(e) { 
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT); 
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000); 
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action; 
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profilesSheet = ss.getSheetByName("Users");
    const profilesData = profilesSheet.getDataRange().getValues();

    if (action === 'dispatchRoute') {
      const emailSheet = ss.getSheetByName("Dispatch");
      const rowIndex = profilesData.findIndex(r => String(r[0]).trim() === String(payload.driverId).trim());
      
      if (rowIndex === -1) throw new Error("Driver not found for dispatch.");
      
      // V0.4 FIX: Read directly from Node.js Payload, ignore the stale Google Sheet
      const stagingJsonStr = payload.stagingJsonStr || "[]"; 
      let stagingJson = [];
      try { stagingJson = JSON.parse(stagingJsonStr); } catch(err){}
      
      if (stagingJson.length === 0) throw new Error("No orders found to dispatch.");

      const endpointsObj = payload.endpointsObj || {};
      const startLocStr = endpointsObj.start ? JSON.stringify(endpointsObj.start) : ""; 
      const endLocStr = endpointsObj.end ? JSON.stringify(endpointsObj.end) : ""; 
      
      let totalOrders = stagingJson.length, r1Stops = 0, r2Stops = 0, r3Stops = 0, dueToday = 0, pastDue = 0;
      let today = new Date(); today.setHours(0,0,0,0);
      
      stagingJson.forEach(s => {
          let rLabel = Array.isArray(s) ? s[1] : (s.R || 1);
          let dDate = Array.isArray(s) ? s[5] : (s.d || s.dueDate);
          
          if (String(rLabel).includes('1')) r1Stops++;
          else if (String(rLabel).includes('2')) r2Stops++;
          else if (String(rLabel).includes('3')) r3Stops++;
          
          if (dDate) {
              let dueTime = new Date(dDate); dueTime.setHours(0,0,0,0);
              if (dueTime < today) pastDue++; else if (dueTime.getTime() === today.getTime()) dueToday++;
          }
      });
      
      const dashboardLink = payload.dashboardLink;
      const routeId = dashboardLink.split('?id=')[1] || new Date().getTime().toString();
      
      let emailSuccess = false, errorMsg = "";
      try { emailSuccess = sendInstantDispatchEmail(payload, ss); } catch(err) { errorMsg = err.message; }
      
      let logStatus = emailSuccess ? "Sent Instantly" : "Failed: " + errorMsg;
      let readableDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "America/Chicago", "MM/dd/yyyy h:mm a");
      
      let newEmailRow = [
          payload.ccCompany || false, logStatus, routeId, payload.driverId || "", payload.companyId || "", 
          payload.customBody || "", payload.addCc || "", payload.ccEmail || "", dashboardLink, 
          stagingJsonStr, stagingJsonStr, startLocStr, endLocStr, 
          totalOrders, r1Stops, r2Stops, r3Stops, dueToday, pastDue,
          readableDate
      ];
      
      emailSheet.appendRow(newEmailRow);
      
      if (emailSuccess) {
          return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
      } else { throw new Error(errorMsg); }
    }

    throw new Error("Invalid Action. This endpoint only supports 'dispatchRoute'. All other actions have been migrated to the Cloud Function.");
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
