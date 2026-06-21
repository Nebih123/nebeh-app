const $ = id => document.getElementById(id);
const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const key = (type, d) => `${type}::${d.toISOString().slice(0,10)}`;

// ====== GOOGLE SHEETS SYNC ======
const SYNC_URL_KEY = 'sync_url';
const SYNC_META_KEY = '_sync_meta';
const SYNC_LAST_KEY = '_sync_last';
const SYNC_PREFIXES = ['morning::', 'evening::', 'batman::', 'custom_tasks'];

function getSyncUrl() { return localStorage.getItem(SYNC_URL_KEY) || ''; }
function setSyncUrl(url) { localStorage.setItem(SYNC_URL_KEY, url.trim()); }
function isSyncKey(k) { return SYNC_PREFIXES.some(p => k === p || k.startsWith(p)); }
function getSyncMeta() { try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch { return {}; } }
function setSyncMeta(meta) { localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta)); }
function setSyncStatus(msg) { localStorage.setItem(SYNC_LAST_KEY, msg); const el = $('sync-status'); if (el) el.textContent = msg; }

// Use this instead of localStorage.setItem for any key that should sync
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
function queuePush(key, value, updatedAt) {
  pushQueue.push({ key, value, updatedAt });
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
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
      body: JSON.stringify({ records })
    });
    setSyncStatus('Last synced: ' + new Date().toLocaleString('en-GB'));
  } catch (e) {
    pushQueue = records.concat(pushQueue); // retry on next push/sync
  }
}

// Push every locally-stored synced key (used for first connect / manual "Sync Now")
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

// Pull remote state and apply anything newer than what we have locally
async function pullSync(silent) {
  const url = getSyncUrl();
  if (!url) return;
  try {
    const res = await fetch(url);
    const remote = await res.json();
    const meta = getSyncMeta();
    let changed = false;
    for (const k in remote) {
      const remoteTime = Number(remote[k].updatedAt) || 0;
      const localTime = meta[k] || 0;
      if (remoteTime > localTime) {
        localStorage.setItem(k, remote[k].value);
        meta[k] = remoteTime;
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
  } catch (e) {
    setSyncStatus('Sync failed — offline?');
  }
}

window.syncNow = async function() {
  if (!getSyncUrl()) { showToast('Add a Sheet URL first'); return; }
  showToast('Syncing…');
  await fetchSettingsFromSheet();
  await pullSync();
  pushAllLocal();
};

// Fetch tasks + journal questions from Settings sheet (sheet = source of truth)
async function fetchSettingsFromSheet() {
  const url = getSyncUrl();
  if (!url) return;
  try {
    const res  = await fetch(url + '?action=getSettings');
    const data = await res.json();
    const meta = getSyncMeta();
    const now  = Date.now();

    // Tasks — sheet always wins
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
    // Offline — use localStorage as fallback
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

// JOURNAL QUESTIONS STORAGE
const JOURNAL_QS_KEY = 'journal_questions';

const DEFAULT_MORNING_QS = [
  {
    id: 'm0',
    label: 'How am I feeling right now?',
    hint: 'Be honest — one sentence is enough'
  },
  {
    id: 'm1',
    label: 'My 3 priorities today',
    hint: '',
    type: 'priorities'
  },
  {
    id: 'm2',
    label: 'What would make today a win?',
    hint: 'Just one thing — the most important'
  },
  {
    id: 'm3',
    label: "What am I avoiding that I shouldn't be?",
    hint: 'The uncomfortable question'
  }
];

const DEFAULT_EVENING_QS = [
  {
    id: 'e0',
    label: 'Did I do what I said this morning?',
    hint: '',
    type: 'radio'
  },
  {
    id: 'e1',
    label: 'What went well today?',
    hint: ''
  },
  {
    id: 'e2',
    label: 'What drained me or went wrong?',
    hint: ''
  },
  {
    id: 'e3',
    label: 'What do I want to do differently tomorrow?',
    hint: ''
  },
  {
    id: 'e4',
    label: "One thing I'm grateful for today",
    hint: ''
  }
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

// Build question objects from plain string labels (from sheet)
function buildQsFromLabels(morningLabels, eveningLabels) {
  const morning = morningLabels.map((label, i) => {
    const id = 'm' + i;
    if (i === 1 && label.toLowerCase().includes('priorit')) return { id, label, hint: '', type: 'priorities' };
    return { id, label, hint: '' };
  });
  const evening = eveningLabels.map((label, i) => {
    const id = 'e' + i;
    if (i === 0 && label.toLowerCase().includes('did i do')) return { id, label, hint: '', type: 'radio' };
    return { id, label, hint: '' };
  });
  return { morning, evening };
}

// TASKS STORAGE
const TASKS_STORAGE_KEY = 'custom_tasks';
const DEFAULT_TASKS = [
  { id: 'sleep', name: 'Sleep (8h)', time: '05:00', days: [0,1,2,3,4,5,6] },
  { id: 'workout', name: 'Workout', time: '05:00 – 05:30', days: [1,3,6] },
  { id: 'read', name: 'Read self-development book', time: '05:30 – 06:00', days: [0,1,2,3,4,5,6] },
  { id: 'biz', name: 'Business building / Personal improvement', time: '06:00 – 07:00', days: [0,1,2,3,4,5,6] },
  { id: 'work', name: 'Accounting / Finance work', time: '09:00 – 17:00', days: [0,1,2,3,4,5,6] },
  { id: 'combat', name: 'Combat training', time: '19:00 – 20:00', days: [1,2,4] },
  { id: 'journal-task', name: 'Journal & plan tomorrow', time: '21:00 – 21:15', days: [0,1,2,3,4,5,6] }
];

function getTasks() {
  const stored = localStorage.getItem(TASKS_STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch(e) { return [...DEFAULT_TASKS]; }
  } else { return [...DEFAULT_TASKS]; }
}

function saveTasks(tasks) {
  setSynced(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  if (document.querySelector('#tab-todos.active')) renderTodos();
  if (document.querySelector('#tab-history.active')) renderHistory();
  if (document.querySelector('#tab-settings.active')) renderSettings();
}

function resetAllTasks() {
  if (confirm('⚠️ This will delete ALL your custom tasks and reset to the original 7 tasks. Your journal and task checkmarks will remain, but tasks will be renamed to defaults. Continue?')) {
    saveTasks([...DEFAULT_TASKS]);
    showToast('Tasks reset to default');
  }
}

// TAB SWITCHING
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'journal') renderJournalDate();
  else if (tab === 'todos') renderTodos();
  else if (tab === 'history') renderHistory();
  else if (tab === 'settings') renderSettings();
  if (getSyncUrl() && (tab === 'history' || tab === 'settings')) pullSync(true);
}

// JOURNAL
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

// Build the form HTML dynamically from stored questions
function renderJournalForm(mode) {
  const qs     = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;
  const container = $(mode === 'morning' ? 'morning-journal' : 'evening-journal');

  let html = '';
  questions.forEach((q, i) => {
    const num = i + 1;
    const hintHtml = q.hint ? `<p class="field-hint">${q.hint}</p>` : '';

    if (q.type === 'priorities') {
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        <input id="jq-${q.id}-0" class="field-input" placeholder="Priority 1" />
        <input id="jq-${q.id}-1" class="field-input" placeholder="Priority 2" />
        <input id="jq-${q.id}-2" class="field-input" placeholder="Priority 3" />
      </div>`;
    } else if (q.type === 'radio') {
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        <div class="radio-group">
          <label class="radio-opt"><input type="radio" name="jq-${q.id}-radio" value="Yes" /> Yes</label>
          <label class="radio-opt"><input type="radio" name="jq-${q.id}-radio" value="Partially" /> Partially</label>
          <label class="radio-opt"><input type="radio" name="jq-${q.id}-radio" value="No" /> No</label>
        </div>
        <textarea id="jq-${q.id}-why" class="field-input" rows="2" placeholder="Why?"></textarea>
      </div>`;
    } else {
      html += `<div class="journal-field">
        <label class="field-label">${num}. ${q.label}</label>
        ${hintHtml}
        <textarea id="jq-${q.id}" class="field-input" rows="2"></textarea>
      </div>`;
    }
  });

  const btnLabel = mode === 'morning' ? 'Save Morning Entry' : 'Save Evening Entry';
  html += `<button class="save-btn" onclick="saveJournal('${mode}')">${btnLabel}</button>`;
  container.innerHTML = html;
}

function saveJournal(mode) {
  const d   = new Date();
  const qs  = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;
  const data = { mode, date: d.toISOString().slice(0,10) };

  questions.forEach(q => {
    if (q.type === 'priorities') {
      data[q.id] = [
        (document.getElementById('jq-' + q.id + '-0')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-1')?.value || '').trim(),
        (document.getElementById('jq-' + q.id + '-2')?.value || '').trim(),
      ];
      // keep legacy 'priorities' key for backward compat
      if (q.id === 'm1') data.priorities = data[q.id];
    } else if (q.type === 'radio') {
      const checked = document.querySelector(`input[name="jq-${q.id}-radio"]:checked`);
      data[q.id]        = checked ? checked.value : '';
      data[q.id + '_why'] = (document.getElementById('jq-' + q.id + '-why')?.value || '').trim();
    } else {
      data[q.id] = (document.getElementById('jq-' + q.id)?.value || '').trim();
    }
  });

  // Legacy keys for sheet sync compatibility
  if (mode === 'morning') {
    data.feeling = data['m0'] || '';
    data.win     = data['m2'] || '';
    data.avoid   = data['m3'] || '';
  } else {
    data.feeling   = data['e0'] || '';
    data.well      = data['e1'] || '';
    data.wrong     = data['e2'] || '';
    data.different = data['e3'] || '';
    data.grateful  = data['e4'] || '';
  }

  setSynced(key(mode, d), JSON.stringify(data));
  showToast('Entry saved ✓');
}

function loadJournalEntry(mode) {
  const d      = new Date();
  const stored = localStorage.getItem(key(mode, d));
  if (!stored) return;
  const data   = JSON.parse(stored);
  const qs     = getJournalQuestions();
  const questions = mode === 'morning' ? qs.morning : qs.evening;

  questions.forEach(q => {
    if (q.type === 'priorities') {
      const vals = data[q.id] || data.priorities || [];
      ['0','1','2'].forEach((s,i) => {
        const el = document.getElementById('jq-' + q.id + '-' + s);
        if (el) el.value = vals[i] || '';
      });
    } else if (q.type === 'radio') {
      const val = data[q.id] || data.did || '';
      if (val) {
        const r = document.querySelector(`input[name="jq-${q.id}-radio"][value="${val}"]`);
        if (r) r.checked = true;
      }
      const why = document.getElementById('jq-' + q.id + '-why');
      if (why) why.value = data[q.id + '_why'] || data.didWhy || '';
    } else {
      const el = document.getElementById('jq-' + q.id);
      if (el) el.value = data[q.id] || '';
    }
  });
}

// HISTORY
function renderHistory() {
  $('history-date').textContent = fmt(new Date());
  renderHistoryEntries();
  renderTaskStats();
}
function renderHistoryEntries() {
  const container = $('history-entries-list');
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('morning::') || k.startsWith('evening::')) {
      try { const d = JSON.parse(localStorage.getItem(k)); entries.push({ k, d }); } catch {}
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
    const preview = d.mode === 'morning' ? (d.feeling || (d.priorities?.filter(Boolean).join(' · ') || '')) : (d.well || d.grateful || '');
    return `<div class="entry-card" onclick="showEntry('${k}')"><div class="entry-meta"><span class="entry-date">${dateStr}${isToday ? ' — Today' : ''}</span><span class="entry-type">${d.mode === 'morning' ? '🌅 Morning' : '🌙 Evening'}</span></div><p class="entry-preview">${preview || '(no preview)'}</p></div>`;
  }).join('');
}
window.showEntry = function(k) {
  const d = JSON.parse(localStorage.getItem(k));
  const dateStr = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let content = '';
  if (d.mode === 'morning') {
    content = `<div class="modal-item"><strong>Feeling</strong><p>${d.feeling || '—'}</p></div>
               <div class="modal-item"><strong>Priorities</strong><p>${(d.priorities||[]).filter(Boolean).map((p,i)=>`${i+1}. ${p}`).join('<br>') || '—'}</p></div>
               <div class="modal-item"><strong>What makes today a win</strong><p>${d.win || '—'}</p></div>
               <div class="modal-item"><strong>Avoiding</strong><p>${d.avoid || '—'}</p></div>`;
  } else {
    content = `<div class="modal-item"><strong>Did what I said</strong><p>${d.did || '—'} ${d.didWhy ? '— ' + d.didWhy : ''}</p></div>
               <div class="modal-item"><strong>What went well</strong><p>${d.well || '—'}</p></div>
               <div class="modal-item"><strong>What drained me</strong><p>${d.wrong || '—'}</p></div>
               <div class="modal-item"><strong>Do differently</strong><p>${d.different || '—'}</p></div>
               <div class="modal-item"><strong>Grateful for</strong><p>${d.grateful || '—'}</p></div>`;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">${dateStr} · ${d.mode === 'morning' ? '🌅 Morning' : '🌙 Evening'}</div>${content}<button class="modal-close" onclick="this.closest('.modal-overlay').remove()">Close</button></div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};
function renderTaskStats() {
  const tasks = getTasks();
  const container = $('task-stats-container');
  const taskStats = {};
  tasks.forEach(t => { taskStats[t.id] = { name: t.name, scheduledCount: 0, completedCount: 0, days: t.days }; });
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('batman::')) {
      const dateStr = k.split('::')[1];
      const date = new Date(dateStr + 'T00:00:00');
      if (isNaN(date.getTime())) continue;
      const dow = date.getDay();
      const state = JSON.parse(localStorage.getItem(k) || '{}');
      for (let taskId in taskStats) {
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
    return `<div class="stat-card"><div class="stat-header"><span class="stat-name">${t.name}</span><span class="stat-percent">${percent}%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${percent}%;"></div></div><div class="stat-detail">${t.completedCount} / ${t.scheduledCount} scheduled days</div></div>`;
  }).join('');
}

// BATMAN SCHEDULE (dynamic)
let weekOffset = 0;
let selectedDay = null;
function getWeekDays(offset = 0) {
  const today = new Date(); today.setHours(0,0,0,0);
  const mon = new Date(today);
  const dow = today.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  mon.setDate(today.getDate() + diff + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
}
function renderTodos() {
  const today = new Date(); today.setHours(0,0,0,0);
  const days = getWeekDays(weekOffset);
  const wStart = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const wEnd = days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  $('week-label').textContent = `${wStart} – ${wEnd}`;
  $('todos-date').textContent = fmt(today);
  if (selectedDay === null || weekOffset !== (selectedDay._weekOffset ?? 0)) {
    if (weekOffset === 0) { const todayInWeek = days.find(d => d.getTime() === today.getTime()); selectedDay = todayInWeek || days[0]; }
    else selectedDay = days[0];
    if (selectedDay) selectedDay._weekOffset = weekOffset;
  }
  const tabContainer = $('day-tabs');
  tabContainer.innerHTML = days.map(d => {
    const isToday = d.getTime() === today.getTime();
    const isSelected = selectedDay && d.toISOString().slice(0,10) === selectedDay.toISOString().slice(0,10);
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const dayNum = d.getDate();
    return `<button class="day-tab ${isSelected ? 'active' : ''} ${isToday && !isSelected ? 'today-marker' : ''}" onclick="selectDay(new Date('${d.toISOString()}'))"><span class="day-num">${dayNum}</span>${dayName}</button>`;
  }).join('');
  renderDaySchedule();
}
window.selectDay = function(d) { selectedDay = new Date(d); selectedDay._weekOffset = weekOffset; renderTodos(); };
window.shiftWeek = function(dir) { weekOffset += dir; selectedDay = null; renderTodos(); };
function renderDaySchedule() {
  if (!selectedDay) return;
  const d = selectedDay;
  const dow = d.getDay();
  const dateKey = d.toISOString().slice(0,10);
  const tasks = getTasks().filter(t => t.days.includes(dow));
  let state = {};
  try { state = JSON.parse(localStorage.getItem(`batman::${dateKey}`) || '{}'); } catch {}
  const list = $('schedule-list');
  if (tasks.length === 0) { list.innerHTML = '<p style="color:var(--text-dim);font-size:14px;text-align:center;padding:40px 0">No tasks scheduled for this day.</p>'; return; }
  list.innerHTML = tasks.map(t => `<div class="schedule-item ${state[t.id] ? 'done' : ''}" onclick="toggleTask('${t.id}', '${dateKey}')"><div class="task-check"></div><div class="task-info"><div class="task-time">${t.time}</div><div class="task-name">${t.name}</div></div></div>`).join('');
}
window.toggleTask = function(taskId, dateKey) {
  const stateKey = `batman::${dateKey}`;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch {}
  state[taskId] = !state[taskId];
  setSynced(stateKey, JSON.stringify(state));
  renderDaySchedule();
  const tasks = getTasks();
  const dow = new Date(dateKey+'T00:00:00').getDay();
  const scheduledTasks = tasks.filter(t => t.days.includes(dow));
  const doneCount = scheduledTasks.filter(t => state[t.id] === true).length;
  if (state[taskId] && doneCount === scheduledTasks.length) showToast('Full day complete 🔥');
  else if (state[taskId]) showToast('Done ✓');
};

// SETTINGS
function renderSettings() {
  const urlInput = $('sync-url-input');
  if (urlInput && document.activeElement !== urlInput) urlInput.value = getSyncUrl();
  const statusEl = $('sync-status');
  if (statusEl) statusEl.textContent = localStorage.getItem(SYNC_LAST_KEY) || (getSyncUrl() ? 'Not synced yet' : 'No Sheet connected');
  const tasks = getTasks();
  const container = $('tasks-list');
  if (tasks.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);padding:20px">No tasks. Add one above.</p>';
    return;
  }
  container.innerHTML = tasks.map((task, idx) => {
    const daysStr = task.days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
    return `<div class="task-item" data-idx="${idx}"><div class="task-header"><strong>${task.name}</strong><div class="task-actions"><button class="icon-btn edit-task" onclick="editTask(${idx})">✏️</button><button class="icon-btn delete-task" onclick="deleteTask(${idx})">🗑️</button></div></div><div class="task-detail">🕒 ${task.time}</div><div class="task-detail">📅 ${daysStr}</div></div>`;
  }).join('');
}
window.addNewTask = function() {
  const name = $('#new-task-name').value.trim();
  const time = $('#new-task-time').value.trim();
  if (!name || !time) { showToast('Please fill both name and time'); return; }
  const checkboxes = document.querySelectorAll('#tab-settings .days-checkboxes input');
  const days = Array.from(checkboxes).filter(cb => cb.checked).map(cb => parseInt(cb.value));
  if (days.length === 0) { showToast('Select at least one day'); return; }
  const tasks = getTasks();
  const newId = `custom_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  tasks.push({ id: newId, name: name, time: time, days: days.sort((a,b)=>a-b) });
  saveTasks(tasks);
  $('#new-task-name').value = '';
  $('#new-task-time').value = '';
  checkboxes.forEach(cb => cb.checked = false);
  renderSettings();
  showToast('Task added');
};
window.editTask = function(idx) {
  const tasks = getTasks();
  const task = tasks[idx];
  const newName = prompt('Edit task name:', task.name);
  if (newName === null) return;
  const newTime = prompt('Edit time (e.g. "07:00 – 07:15"):', task.time);
  if (newTime === null) return;
  let daysInput = prompt('Edit days (comma-separated numbers: 0=Sun,1=Mon,...6=Sat)\nCurrent: ' + task.days.join(','), task.days.join(','));
  if (daysInput === null) return;
  let newDays = daysInput.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n>=0 && n<=6);
  if (newDays.length === 0) newDays = task.days;
  tasks[idx] = { ...task, name: newName, time: newTime, days: newDays.sort((a,b)=>a-b) };
  saveTasks(tasks);
  renderSettings();
  showToast('Task updated');
};
window.deleteTask = function(idx) {
  if (confirm('Delete this task? All past checkmarks for this task will remain in storage but won’t appear in schedule anymore.')) {
    const tasks = getTasks();
    tasks.splice(idx, 1);
    saveTasks(tasks);
    renderSettings();
    showToast('Task deleted');
  }
};

// INIT
document.addEventListener('DOMContentLoaded', async () => {
  renderJournalDate();
  if (getSyncUrl()) {
    await fetchSettingsFromSheet();
    renderJournalDate(); // re-render with fresh questions
    pullSync(true).then(() => {
      if (document.querySelector('.tab.active')?.id === 'tab-journal') renderJournalDate();
    });
  }
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(err => console.log('SW:', err)); }
});