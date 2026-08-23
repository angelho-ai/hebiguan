/**
 * 何必館 預約看屋表單 → Google Sheet
 *
 * 部署方式見同資料夾的 SETUP.md（5 分鐘完成）。
 * 每筆預約會寫入一列：時間戳記、姓名、稱謂、電話、Email、看屋日期、時段
 * 並同時寄一封通知信到你的信箱（不需要可把 NOTIFY_EMAIL 改成 ""）。
 */

const SHEET_NAME = "預約";                       // 工作表名稱（不存在會自動建立）
const NOTIFY_EMAIL = "angel.ho.ai.pm@gmail.com"; // 收到新預約時通知的信箱；設為 "" 則不寄信

function doPost(e) {
  try {
    const p = e.parameter;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["時間", "姓名", "稱謂", "電話", "Email", "看屋日期", "時段"]);
      sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm:ss"),
      p.name || "", p.title || "", "'" + (p.phone || ""), p.email || "", p.date || "", p.slot || "",
    ]);

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: "【何必館】新看屋預約：" + (p.name || "") + p.title + " " + (p.date || "") + " " + (p.slot || ""),
        body:
          "姓名：" + (p.name || "") + " " + (p.title || "") + "\n" +
          "電話：" + (p.phone || "") + "\n" +
          "Email：" + (p.email || "") + "\n" +
          "日期：" + (p.date || "") + "\n" +
          "時段：" + (p.slot || "") + "\n\n" +
          "完整名單：" + ss.getUrl(),
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** 部署後可先在瀏覽器打開網址測試，看到 ok 字樣代表部署成功 */
function doGet() {
  return ContentService.createTextOutput("何必館表單後端運作中 ok");
}
