/**
 * zeptoMailer.js
 * VERSION: V15.2
 * * CHANGES:
 * V15.2 - ZeptoMail Formatting & Bug Fixes. 
 * 1. Fixed map image rendering by shifting base64 payload from 'attachments' to ZeptoMail's 'inline_images' array.
 * 2. Rewrote Due Date comparison logic to use strict 'YYYY-MM-DD' string matching against the calculated local timezone to fix inaccurate offset highlighting.
 * 3. Adjusted route numbering logic to properly map 0-indexed clusters to 1-indexed UI headers (Route 1, 2, 3) and restored corresponding table colors.
 * 4. Fixed casing in the hardcoded dashboard link (sproute instead of Sproute).
 * * V15.1 - ZeptoMail Authorization & Local Timezone Accuracy Fix. Added the 
 * required 'Zoho-enczapikey ' prefix handler for the ZEPTO_TOKEN. Integrated 'geo-tz' 
 * to dynamically extract the exact IANA Timezone string based on the latitude and 
 * longitude of the route's first stop.
 */

const { safeJsonParse } = require('./helpers'); 
const { find } = require('geo-tz');

const ZEPTO_URL = "https://api.zeptomail.com/v1.1/email";

// Pull the token securely from Google Cloud Run's environment and ensure prefix
let ZEPTO_TOKEN = process.env.ZEPTO_TOKEN;
if (ZEPTO_TOKEN && !ZEPTO_TOKEN.startsWith("Zoho-enczapikey ")) {
    ZEPTO_TOKEN = `Zoho-enczapikey ${ZEPTO_TOKEN}`;
}

if (!ZEPTO_TOKEN) {
    console.error("CRITICAL: ZEPTO_TOKEN environment variable is missing!");
}

async function sendRouteEmail(db, payload, routeId, driverData) {
    try {
        // 1. Fetch Company Data from Firestore
        const companyRef = db.collection('Companies').doc(String(payload.companyId));
        const companyDoc = await companyRef.get();
        
        if (!companyDoc.exists) {
            throw new Error("Company profile not found in Firestore.");
        }
        const comp = companyDoc.data();

        // 2. Extract Data
        const driverName = driverData.name || "Inspector";
        const driverEmail = driverData.email;
        
        if (!driverEmail) throw new Error("Driver email address is missing.");

        const stagingJsonStr = driverData.activeStaging?.orders || "[]";
        const stagingStops = safeJsonParse(stagingJsonStr, []);
        
        if (stagingStops.length === 0) throw new Error("No orders in staging bay to dispatch.");

        // 3. Resolve Dynamic Timezone from Coordinates
        let localTimeZone = 'America/Chicago'; // Default fallback
        const firstStop = stagingStops[0];
        if (firstStop) {
            let lat = parseFloat(Array.isArray(firstStop) ? firstStop[9] : (firstStop.lat || firstStop.l));
            let lng = parseFloat(Array.isArray(firstStop) ? firstStop[10] : (firstStop.lng || firstStop.g));
            
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                try {
                    const tzResult = find(lat, lng);
                    if (tzResult && tzResult.length > 0) {
                        localTimeZone = tzResult[0];
                    }
                } catch (tzError) {
                    console.error("Timezone resolution failed, using default:", tzError.message);
                }
            }
        }

        // 4. Calculate Route Statistics & Grouping
        let totalMiles = 0, dueToday = 0, pastDue = 0, totalSecs = 0;
        let routesMap = {};
        
        // Generate a strict YYYY-MM-DD string for today in the local timezone
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: localTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(new Date());
        const mo = parts.find(p => p.type === 'month').value;
        const da = parts.find(p => p.type === 'day').value;
        const ye = parts.find(p => p.type === 'year').value;
        const localTodayStr = `${ye}-${mo}-${da}`; // "YYYY-MM-DD"

        stagingStops.forEach(s => {
            // Minified format: [rowId, cluster, address, client, app, due, type, eta, dist, lat, lng, status, durationSecs]
            // Default to 0 if cluster is missing so it groups gracefully
            let rLabel = String(Array.isArray(s) ? s[1] : (s.cluster !== undefined ? s.cluster : (s.R || s.routeNum || 0)));
            let dDate = Array.isArray(s) ? s[5] : s.dueDate;
            let dist = Array.isArray(s) ? s[8] : s.dist;
            let dur = Array.isArray(s) ? s[12] : s.durationSecs;

            if (!routesMap[rLabel]) routesMap[rLabel] = [];
            routesMap[rLabel].push(s);

            totalMiles += parseFloat(dist || 0);
            totalSecs += parseFloat(dur || 0);

            if (dDate) {
                // Safe string comparison (e.g. "2026-04-09" vs "2026-04-10") avoids UTC parsing drift
                if (dDate < localTodayStr) pastDue++;
                else if (dDate === localTodayStr) dueToday++;
            }
        });

        const serviceDelay = comp.serviceDelayMins ? parseInt(comp.serviceDelayMins) : 0;
        const totalOrders = stagingStops.length;
        const totalHrs = totalOrders > 0 ? ((totalSecs + (totalOrders * serviceDelay * 60)) / 3600).toFixed(1) : 0;

        // 5. Build the HTML Table Rows
        let tableRows = "";
        // Match standard route colors mapped to 0-indexed clusters
        const hexColors = { "0": "#000075", "1": "#4363d8", "2": "#469990" }; 
        
        Object.keys(routesMap).sort().forEach(rKey => {
            let rStops = routesMap[rKey];
            let rColor = hexColors[rKey] || "#374151";
            let displayRouteNum = parseInt(rKey) + 1; // Shifts 0,1,2 to Display as Route 1,2,3

            if (Object.keys(routesMap).length > 1) {
                tableRows += `<tr style="background-color: #f3f4f6;"><td colspan="7" style="padding: 8px 10px; font-weight: bold; color: ${rColor}; font-size: 11px; text-align: left; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db;">ROUTE ${displayRouteNum}</td></tr>`;
            }

            let localSeq = 1;
            rStops.forEach((s) => {
                let dDate = Array.isArray(s) ? s[5] : s.dueDate;
                let app = Array.isArray(s) ? s[4] : s.app;
                let addr = Array.isArray(s) ? s[2] : s.address;
                let client = Array.isArray(s) ? s[3] : s.client;
                let type = Array.isArray(s) ? s[6] : s.type;
                let eta = Array.isArray(s) ? s[7] : s.eta;

                let dueBg = "#374151", dueFmt = '--';
                if (dDate) {
                    let dateParts = dDate.split('-');
                    if (dateParts.length === 3) {
                        dueFmt = `${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`; // Drop leading zeros for month/day
                    }
                    if (dDate < localTodayStr) dueBg = "#ef4444"; 
                    else if (dDate === localTodayStr) dueBg = "#f59e0b";
                }

                let appVal = (app || '--').substring(0,2).toUpperCase();
                let appHtml = `<div style="background-color:#374151; color:#ffffff; width:28px; height:28px; border-radius:4px; text-align:center; line-height:28px; font-size:11px; font-weight:bold; margin:0 auto;">${appVal}</div>`;
                let dueHtml = `<div style="background-color:${dueBg}; color:#ffffff; padding:4px 8px; border-radius:4px; text-align:center; font-size:11px; display:inline-block; font-weight:bold;">${dueFmt}</div>`;
                let shortAddr = addr ? addr.split(',')[0] : '--'; 
                let mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr || '')}`;
                let addrHtml = `<a href="${mapsLink}" style="color:#111827; text-decoration:none; font-weight:bold;">${shortAddr}</a>`;

                tableRows += `<tr>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center; color:#111827; font-weight:bold;">${localSeq}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">${eta || '--'}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center;">${appHtml}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">${dueHtml}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${addrHtml}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${client || '--'}</td>
                    <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">${type || '--'}</td>
                </tr>`;
                localSeq++;
            });
        });

        // 6. Construct the Full HTML Body
        const dashboardLink = `https://mypieinteractive.github.io/sproute/?id=${routeId}`;
        const sprouteLogoUrl = 'https://raw.githubusercontent.com/mypieinteractive/Sproute/809b30bc160d3e353020425ce349c77544ed0452/Sproute%20Logo.png';
        const customBodyText = payload.customBody || comp.defaultEmailMessage || "";

        let htmlSignature = `
        <table style="border-collapse: collapse; width: 100%; border-bottom: 2px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 20px;"><tr>
            ${comp.logoUrl ? `<td style="padding-right: 15px; width: 60px; vertical-align: middle;"><img src="${comp.logoUrl}" width="60" style="border-radius: 4px; display: block;"></td>` : ''}
            <td style="padding-left: 0px; font-family: Arial, sans-serif; font-size: 13px; line-height: 1.4; color: #333; vertical-align: middle;">
                <strong style="color: #111; font-size: 16px;">${comp.name || 'Your Company'}</strong><br><span style="color: #666;">${comp.address || ''}</span><br><a href="mailto:${comp.email}" style="color: #2563eb; text-decoration: none;">${comp.email || ''}</a>
            </td>
        </tr></table>`;

        let mapImageHtml = "";
        if (payload.mapBase64) {
            mapImageHtml = `
            <div style="margin-bottom: 25px;">
                <a href="${dashboardLink}" target="_blank" style="text-decoration:none; display:block; text-align:center;">
                    <div style="font-size: 15px; font-weight: bold; color: #2563eb; margin-bottom: 10px; font-family: Arial, sans-serif;">Click to open your interactive route ➔</div>
                    <img src="cid:routeMap" style="width: 100%; max-width: 600px; border-radius: 8px; border: 1px solid #d1d5db; margin: 0 auto; display: block;" alt="Route Map">
                </a>
            </div>`;
        }

        let htmlBody = `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 800px;">
            ${htmlSignature}
            <p>${driverName},</p>
            <p>${customBodyText.replace(/\n/g, '<br>')}</p>
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
                <a href="https://sprouteapp.com" target="_blank"><img src="${sprouteLogoUrl}" alt="Sproute" style="height: 20px; margin-top: 8px; opacity: 0.8;"></a>
            </div>
        </div>`;

        // 7. Build ZeptoMail Payload
        const toList = [{ email_address: { address: driverEmail, name: driverName } }];
        let ccList = [];
        
        if (payload.ccCompany && comp.email) ccList.push({ email_address: { address: comp.email } });
        if (payload.addCc) ccList.push({ email_address: { address: payload.addCc } });
        if (payload.ccEmail) ccList.push({ email_address: { address: payload.ccEmail } });

        // Strip the data URL prefix so ZeptoMail accepts it
        const cleanBase64 = payload.mapBase64 ? payload.mapBase64.replace(/^data:image\/\w+;base64,/, "") : "";
        const inline_images = cleanBase64 ? [{
            content: cleanBase64,
            mime_type: "image/jpeg",
            name: "routeMap.jpg",
            cid: "routeMap"
        }] : [];

        const zeptoPayload = {
            from: { address: "noreply@sprouteapp.com", name: comp.name || "Sproute System" },
            to: toList,
            subject: "Your Route is Ready",
            htmlbody: htmlBody
        };

        if (inline_images.length > 0) zeptoPayload.inline_images = inline_images;
        if (ccList.length > 0) zeptoPayload.cc = ccList;
        if (comp.email) zeptoPayload.reply_to = [{ address: comp.email, name: comp.name }];

        // 8. Fire to ZeptoMail
        const emailResponse = await fetch(ZEPTO_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": ZEPTO_TOKEN
            },
            body: JSON.stringify(zeptoPayload)
        });

        const emailResult = await emailResponse.json();

        if (!emailResponse.ok) {
            console.error("ZeptoMail Error:", emailResult);
            throw new Error(`Email provider rejected payload: ${JSON.stringify(emailResult)}`);
        }

        return { success: true };

    } catch (error) {
        console.error("ZeptoMailer Error:", error);
        throw error;
    }
}

module.exports = { sendRouteEmail };
