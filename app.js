const $ = id => document.getElementById(id);
const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const key = (type, d) => `${type}::${d.toISOString().slice(0,10)}`;

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'journal') renderJournalDate();
  if (tab === 'todos') renderTodos();
}

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
  loadJournalEntry(journalMode);
  renderPastEntries();
}

function saveJournal(mode) {
  const d = new Date();
  let data = {};
  if (mode === 'morning') {
    data = {
      mode: 'morning',
      date: d.toISOString().slice(0,10),
      feeling: $('m-feeling').value.trim(),
      priorities: [$('m-p1').value.trim(), $('m-p2').value.trim(), $('m-p3').value.trim()],
      win: $('m-win').value.trim(),
      avoid: $('m-avoid').value.trim(),
    };
  } else {
    const checked = document.querySelector('input[name="e-did"]:checked');
    data = {
      mode: 'evening',
      date: d.toISOString().slice(0,10),
      did: checked ? checked.value : '',
      didWhy: $('e-did-why').value.trim(),
      well: $('e-well').value.trim(),
      wrong: $('e-wrong').value.trim(),
      different: $('e-different').value.trim(),
      grateful: $('e-grateful').value.trim(),
    };
  }
  localStorage.setItem(key(mode, d), JSON.stringify(data));
  showToast('Entry saved ✓');
  renderPastEntries();
}

function loadJournalEntry(mode) {
  const d = new Date();
  const stored = localStorage.getItem(key(mode, d));
  if (!stored) return;
  const data = JSON.parse(stored);
  if (mode === 'morning') {
    $('m-feeling').value = data.feeling || '';
    $('m-p1').value = data.priorities?.[0] || '';
    $('m-p2').value = data.priorities?.[1] || '';
    $('m-p3').value = data.priorities?.[2] || '';
    $('m-win').value = data.win || '';
    $('m-avoid').value = data.avoid || '';
  } else {
    if (data.did) { const r = document.querySelector(`input[name="e-did"][value="${data.did}"]`); if (r) r.checked = true; }
    $('e-did-why').value = data.didWhy || '';
    $('e-well').value = data.well || '';
    $('e-wrong').value = data.wrong || '';
    $('e-different').value = data.different || '';
    $('e-grateful').value = data.grateful || '';
  }
}

function renderPastEntries() {
  const list = $('entries-list');
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('morning::') || k.startsWith('evening::')) {
      try { const d = JSON.parse(localStorage.getItem(k)); entries.push({ k, d }); } catch {}
    }
  }
  entries.sort((a, b) => b.d.date.localeCompare(a.d.date));
  if (entries.length === 0) { list.innerHTML = '<p style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px 0">No past entries yet</p>'; return; }
  list.innerHTML = entries.map(({ k, d }) => {
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
    content = `<div class="modal-item"><strong>Feeling</strong><p>${d.feeling || '—'}</p></div><div class="modal-item"><strong>Priorities</strong><p>${(d.priorities||[]).filter(Boolean).map((p,i)=>`${i+1}. ${p}`).join('<br>') || '—'}</p></div><div class="modal-item"><strong>What makes today a win</strong><p>${d.win || '—'}</p></div><div class="modal-item"><strong>Avoiding</strong><p>${d.avoid || '—'}</p></div>`;
  } else {
    content = `<div class="modal-item"><strong>Did what I said</strong><p>${d.did || '—'} ${d.didWhy ? '— ' + d.didWhy : ''}</p></div><div class="modal-item"><strong>What went well</strong><p>${d.well || '—'}</p></div><div class="modal-item"><strong>What drained me</strong><p>${d.wrong || '—'}</p></div><div class="modal-item"><strong>Do differently</strong><p>${d.different || '—'}</p></div><div class="modal-item"><strong>Grateful for</strong><p>${d.grateful || '—'}</p></div>`;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet"><div class="modal-handle"></div><div class="modal-title">${dateStr} · ${d.mode === 'morning' ? '🌅 Morning' : '🌙 Evening'}</div>${content}<button class="modal-close" onclick="this.closest('.modal-overlay').remove()">Close</button></div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

const BASE_TASKS = [
  { time: '05:00', name: 'Sleep (8h)', id: 'sleep' },
  { time: '05:00 – 05:30', name: 'Workout', id: 'workout', days: [1,3,6] },
  { time: '05:30 – 06:00', name: 'Read self-development book', id: 'read' },
  { time: '06:00 – 07:00', name: 'Business building / Personal improvement', id: 'biz' },
  { time: '09:00 – 17:00', name: 'Accounting / Finance work', id: 'work' },
  { time: '19:00 – 20:00', name: 'Combat training', id: 'combat', days: [1,2,4] },
  { time: '21:00 – 21:15', name: 'Journal & plan tomorrow', id: 'journal-task' },
];
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
  const tasks = BASE_TASKS.filter(t => !t.days || t.days.includes(dow));
  let state = {};
  try { state = JSON.parse(localStorage.getItem(`batman::${dateKey}`) || '{}'); } catch {}
  const list = $('schedule-list');
  if (tasks.length === 0) { list.innerHTML = '<p style="color:var(--text-dim);font-size:14px;text-align:center;padding:40px 0">Rest day — recharge.</p>'; return; }
  list.innerHTML = tasks.map(t => `<div class="schedule-item ${state[t.id] ? 'done' : ''}" onclick="toggleTask('${t.id}', '${dateKey}')"><div class="task-check"></div><div class="task-info"><div class="task-time">${t.time}</div><div class="task-name">${t.name}</div></div></div>`).join('');
}

window.toggleTask = function(taskId, dateKey) {
  const stateKey = `batman::${dateKey}`;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch {}
  state[taskId] = !state[taskId];
  localStorage.setItem(stateKey, JSON.stringify(state));
  renderDaySchedule();
  const doneCount = Object.values(state).filter(Boolean).length;
  const total = BASE_TASKS.filter(t => !t.days || t.days.includes(new Date(dateKey+'T00:00:00').getDay())).length;
  if (state[taskId] && doneCount === total) showToast('Full day complete 🔥');
  else if (state[taskId]) showToast('Done ✓');
};

document.addEventListener('DOMContentLoaded', () => {
  renderJournalDate();
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(err => console.log('SW:', err)); }
});