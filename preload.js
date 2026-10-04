const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Existing app API
  get: () => ipcRenderer.invoke('get'),
  patch: (section, patch) => ipcRenderer.invoke('patch', section, patch),
  reset: section => ipcRenderer.invoke('reset', section),
  streakValue: (mode, n) => ipcRenderer.invoke('streak-value', mode, n),
  hotkey: k => ipcRenderer.invoke('hotkey', k),
  checkHotkeyConflict: (accel, owner) => ipcRenderer.invoke('hotkey-conflict-check', accel, owner),
  setHotkeyInputGuard: active => ipcRenderer.invoke('hotkey-input-guard', !!active),
  edit: v => ipcRenderer.invoke('edit', v),
  saveBounds: () => ipcRenderer.invoke('save-bounds'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  copy: text => ipcRenderer.invoke('copy', text),
  dragStart: (key, mouse) => ipcRenderer.send('drag-start', key, mouse),
  dragMove: mouse => ipcRenderer.send('drag-move', mouse),
  dragEnd: () => ipcRenderer.send('drag-end'),
  resizeStart: (key, edge, mouse) => ipcRenderer.send('resize-start', key, edge, mouse),
  resizeMove: mouse => ipcRenderer.send('resize-move', mouse),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  onState: cb => ipcRenderer.on('state', (_, s) => cb(s)),
  onEdit: cb => ipcRenderer.on('edit', (_, v) => cb(v)),
  onDirty: cb => ipcRenderer.on('dirty', (_, v) => cb(v)),

  // WinStreak v2
  streakSetLocked: locked => ipcRenderer.invoke('streak-lock', !!locked),
  onStreakLock: cb => ipcRenderer.on('streak-lock-state', (_, v) => cb(!!v)),

  // 1v1 Timer API
  timerGet: () => ipcRenderer.invoke('timer-get'),
  timerPatch: patch => ipcRenderer.invoke('timer-patch', patch),
  timerAction: () => ipcRenderer.invoke('timer-action'),
  timerSwap: () => ipcRenderer.invoke('timer-swap'),
  timerScore: (player, delta) => ipcRenderer.invoke('timer-score', player, delta),
  timerReset: () => ipcRenderer.invoke('timer-reset'),
  timerHotkey: (which, accel) => ipcRenderer.invoke('timer-hotkey', which, accel),
  timerEdit: v => ipcRenderer.invoke('timer-edit', v),
  onTimerState: cb => ipcRenderer.on('timer-state', (_, s) => cb(s)),
  onTimerEdit: cb => ipcRenderer.on('timer-edit', (_, v) => cb(v))
});

// Keep the Timer injection untouched, then layer the WinStreak v2 controls on
// top of the legacy WinStreak page after the Timer tab is ready.
window.addEventListener('DOMContentLoaded', () => {
  try {
    if (!window.location.pathname.toLowerCase().endsWith('/app.html')) return;
    const addStreakV2 = () => {
      if (document.querySelector('script[data-streak-v2]')) return;
      const streak = document.createElement('script');
      streak.src = 'streak-ui-v2.js';
      streak.dataset.streakV2 = '1';
      document.body.appendChild(streak);
    };
    const timer = document.createElement('script');
    timer.src = 'timer-ui.js';
    timer.addEventListener('load', addStreakV2, { once: true });
    timer.addEventListener('error', addStreakV2, { once: true });
    document.body.appendChild(timer);
  } catch {}
});
