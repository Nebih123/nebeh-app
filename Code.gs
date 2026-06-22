// ============================================================================
// NEBIH COMMAND CENTER - Google Sheets Backend
// Matches the specific frontend API calls from app.js
// ============================================================================

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Database');
  if (!sheet) {
    sheet = ss.insertSheet('Database');
    sheet.appendRow(['Key', 'Value', 'Last Updated']);
    sheet.getRange('A1:C1').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getKey(key) {
  const data = getSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setKey(key, value) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[value, now]]);
      return;
    }
  }
  sheet.appendRow([key, value, now]);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------------------
// GET REQUESTS (Fetching data)
// ----------------------------------------------------------------------------
function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'tasks') {
    const tasks = JSON.parse(getKey('tasks') || '[]');
    return jsonResponse(tasks);
  }
  
  if (action === 'journal') {
    const date = e.parameter.date;
    const entry = JSON.parse(getKey('journal_' + date) || '{"data": []}');
    return jsonResponse(entry);
  }
  
  return jsonResponse({ error: 'Unknown GET action' });
}

// ----------------------------------------------------------------------------
// POST REQUESTS (Saving data)
// ----------------------------------------------------------------------------
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  
  if (action === 'save-tasks') {
    setKey('tasks', JSON.stringify(body.tasks));
    return jsonResponse({ tasksSaved: body.tasks.length });
  }
  
  if (action === 'add-task') {
    let tasks = JSON.parse(getKey('tasks') || '[]');
    tasks.push(body.task);
    setKey('tasks', JSON.stringify(tasks));
    return jsonResponse({ ok: true });
  }
  
  if (action === 'delete-task') {
    let tasks = JSON.parse(getKey('tasks') || '[]');
    tasks = tasks.filter(t => t.id !== body.taskId);
    setKey('tasks', JSON.stringify(tasks));
    return jsonResponse({ ok: true });
  }
  
  if (action === 'save-journal') {
    setKey('journal_' + body.date, JSON.stringify({ data: body.responses }));
    return jsonResponse({ ok: true });
  }
  
  return jsonResponse({ error: 'Unknown POST action' });
}