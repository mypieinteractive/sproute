/**
 * ZEPTO MAILER - V1.0
 * FILE: zeptoMailer.js
 * Handles formatting and sending enterprise dispatch emails via ZeptoMail REST API.
 */

const { safeJsonParse } = require('./helpers'); // Assuming you have this in your helpers file

const ZEPTO_URL = "https://api.zeptomail.com/v1.1/email";
// IMPORTANT: Move this to your .env file later for security! (process.env.ZEPTO_TOKEN)
const ZEPTO_TOKEN = "Zoho-enczapikey wSsVR60lq0b1Cv18yDWlL+9tml4DVlukFhss2wOjun78TajEp8c8n0bOA1PzSaMfGGY8EzBH8L8tmR0B1mJbhtV4zg4FDiiF9mqRe1U4J3x17qnvhDzMXGRflhKLKI0LxgtvkmZpF8wg+g==";

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

        // 3. Calculate Route Statistics
        let totalMiles = 0, dueToday = 0, pastDue = 0, totalSecs = 0;
        let routesMap = {};
        
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
        const [{ value: mo }, , { value: da }, , { value: ye }] = formatter.formatToParts(new Date());
        const todayMs = new Date(`${ye}-${mo}-${da}T00:00:00`).getTime();

        stagingStops.forEach(s => {
            // Minified format: [rowId, cluster, address, client, app, due, type, eta, dist, lat, lng, status, durationSecs]
            let rLabel = String(Array.isArray(s) ? s[1] : (s.R || s.routeNum || 1));
            let dDate = Array.isArray(s) ? s[5] : s.dueDate;
            let dist = Array.isArray(s) ? s[8] : s.dist;
            let dur = Array.isArray(s) ? s[12] : s.durationSecs;

            if (!routesMap[rLabel]) routesMap[rLabel] = [];
            routesMap[rLabel].push(s);

            totalMiles += parseFloat(dist || 0);
            totalSecs += parseFloat(dur || 0);

            if (dDate) {
                let dueTimeMs = new Date(`${dDate}T00:00:00`).getTime();
                if (dueTimeMs < todayMs) pastDue++;
                else if (dueTimeMs === todayMs) dueToday++;
            }
        });

        const serviceDelay = comp.serviceDelayMins ? parseInt(comp.serviceDelayMins) : 0;
        const totalOrders = stagingStops.length;
        const totalHrs = totalOrders > 0 ? ((totalSecs + (totalOrders * serviceDelay * 60)) / 3600).toFixed(1) : 0;

        // 4. Build the HTML Table Rows
        let tableRows = "";
        const hexColors = { "1": "#000075", "2": "#4363d8", "3": "#469990" };
        
        Object.keys(routesMap).sort().forEach(rKey => {
            let rStops = routesMap[rKey];
            let rColor = hexColors[rKey] || "#374151";

            if (Object.keys(routesMap).length > 1) {
                tableRows += `<tr style="background-color: #f3f4f6;"><td colspan="7" style="padding: 8px 10px; font-weight: bold; color: ${rColor}; font-size: 11px; text-align: left; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db;">ROUTE ${rKey}</td></tr>`;
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
                    let dueTimeMs = new Date(`${dDate}T00:00:00`).getTime();
                    let dObj = new Date(dDate); // For extracting month/day
                    dueFmt = `${dObj.getMonth()+1}/${dObj.getDate()}`;
                    
                    if (dueTimeMs < todayMs) dueBg = "#ef4444"; 
                    else if (dueTimeMs === todayMs) dueBg = "#f59e0b";
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

        // 5. Construct the Full HTML Body
        const dashboardLink = `https://mypieinteractive.github.io/Sproute/?id=${routeId}`;
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

        // 6. Build ZeptoMail Payload
        const toList = [{ email_address: { address: driverEmail, name: driverName } }];
        let ccList = [];
        
        if (payload.ccCompany && comp.email) ccList.push({ email_address: { address: comp.email } });
        if (payload.addCc) ccList.push({ email_address: { address: payload.addCc } });
        if (payload.ccEmail) ccList.push({ email_address: { address: payload.ccEmail } });

        // Strip the data URL prefix so ZeptoMail accepts it
        const cleanBase64 = payload.mapBase64 ? payload.mapBase64.replace(/^data:image\/\w+;base64,/, "") : "";
        const attachments = cleanBase64 ? [{
            content: cleanBase64,
            mime_type: "image/jpeg",
            name: "routeMap.jpg",
            cid: "routeMap"
        }] : [];

        const zeptoPayload = {
            from: { address: "noreply@sprouteapp.com", name: comp.name || "Sproute System" },
            to: toList,
            subject: "Your Route is Ready",
            htmlbody: htmlBody,
            attachments: attachments
        };

        if (ccList.length > 0) zeptoPayload.cc = ccList;
        if (comp.email) zeptoPayload.reply_to = [{ address: comp.email, name: comp.name }];

        // 7. Fire to ZeptoMail
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
