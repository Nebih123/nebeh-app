// ============================================================
//  NEBIH APP — Google Sheets Backend  (Code.gs)
//  Sheets: Settings | Batman | Journal | Sync (hidden)
//
//  SETTINGS sheet = single source of truth for tasks & journal
//  questions. Edit there → push to app via menu.
//  BATMAN = tasks + time + schedule + rolling date checkboxes.
//  JOURNAL = morning/evening entries by date.
// ============================================================

const CLR = {
  HDR_DARK   : '#1a1a2e',
  HDR_FG     : '#ffffff',
  DATE_BG    : '#0f3460',
  DATE_FG    : '#ffffff',
  TODAY_BG   : '#1b5e20',
  TODAY_FG   : '#ffffff',
  WEEKEND_BG : '#4a148c',
  WEEKEND_FG : '#ffffff',
  ODD_ROW    : '#f8f9ff',
  EVEN_ROW   : '#ffffff',
  GREY_CELL  : '#f0f0f0',  // non-scheduled day in Batman
  SETTINGS_S : '#e8f5e9',  // Settings section bg – tasks
  SETTINGS_J : '#e3f2fd',  // Settings section bg – journal Qs
};

const SH = {
  SYNC     : 'Sync',
  SETTINGS : 'Settings',
  BATMAN   : 'Batman',
  JOURNAL  : 'Journal',
};

// ── Default tasks (used only on first-ever setup) ──────────
const DEFAULT_TASKS = [
  { id:'sleep',     name:'Sleep (8h)',                          time:'05:00',          days:[0,1,2,3,4,5,6] },
  { id:'workout',   name:'Workout',                             time:'05:00 – 05:30',  days:[1,4]            },
  { id:'read',      name:'Read self-development book',          time:'05:30 – 06:00',  days:[0,1,2,3,4,5,6] },
  { id:'biz',       name:'Business building / Personal improvement', time:'06:00 – 07:00', days:[0,1,2,3,4,5,6] },
  { id:'work',      name:'Accounting / Finance work',           time:'09:00 – 17:00',  days:[0,1,2,3,4,5,6] },
  { id:'journal-task', name:'Journal & plan tomorrow',          time:'21:00 – 21:15',  days:[0,1,2,3,4,5,6] },
];

const DEFAULT_MORNING_QS = [
  'Feeling right now',
  'My 3 priorities today',
  'What would make today a win',
  'What am I avoiding that I shouldn\'t be',
];

const DEFAULT_EVENING_QS = [
  'Feeling right now',
  'What went well today',
  'What would I do differently',
  'Gratitude — 3 things',
];

// ============================================================
//  doGet / doPost  — PWA endpoints
// ============================================================
function doGet(e) {
  const action = e.parameter.action || 'get';
  const key    = e.parameter.key;
  const value  = e.parameter.value;

  if (action === 'set' && key) {
    setKey(key, value);
    syncToSheets(key, value);
    return jsonResponse({ ok: true });
  }
  if (action === 'get' && key) {
    return jsonResponse({ value: getKey(key) });
  }
  if (action === 'getAll') {
    return jsonResponse(getAllKeys());
  }
  // App polls this on load to pick up sheet-side edits
  if (action === 'getSettings') {
    return jsonResponse(readSettingsForApp());
  }
  return jsonResponse({ ok: true });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  const action = body.action || e.parameter.action || 'set';
  const key    = body.key    || e.parameter.key;
  const value  = body.value  !== undefined ? body.value : e.parameter.value;

  if (action === 'set' && key) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    setKey(key, v);
    syncToSheets(key, v);
    return jsonResponse({ ok: true });
  }
  if (action === 'getAll')      return jsonResponse(getAllKeys());
  if (action === 'getSettings') return jsonResponse(readSettingsForApp());
  return jsonResponse({ ok: false, error: 'unknown action' });
}

// ============================================================
//  LOW-LEVEL KV  (Sync sheet, hidden)
// ============================================================
function getSyncSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SH.SYNC);
  if (!sh) {
    sh = ss.insertSheet(SH.SYNC);
    sh.hideSheet();
    sh.getRange('A1:C1').setValues([['key','value','updatedAt']]).setFontWeight('bold');
  }
  return sh;
}

function getKey(key) {
  const data = getSyncSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setKey(key, value) {
  const sh   = getSyncSheet();
  const data = sh.getDataRange().getValues();
  const now  = Date.now();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) { sh.getRange(i+1,2,1,2).setValues([[value,now]]); return; }
  }
  sh.appendRow([key, value, now]);
}

function getAllKeys() {
  const data = getSyncSheet().getDataRange().getValues();
  const out  = {};
  for (let i = 1; i < data.length; i++) { if (data[i][0]) out[data[i][0]] = data[i][1]; }
  return out;
}

// ============================================================
//  ROUTING  — app write → correct sheet
// ============================================================
function syncToSheets(key, rawValue) {
  let value;
  try { value = JSON.parse(rawValue); } catch (_) { value = rawValue; }

  if (key === 'custom_tasks') {
    // App sent updated tasks — reflect in Settings & Batman
    updateSettingsTasks(value);
    rebuildBatman(readSettingsData());
    return;
  }
  const mM = key.match(/^morning::(\d{4}-\d{2}-\d{2})$/);
  const eM = key.match(/^evening::(\d{4}-\d{2}-\d{2})$/);
  if (mM) { writeJournalRow(mM[1], 'morning', value); return; }
  if (eM) { writeJournalRow(eM[1], 'evening', value); return; }
}

// ============================================================
//  SETTINGS SHEET
//  Layout:
//    Row 1  : section header "TO-DO LIST"
//    Row 2  : column headers  ID | Task name | Time | Sun Mon Tue Wed Thu Fri Sat
//    Row 3+ : one task per row  (user adds/edits/removes here)
//    Gap row after last task
//    Section header "JOURNAL QUESTIONS"
//    Sub-header  Morning | Evening
//    Row pairs   Q1 morning | Q1 evening
//                Q2 morning | Q2 evening  …
// ============================================================
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function buildSettingsSheet(tasks, morningQs, eveningQs) {
  const sh = getOrCreateSheet(SH.SETTINGS);
  sh.clearContents();
  sh.clearFormats();
  sh.clearConditionalFormatRules();

  // Column widths
  sh.setColumnWidth(1, 80);   // ID
  sh.setColumnWidth(2, 260);  // Task name
  sh.setColumnWidth(3, 150);  // Time
  for (let c = 4; c <= 10; c++) sh.setColumnWidth(c, 52);
  sh.setColumnWidth(11, 30);  // spacer
  sh.setColumnWidth(12, 220); // Morning Q
  sh.setColumnWidth(13, 220); // Evening Q

  let r = 1;

  // ── TO-DO section header ─────────────────────────────────
  sh.getRange(r, 1, 1, 10).merge()
    .setValue('📋  TO-DO LIST — Edit tasks here, then use menu ⚙️ → Push Settings → App')
    .setBackground(CLR.HDR_DARK).setFontColor('#a5d6a7')
    .setFontWeight('bold').setFontSize(11);
  r++;

  // Column headers
  const taskHdrs = ['ID','Task name','Time','Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  sh.getRange(r, 1, 1, 10).setValues([taskHdrs])
    .setBackground('#263238').setFontColor(CLR.HDR_FG)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(r, 2).setHorizontalAlignment('left');
  sh.getRange(r, 4).setBackground('#6d1f1f'); // Sun
  sh.getRange(r, 10).setBackground('#6d1f1f'); // Sat
  r++;

  // Task rows
  tasks.forEach((task, i) => {
    const days   = task.days || [];
    const dayMap = [0,1,2,3,4,5,6].map(d => days.includes(d));
    sh.getRange(r, 1).setValue(task.id   || String(i+1));
    sh.getRange(r, 2).setValue(task.name || '');
    sh.getRange(r, 3).setValue(task.time || '');
    for (let d = 0; d <= 6; d++) {
      const cell = sh.getRange(r, d + 4);
      cell.insertCheckboxes();
      cell.setValue(dayMap[d]);
    }
    const bg = (i % 2 === 0) ? CLR.ODD_ROW : CLR.EVEN_ROW;
    sh.getRange(r, 1, 1, 10).setBackground(bg);
    r++;
  });

  // Blank template row so user knows where to add
  sh.getRange(r, 1).setValue('(new id)').setFontColor('#aaaaaa').setFontStyle('italic');
  sh.getRange(r, 2).setValue('Add new task here…').setFontColor('#aaaaaa').setFontStyle('italic');
  sh.getRange(r, 3).setValue('HH:MM – HH:MM').setFontColor('#aaaaaa').setFontStyle('italic');
  for (let d = 0; d <= 6; d++) sh.getRange(r, d + 4).insertCheckboxes();
  r += 2;

  // ── JOURNAL QUESTIONS section header ─────────────────────
  sh.getRange(r, 1, 1, 13).merge()
    .setValue('📓  JOURNAL QUESTIONS — Edit questions here, then rebuild Journal sheet')
    .setBackground(CLR.HDR_DARK).setFontColor('#80cbc4')
    .setFontWeight('bold').setFontSize(11);
  r++;

  sh.getRange(r, 12).setValue('🌅 Morning question')
    .setBackground('#263238').setFontColor('#ffd54f').setFontWeight('bold');
  sh.getRange(r, 13).setValue('🌙 Evening question')
    .setBackground('#263238').setFontColor('#80cbc4').setFontWeight('bold');
  r++;

  const maxQ = Math.max(morningQs.length, eveningQs.length);
  for (let i = 0; i < maxQ; i++) {
    sh.getRange(r, 12).setValue(morningQs[i] || '').setBackground(i%2===0 ? '#fffde7' : '#fff8e1');
    sh.getRange(r, 13).setValue(eveningQs[i] || '').setBackground(i%2===0 ? '#e1f5fe' : '#e0f7fa');
    r++;
  }
  // Blank template rows for new questions
  sh.getRange(r, 12).setValue('Add morning question…').setFontColor('#aaaaaa').setFontStyle('italic');
  sh.getRange(r, 13).setValue('Add evening question…').setFontColor('#aaaaaa').setFontStyle('italic');

  sh.setFrozenRows(2);
  SpreadsheetApp.flush();
}

// Read tasks from Settings sheet
function readSettingsData() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
  if (!sh) return { tasks: DEFAULT_TASKS, morningQs: DEFAULT_MORNING_QS, eveningQs: DEFAULT_EVENING_QS };

  const data    = sh.getDataRange().getValues();
  const tasks   = [];
  const mQs     = [];
  const eQs     = [];
  let inTasks   = false;
  let inJournal = false;
  let journalHeader = false;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const a   = String(row[0] || '').trim();
    const b   = String(row[1] || '').trim();

    // Detect section markers
    if (String(row[0]).includes('TO-DO LIST'))       { inTasks = true;  inJournal = false; continue; }
    if (String(row[0]).includes('JOURNAL QUESTIONS')){ inJournal = true; inTasks = false;  journalHeader = false; continue; }

    if (inTasks) {
      if (a === 'ID') continue; // header row
      if (!a || !b || a.startsWith('(new')) continue; // blank/template
      const days = [];
      for (let d = 0; d <= 6; d++) { if (row[d+3] === true) days.push(d); }
      tasks.push({ id: a, name: b, time: String(row[2]||''), days });
    }

    if (inJournal) {
      if (!journalHeader && (String(row[11]).includes('Morning') || String(row[11]).includes('question'))) {
        journalHeader = true; continue;
      }
      if (journalHeader) {
        const mq = String(row[11]||'').trim();
        const eq = String(row[12]||'').trim();
        if (mq && !mq.startsWith('Add morning')) mQs.push(mq);
        if (eq && !eq.startsWith('Add evening')) eQs.push(eq);
      }
    }
  }

  return {
    tasks    : tasks.length   ? tasks : DEFAULT_TASKS,
    morningQs: mQs.length     ? mQs   : DEFAULT_MORNING_QS,
    eveningQs: eQs.length     ? eQs   : DEFAULT_EVENING_QS,
  };
}

// When app sends updated tasks, mirror them into Settings task rows only
function updateSettingsTasks(tasks) {
  const existing = readSettingsData();
  buildSettingsSheet(tasks, existing.morningQs, existing.eveningQs);
}

// What the app gets when it calls ?action=getSettings
function readSettingsForApp() {
  const d = readSettingsData();
  return {
    custom_tasks  : d.tasks,
    morning_questions: d.morningQs,
    evening_questions: d.eveningQs,
  };
}

// ============================================================
//  BATMAN SHEET  (tasks + schedule + history in one place)
//  Columns: Unique Num. | Task name | Time | [date cols…]
// ============================================================
function rebuildBatman(settingsData) {
  const tasks = settingsData.tasks;
  const sh    = getOrCreateSheet(SH.BATMAN);

  // Preserve existing checkbox states before clearing
  const existing = readExistingBatmanData(sh);

  sh.clearContents();
  sh.clearFormats();

  // Column widths
  sh.setColumnWidth(1, 70);   // Unique Num.
  sh.setColumnWidth(2, 240);  // Task name
  sh.setColumnWidth(3, 140);  // Time

  // Date window: 7 days back → today → 14 days forward
  const today     = new Date(); today.setHours(0,0,0,0);
  const startDate = new Date(today); startDate.setDate(today.getDate() - 7);
  const endDate   = new Date(today); endDate.setDate(today.getDate() + 14);
  const dates     = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate()+1)) {
    dates.push(new Date(d));
  }

  // ── Row 1: headers ──────────────────────────────────────
  sh.getRange(1,1).setValue('Unique Num.')
    .setBackground(CLR.HDR_DARK).setFontColor(CLR.HDR_FG)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(1,2).setValue('Task name')
    .setBackground(CLR.HDR_DARK).setFontColor(CLR.HDR_FG).setFontWeight('bold');
  sh.getRange(1,3).setValue('Time')
    .setBackground(CLR.HDR_DARK).setFontColor(CLR.HDR_FG)
    .setFontWeight('bold').setHorizontalAlignment('center');

  // Date column headers
  dates.forEach((date, idx) => {
    const col      = idx + 4;
    const isToday  = date.getTime() === today.getTime();
    const isWeekend= date.getDay()===0 || date.getDay()===6;
    sh.setColumnWidth(col, 88);
    const hdr = sh.getRange(1, col);
    hdr.setValue(formatDateDE(date))
       .setFontWeight('bold').setHorizontalAlignment('center').setWrap(false);
    if (isToday)        hdr.setBackground(CLR.TODAY_BG).setFontColor(CLR.TODAY_FG);
    else if (isWeekend) hdr.setBackground(CLR.WEEKEND_BG).setFontColor(CLR.WEEKEND_FG);
    else                hdr.setBackground(CLR.DATE_BG).setFontColor(CLR.DATE_FG);
  });

  // ── Task rows ───────────────────────────────────────────
  tasks.forEach((task, i) => {
    const row    = i + 2;
    const taskId = String(task.id || i+1);
    const days   = task.days || [];
    const bg     = (i % 2 === 0) ? CLR.ODD_ROW : CLR.EVEN_ROW;

    sh.getRange(row,1).setValue(taskId)
      .setFontWeight('bold').setHorizontalAlignment('center').setBackground(bg);
    sh.getRange(row,2).setValue(task.name||'').setBackground(bg);
    sh.getRange(row,3).setValue(task.time||'')
      .setHorizontalAlignment('center').setBackground(bg);

    dates.forEach((date, idx) => {
      const col      = idx + 4;
      const dow      = date.getDay();
      const isToday  = date.getTime() === today.getTime();
      const isWeekend= dow===0 || dow===6;
      const cell     = sh.getRange(row, col);
      const cellBg   = isToday   ? '#c8e6c9' :
                       isWeekend ? '#ede7f6' : bg;

      if (days.includes(dow)) {
        const dateKey = formatDateISO(date);
        const prior   = existing[taskId] && existing[taskId][dateKey];
        cell.insertCheckboxes();
        cell.setValue(prior === true ? true : false);
        cell.setBackground(cellBg);
      } else {
        // Not scheduled — grey blank (no checkbox)
        cell.setValue('').setBackground(CLR.GREY_CELL);
      }
    });
  });

  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  SpreadsheetApp.flush();
}

function readExistingBatmanData(sh) {
  const result = {};
  try {
    const nr = sh.getLastRow();
    const nc = sh.getLastColumn();
    if (nr < 2 || nc < 4) return result;
    const data = sh.getRange(1,1,nr,nc).getValues();
    const hdr  = data[0];
    const dateCols = [];
    for (let c = 3; c < hdr.length; c++) {
      dateCols.push(parseDateDE(String(hdr[c])));
    }
    for (let r = 1; r < data.length; r++) {
      const id = String(data[r][0]);
      if (!id) continue;
      result[id] = {};
      for (let c = 3; c < data[r].length; c++) {
        if (dateCols[c-3]) result[id][dateCols[c-3]] = (data[r][c] === true);
      }
    }
  } catch(_) {}
  return result;
}

// Push Batman checkbox states back to Sync so app can read them
function readBatmanCompletions(changes) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.BATMAN);
  if (!sh) return;
  const nr = sh.getLastRow();
  const nc = sh.getLastColumn();
  if (nr < 2 || nc < 4) return;
  const data     = sh.getRange(1,1,nr,nc).getValues();
  const dateCols = [];
  for (let c = 3; c < data[0].length; c++) dateCols.push(parseDateDE(String(data[0][c])));

  const byDate = {};
  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][0]);
    for (let c = 3; c < data[r].length; c++) {
      const iso = dateCols[c-3];
      if (!iso) continue;
      if (!byDate[iso]) byDate[iso] = {};
      if (data[r][c] === true || data[r][c] === false) byDate[iso][id] = data[r][c];
    }
  }
  Object.keys(byDate).forEach(iso => {
    const key = `batman::${iso}`;
    const val = JSON.stringify(byDate[iso]);
    setKey(key, val);
    if (changes) changes[key] = val;
  });
}

// ============================================================
//  JOURNAL SHEET
// ============================================================
function ensureJournalSheet(morningQs, eveningQs) {
  const sh   = getOrCreateSheet(SH.JOURNAL);
  const data = sh.getDataRange().getValues();
  const isNew= data.length < 2 || (data[0][0]==='' && data[0][1]==='');
  if (isNew) buildJournalHeaders(sh, morningQs||DEFAULT_MORNING_QS, eveningQs||DEFAULT_EVENING_QS);
  return sh;
}

function buildJournalHeaders(sh, morningQs, eveningQs) {
  sh.clearContents();
  sh.clearFormats();

  sh.setColumnWidth(1, 100);
  const mCount = morningQs.length;
  const eCount = eveningQs.length;
  for (let c = 2; c <= 1+mCount; c++)           sh.setColumnWidth(c, 200);
  for (let c = 2+mCount; c <= 1+mCount+eCount; c++) sh.setColumnWidth(c, 200);

  // Row 1 – section headers
  sh.getRange(1,1).setValue('Date')
    .setBackground(CLR.HDR_DARK).setFontColor(CLR.HDR_FG)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(1, 2, 1, mCount).merge()
    .setValue('🌅  MORNING')
    .setBackground(CLR.HDR_DARK).setFontColor('#ffd54f')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(12);
  sh.getRange(1, 2+mCount, 1, eCount).merge()
    .setValue('🌙  EVENING')
    .setBackground(CLR.HDR_DARK).setFontColor('#80cbc4')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(12);

  // Row 2 – question headers
  sh.getRange(2,1).setValue('').setBackground('#0d2137');
  morningQs.forEach((q,i) => {
    sh.getRange(2, i+2)
      .setValue(q).setBackground('#0d2137').setFontColor('#ffd54f')
      .setFontSize(9).setWrap(true).setFontWeight('bold');
  });
  eveningQs.forEach((q,i) => {
    sh.getRange(2, 2+mCount+i)
      .setValue(q).setBackground('#0d2137').setFontColor('#80cbc4')
      .setFontSize(9).setWrap(true).setFontWeight('bold');
  });

  sh.setRowHeight(2, 50);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(1);
  SpreadsheetApp.flush();
}

function writeJournalRow(isoDate, mode, data) {
  const settings = readSettingsData();
  const sh       = ensureJournalSheet(settings.morningQs, settings.eveningQs);
  const mCount   = settings.morningQs.length;
  const row      = findOrCreateJournalDateRow(sh, isoDate);

  if (mode === 'morning') {
    sh.getRange(row,2).setValue(data.feeling||'');
    sh.getRange(row,3).setValue(Array.isArray(data.priorities)
      ? data.priorities.filter(Boolean).join('\n') : '');
    if (mCount > 2) sh.getRange(row,4).setValue(data.win||'');
    if (mCount > 3) sh.getRange(row,5).setValue(data.avoid||'');
  }
  if (mode === 'evening') {
    const base = 2 + mCount;
    sh.getRange(row, base  ).setValue(data.feeling||'');
    sh.getRange(row, base+1).setValue(data.went||'');
    if (settings.eveningQs.length > 2) sh.getRange(row, base+2).setValue(data.different||'');
    if (settings.eveningQs.length > 3) sh.getRange(row, base+3).setValue(
      Array.isArray(data.grateful) ? data.grateful.filter(Boolean).join('\n') : (data.grateful||''));
  }

  const isWeekend = isWeekendISO(isoDate);
  sh.getRange(row,1)
    .setValue(formatDateDE(parseISO(isoDate)))
    .setBackground(isWeekend ? CLR.WEEKEND_BG : CLR.DATE_BG)
    .setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');

  const bg = ((row-3) % 2 === 0) ? CLR.ODD_ROW : CLR.EVEN_ROW;
  sh.getRange(row, 2, 1, mCount + settings.eveningQs.length).setBackground(bg).setWrap(true);
  sh.setRowHeight(row, 80);
  SpreadsheetApp.flush();
}

function findOrCreateJournalDateRow(sh, isoDate) {
  const label   = formatDateDE(parseISO(isoDate));
  const lastRow = Math.max(sh.getLastRow(), 2);
  const colA    = sh.getRange(3,1,Math.max(lastRow-2,1),1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim() === label) return i+3;
  }
  const newDate = parseISO(isoDate);
  let insertAt  = lastRow+1;
  for (let i = 0; i < colA.length; i++) {
    const iso = parseDateDE(String(colA[i][0]).trim());
    if (iso && parseISO(iso) > newDate) { insertAt = i+3; break; }
  }
  if (insertAt <= lastRow) sh.insertRowBefore(insertAt);
  return insertAt;
}

// ============================================================
//  UTILITIES
// ============================================================
function formatDateDE(date) {
  return String(date.getDate()).padStart(2,'0') + '.' +
         String(date.getMonth()+1).padStart(2,'0') + '.' + date.getFullYear();
}
function formatDateISO(date) {
  return date.getFullYear() + '-' +
         String(date.getMonth()+1).padStart(2,'0') + '-' +
         String(date.getDate()).padStart(2,'0');
}
function parseDateDE(str) {
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function parseISO(iso) {
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y,m-1,d);
}
function isWeekendISO(iso) {
  const d = parseISO(iso).getDay();
  return d===0 || d===6;
}
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  MENU & TRIGGERS
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Nebih App')
    .addItem('🔄 Sync from App → Sheets',     'triggerSyncFromApp')
    .addItem('📤 Push Settings → App',         'triggerPushSettings')
    .addItem('🦇 Rebuild Batman sheet',        'triggerRebuildBatman')
    .addItem('📓 Rebuild Journal sheet',       'triggerRebuildJournal')
    .addItem('🏗️  Full rebuild (all sheets)',  'rebuildAll')
    .addItem('🔗 Show Web App URL',            'showWebAppUrl')
    .addToUi();
}

function triggerSyncFromApp() {
  const all = getAllKeys();
  Object.keys(all).forEach(key => syncToSheets(key, all[key]));
  SpreadsheetApp.getUi().alert('✅ App data synced into Sheets.');
}

function triggerPushSettings() {
  const d    = readSettingsData();
  const json = JSON.stringify(d.tasks);
  setKey('custom_tasks', json);
  rebuildBatman(d);
  SpreadsheetApp.getUi().alert('✅ Settings pushed to App & Batman rebuilt.\n\nThe app will pick up the new tasks next time it loads.');
}

function triggerRebuildBatman() {
  rebuildBatman(readSettingsData());
  SpreadsheetApp.getUi().alert('✅ Batman sheet rebuilt.');
}

function triggerRebuildJournal() {
  const d  = readSettingsData();
  const sh = getOrCreateSheet(SH.JOURNAL);
  buildJournalHeaders(sh, d.morningQs, d.eveningQs);
  SpreadsheetApp.getUi().alert('✅ Journal sheet rebuilt with updated questions.\n\nNote: existing journal entries are preserved, only the headers changed.');
}

function rebuildAll() {
  // Use data from Settings if it exists, otherwise seed with defaults from Sync
  let d = readSettingsData();
  if (!d.tasks.length) {
    const raw = getKey('custom_tasks');
    if (raw) d.tasks = JSON.parse(raw);
  }
  buildSettingsSheet(d.tasks, d.morningQs, d.eveningQs);
  rebuildBatman(d);
  const jsh = getOrCreateSheet(SH.JOURNAL);
  buildJournalHeaders(jsh, d.morningQs, d.eveningQs);
  SpreadsheetApp.getUi().alert('✅ All sheets rebuilt:\n• Settings\n• Batman\n• Journal');
}

function showWebAppUrl() {
  SpreadsheetApp.getUi().alert('Web App URL:\n\n' + ScriptApp.getService().getUrl());
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyUpdate')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyUpdate').timeBased().everyDays(1).atHour(0).create();
  Logger.log('Daily trigger installed.');
}

function dailyUpdate() {
  // Midnight: add today's column to Batman using latest Settings
  rebuildBatman(readSettingsData());
}
