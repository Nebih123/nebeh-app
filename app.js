const $ = id => document.getElementById(id);
const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const key = (type, d) => `${type}::${d.toISOString().slice(0,10)}`;

// ====== GOOGLE SHEETS SYNC ======
const SYNC_URL_KEY  = 'sync_url';
const SYNC_META_KEY = '_sync_meta';
const SYNC_LAST_KEY = '_sync_last';
const SYNC_PREFIXES = ['morning::', 'evening::', 'batman::', 'custom_tasks'];

function getSyncUrl()  { return localStorage.getItem(SYNC_URL_KEY) || ''; }
function setSyncUrl(u) { localStorage.setItem(SYNC_URL_KEY, u.trim()); }
function isSyncKey(k)  { return SYNC_PREFIXES.some(p => k === p || k.startsWith(p)); }
function getSyncMeta() { try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch { return {}; } }
function setSyncMeta(m){ localStorage.setItem(SYNC_META_KEY, JSON.stringify(m)); }
function setSyncStatus(msg) {
  localStorage.setItem(SYNC_LAST_KEY, msg);
  const el = $('sync-status');
  if (el) el.textContent = msg;
}

// Use this instead of raw localStorage.setItem for anything that should sync
function setSynced(k, value) {
  const now = Date.now();
  localStorage.setItem(k, value);
  const meta = getSyncMeta();
  meta[k] = now;
  setSyncMeta(meta);
  queuePush(k, value, now);
}

let pushQueue = [];
let pushTimer = null;
function queuePush(k, value, updatedAt) {
  pushQueue.push({ key: k, value, updatedAt });
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPushQueue, 700);
}
async function flushPushQueue() {
  const url = getSyncUrl();
  if (!url || pushQueue.length === 0) return;
  const records = pushQueue;
  pushQueue = [];
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ records })
    });
    setSyncStatus('Last synced: ' + new Date().toLocaleString('en-GB'));
  } catch (_) {
    pushQueue = records.concat(pushQueue); // retry on next push
  }
}

function pushAllLocal() {
  const meta = getSyncMeta();
  let changed = false;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isSyncKey(k)) {
      if (!meta[k]) { meta[k] = Date.now(); changed = true; }
      queuePush(k, localStorage.getItem(k), meta[k]);
    }
  }
  if (changed) setSyncMeta(meta);
  flushPushQueue();
}

async function pullSync(silent) {
  const url = getSyncUrl();
  if (!url) return;
  try {
    const res    = await fetch(url + '?action=getAll');
    const remote = await res.json();
    const meta   = getSyncMeta();
    let changed  = false;
    for (const k in remote) {
      // remote is flat { key: value } from Code.gs getAllKeys()
      const remoteVal  = remote[k];
      const remoteTime = meta[k] ? 0 : 1; // if we have no local timestamp, treat remote as newer
      const localTime  = meta[k] || 0;
      if (remoteTime > localTime || localTime === 0) {
        if (typeof remoteVal === 'string') {
          localStorage.setItem(k, remoteVal);
        } else {
          localStorage.setItem(k, JSON.stringify(remoteVal));
        }
        meta[k] = Date.now();
        changed = true;
      }
    }
    setSyncMeta(meta);
    setSyncStatus('Last synced: ' + new Date().toLocaleString('en-GB'));
    if (changed && !silent) {
      const activeId = document.querySelector('.tab.active')?.id;
      if (activeId) switchTab(activeId.replace('tab-', ''));
      showToast('Synced from Sheet ✓');
    }
  } catch (_) {
    setSyncStatus('Sync failed — offline?');
  }
}

window.syncNow = async function() {
  if (!getSyncUrl()) { showToast('Add a Sheet URL first'); return; }
  showToast('Syncing…');
  setSyncStatus('Syncing…');
  await fetchSettingsFromSheet();
  await pullSync(false);
  pushAllLocal();
};

// FIX #1: fetchSettingsFromSheet — calls ?action=getSettings which Code.gs now supports
async function fetchSettingsFromSheet() {
  const url = getSyncUrl();
  if (!url) return;
  try {
    const res  = await fetch(url + '?action=getSettings');
    const data = await res.json();
    const meta = getSyncMeta();
    const now  = Date.now();

    // Tasks — sheet always wins when it returns data
    if (data && Array.isArray(data.custom_tasks) && data.custom_tasks.length > 0) {
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(data.custom_tasks));
      meta[TASKS_STORAGE_KEY] = now;
    }

    // Journal questions — build from sheet labels and save
    if (data && Array.isArray(data.morning_questions) && data.morning_questions.length > 0) {
      const qs = buildQsFromLabels(data.morning_questions, data.evening_questions || []);
      saveJournalQuestions(qs);
      meta[JOURNAL_QS_KEY] = now;
    }

    setSyncMeta(meta);
  } catch (_) {
    // Offline — localStorage fallback is used automatically
  }
}

window.saveSyncUrl = function() {
  const val = $('sync-url-input').value;
  setSyncUrl(val);
  showToast(val ? 'Sync URL saved' : 'Sync URL cleared');
  if (val) window.syncNow();
};

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ====== JOURNAL QUESTIONS ======
const JOURNAL_QS_KEY = 'journal_questions';

const DEFAULT_MORNING_QS = [
  { id: 'm0', label: 'Feeling right now',                      hint: 'Be honest — one sentence is enough' },
  { id: 'm1', label: 'My 3 priorities today',                  hint: '',   type: 'priorities' },
  { id: 'm2', label: 'What would make today a win',            hint: 'Just one thing — the most important' },
  { id: 'm3', label: "What am I avoiding that I shouldn't be", hint: 'The uncomfortable question' },
  { id: 'm4', label: 'Prays',                                  hint: '' },
];

const DEFAULT_EVENING_QS = [
  { id: 'e0', label: 'Feeling right now',             hint: '' },
  { id: 'e1', label: 'What went well today',           hint: '' },
  { id: 'e2', label: 'What would I do differently',    hint: '' },
  { id: 'e3', label: 'Gratitude — 3 things',          hint: '', type: 'gratitude' },
  { id: 'e4', label: 'Prays',                          hint: '' },
];

function getJournalQuestions() {
  try {
    const stored = localStorage.getItem(JOURNAL_QS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.morning && parsed.evening) return parsed;
    }
  } catch(_) {}
  return { morning: DEFAULT_MORNING_QS, evening: DEFAULT_EVENING_QS };
}

function saveJournalQuestions(qs) {
  localStorage.setItem(JOURNAL_QS_KEY, JSON.stringify(qs));
}

// FIX #2: buildQsFromLabels — updated to match the new sheet question structure
// Detects 'priorit' for morning triple-input, 'gratitude' for evening triple-input
// No more 'did i do' radio since that question is gone from the sheet
function buildQsFromLabels(morningLabels, eveningLabels) {
  const morning = morningLabels.map((label, i) => {
    const id = 'm' + i;
    const low = label.toLowerCase();
    if (low.includes('priorit')) return { id, label, hint: '', type: 'priorities' };
    return { id, label, hint: '' };
  });
  const evening = eveningLabels.map((label, i) => {
    const id = 'e' + i;
    const low = label.toLowerCase();
    if (low.includes('gratitude') || low.includes('grateful')) return { id, label, hint: '', type: 'gratitude' };
    return { id, label, hint: '' };
  });
  return { morning, evening };
}

// ====== TASKS STORAGE ======
const TASKS_STORAGE_KEY = 'custom_tasks';
const DEFAULT_TASKS = [
  { id: 'sleep',        name: 'Sleep (8h)',                              time: '05:00',         days: [0,1,2,3,4,5,6] },
  { id: 'workout',      name: 'Workout',                                 time: '05:00 – 05:30', days: [1,4]            },
  { id: 'read',         name: 'Read self-development book',              time: '05:30 – 06:00', days: [0,1,2,3,4,5,6] },
  { id: 'biz',          name: 'Business building / Personal improvement',time: '06:00 – 07:00', days: [0,1,2,3,4,5,6] },
  { id: 'work',         name: 'Accounting / Finance work',               time: '09:00 – 17:00', days: [0,1,2,3,4,5,6] },
  { id: 'journal-task', name: 'Journal & plan tomorrow',                 time: '21:00 – 21:15', days: [0,1,2,3,4,5,6] },
];

function getTasks() {
  const stored = localStorage.getItem(TASKS_STORAGE_KEY);
  if (stored) { try { return JSON.parse(stored); } catch(_) {} }
  return [...DEFAULT_TASKS];
}

function saveTasks(tasks) {
  setSynced(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  if (document.querySelector('#tab-todos.active'))    renderTodos();
  if (document.querySelector('#tab-history.active'))  renderHistory();
  if (document.querySelector('#tab-settings.active')) renderSettings();
}

function resetAllTasks() {
  if (confirm('⚠️ Reset to 6 default tasks? Your journal entries and checkmarks are kept.')) {
    saveTasks([...DEFAULT_TASKS]);
    showToast('Tasks reset to default');
  }
}

// ====== TAB SWITCHING ======
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'journal')  renderJournalDate();
  else if (tab === 'todos')    renderTodos();
  else if (tab === 'history')  renderHistory();
  else if (tab === 'settings') renderSettings();
  if (getSyncUrl() && (tab === 'history' || tab === 'settings')) pullSync(true);
}

// ====== JOURNAL ======
let journalMode = 'morning';

function switchJournal(mode) {
  journalMode = mode;
  $('morning-journal').classList.toggle('hidden', mode !== 'morning');
  $('evening-journal').classList.toggle('hidden', mode !== 'evening');
  $('btn-morning').classList.toggle('active', mode === 'morning');
  $('btn-evening').classList.toggle('active', mode === 'evening');
  loadJournalEntry(mode);
}

function renderJournalDate() {
  const d = new Date();
  $('journal-date').textContent = fmt(d);
  renderJournalForm('morning');
  renderJournalForm('evening');
  loadJournalEntry(journalMode);
}

// Build the form HTML from stored/sheet questions
function renderJournalForm(mode) {
  const qs        = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;
  const container = $(mode === 'morning' ? 'morning-journal' : 'evening-journal');

  let html = '';
  questions.forEach((q, i) => {
    const num      = i + 1;
    const hintHtml = q.hint ? `<p class="field-hint">${q.hint}</p>` : '';

    if (q.type === 'priorities') {
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        <input id="jq-${q.id}-0" class="field-input" placeholder="Priority 1" />
        <input id="jq-${q.id}-1" class="field-input" placeholder="Priority 2" />
        <input id="jq-${q.id}-2" class="field-input" placeholder="Priority 3" />
      </div>`;
    } else if (q.type === 'gratitude') {
      // FIX #3: new 'gratitude' type — 3 separate lines
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        <input id="jq-${q.id}-0" class="field-input" placeholder="1. I'm grateful for…" />
        <input id="jq-${q.id}-1" class="field-input" placeholder="2. I'm grateful for…" />
        <input id="jq-${q.id}-2" class="field-input" placeholder="3. I'm grateful for…" />
      </div>`;
    } else {
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        ${hintHtml}
        <textarea id="jq-${q.id}" class="field-input" rows="2"></textarea>
      </div>`;
    }
  });

  const btnLabel = mode === 'morning' ? '💾 Save Morning Entry' : '💾 Save Evening Entry';
  html += `<button class="save-btn" onclick="saveJournal('${mode}')">${btnLabel}</button>`;
  container.innerHTML = html;
}

// FIX #4: saveJournal — updated data keys to match what Code.gs writeJournalRow expects
// Code.gs expects: morning → feeling, priorities, win, avoid
//                  evening → feeling, went (not well!), different, grateful
function saveJournal(mode) {
  const d         = new Date();
  const qs        = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;
  const data      = { mode, date: d.toISOString().slice(0,10) };

  questions.forEach(q => {
    if (q.type === 'priorities') {
      data[q.id] = [
        (document.getElementById('jq-' + q.id + '-0')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-1')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-2')?.value || '').trim(),
      ];
    } else if (q.type === 'gratitude') {
      data[q.id] = [
        (document.getElementById('jq-' + q.id + '-0')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-1')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-2')?.value || '').trim(),
      ];
    } else {
      data[q.id] = (document.getElementById('jq-' + q.id)?.value || '').trim();
    }
  });

  // Legacy keys — keep for Code.gs writeJournalRow compatibility
  // Morning: feeling, priorities (array), win, avoid
  if (mode === 'morning') {
    const qs = getJournalQuestions().morning;
    qs.forEach(q => {
      const low = q.label.toLowerCase();
      if (low.includes('feeling') || low.includes('feel'))     data.feeling    = data[q.id] || '';
      if (q.type === 'priorities')                             data.priorities = data[q.id] || [];
      if (low.includes('win') || low.includes('make today'))   data.win        = data[q.id] || '';
      if (low.includes('avoid'))                               data.avoid      = data[q.id] || '';
      if (low.includes('pray'))                                data.prays      = data[q.id] || '';
    });
  } else {
    // Evening: feeling, went (what went well), different, grateful (array), prays
    const qs = getJournalQuestions().evening;
    qs.forEach(q => {
      const low = q.label.toLowerCase();
      if (low.includes('feeling') || low.includes('feel'))                 data.feeling   = data[q.id] || '';
      if (low.includes('went well') || low.includes('well today'))         data.went      = data[q.id] || '';
      if (low.includes('different') || low.includes('differently'))        data.different = data[q.id] || '';
      if (q.type === 'gratitude' || low.includes('gratitud') || low.includes('grateful')) data.grateful = data[q.id] || [];
      if (low.includes('pray'))                                            data.prays     = data[q.id] || '';
    });
    // Backward compat key
    data.well = data.went || '';
  }

  setSynced(key(mode, d), JSON.stringify(data));
  showToast('Entry saved ✓');
}

function loadJournalEntry(mode) {
  const d      = new Date();
  const stored = localStorage.getItem(key(mode, d));
  if (!stored) return;
  let data;
  try { data = JSON.parse(stored); } catch(_) { return; }
  const qs        = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;

  questions.forEach(q => {
    if (q.type === 'priorities') {
      const vals = data[q.id] || data.priorities || [];
      ['0','1','2'].forEach((s, i) => {
        const el = document.getElementById('jq-' + q.id + '-' + s);
        if (el) el.value = vals[i] || '';
      });
    } else if (q.type === 'gratitude') {
      const vals = data[q.id] || (Array.isArray(data.grateful) ? data.grateful : []);
      ['0','1','2'].forEach((s, i) => {
        const el = document.getElementById('jq-' + q.id + '-' + s);
        if (el) el.value = vals[i] || '';
      });
    } else {
      const el = document.getElementById('jq-' + q.id);
      if (el) {
        // Try the direct id key first, then legacy field names
        el.value = data[q.id] || '';
      }
    }
  });
}

// ====== HISTORY ======
function renderHistory() {
  $('history-date').textContent = fmt(new Date());
  renderHistoryEntries();
  renderTaskStats();
}

function renderHistoryEntries() {
  const container = $('history-entries-list');
  const entries   = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('morning::') || k.startsWith('evening::')) {
      try { const d = JSON.parse(localStorage.getItem(k)); entries.push({ k, d }); } catch(_) {}
    }
  }
  entries.sort((a, b) => b.d.date.localeCompare(a.d.date));
  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);padding:20px 0">No journal entries yet.</p>';
    return;
  }
  container.innerHTML = entries.map(({ k, d }) => {
    const dateStr = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const isToday = d.date === new Date().toISOString().slice(0,10);
    // Preview: show first non-empty text field
    let preview = '';
    if (d.mode === 'morning') {
      preview = d.feeling || (Array.isArray(d.priorities) ? d.priorities.filter(Boolean).join(' · ') : '') || d.win || '';
    } else {
      preview = d.feeling || d.went || d.well || '';
    }
    return `<div class="entry-card" onclick="showEntry('${k}')">
      <div class="entry-meta">
        <span class="entry-date">${dateStr}${isToday ? ' — Today' : ''}</span>
        <span class="entry-type">${d.mode === 'morning' ? '🌅 Morning' : '🌙 Evening'}</span>
      </div>
      <p class="entry-preview">${preview || '(no preview)'}</p>
    </div>`;
  }).join('');
}

// FIX #5: showEntry modal — now reads the correct field names (went not well, no more did/didWhy)
// Dynamically renders all saved fields based on the question labels so it never breaks again
window.showEntry = function(k) {
  const d       = JSON.parse(localStorage.getItem(k));
  const dateStr = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const qs      = getJournalQuestions();
  const questions = d.mode === 'morning' ? qs.morning : qs.evening;

  let content = '';
  questions.forEach(q => {
    const val = d[q.id];
    if (q.type === 'priorities') {
      const list = (Array.isArray(val) ? val : (d.priorities || [])).filter(Boolean);
      content += `<div class="modal-item"><strong>${q.label}</strong><p>${list.length ? list.map((p,i)=>`${i+1}. ${p}`).join('<br>') : '—'}</p></div>`;
    } else if (q.type === 'gratitude') {
      const list = (Array.isArray(val) ? val : (Array.isArray(d.grateful) ? d.grateful : [])).filter(Boolean);
      content += `<div class="modal-item"><strong>${q.label}</strong><p>${list.length ? list.map((g,i)=>`${i+1}. ${g}`).join('<br>') : '—'}</p></div>`;
    } else {
      // Also check legacy keys
      const legacyVal = (() => {
        const low = q.label.toLowerCase();
        if (d.mode === 'morning') {
          if (low.includes('feeling') || low.includes('feel')) return d.feeling;
          if (low.includes('win') || low.includes('make today')) return d.win;
          if (low.includes('avoid')) return d.avoid;
          if (low.includes('pray')) return d.prays;
        } else {
          if (low.includes('feeling') || low.includes('feel')) return d.feeling;
          if (low.includes('went well') || low.includes('well today')) return d.went || d.well;
          if (low.includes('different')) return d.different;
          if (low.includes('pray')) return d.prays;
        }
        return undefined;
      })();
      const display = val || legacyVal || '—';
      content += `<div class="modal-item"><strong>${q.label}</strong><p>${display}</p></div>`;
    }
  });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title">${dateStr} · ${d.mode === 'morning' ? '🌅 Morning' : '🌙 Evening'}</div>
    ${content}
    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">Close</button>
  </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

function renderTaskStats() {
  const tasks     = getTasks();
  const container = $('task-stats-container');
  const taskStats = {};
  tasks.forEach(t => { taskStats[t.id] = { name: t.name, scheduledCount: 0, completedCount: 0, days: t.days }; });
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('batman::')) {
      const dateStr = k.split('::')[1];
      const date    = new Date(dateStr + 'T00:00:00');
      if (isNaN(date.getTime())) continue;
      const dow   = date.getDay();
      let state = {};
      try { state = JSON.parse(localStorage.getItem(k) || '{}'); } catch(_) {}
      for (const taskId in taskStats) {
        if (taskStats[taskId].days.includes(dow)) {
          taskStats[taskId].scheduledCount++;
          if (state[taskId] === true) taskStats[taskId].completedCount++;
        }
      }
    }
  }
  const hasData = Object.values(taskStats).some(t => t.scheduledCount > 0);
  if (!hasData) {
    container.innerHTML = '<p style="color:var(--text-dim);padding:20px 0">No task data yet. Start checking off your Batman schedule!</p>';
    return;
  }
  container.innerHTML = Object.values(taskStats).map(t => {
    const percent = t.scheduledCount === 0 ? 0 : Math.round((t.completedCount / t.scheduledCount) * 100);
    return `<div class="stat-card">
      <div class="stat-header"><span class="stat-name">${t.name}</span><span class="stat-percent">${percent}%</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${percent}%"></div></div>
      <div class="stat-detail">${t.completedCount} / ${t.scheduledCount} scheduled days</div>
    </div>`;
  }).join('');
}

// ====== BATMAN SCHEDULE ======
let weekOffset = 0;
let selectedDay = null;

function getWeekDays(offset = 0) {
  const today = new Date(); today.setHours(0,0,0,0);
  const mon   = new Date(today);
  const dow   = today.getDay();
  const diff  = dow === 0 ? -6 : 1 - dow;
  mon.setDate(today.getDate() + diff + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
}

function renderTodos() {
  const today = new Date(); today.setHours(0,0,0,0);
  const days  = getWeekDays(weekOffset);
  const wStart = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const wEnd   = days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  $('week-label').textContent  = `${wStart} – ${wEnd}`;
  $('todos-date').textContent  = fmt(today);

  if (selectedDay === null || weekOffset !== (selectedDay._weekOffset ?? 0)) {
    if (weekOffset === 0) {
      const todayInWeek = days.find(d => d.getTime() === today.getTime());
      selectedDay = todayInWeek || days[0];
    } else {
      selectedDay = days[0];
    }
    if (selectedDay) selectedDay._weekOffset = weekOffset;
  }

  const tabContainer = $('day-tabs');
  tabContainer.innerHTML = days.map(d => {
    const isToday    = d.getTime() === today.getTime();
    const isSelected = selectedDay && d.toISOString().slice(0,10) === selectedDay.toISOString().slice(0,10);
    const dayName    = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const dayNum     = d.getDate();
    return `<button class="day-tab ${isSelected ? 'active' : ''} ${isToday && !isSelected ? 'today-marker' : ''}"
      onclick="selectDay(new Date('${d.toISOString()}'))">
      <span class="day-num">${dayNum}</span>${dayName}
    </button>`;
  }).join('');

  renderDaySchedule();
}

window.selectDay = function(d) { selectedDay = new Date(d); selectedDay._weekOffset = weekOffset; renderTodos(); };
window.shiftWeek = function(dir) { weekOffset += dir; selectedDay = null; renderTodos(); };

function renderDaySchedule() {
  if (!selectedDay) return;
  const d       = selectedDay;
  const dow     = d.getDay();
  const dateKey = d.toISOString().slice(0,10);
  const tasks   = getTasks().filter(t => t.days.includes(dow));
  let state = {};
  try { state = JSON.parse(localStorage.getItem(`batman::${dateKey}`) || '{}'); } catch(_) {}
  const list = $('schedule-list');
  if (tasks.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:14px;text-align:center;padding:40px 0">No tasks scheduled for this day.</p>';
    return;
  }
  list.innerHTML = tasks.map(t => `
    <div class="schedule-item ${state[t.id] ? 'done' : ''}" onclick="toggleTask('${t.id}', '${dateKey}')">
      <div class="task-check"></div>
      <div class="task-info">
        <div class="task-time">${t.time}</div>
        <div class="task-name">${t.name}</div>
      </div>
    </div>`).join('');
}

window.toggleTask = function(taskId, dateKey) {
  const stateKey = `batman::${dateKey}`;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch(_) {}
  state[taskId] = !state[taskId];
  setSynced(stateKey, JSON.stringify(state));
  renderDaySchedule();
  const tasks    = getTasks();
  const dow      = new Date(dateKey + 'T00:00:00').getDay();
  const scheduled = tasks.filter(t => t.days.includes(dow));
  const doneCount = scheduled.filter(t => state[t.id] === true).length;
  if (state[taskId] && doneCount === scheduled.length) showToast('Full day complete 🔥');
  else if (state[taskId]) showToast('Done ✓');
};

// ====== SETTINGS ======
function renderSettings() {
  const urlInput = $('sync-url-input');
  if (urlInput && document.activeElement !== urlInput) urlInput.value = getSyncUrl();
  const statusEl = $('sync-status');
  if (statusEl) statusEl.textContent = localStorage.getItem(SYNC_LAST_KEY) || (getSyncUrl() ? 'Not synced yet' : 'No Sheet connected');

  const tasks     = getTasks();
  const container = $('tasks-list');
  if (tasks.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);padding:20px">No tasks. Add one above.</p>';
    return;
  }
  container.innerHTML = tasks.map((task, idx) => {
    const daysStr = task.days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
    return `<div class="task-item" data-idx="${idx}">
      <div class="task-header">
        <strong>${task.name}</strong>
        <div class="task-actions">
          <button class="icon-btn" onclick="editTask(${idx})">✏️</button>
          <button class="icon-btn" onclick="deleteTask(${idx})">🗑️</button>
        </div>
      </div>
      <div class="task-detail">🕒 ${task.time}</div>
      <div class="task-detail">📅 ${daysStr}</div>
    </div>`;
  }).join('');
}

// FIX #6: addNewTask — was using $('#new-task-name') with # prefix, which breaks since $ = getElementById
// Fixed to use $('new-task-name') without #
window.addNewTask = function() {
  const nameEl = $('new-task-name');
  const timeEl = $('new-task-time');
  const name   = nameEl ? nameEl.value.trim() : '';
  const time   = timeEl ? timeEl.value.trim() : '';
  if (!name || !time) { showToast('Please fill both name and time'); return; }
  const checkboxes = document.querySelectorAll('#tab-settings .days-checkboxes input');
  const days       = Array.from(checkboxes).filter(cb => cb.checked).map(cb => parseInt(cb.value));
  if (days.length === 0) { showToast('Select at least one day'); return; }
  const tasks = getTasks();
  const newId = `custom_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  tasks.push({ id: newId, name, time, days: days.sort((a,b)=>a-b) });
  saveTasks(tasks);
  nameEl.value = '';
  timeEl.value = '';
  checkboxes.forEach(cb => cb.checked = false);
  renderSettings();
  showToast('Task added ✓');
};

// FIX #7: editTask — replaced triple browser prompt() with an inline edit form inside the task card
window.editTask = function(idx) {
  const tasks   = getTasks();
  const task    = tasks[idx];
  const days    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const daysHtml = days.map((d, i) =>
    `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
      <input type="checkbox" value="${i}" ${task.days.includes(i) ? 'checked' : ''} />
      ${d}
    </label>`
  ).join('');

  const container = $('tasks-list');
  const taskCards = container.querySelectorAll('.task-item');
  const card      = taskCards[idx];
  if (!card) return;

  card.innerHTML = `
    <div class="edit-task-form">
      <input id="edit-name-${idx}" class="field-input" value="${task.name}" placeholder="Task name" style="margin-bottom:8px" />
      <input id="edit-time-${idx}" class="field-input" value="${task.time}" placeholder="e.g. 07:00 – 07:30" style="margin-bottom:8px" />
      <div class="days-checkboxes" style="margin-bottom:10px">${daysHtml}</div>
      <div style="display:flex;gap:8px">
        <button class="save-btn" style="flex:1;padding:10px;font-size:13px" onclick="confirmEditTask(${idx})">Save</button>
        <button class="save-btn" style="flex:1;padding:10px;font-size:13px;background:var(--surface2);color:var(--text);border:1px solid var(--border)" onclick="renderSettings()">Cancel</button>
      </div>
    </div>`;
};

window.confirmEditTask = function(idx) {
  const tasks   = getTasks();
  const task    = tasks[idx];
  const nameEl  = $(`edit-name-${idx}`);
  const timeEl  = $(`edit-time-${idx}`);
  const newName = nameEl ? nameEl.value.trim() : task.name;
  const newTime = timeEl ? timeEl.value.trim() : task.time;
  const checks  = document.querySelectorAll(`#tasks-list .task-item[data-idx="${idx}"] .edit-task-form input[type="checkbox"]`);
  // Fallback: all checkboxes inside the currently rendered form
  const allChecks = document.querySelectorAll('.edit-task-form input[type="checkbox"]');
  const newDays = Array.from(allChecks).filter(cb => cb.checked).map(cb => parseInt(cb.value)).sort((a,b)=>a-b);
  if (!newName) { showToast('Task name cannot be empty'); return; }
  tasks[idx] = { ...task, name: newName, time: newTime, days: newDays.length ? newDays : task.days };
  saveTasks(tasks);
  renderSettings();
  showToast('Task updated ✓');
};

window.deleteTask = function(idx) {
  const tasks = getTasks();
  const name  = tasks[idx]?.name || 'this task';
  if (confirm(`Delete "${name}"? Past checkmarks are kept but won't show in schedule.`)) {
    tasks.splice(idx, 1);
    saveTasks(tasks);
    renderSettings();
    showToast('Task deleted');
  }
};

// ====== INIT ======
document.addEventListener('DOMContentLoaded', async () => {
  renderJournalDate();
  if (getSyncUrl()) {
    await fetchSettingsFromSheet();
    renderJournalDate(); // re-render with questions from sheet
    pullSync(true).then(() => {
      if (document.querySelector('.tab.active')?.id === 'tab-journal') renderJournalDate();
    });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW:', err));
  }
});
