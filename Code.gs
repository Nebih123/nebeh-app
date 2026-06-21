/**
 * Nebih Command Center — Google Sheets Sync Backend
 *
 * Acts as a simple key-value store: every relevant localStorage key from the
 * PWA (journal entries, task completion states, custom task list) is mirrored
 * here as one row, with a last-write-wins timestamp for conflict resolution.
 *
 * SETUP:
 * 1. Create a new Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Delete the placeholder code and paste this entire file in.
 * 4. Deploy > New deployment > Type: "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Click Deploy, authorize the permissions prompt (it's your own script).
 * 6. Copy the Web App URL (ends in /exec) — paste it into the app's
 *    Settings tab under "Google Sheets Sync".
 *
 * A sheet tab named "Sync" will be created automatically on first request.
 */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Sync');
  if (!sheet) {
    sheet = ss.insertSheet('Sync');
    sheet.appendRow(['key', 'value', 'updatedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  var result = {};
  for (var i = 1; i < data.length; i++) {
    var k = data[i][0];
    if (!k) continue;
    result[k] = { value: data[i][1], updatedAt: data[i][2] };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var body = JSON.parse(e.postData.contents);
    var records = body.records || (body.key ? [body] : []);

    var data = sheet.getDataRange().getValues();
    var keyToRow = {};
    for (var i = 1; i < data.length; i++) {
      keyToRow[data[i][0]] = i + 1; // 1-indexed sheet row
    }

    records.forEach(function (rec) {
      if (!rec || !rec.key) return;
      var row = keyToRow[rec.key];
      if (row) {
        sheet.getRange(row, 2).setValue(rec.value);
        sheet.getRange(row, 3).setValue(rec.updatedAt);
      } else {
        sheet.appendRow([rec.key, rec.value, rec.updatedAt]);
        keyToRow[rec.key] = sheet.getLastRow();
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, count: records.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
