/**
 * 何必館 預約看屋表單 → Google Sheet
 *
 * 部署方式見同資料夾的 SETUP.md（5 分鐘完成）。
 * 每筆預約會寫入一列：時間戳記、姓名、稱謂、電話、Email、看屋日期、時段
 * 並同時寄一封通知信到你的信箱（不需要可把 NOTIFY_EMAIL 改成 ""）。
 *
 * 名額控管：同一個「日期＋時段」最多 SLOT_CAPACITY 組，寫入前會上鎖再數，
 * 額滿則回傳 {ok:false, reason:"full"} 不寫入。彈性時段不受限制。
 */

const SHEET_NAME = "預約";                       // 工作表名稱（不存在會自動建立）
const NOTIFY_EMAIL = "angel.ho.ai.pm@gmail.com"; // 收到新預約時通知的信箱；設為 "" 則不寄信
const SLOT_CAPACITY = 2;                         // 每個時段可接受的組數（需與 index.html 的 CONFIG.SLOT_CAPACITY 一致）
const FLEXIBLE_KEYWORD = "其他時間";              // 日期含這個字樣者視為彈性時段，不列入名額計算

const HEADERS = ["時間", "姓名", "稱謂", "電話", "Email", "看屋日期", "時段"];
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

/** 讀出各「日期|時段」目前已預約的組數 */
function tally_(sheet) {
  const last = sheet.getLastRow();
  const counts = {};
  if (last < 2) return counts;
  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  rows.forEach(function (r) {
    const date = String(r[COL_DATE - 1] || "").trim();
    const slot = String(r[COL_SLOT - 1] || "").trim();
    if (!date || !slot) return;
    const key = date + "|" + slot;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function isFlexible_(date) {
  return String(date || "").indexOf(FLEXIBLE_KEYWORD) !== -1;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // 優先解析 JSON body（前端改用 text/plain 送 JSON 以避開 CORS preflight）；
    // 舊版的 form-urlencoded 仍可運作。
    let p = {};
    if (e && e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (_) { p = (e && e.parameter) || {}; }
    } else {
      p = (e && e.parameter) || {};
    }

    const date = String(p.date || "").trim();
    const slot = String(p.slot || "").trim();

    // 上鎖：避免兩個人同時搶最後一個名額時都通過檢查
    lock.waitLock(20000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheet_(ss);

    if (!isFlexible_(date)) {
      const counts = tally_(sheet);
      const used = counts[date + "|" + slot] || 0;
      if (used >= SLOT_CAPACITY) {
        return json_({ ok: false, reason: "full" });
      }
    }

    sheet.appendRow([
      Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm:ss"),
      p.name || "", p.title || "", "'" + (p.phone || ""), p.email || "", date, slot,
    ]);
    SpreadsheetApp.flush();

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: "【何必館】新看屋預約：" + (p.name || "") + (p.title || "") + " " + date + " " + slot,
        body:
          "姓名：" + (p.name || "") + " " + (p.title || "") + "\n" +
          "電話：" + (p.phone || "") + "\n" +
          "Email：" + (p.email || "") + "\n" +
          "日期：" + date + "\n" +
          "時段：" + slot + "\n\n" +
          "完整名單：" + ss.getUrl(),
      });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * ?action=availability → 回傳 {"日期|時段": 已預約組數, ...}
 * 無參數時維持原本的健康檢查文字。
 */
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";
  if (action === "availability") {
    try {
      const sheet = getSheet_(SpreadsheetApp.getActiveSpreadsheet());
      return json_(tally_(sheet));
    } catch (err) {
      return json_({});
    }
  }
  return ContentService.createTextOutput("何必館表單後端運作中 ok");
}
