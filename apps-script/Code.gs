/**
 * Shorts Guard — Google Sheets webhook.
 *
 * Paste this into the Apps Script editor of your "Shorts Guard Log" spreadsheet
 * (Extensions → Apps Script), then deploy it as a Web app and copy the URL into
 * the extension's "Sync webhook URL" setting.
 *
 * Every note you save and every Traction pass is appended as a row here, so the
 * weekly analysis can read it.
 */

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Log") || ss.insertSheet("Log");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "receivedAt", "type", "date", "ts", "kind",
      "what", "why", "from", "passesUsed", "shortsViewed"
    ]);
  }

  var d = {};
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    d = {};
  }

  sheet.appendRow([
    new Date(),
    d.type || "",
    d.date || "",
    d.ts || "",
    d.kind || "",
    d.what || "",
    d.why || "",
    d.from || "",
    d.passesUsed != null ? d.passesUsed : "",
    d.shortsViewed != null ? d.shortsViewed : ""
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Optional: open this once from the editor to test that it works. */
function test() {
  doPost({ postData: { contents: JSON.stringify({
    type: "entry", date: "2026-01-01", ts: Date.now(),
    kind: "note", what: "test row", why: "checking", from: "setup"
  }) } });
}
