/**
 * NEBIH COMMAND CENTER - Frontend App
 * Two-way sync with Google Sheets
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const APP_CONFIG = {
  // IMPORTANT: Replace this with your newly generated Web App URL.
  // It MUST end in /exec
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzfqLKOmnFA9uYZh87EN-L2JBlM9xG-jId_iWK2T4308VVTjyrDdEP-23utxYZdIOxX-Q/exec',
  
  DEBUG_MODE: true,
  SYNC_INTERVAL: 30000, 
  THEME_COLOR: '#1a1a2e',
  ACCENT_COLOR: '#d4af37'
};

// ============================================================================
// GLOBAL STATE & LOGGING
// ============================================================================

let appState = {
  tasks: [],
  journal: {},
  syncStatus: 'idle',
  lastSyncTime: null,
  currentDate: new Date().toLocaleDateString('de-DE'), 
};

const AppLogger = {
  log: (message, data = null) => APP_CONFIG.DEBUG_MODE && console.log(`[${new Date().toLocaleTimeString()}] ${message}`, data || ''),
  error: (message, error = null) => { console.error(`[ERROR] ${message}`, error || ''); updateSyncStatus('error', message); }
};

function updateSyncStatus(status, message = '') {
  appState.syncStatus = status;
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;
  statusEl.textContent = `${status.toUpperCase()} - ${message}`;
}

// ============================================================================
// API CALLS
// ============================================================================

async function fetchTasks() {
  try {
    updateSyncStatus('syncing', 'Loading tasks...');
    const response = await fetch(`${APP_CONFIG.SCRIPT_URL}?action=tasks`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    appState.tasks = data;
    updateSyncStatus('success', `Loaded ${data.length} tasks`);
    renderTasks();
    return data;
  } catch (error) {
    AppLogger.error('Failed to fetch tasks', error);
    return [];
  }
}

async function saveTasks() {
  try {
    updateSyncStatus('syncing', 'Saving tasks...');
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'save-tasks', tasks: appState.tasks })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    updateSyncStatus('success', 'Tasks saved');
    return data;
  } catch (error) {
    AppLogger.error('Failed to save tasks', error);
  }
}

async function fetchJournalEntry(dateStr) {
  try {
    updateSyncStatus('syncing', `Loading journal...`);
    const response = await fetch(`${APP_CONFIG.SCRIPT_URL}?action=journal&date=${encodeURIComponent(dateStr)}`);
    return await response.json();
  } catch (error) {
    AppLogger.error('Failed to fetch journal', error);
    return { error: error.message };
  }
}

async function saveJournalEntry(dateStr, responses) {
  try {
    updateSyncStatus('syncing', `Saving journal...`);
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'save-journal', date: dateStr, responses: responses })
    });
    return await response.json();
  } catch (error) {
    AppLogger.error('Failed to save journal', error);
    return { error: error.message };
  }
}

// ============================================================================
// RENDERING & UI (Aligned with index.html)
// ============================================================================

function renderTasks() {
  // Targeting the correct element from index.html
  const container = document.getElementById('tasks-list');
  if (!container) return;
  
  if (appState.tasks.length === 0) {
    container.innerHTML = '<p class="field-hint">No tasks loaded. Add one below.</p>';
    return;
  }
  
  container.innerHTML = appState.tasks.map(task => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `
      <div class="task-item" data-task-id="${task.id}">
        <div class="task-header">
          <strong>${task.name}</strong>
          <span class="task-detail">${task.time}</span>
        </div>
        <div class="days-checkboxes">
          ${days.map(day => {
            const isChecked = task.days[day.toLowerCase()] ? 'checked' : '';
            return `<label><input type="checkbox" ${isChecked} onchange="updateTaskDay('${task.id}', '${day.toLowerCase()}', this.checked)"> ${day}</label>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function updateTaskDay(taskId, day, isChecked) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (task) {
    task.days[day] = isChecked;
    setTimeout(() => saveTasks(), 500);
  }
}

// Basic Tab Switcher for index.html
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initApp() {
  if (APP_CONFIG.SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    updateSyncStatus('error', 'Add deployment URL to app.js');
    return;
  }
  
  await fetchTasks();
  
  setInterval(async () => {
    if (appState.syncStatus === 'idle' || appState.syncStatus === 'success') {
      await fetchTasks();
    }
  }, APP_CONFIG.SYNC_INTERVAL);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

window.switchTab = switchTab;
