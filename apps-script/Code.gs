/**
 * 何必館 預約看屋表單 → Google Sheet
 *
 * 部署方式見同資料夾的 SETUP.md（5 分鐘完成）。
 * v3：電話／開放場次／過期檢核、希望時間、通知狀態、重送識別碼。
 * 原前七欄不移動；新欄位只附加，不覆寫歷史資料。
 * 並同時寄一封通知信到你的信箱（不需要可把 NOTIFY_EMAIL 改成 ""）。
 *
 * 名額控管：同一個「日期＋時段」最多 SLOT_CAPACITY 組，寫入前會上鎖再數，
 * 額滿則回傳 {ok:false, reason:"full"} 不寫入。彈性時段不受限制。
 */

const SHEET_NAME = "預約";                       // 工作表名稱（不存在會自動建立）
const NOTIFY_EMAIL = "angel.ho.ai.pm@gmail.com"; // 收到新預約時通知的信箱；設為 "" 則不寄信
const SLOT_CAPACITY = 1;                         // 每個時段可接受的組數（需與 index.html 的 CONFIG.SLOT_CAPACITY 一致）
const BOOKING_SCHEMA_VERSION = 3;
const FLEXIBLE_DATE = "其他時間（送出後與您協調）";
const FLEXIBLE_SLOT = "由專人與您聯繫安排";
// 異動場次時，需同步 index.html 的 CONFIG.DATES；開始時間以台北時間為準。
const BOOKING_DATES = [
  { iso: "2026-09-06", label: "2026/9/6（日）", start: "14:00", end: "17:00", every: 60 },
  { iso: "2026-09-11", label: "2026/9/11（五）", start: "12:00", end: "13:00", every: 60 },
  { iso: "2026-09-12", label: "2026/9/12（六）", start: "14:00", end: "17:00", every: 60 },
];
const CONTACT_HEADERS = ["LINE ID", "個資同意", "希望看屋時間", "通知狀態", "預約識別碼"];

// 保留既有 Email 欄位置與歷史資料，新預約不再收集或儲存買方信箱。
const HEADERS = ["時間", "姓名", "稱謂", "電話", "Email", "看屋日期", "時段"].concat(CONTACT_HEADERS);
const COL_DATE = 6;   // 「看屋日期」在第幾欄（1-based）
const COL_SLOT = 7;   // 「時段」在第幾欄

function getSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }
  return sheet;
}

/** 只在有效預約寫入時補上新欄位，不更動舊欄位與既有資料。 */
function ensureContactColumns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), COL_SLOT)).getValues()[0];
  const indexes = {};
  CONTACT_HEADERS.forEach(function (label) {
    let index = headers.indexOf(label);
    if (index === -1) {
      index = headers.length;
      headers.push(label);
      sheet.getRange(1, index + 1).setValue(label).setFontWeight("bold");
    }
    indexes[label] = index;
  });
  return { indexes: indexes, width: headers.length };
}

/** 使用者輸入以文字儲存，避免被試算表當成公式。 */
function sheetText_(value) {
  const text = String(value || "").trim();
  return /^[=+@-]/.test(text) ? "'" + text : text;
}

/** 讀出各「日期|時段」目前已預約的組數 */
function tally_(sheet) {
  const last = sheet.getLastRow();
  const counts = {};
  if (last < 2) return counts;
  const rows = sheet.getRange(2, 1, last - 1, COL_SLOT).getValues();
  rows.forEach(function (r) {
    const date = String(r[COL_DATE - 1] || "").trim();
    const slot = String(r[COL_SLOT - 1] || "").trim();
    if (!date || !slot) return;
    const key = date + "|" + slot;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function normalizePhone_(value) {
  const raw = String(value || "").normalize("NFKC").trim();
  if (raw.length > 40 || /[^+\d\s().-]/.test(raw)) return "";
  let phone = raw.replace(/[\s().-]/g, "");
  if (phone.indexOf("+886") === 0) phone = "0" + phone.slice(4).replace(/^0/, "");
  if (/^09\d{8}$/.test(phone) || /^0[2-8]\d{7,8}$/.test(phone) || /^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  return "";
}

function slotStart_(date, slot) {
  if (date === FLEXIBLE_DATE && slot === FLEXIBLE_SLOT) return Infinity;
  const d = BOOKING_DATES.find(function (item) { return item.label === date; });
  if (!d) return NaN;
  const minutes = function (s) { const p = s.split(":").map(Number); return p[0] * 60 + p[1]; };
  const time = function (n) { return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0"); };
  for (let m = minutes(d.start); m + d.every <= minutes(d.end); m += d.every) {
    if (slot === time(m) + " – " + time(m + d.every)) return Date.parse(d.iso + "T" + time(m) + ":00+08:00");
  }
  return NaN;
}

// 重送相同請求時回覆已收到，不重複寫入或寄信。識別碼不作為查詢他人預約的介面。
function findRequest_(sheet, requestId) {
  if (!requestId || sheet.getLastRow() < 2) return null;
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const idCol = headers.indexOf("預約識別碼");
  if (idCol < 0) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const row = rows.find(function (r) { return String(r[idCol]) === requestId; });
  return row ? { row: row, headers: headers } : null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let saved = false;
  let locked = false;
  try {
    // 優先解析 JSON body（前端改用 text/plain 送 JSON 以避開 CORS preflight）；
    // 舊版的 form-urlencoded 仍可運作。
    let p = {};
    if (e && e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (_) { p = (e && e.parameter) || {}; }
    } else {
      p = (e && e.parameter) || {};
    }

    const name = String(p.name || "").trim();
    const rawPhone = String(p.phone || "").trim();
    const phone = normalizePhone_(rawPhone);
    const lineId = String(p.lineId || "").trim();
    const date = String(p.date || "").trim();
    const slot = String(p.slot || "").trim();
    const preferredTime = date === FLEXIBLE_DATE ? String(p.preferredTime || "").trim().slice(0, 200) : "";
    const requestId = String(p.requestId || "").trim();
    if (!name || !rawPhone || !date || !slot) {
      return json_({ ok: false, reason: "required_fields" });
    }
    if (p.privacyConsent !== true && p.privacyConsent !== "true") {
      return json_({ ok: false, reason: "consent_required" });
    }
    if (!phone) return json_({ ok: false, reason: "invalid_phone" });
    if (requestId && !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return json_({ ok: false, reason: "invalid_request" });
    const start = slotStart_(date, slot);
    if (Number.isNaN(start)) return json_({ ok: false, reason: "invalid_slot" });

    // 上鎖：避免兩個人同時搶最後一個名額時都通過檢查
    lock.waitLock(20000);
    locked = true;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    const existing = sheet ? findRequest_(sheet, requestId) : null;
    if (existing) {
      const r = existing.row, h = existing.headers;
      const text = function (v) { return String(v || "").replace(/^'/, ""); };
      if (text(r[1]) !== name || text(r[3]) !== phone || String(r[5]) !== date || String(r[6]) !== slot ||
          text(r[h.indexOf("LINE ID")]) !== lineId || text(r[h.indexOf("希望看屋時間")]) !== preferredTime) {
        return json_({ ok: false, reason: "request_conflict" });
      }
      return json_({ ok: true });
    }
    // 在拿到鎖之後再檢查，避免排隊時跨過場次開始時間。
    if (start <= Date.now()) return json_({ ok: false, reason: "expired_slot" });
    if (!sheet) sheet = getSheet_(ss);

    if (date !== FLEXIBLE_DATE) {
      const counts = tally_(sheet);
      const used = counts[date + "|" + slot] || 0;
      if (used >= SLOT_CAPACITY) {
        return json_({ ok: false, reason: "full" });
      }
    }

    const columns = ensureContactColumns_(sheet);
    const row = [
      Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm:ss"),
      sheetText_(name), sheetText_(p.title), "'" + phone, "", sheetText_(date), sheetText_(slot),
    ];
    while (row.length < columns.width) row.push("");
    row[columns.indexes["LINE ID"]] = lineId ? "'" + lineId : "";
    row[columns.indexes["個資同意"]] = "已同意";
    row[columns.indexes["希望看屋時間"]] = sheetText_(preferredTime);
    row[columns.indexes["通知狀態"]] = NOTIFY_EMAIL ? "待寄送" : "未啟用通知";
    row[columns.indexes["預約識別碼"]] = requestId;
    sheet.appendRow(row);
    saved = true;
    const rowNumber = sheet.getLastRow();
    SpreadsheetApp.flush();
    lock.releaseLock();
    locked = false;

    if (NOTIFY_EMAIL) {
      let status = "已寄送";
      try { MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: "【何必館】新看屋預約：" + name + (p.title || "") + " " + date + " " + slot,
        body:
          "姓名：" + name + " " + (p.title || "") + "\n" +
          "電話：" + phone + "\n" +
          "LINE ID：" + (lineId || "未填寫") + "\n" +
          "個資同意：已同意\n" +
          "日期：" + date + "\n" +
          "時段：" + slot + "\n\n" +
          (preferredTime ? "希望看屋時間：" + preferredTime + "\n\n" : "") +
          "完整名單：" + ss.getUrl(),
      }); } catch (mailError) {
        status = "寄送失敗，請查看預約";
        console.error("預約已儲存，通知信寄送失敗。");
      }
      // 通知是附加動作；無論寄信或狀態標記失敗，都不能推翻已儲存的預約。
      try { sheet.getRange(rowNumber, columns.indexes["通知狀態"] + 1).setValue(status); }
      catch (statusError) { console.error("預約已儲存，通知狀態未更新。"); }
    }
    return json_({ ok: true });
  } catch (err) {
    if (saved) return json_({ ok: true });
    console.error("預約未完成，請檢查 Apps Script 執行紀錄。");
    return json_({ ok: false, reason: "server_error" });
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (_) {} }
  }
}

/**
 * ?action=availability → 回傳 {"日期|時段": 已預約組數, ...}
 * ?action=capabilities → 前端確認部署支援 v3 預約規則與錯誤處理
 * 無參數時維持原本的健康檢查文字。
 */
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";
  if (action === "capabilities") {
    return json_({ bookingSchemaVersion: BOOKING_SCHEMA_VERSION });
  }
  if (action === "availability") {
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      return json_(sheet ? tally_(sheet) : {});
    } catch (err) {
      return json_({});
    }
  }
  return ContentService.createTextOutput("何必館表單後端運作中 ok");
}
