/**
 * NEBIH COMMAND CENTER - Frontend App
 * Two-way sync with Google Sheets
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const APP_CONFIG = {
  // TODO: Replace with your Apps Script deployment URL
  SCRIPT_URL: 'https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID_HERE/userweb',
  
  // Feature flags
  DEBUG_MODE: true,
  SYNC_INTERVAL: 30000, // Auto-sync every 30 seconds
  
  // UI
  THEME_COLOR: '#1a1a2e',
  ACCENT_COLOR: '#d4af37'
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let appState = {
  tasks: [],
  journal: {},
  syncStatus: 'idle', // idle, syncing, success, error
  lastSyncTime: null,
  currentDate: new Date().toLocaleDateString('de-DE'), // German format: DD.MM.YYYY
};

// ============================================================================
// LOGGING & DEBUG
// ============================================================================

const AppLogger = {
  log: function(message, data = null) {
    if (APP_CONFIG.DEBUG_MODE) {
      console.log(`[${new Date().toLocaleTimeString()}] ${message}`, data || '');
    }
  },
  error: function(message, error = null) {
    console.error(`[ERROR] ${message}`, error || '');
    updateSyncStatus('error', message);
  },
  info: function(message, data = null) {
    console.info(`[INFO] ${message}`, data || '');
  }
};

// ============================================================================
// SYNC STATUS DISPLAY
// ============================================================================

function updateSyncStatus(status, message = '') {
  appState.syncStatus = status;
  
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;
  
  const icons = {
    idle: '⊘',
    syncing: '↻',
    success: '✓',
    error: '✕'
  };
  
  const colors = {
    idle: '#888',
    syncing: '#ffd700',
    success: '#4caf50',
    error: '#f44336'
  };
  
  statusEl.textContent = icons[status] || '?';
  statusEl.style.color = colors[status];
  statusEl.title = message || status;
  
  AppLogger.log(`Sync status: ${status}`, { message });
}

// ============================================================================
// API CALLS - TASKS
// ============================================================================

/**
 * Fetch tasks from Google Sheets
 */
async function fetchTasks() {
  try {
    updateSyncStatus('syncing', 'Loading tasks...');
    AppLogger.log('Fetching tasks from sheet...');
    
    const url = `${APP_CONFIG.SCRIPT_URL}?action=tasks`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format: expected array');
    }
    
    appState.tasks = data;
    appState.lastSyncTime = new Date();
    
    AppLogger.log(`Successfully fetched ${data.length} tasks`, 
      data.map(t => `${t.id} (${Object.values(t.days).filter(Boolean).length} days)`));
    
    updateSyncStatus('success', `Loaded ${data.length} tasks`);
    renderTasks();
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to fetch tasks', error);
    updateSyncStatus('error', `Failed to fetch tasks: ${error.message}`);
    return [];
  }
}

/**
 * Save task days back to sheet
 */
async function saveTasks() {
  try {
    updateSyncStatus('syncing', 'Saving tasks...');
    AppLogger.log('Saving tasks to sheet...', { taskCount: appState.tasks.length });
    
    const payload = {
      action: 'save-tasks',
      tasks: appState.tasks
    };
    
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    AppLogger.log('Successfully saved tasks', data);
    updateSyncStatus('success', `Saved ${data.tasksSaved} tasks`);
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to save tasks', error);
    updateSyncStatus('error', `Failed to save tasks: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Add new task to sheet
 */
async function addTaskToSheet(task) {
  try {
    updateSyncStatus('syncing', `Adding task: ${task.id}...`);
    AppLogger.log('Adding new task to sheet...', task);
    
    const payload = {
      action: 'add-task',
      task: task
    };
    
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    AppLogger.log('Successfully added task', data);
    updateSyncStatus('success', `Added task: ${task.id}`);
    
    // Re-fetch to get updated data
    await fetchTasks();
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to add task', error);
    updateSyncStatus('error', `Failed to add task: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Delete task from sheet
 */
async function deleteTaskFromSheet(taskId) {
  try {
    updateSyncStatus('syncing', `Deleting task: ${taskId}...`);
    AppLogger.log('Deleting task from sheet...', { taskId });
    
    const payload = {
      action: 'delete-task',
      taskId: taskId
    };
    
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    AppLogger.log('Successfully deleted task', data);
    updateSyncStatus('success', `Deleted task: ${taskId}`);
    
    // Re-fetch to get updated data
    await fetchTasks();
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to delete task', error);
    updateSyncStatus('error', `Failed to delete task: ${error.message}`);
    return { error: error.message };
  }
}

// ============================================================================
// API CALLS - JOURNAL
// ============================================================================

/**
 * Fetch journal entry for specific date
 */
async function fetchJournalEntry(dateStr) {
  try {
    updateSyncStatus('syncing', `Loading journal for ${dateStr}...`);
    AppLogger.log('Fetching journal entry...', { date: dateStr });
    
    const url = `${APP_CONFIG.SCRIPT_URL}?action=journal&date=${encodeURIComponent(dateStr)}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    AppLogger.log('Successfully fetched journal entry', data);
    updateSyncStatus('success', `Loaded journal`);
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to fetch journal entry', error);
    updateSyncStatus('error', `Failed to fetch journal: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Save journal entry to sheet
 * IMPORTANT: This saves ALL responses as an array
 */
async function saveJournalEntry(dateStr, responses) {
  try {
    // Validate responses
    if (!Array.isArray(responses)) {
      throw new Error('Responses must be an array');
    }
    
    if (responses.length === 0) {
      throw new Error('No responses to save');
    }
    
    updateSyncStatus('syncing', `Saving journal for ${dateStr}...`);
    AppLogger.log('Saving journal entry...', { date: dateStr, responseCount: responses.length });
    
    const payload = {
      action: 'save-journal',
      date: dateStr,
      responses: responses // Send all responses
    };
    
    const response = await fetch(APP_CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    AppLogger.log('Successfully saved journal entry', data);
    updateSyncStatus('success', `Saved journal`);
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to save journal entry', error);
    updateSyncStatus('error', `Failed to save journal: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Fetch all journal entries
 */
async function fetchAllJournalEntries() {
  try {
    updateSyncStatus('syncing', 'Loading all journal entries...');
    AppLogger.log('Fetching all journal entries...');
    
    const url = `${APP_CONFIG.SCRIPT_URL}?action=journal-all`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format: expected array');
    }
    
    AppLogger.log(`Successfully fetched ${data.length} journal entries`);
    updateSyncStatus('success', `Loaded ${data.length} journal entries`);
    
    return data;
  } catch (error) {
    AppLogger.error('Failed to fetch journal entries', error);
    updateSyncStatus('error', `Failed to fetch journal entries: ${error.message}`);
    return [];
  }
}

// ============================================================================
// TASK RENDERING
// ============================================================================

/**
 * Render tasks in the UI
 */
function renderTasks() {
  const container = document.getElementById('tasks-container');
  if (!container) return;
  
  AppLogger.log(`Rendering ${appState.tasks.length} tasks`);
  
  if (appState.tasks.length === 0) {
    container.innerHTML = '<p class="no-tasks">No tasks loaded. Try syncing.</p>';
    return;
  }
  
  container.innerHTML = appState.tasks.map((task, idx) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    return `
      <div class="task-item" data-task-id="${task.id}">
        <div class="task-header">
          <strong>${task.name}</strong>
          <span class="task-time">${task.time}</span>
        </div>
        <div class="task-days">
          ${days.map(day => {
            const isChecked = task.days[day.toLowerCase()] ? 'checked' : '';
            return `
              <label class="day-checkbox ${isChecked}">
                <input type="checkbox" 
                  ${isChecked ? 'checked' : ''} 
                  onchange="updateTaskDay('${task.id}', '${day.toLowerCase()}', this.checked)">
                <span>${day}</span>
              </label>
            `;
          }).join('')}
        </div>
        <div class="task-actions">
          <button onclick="deleteTaskUI('${task.id}')" class="btn-delete">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update task day when checkbox changes
 */
function updateTaskDay(taskId, day, isChecked) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (!task) {
    AppLogger.error('Task not found', { taskId });
    return;
  }
  
  // Update local state
  task.days[day] = isChecked;
  
  AppLogger.log(`Updated task day`, { taskId, day, isChecked });
  
  // Auto-save after short delay
  setTimeout(() => saveTasks(), 500);
}

/**
 * Delete task from UI
 */
async function deleteTaskUI(taskId) {
  if (!confirm(`Delete task "${taskId}"?`)) {
    return;
  }
  
  await deleteTaskFromSheet(taskId);
}

/**
 * Add new task from UI
 */
async function addNewTaskUI() {
  const id = prompt('Task ID (e.g., "reading"):');
  if (!id) return;
  
  const name = prompt('Task name (e.g., "Read book"):');
  if (!name) return;
  
  const time = prompt('Time (e.g., "09:00 - 10:00"):');
  if (!time) return;
  
  const newTask = {
    id: id.trim(),
    name: name.trim(),
    time: time.trim(),
    days: {
      sun: false,
      mon: false,
      tue: false,
      wed: false,
      thu: false,
      fri: false,
      sat: false
    }
  };
  
  await addTaskToSheet(newTask);
}

// ============================================================================
// JOURNAL RENDERING
// ============================================================================

/**
 * Render journal questions and answers
 */
async function renderJournal() {
  const container = document.getElementById('journal-container');
  if (!container) return;
  
  AppLogger.log('Rendering journal for date:', appState.currentDate);
  
  const entry = await fetchJournalEntry(appState.currentDate);
  
  if (entry.error) {
    container.innerHTML = `<p class="error">Failed to load journal: ${entry.error}</p>`;
    return;
  }
  
  // Define journal questions
  const questions = {
    morning: [
      'Feeling right now',
      'My 3 priorities today',
      'What would make today a win',
      'What am I avoiding that I shouldn\'t be',
      'Prays'
    ],
    evening: [
      'Feeling right now',
      'What went well today',
      'What would I do differently',
      'Gratitude — 3 things',
      'Prays'
    ]
  };
  
  // Prepare data - if found, use existing; otherwise empty
  let existingData = entry.data || [];
  
  // Build HTML
  let html = `
    <div class="journal-date">
      <input type="date" id="journal-date-picker" value="${formatDateForInput(appState.currentDate)}" 
        onchange="changeJournalDate(this.value)">
    </div>
  `;
  
  html += '<div class="journal-section">';
  html += '<h3>🌅 Morning</h3>';
  
  questions.morning.forEach((q, idx) => {
    const value = existingData[idx + 1] || ''; // +1 because index 0 is date
    html += `
      <div class="journal-q">
        <label>${q}</label>
        <textarea data-question-index="${idx}" data-section="morning" placeholder="...">${value}</textarea>
      </div>
    `;
  });
  
  html += '</div>';
  
  html += '<div class="journal-section">';
  html += '<h3>🌙 Evening</h3>';
  
  questions.evening.forEach((q, idx) => {
    const dataIndex = questions.morning.length + idx + 1; // Offset by morning questions
    const value = existingData[dataIndex] || '';
    html += `
      <div class="journal-q">
        <label>${q}</label>
        <textarea data-question-index="${idx}" data-section="evening" placeholder="...">${value}</textarea>
      </div>
    `;
  });
  
  html += '</div>';
  
  html += `
    <div class="journal-actions">
      <button onclick="saveJournalUI()" class="btn-primary">Save Journal</button>
      <button onclick="clearJournalUI()" class="btn-secondary">Clear</button>
    </div>
  `;
  
  container.innerHTML = html;
}

/**
 * Format date string for HTML input
 */
function formatDateForInput(dateStr) {
  // Convert "21.06.2026" to "2026-06-21"
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

/**
 * Format date from input to display format
 */
function formatDateFromInput(inputDate) {
  // Convert "2026-06-21" to "21.06.2026"
  const parts = inputDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return inputDate;
}

/**
 * Change journal date
 */
async function changeJournalDate(inputDate) {
  appState.currentDate = formatDateFromInput(inputDate);
  AppLogger.log('Journal date changed to:', appState.currentDate);
  await renderJournal();
}

/**
 * Save journal from UI
 */
async function saveJournalUI() {
  const textareas = document.querySelectorAll('#journal-container textarea');
  
  if (textareas.length === 0) {
    AppLogger.error('No journal inputs found');
    return;
  }
  
  // Collect all responses in order: [date, morning1-5, evening1-5]
  const responses = [];
  
  textareas.forEach(textarea => {
    const value = textarea.value.trim();
    responses.push(value);
  });
  
  AppLogger.log('Saving journal responses...', { 
    date: appState.currentDate, 
    responseCount: responses.length,
    responses: responses 
  });
  
  const result = await saveJournalEntry(appState.currentDate, responses);
  
  if (!result.error) {
    alert('Journal saved successfully! ✓');
  } else {
    alert(`Error saving journal: ${result.error}`);
  }
}

/**
 * Clear journal inputs
 */
function clearJournalUI() {
  if (!confirm('Clear all entries for this date?')) {
    return;
  }
  
  const textareas = document.querySelectorAll('#journal-container textarea');
  textareas.forEach(textarea => {
    textarea.value = '';
  });
  
  AppLogger.log('Cleared journal entries');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the app
 */
async function initApp() {
  AppLogger.log('Initializing Nebih Command Center...');
  
  updateSyncStatus('syncing', 'Initializing...');
  
  // Validate configuration
  if (APP_CONFIG.SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    alert('❌ ERROR: Update SCRIPT_URL in app.js with your Apps Script deployment URL');
    updateSyncStatus('error', 'Configuration incomplete');
    return;
  }
  
  // Load initial data
  await Promise.all([
    fetchTasks(),
    renderJournal()
  ]);
  
  updateSyncStatus('success', 'Ready');
  
  // Setup auto-sync
  setInterval(async () => {
    if (appState.syncStatus === 'idle' || appState.syncStatus === 'success') {
      await fetchTasks();
    }
  }, APP_CONFIG.SYNC_INTERVAL);
  
  AppLogger.log('App initialization complete');
}

/**
 * Manual sync button
 */
async function manualSync() {
  await Promise.all([
    fetchTasks(),
    renderJournal()
  ]);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get debug info from backend
 */
async function getDebugInfo() {
  try {
    const url = `${APP_CONFIG.SCRIPT_URL}?action=debug`;
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('=== DEBUG INFO ===');
    console.log(data);
    console.log('=== LOCAL STATE ===');
    console.log(appState);
    
    return data;
  } catch (error) {
    console.error('Debug error:', error);
  }
}

/**
 * Auto-initialize on page load
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ============================================================================
// EXPORTS FOR BROWSER CONSOLE
// ============================================================================

window.appState = appState;
window.manualSync = manualSync;
window.getDebugInfo = getDebugInfo;
window.AppLogger = AppLogger;
