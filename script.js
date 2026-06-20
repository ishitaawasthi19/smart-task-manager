/**
 * ============================================================
 *  Smart Task Manager — script.js
 *  Compatible with the current index.html + style.css
 * ============================================================
 *
 *  Features:
 *   ✔ Add task (button click or Enter key)
 *   ✔ Mark task as completed / restore to pending (checkbox)
 *   ✔ Delete individual task (with exit animation)
 *   ✔ Clear all completed tasks
 *   ✔ Delete all tasks (double-click safety guard)
 *   ✔ Filter view — All / Pending / Completed
 *   ✔ Live character counter with warning colours
 *   ✔ Duplicate-task detection
 *   ✔ Progress ring (% complete) + stat cards updated in real time
 *   ✔ Total count badge in top-bar synced automatically
 *   ✔ Animated toast notifications
 *   ✔ Full localStorage persistence (auto-save on every change)
 *   ✔ Today's date shown in the topbar
 * ============================================================
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   1.  CONSTANTS & CONFIGURATION
───────────────────────────────────────────────────────────── */

const STORAGE_KEY  = 'smart-tasks-v2';  // localStorage key
const MAX_CHARS    = 120;               // max task text length
const ANIM_DELAY   = 290;              // ms — matches CSS slideOut duration
const TOAST_MS     = 2800;             // ms — how long toasts stay visible
const CONFIRM_MS   = 3000;             // ms — delete-all confirm window

/* Circumference of the SVG ring circle (r=50 → 2πr = 314.159…)
   Must match the stroke-dasharray attribute in index.html exactly */
const RING_CIRCUMFERENCE = 314.159;

/* ─────────────────────────────────────────────────────────────
   2.  DOM REFERENCES
───────────────────────────────────────────────────────────── */

// Input
const taskInput     = document.getElementById('task-input');
const addBtn        = document.getElementById('add-btn');
const charCounter   = document.getElementById('char-counter');

// Task lists
const pendingList   = document.getElementById('pending-list');
const completedList = document.getElementById('completed-list');

// Empty states
const pendingEmpty  = document.getElementById('pending-empty');
const completedEmpty= document.getElementById('completed-empty');

// Section visibility
const tasksBoard    = document.getElementById('tasks-container'); // class="board"

// Column badges (inside board columns)
const pendingBadge  = document.getElementById('pending-badge');
const completedBadge= document.getElementById('completed-badge');

// Sidebar stat values
const totalCountEl    = document.getElementById('total-count');
const pendingCountEl  = document.getElementById('pending-count');
const completedCountEl= document.getElementById('completed-count');

// Top-bar total badge
const totalCountTop   = document.getElementById('total-count-top');

// Progress (hidden bar drives the ring via MutationObserver in HTML)
const progressFill  = document.getElementById('progress-fill');

// Progress ring + label (in sidebar)
const ringFill      = document.getElementById('ring-fill');
const progressLabel = document.getElementById('progress-label'); // shows "42%"

// Filter tabs (sidebar nav)
const filterTabs    = document.querySelectorAll('.filter-tab');

// Action buttons
const clearCompBtn  = document.getElementById('clear-completed-btn');
const deleteAllBtn  = document.getElementById('delete-all-btn');

// Toast
const toast         = document.getElementById('toast');

// Topbar date
const topbarDate    = document.getElementById('topbar-date');

/* ─────────────────────────────────────────────────────────────
   3.  APPLICATION STATE
───────────────────────────────────────────────────────────── */

/** @type {Array<{id:string, text:string, completed:boolean, createdAt:number}>} */
let tasks = [];

let toastTimerId    = null;  // for clearing active toast
let confirmTimerId  = null;  // for resetting delete-all confirm state

/* ─────────────────────────────────────────────────────────────
   4.  LOCALSTORAGE — LOAD & SAVE
───────────────────────────────────────────────────────────── */

/**
 * Reads tasks from localStorage into the `tasks` array.
 * Silently falls back to an empty array on any parse error.
 */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    tasks = Array.isArray(parsed) ? parsed : [];
  } catch {
    tasks = [];
  }
}

/**
 * Serialises `tasks` to localStorage.
 * Called after every mutation (add / toggle / delete).
 */
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

/* ─────────────────────────────────────────────────────────────
   5.  TASK OPERATIONS  (add / toggle / delete)
───────────────────────────────────────────────────────────── */

/**
 * Creates and prepends a new task.
 * @param {string} rawText - Raw value from the input field.
 * @returns {boolean} true if the task was successfully added.
 */
function addTask(rawText) {
  const text = rawText.trim();

  // Validation — empty input
  if (!text) {
    showToast('✏️ Please type something first!');
    shakeInput();
    return false;
  }

  // Validation — too long
  if (text.length > MAX_CHARS) {
    showToast(`⚠️ Max ${MAX_CHARS} characters allowed.`);
    return false;
  }

  // Validation — duplicate (case-insensitive)
  const duplicate = tasks.some(t => t.text.toLowerCase() === text.toLowerCase());
  if (duplicate) {
    showToast('⚠️ This task already exists!');
    shakeInput();
    return false;
  }

  // Build the task object
  const task = {
    id:        generateId(),
    text,
    completed: false,
    createdAt: Date.now(),
  };

  tasks.unshift(task); // newest tasks appear at the top
  saveTasks();
  renderAll();
  showToast('✅ Task added!');
  return true;
}

/**
 * Toggles the completed state of a task and re-renders.
 * @param {string} id - Task ID.
 */
function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  task.completed = !task.completed;
  saveTasks();
  renderAll();
  showToast(task.completed ? '🎉 Task completed!' : '↩️ Moved back to pending.');
}

/**
 * Removes a single task by ID, playing an exit animation first.
 * @param {string} id - Task ID.
 */
function deleteTask(id) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;

  showToast('🗑️ Task deleted.');

  const el = document.getElementById(id);
  if (el) {
    // Trigger the CSS exit animation, then remove from state
    el.classList.add('removing');
    setTimeout(() => {
      tasks.splice(idx, 1);
      saveTasks();
      renderAll();
    }, ANIM_DELAY);
  } else {
    tasks.splice(idx, 1);
    saveTasks();
    renderAll();
  }
}

/**
 * Removes all completed tasks.
 */
function clearCompleted() {
  const n = tasks.filter(t => t.completed).length;
  if (n === 0) {
    showToast('ℹ️ No completed tasks to clear.');
    return;
  }
  tasks = tasks.filter(t => !t.completed);
  saveTasks();
  renderAll();
  showToast(`🧹 Cleared ${n} completed task${n !== 1 ? 's' : ''}.`);
}

/**
 * Removes every task. Uses a two-click confirmation pattern.
 */
function deleteAll() {
  const n = tasks.length;
  if (n === 0) return;
  tasks = [];
  saveTasks();
  renderAll();
  showToast(`🗑️ All ${n} task${n !== 1 ? 's' : ''} deleted.`);
}

/* ─────────────────────────────────────────────────────────────
   6.  RENDERING
───────────────────────────────────────────────────────────── */

/**
 * Master render function — rebuilds both task lists and updates
 * all counters, badges, progress ring, and UI visibility.
 */
function renderAll() {
  const pending   = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t =>  t.completed);

  // ── Task lists ──────────────────────────────────────────
  renderList(pendingList,   pending);
  renderList(completedList, completed);

  // ── Empty states ────────────────────────────────────────
  toggleClass(pendingEmpty,   'visible', pending.length   === 0);
  toggleClass(completedEmpty, 'visible', completed.length === 0);

  // ── Column badges ───────────────────────────────────────
  setTextAndPulse(pendingBadge,   pending.length);
  setTextAndPulse(completedBadge, completed.length);

  // ── Sidebar stat cards ──────────────────────────────────
  setTextAndPulse(totalCountEl,     tasks.length);
  setTextAndPulse(pendingCountEl,   pending.length);
  setTextAndPulse(completedCountEl, completed.length);

  // ── Top-bar badge ────────────────────────────────────────
  if (totalCountTop) totalCountTop.textContent = tasks.length;

  // ── Progress ring ────────────────────────────────────────
  const pct = tasks.length === 0
    ? 0
    : Math.round((completed.length / tasks.length) * 100);

  updateProgressRing(pct);

  // ── Hidden progress bar (drives MutationObserver in HTML) ─
  if (progressFill) progressFill.style.width = `${pct}%`;

  // ── Delete-all button visibility ─────────────────────────
  toggleClass(deleteAllBtn, 'visible', tasks.length > 0);
}

/**
 * Renders an array of task objects into a <ul> element.
 * @param {HTMLElement} listEl - The <ul> to populate.
 * @param {Array}       taskArr - Tasks to render.
 */
function renderList(listEl, taskArr) {
  listEl.innerHTML = '';
  taskArr.forEach(task => listEl.appendChild(createTaskElement(task)));
}

/**
 * Builds a single <li> task card element.
 * @param {{id, text, completed}} task
 * @returns {HTMLLIElement}
 */
function createTaskElement(task) {
  /* ── Wrapper ── */
  const li = document.createElement('li');
  li.id = task.id;
  li.className = `task-item${task.completed ? ' completed' : ''}`;
  li.setAttribute('role', 'listitem');

  /* ── Checkbox ── */
  const checkboxId = `chk-${task.id}`;
  const checkbox   = document.createElement('input');
  checkbox.type      = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.id        = checkboxId;
  checkbox.checked   = task.completed;
  checkbox.setAttribute(
    'aria-label',
    `${task.completed ? 'Restore' : 'Complete'}: ${task.text}`
  );
  checkbox.addEventListener('change', () => toggleTask(task.id));

  /* ── Label (task text) ── */
  const label      = document.createElement('label');
  label.className  = 'task-text';
  label.htmlFor    = checkboxId;
  label.textContent= task.text;
  label.title      = task.text; // shows full text on hover when truncated

  /* ── Delete button ── */
  const delBtn     = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.type      = 'button';
  delBtn.innerHTML = '&#x2715;'; // ✕
  delBtn.setAttribute('aria-label', `Delete: ${task.text}`);
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  li.appendChild(checkbox);
  li.appendChild(label);
  li.appendChild(delBtn);
  return li;
}

/* ─────────────────────────────────────────────────────────────
   7.  PROGRESS RING
───────────────────────────────────────────────────────────── */

/**
 * Animates the SVG ring and updates the percentage label.
 * stroke-dashoffset = circumference × (1 − pct/100)
 * At 0%  → offset = 314 (fully hidden)
 * At 100%→ offset = 0   (fully drawn)
 * @param {number} pct - Integer 0–100.
 */
function updateProgressRing(pct) {
  if (ringFill) {
    const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
    ringFill.style.strokeDashoffset = offset.toFixed(2);
  }
  if (progressLabel) {
    progressLabel.textContent = `${pct}%`;
  }
}

/* ─────────────────────────────────────────────────────────────
   8.  FILTER TABS
───────────────────────────────────────────────────────────── */

/**
 * Applies a CSS filter class to the board container so that
 * the correct section is visible (handled entirely by CSS).
 * @param {'all'|'pending'|'completed'} filter
 */
function setFilter(filter) {
  // The board uses class="board" and the CSS rules are:
  //   .board.filter-pending   → hide #completed-section
  //   .board.filter-completed → hide #pending-section
  tasksBoard.classList.remove('filter-pending', 'filter-completed');
  if (filter !== 'all') {
    tasksBoard.classList.add(`filter-${filter}`);
  }

  filterTabs.forEach(tab => {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

/* ─────────────────────────────────────────────────────────────
   9.  TOAST NOTIFICATIONS
───────────────────────────────────────────────────────────── */

/**
 * Displays a short-lived toast message at the bottom of the screen.
 * Cancels any currently visible toast before showing the new one.
 * @param {string} message
 */
function showToast(message) {
  if (toastTimerId) clearTimeout(toastTimerId);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimerId = setTimeout(() => toast.classList.remove('show'), TOAST_MS);
}

/* ─────────────────────────────────────────────────────────────
   10.  CHARACTER COUNTER
───────────────────────────────────────────────────────────── */

/**
 * Updates the character counter below the input and applies
 * warning / danger colour classes based on remaining characters.
 * @param {string} value - Current input value.
 */
function updateCharCounter(value) {
  const len = value.length;
  charCounter.textContent = `${len} / ${MAX_CHARS}`;
  charCounter.classList.remove('warning', 'danger');

  if (len >= MAX_CHARS) {
    charCounter.classList.add('danger');
  } else if (len >= MAX_CHARS * 0.8) {
    charCounter.classList.add('warning');
  }
}

/* ─────────────────────────────────────────────────────────────
   11.  UI HELPERS
───────────────────────────────────────────────────────────── */

/**
 * Sets an element's textContent and applies a brief pop/scale animation.
 * @param {HTMLElement} el
 * @param {number|string} value
 */
function setTextAndPulse(el, value) {
  if (!el) return;
  if (el.textContent === String(value)) return; // no change → no pulse
  el.textContent = String(value);
  el.style.transform = 'scale(1.3)';
  setTimeout(() => (el.style.transform = 'scale(1)'), 220);
}

/**
 * Adds or removes a CSS class based on a boolean condition.
 * @param {HTMLElement} el
 * @param {string}      cls
 * @param {boolean}     condition
 */
function toggleClass(el, cls, condition) {
  if (!el) return;
  el.classList.toggle(cls, condition);
}

/**
 * Brief horizontal shake animation on the input field.
 * Uses a CSS class that triggers a keyframe animation.
 */
function shakeInput() {
  taskInput.classList.add('shake');
  setTimeout(() => taskInput.classList.remove('shake'), 500);
}

/**
 * Generates a collision-resistant unique ID string.
 * @returns {string}
 */
function generateId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Formats today's date as a human-readable string and injects
 * it into the topbar date element.
 */
function setTodaysDate() {
  if (!topbarDate) return;
  topbarDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}

/* ─────────────────────────────────────────────────────────────
   12.  EVENT LISTENERS
───────────────────────────────────────────────────────────── */

/* ── Add Task ── */
addBtn.addEventListener('click', () => {
  const success = addTask(taskInput.value);
  if (success) {
    taskInput.value = '';
    updateCharCounter('');
    taskInput.focus();
  }
});

/* ── Enter key ── */
taskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') addBtn.click();
});

/* ── Live character counter ── */
taskInput.addEventListener('input', () => {
  updateCharCounter(taskInput.value);
});

/* ── Filter tabs ── */
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => setFilter(tab.dataset.filter));
});

/* ── Clear Completed ── */
clearCompBtn.addEventListener('click', clearCompleted);

/* ── Delete All (two-click confirm) ── */
deleteAllBtn.addEventListener('click', () => {
  if (!deleteAllBtn.dataset.confirming) {
    // First click — enter confirm state
    deleteAllBtn.dataset.confirming = '1';
    deleteAllBtn.textContent = '⚠️ Click again to confirm';
    deleteAllBtn.style.background = 'rgba(239, 68, 68, 0.25)';

    confirmTimerId = setTimeout(() => {
      resetDeleteAllBtn();
    }, CONFIRM_MS);
  } else {
    // Second click — execute
    clearTimeout(confirmTimerId);
    resetDeleteAllBtn();
    deleteAll();
  }
});

/**
 * Resets the Delete All button to its default visual state.
 */
function resetDeleteAllBtn() {
  deleteAllBtn.dataset.confirming = '';
  deleteAllBtn.textContent = '🗑️ Delete All';
  deleteAllBtn.style.background = '';
}

/* ─────────────────────────────────────────────────────────────
   13.  SHAKE ANIMATION (injected keyframe)
───────────────────────────────────────────────────────────── */

/**
 * Injects a @keyframes rule for the input shake animation
 * so no changes are needed to style.css.
 */
(function injectShakeKeyframe() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes inputShake {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-7px); }
      40%     { transform: translateX(7px); }
      60%     { transform: translateX(-5px); }
      80%     { transform: translateX(5px); }
    }
    .task-input.shake {
      animation: inputShake 0.45s ease;
      border-color: #ef4444 !important;
      box-shadow: 0 0 0 3px rgba(239,68,68,0.2) !important;
    }
  `;
  document.head.appendChild(style);
})();

/* ─────────────────────────────────────────────────────────────
   14.  BOOT  (IIFE — runs immediately on DOMContentLoaded)
───────────────────────────────────────────────────────────── */

(function init() {
  setTodaysDate();      // show today's date in the topbar
  loadTasks();          // pull tasks from localStorage
  renderAll();          // build the UI from loaded state
  updateCharCounter(''); // initialise counter display
  taskInput.focus();    // focus input so the user can type immediately
})();
