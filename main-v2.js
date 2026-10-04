const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const TIMER_PORT = 17385;
const TIMER_BASES = {
  0: { w: 248, h: 264 }, // Side Stack — redesigned compact vertical card
  1: { w: 258, h: 292 }, // Split Tower
  2: { w: 526, h: 110 }, // Center Beam — +5px per side for longer names
  3: { w: 530, h: 112 }, // Corner Rail — +5px per side for longer names
  4: { w: 526, h: 118 }, // Glass Wings
  5: { w: 544, h: 110 }  // Glass Ribbon — +5px per side for longer names
};
const TIMER_SCALE_UI = { min: 70, max: 100 };

const TIMER_DEF = {
  schema: 235,
  enabled: true,
  locked: true,
  x: 70,
  y: 360,
  scaleUi: 90,
  scale: 1,
  style: 2,
  player1: 'PLAYER 1',
  player2: 'PLAYER 2',
  score1: 0,
  score2: 0,
  active: 1,
  time1: 0,
  time2: 0,
  done1: false,
  done2: false,
  running: false,
  runningPlayer: 0,
  startedAt: 0,
  accent: '#3b82f6',
  accentMode: 'solid',
  backgroundColor: '#0d0e13',
  opacity: 1,
  textShadow: 20,
  hotkeyAction: 'F1',
  hotkeySwap: 'F2',
  hotkeyReset: 'F3',
  autoSwap: false,
  bestOf: 3,
  matchWinner: 0,
  celebrationWinner: 0,
  celebrationUntil: 0,
  celebrationIntroUntil: 0,
  celebrationPersistent: false,
  celebrationId: 0,
  victoryCooldownUntil: 0,
  audioEventId: 0,
  audioEventType: '',
  soundEnabled: true,
  victoryEffectEnabled: true,
  lastWinner: 0,
  lastDelta: 0,
  round: 1,
  language: 'pt'
};

let T = null;
let timerWin = null;
let timerServer = null;
let timerQuitting = false;
let registeredAction = '';
let registeredSwap = '';
let registeredReset = '';
let lastActionAt = 0;
let saveMoveTimer = null;
let timerWriteTimer = null;
let pendingRoundTimer = null;
const timerSseClients = new Set();
let uIOhook = null;
let mouseHookStarted = false;
const mouseShortcuts = new Map();
let hotkeyInputGuard = false;

function isMouseAccel(v) { return /^MOUSE[3-5]$/i.test(String(v || '').trim()); }
function normalizeMouseAccel(v) { const m=String(v||'').trim().toUpperCase(); return isMouseAccel(m)?m:''; }
function buttonToMouseAccel(button) {
  const b = Number(button);
  if (b === 3) return 'MOUSE3';
  if (b === 4) return 'MOUSE4';
  if (b === 5) return 'MOUSE5';
  return '';
}
function ensureMouseHook() {
  if (mouseHookStarted) return true;
  try {
    if (!uIOhook) ({ uIOhook } = require('uiohook-napi'));
    uIOhook.on('mousedown', e => {
      if (hotkeyInputGuard) return;
      const key = buttonToMouseAccel(e?.button);
      if (!key) return;
      for (const entry of mouseShortcuts.values()) {
        if (entry?.key === key) { try { entry.cb(); } catch {} }
      }
    });
    uIOhook.start();
    mouseHookStarted = true;
    return true;
  } catch { return false; }
}
function registerMouseShortcut(owner, accel, cb) {
  const key = normalizeMouseAccel(accel);
  mouseShortcuts.delete(owner);
  if (!key) return true;
  if (!ensureMouseHook()) return false;
  mouseShortcuts.set(owner, { key, cb });
  return true;
}
function unregisterMouseShortcut(owner) {
  mouseShortcuts.delete(owner);
  if (mouseHookStarted && mouseShortcuts.size === 0) {
    try { uIOhook?.stop(); } catch {}
    mouseHookStarted = false;
  }
}
function setHotkeyInputGuard(active) {
  hotkeyInputGuard = !!active;
  global.__dbdHotkeyCaptureActive = hotkeyInputGuard;
  return hotkeyInputGuard;
}
global.__dbdRegisterMouseShortcut = registerMouseShortcut;
global.__dbdUnregisterMouseShortcut = unregisterMouseShortcut;
global.__dbdIsMouseAccel = isMouseAccel;
global.__dbdHotkeyCaptureActive = false;

const rawUnregisterAll = globalShortcut.unregisterAll.bind(globalShortcut);
const rawUnregister = globalShortcut.unregister.bind(globalShortcut);

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }
function clampInt(v, min, max) { return Math.round(clamp(v, min, max)); }
function timerFile() { return path.join(app.getPath('userData'), 'timer-v200.json'); }
function legacySettingsFile() { return path.join(app.getPath('userData'), 'settings-v270.json'); }
function readLegacyLanguageOnce() {
  try {
    const saved = JSON.parse(fs.readFileSync(legacySettingsFile(), 'utf8'));
    return ['pt','en','es'].includes(saved?.language) ? saved.language : 'pt';
  } catch { return 'pt'; }
}
function timerSnapshot() { return { ...T }; }
function baseFor(style = T?.style ?? 2) { return TIMER_BASES[clampInt(style, 0, 5)] || TIMER_BASES[2]; }

// UI remains 70–100%. Beta 2.0.4 keeps the overlay slightly larger than the original baseline.
// 100% in the app maps to 1.10x; fresh installs start at 90%.
function scaleFactorFromUi(value) {
  const ui = clamp(Number(value) || 100, TIMER_SCALE_UI.min, TIMER_SCALE_UI.max);
  const previousScale = 0.78 + ((ui - 70) / 30) * 0.22;
  return previousScale * 1.10;
}

function migrateOldScale(oldScale) {
  const s = Number(oldScale);
  if (!Number.isFinite(s) || s <= 0) return 100;
  const previousScale = s / 1.10;
  return clampInt(70 + ((Math.min(1, previousScale) - 0.78) / 0.22) * 30, 70, 100);
}

function normalizeTimer() {
  if (!T) T = clone(TIMER_DEF);
  if (!Number.isFinite(Number(T.scaleUi))) T.scaleUi = migrateOldScale(T.scale);
  T.scaleUi = clampInt(T.scaleUi, TIMER_SCALE_UI.min, TIMER_SCALE_UI.max);
  T.scale = scaleFactorFromUi(T.scaleUi);
  T.style = clampInt(T.style, 0, 5);
  T.opacity = clamp(T.opacity, 0, 1);
  T.textShadow = Number.isFinite(Number(T.textShadow)) ? clampInt(T.textShadow, 0, 100) : 20;
  T.locked = !!T.locked;
  T.backgroundColor = /^#[0-9a-f]{6}$/i.test(String(T.backgroundColor || '')) ? T.backgroundColor : '#0d0e13';
  T.score1 = Math.max(0, Math.floor(Number(T.score1) || 0));
  T.score2 = Math.max(0, Math.floor(Number(T.score2) || 0));
  T.active = Number(T.active) === 2 ? 2 : 1;
  T.time1 = Math.max(0, Number(T.time1) || 0);
  T.time2 = Math.max(0, Number(T.time2) || 0);
  T.done1 = !!T.done1;
  T.done2 = !!T.done2;
  T.running = !!T.running;
  T.runningPlayer = T.running ? (Number(T.runningPlayer) === 2 ? 2 : 1) : 0;
  T.player1 = String(T.player1 ?? 'PLAYER 1').slice(0, 48);
  T.player2 = String(T.player2 ?? 'PLAYER 2').slice(0, 48);
  T.accent = /^#[0-9a-f]{6}$/i.test(String(T.accent || '')) ? T.accent : '#3b82f6';
  // Beta 2.0.1: Rainbow preset removed; keep one solid accent color.
  T.accentMode = 'solid';
  T.hotkeyAction = String(T.hotkeyAction || 'F1');
  T.hotkeySwap = String(T.hotkeySwap || 'F2');
  T.hotkeyReset = String(T.hotkeyReset || 'F3');
  T.autoSwap = !!T.autoSwap;
  T.bestOf = [1,3,5,7].includes(Number(T.bestOf)) ? Number(T.bestOf) : 3;
  T.matchWinner = [1,2].includes(Number(T.matchWinner)) ? Number(T.matchWinner) : 0;
  T.celebrationWinner = [1,2].includes(Number(T.celebrationWinner)) ? Number(T.celebrationWinner) : 0;
  T.celebrationUntil = Math.max(0, Number(T.celebrationUntil) || 0);
  T.celebrationIntroUntil = Math.max(0, Number(T.celebrationIntroUntil) || 0);
  T.celebrationPersistent = !!T.celebrationPersistent;
  T.celebrationId = Math.max(0, Math.floor(Number(T.celebrationId) || 0));
  T.victoryCooldownUntil = Math.max(0, Number(T.victoryCooldownUntil) || 0);
  T.audioEventId = Math.max(0, Math.floor(Number(T.audioEventId) || 0));
  T.audioEventType = ['start','stop','victory'].includes(String(T.audioEventType || '')) ? String(T.audioEventType) : '';
  T.soundEnabled = T.soundEnabled !== false;
  T.victoryEffectEnabled = T.victoryEffectEnabled !== false;
  T.language = ['pt','en','es'].includes(String(T.language || '')) ? String(T.language) : 'pt';
  T.schema = 235;
}

function loadTimer() {
  T = clone(TIMER_DEF);
  try {
    const saved = JSON.parse(fs.readFileSync(timerFile(), 'utf8'));
    if (saved && typeof saved === 'object') T = { ...T, ...saved };
  } catch {}
  T.running = false;
  T.runningPlayer = 0;
  T.startedAt = 0;
  T.language = readLegacyLanguageOnce();
  // Beta 2.0.7: every launch starts with the Timer visible and protected.
  T.enabled = true;
  T.locked = true;
  normalizeTimer();
}

function timerPayload() {
  normalizeTimer();
  return JSON.stringify(T, null, 2);
}
function writeTimerFile() {
  clearTimeout(timerWriteTimer);
  timerWriteTimer = null;
  const payload = timerPayload();
  try { fs.writeFile(timerFile(), payload, () => {}); } catch {}
}
function scheduleTimerWrite(delay = 140) {
  clearTimeout(timerWriteTimer);
  timerWriteTimer = setTimeout(writeTimerFile, delay);
}
function flushTimerFile() {
  clearTimeout(timerWriteTimer);
  timerWriteTimer = null;
  try { fs.writeFileSync(timerFile(), timerPayload()); } catch {}
}
function broadcastTimerSse(snapshot) {
  if (!timerSseClients.size) return;
  const packet = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of [...timerSseClients]) {
    try { res.write(packet); } catch { timerSseClients.delete(res); }
  }
}
function saveTimer() { scheduleTimerWrite(); pushTimer(); }

function pushTimer() {
  if (!T) return;
  const snapshot = timerSnapshot();
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return;
    try { w.webContents.send('timer-state', snapshot); } catch {}
  });
  broadcastTimerSse(snapshot);
}

function timerWindowSize() {
  const b = baseFor();
  return { width: Math.round(b.w * T.scale), height: Math.round(b.h * T.scale) };
}

function clampTimerToDisplay(rect) {
  const d = screen.getDisplayMatching(rect);
  const b = d.bounds;
  const width = Math.min(rect.width, b.width);
  const height = Math.min(rect.height, b.height);
  let x = Math.max(b.x, Math.min(rect.x, b.x + b.width - width));
  let y = Math.max(b.y, Math.min(rect.y, b.y + b.height - height));
  if (Math.abs(x - b.x) <= 10) x = b.x;
  if (Math.abs(y - b.y) <= 10) y = b.y;
  if (Math.abs((x + width) - (b.x + b.width)) <= 10) x = b.x + b.width - width;
  if (Math.abs((y + height) - (b.y + b.height)) <= 10) y = b.y + b.height - height;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function applyTimerGeometry(keepCenter = false) {
  if (!timerWin || timerWin.isDestroyed()) return;
  const old = timerWin.getBounds();
  const size = timerWindowSize();
  let x = Number.isFinite(+T.x) ? +T.x : old.x;
  let y = Number.isFinite(+T.y) ? +T.y : old.y;
  if (keepCenter) {
    x = Math.round(old.x + old.width / 2 - size.width / 2);
    y = Math.round(old.y + old.height / 2 - size.height / 2);
  }
  const next = clampTimerToDisplay({ x, y, ...size });
  timerWin.setBounds(next);
  try { timerWin.webContents.setZoomFactor(T.scale); } catch {}
  T.x = next.x;
  T.y = next.y;
}

function applyTimerInteractivity() {
  if (!timerWin || timerWin.isDestroyed() || !T) return;
  if (T.locked) {
    timerWin.setIgnoreMouseEvents(true);
    try { timerWin.setFocusable(false); } catch {}
  } else {
    timerWin.setIgnoreMouseEvents(false);
    try { timerWin.setFocusable(true); } catch {}
  }
  try { timerWin.webContents.send('timer-lock-state', !!T.locked); } catch {}
}

function timerVisibility() {
  if (!T) return;
  if (!timerWin || timerWin.isDestroyed()) {
    if (T.enabled && app.isReady() && !timerQuitting) createTimerWindow();
    return;
  }
  if (T.enabled) {
    try { if (timerWin.isMinimized()) timerWin.restore(); } catch {}
    try { timerWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    applyTimerInteractivity();
    // Always call showInactive, not only when isVisible() says false. This fixes
    // the hide -> show edge case seen on some Windows configurations.
    try { timerWin.showInactive(); } catch { try { timerWin.show(); } catch {} }
    try { timerWin.moveTop(); } catch {}
  } else {
    try { timerWin.hide(); } catch {}
  }
}

function createTimerWindow() {
  const size = timerWindowSize();
  timerWin = new BrowserWindow({
    title: 'DBD Overlay Studio — 1v1 Timer Overlay',
    x: T.x,
    y: T.y,
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });
  timerWin.setAlwaysOnTop(true, 'screen-saver');
  timerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The overlay itself is the drag handle while unlocked. Locked mode becomes fully click-through.
  applyTimerInteractivity();
  timerWin.loadFile('timer.html');
  timerWin.webContents.once('did-finish-load', () => {
    try { timerWin.webContents.setZoomFactor(T.scale); } catch {}
    pushTimer();
    applyTimerInteractivity();
    timerVisibility();
  });
  timerWin.on('move', () => {
    if (!timerWin || timerWin.isDestroyed() || !T) return;
    const [x, y] = timerWin.getPosition();
    T.x = x;
    T.y = y;
    clearTimeout(saveMoveTimer);
    saveMoveTimer = setTimeout(() => { scheduleTimerWrite(0); pushTimer(); }, 180);
  });
}

function startTimerServer() {
  timerServer = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      try { res.write(`data: ${JSON.stringify(timerSnapshot())}\n\n`); } catch {}
      timerSseClients.add(res);
      req.on('close', () => timerSseClients.delete(res));
      return;
    }
    if (url === '/state') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(timerSnapshot()));
    }
    const files = {
      '/obs-timer': ['obs-timer.html', 'text/html; charset=utf-8'],
      '/timer-render.js': ['timer-render.js', 'application/javascript; charset=utf-8'],
      '/timer-render.css': ['timer-render.css', 'text/css; charset=utf-8']
    };
    if (files[url]) {
      const [file, type] = files[url];
      try {
        const body = fs.readFileSync(path.join(__dirname, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        return res.end(body);
      } catch {
        res.writeHead(404); return res.end();
      }
    }
    res.writeHead(404); res.end();
  });
  timerServer.on('error', () => {});
  timerServer.listen(TIMER_PORT, '127.0.0.1');
}

function currentMs(player, now = Date.now()) {
  if (T.running && T.runningPlayer === player) return Math.max(0, now - T.startedAt);
  return player === 1 ? T.time1 : T.time2;
}

function setTimerAudioEvent(type) {
  if (!T.soundEnabled) return;
  T.audioEventType = ['start','stop','victory'].includes(type) ? type : '';
  T.audioEventId = (Number(T.audioEventId) || 0) + 1;
}

function startActiveTimer() {
  const p = T.active;
  const alreadyDone = p === 1 ? T.done1 : T.done2;
  if (alreadyDone) return false;
  if (p === 1) T.time1 = 0; else T.time2 = 0;
  T.running = true;
  T.runningPlayer = p;
  T.startedAt = Date.now();
  T.lastWinner = 0;
  T.lastDelta = 0;
  setTimerAudioEvent('start');
  saveTimer();
  return true;
}

function clearPendingRound() {
  if (pendingRoundTimer) {
    clearTimeout(pendingRoundTimer);
    pendingRoundTimer = null;
  }
}

function scheduleRoundResolution() {
  clearPendingRound();
  if (!T || T.running || T.matchWinner || !T.done1 || !T.done2) return;
  pendingRoundTimer = setTimeout(() => {
    pendingRoundTimer = null;
    if (!T || T.running || T.matchWinner || !T.done1 || !T.done2) return;
    resolveRound(true);
  }, 500);
}

function stopRunningTimer() {
  if (!T.running) return false;
  const p = T.runningPlayer;
  const elapsed = currentMs(p);
  if (p === 1) { T.time1 = elapsed; T.done1 = true; }
  else { T.time2 = elapsed; T.done2 = true; }
  T.running = false;
  T.runningPlayer = 0;
  T.startedAt = 0;
  if (T.autoSwap && !(T.done1 && T.done2)) T.active = p === 1 ? 2 : 1;
  setTimerAudioEvent('stop');
  saveTimer();
  if (T.done1 && T.done2) scheduleRoundResolution();
  return true;
}

function timerSeriesStarted() {
  return !!(
    T.running || T.done1 || T.done2 ||
    Number(T.time1) > 0 || Number(T.time2) > 0 ||
    Number(T.score1) > 0 || Number(T.score2) > 0 ||
    Number(T.matchWinner) > 0 || Number(T.round) > 1
  );
}

function winsNeeded() {
  return Math.floor((Number(T.bestOf) || 3) / 2) + 1;
}

function evaluateMatchWinner(triggerCelebration = false) {
  const need = winsNeeded();
  const s1 = Number(T.score1) || 0;
  const s2 = Number(T.score2) || 0;
  let winner = 0;
  if (s1 >= need && s1 > s2) winner = 1;
  else if (s2 >= need && s2 > s1) winner = 2;

  if (!winner) {
    T.matchWinner = 0;
    T.celebrationWinner = 0;
    T.celebrationUntil = 0;
    T.celebrationIntroUntil = 0;
    T.celebrationPersistent = false;
    return 0;
  }

  const changed = winner !== T.matchWinner;
  T.matchWinner = winner;
  T.active = winner;
  T.running = false;
  T.runningPlayer = 0;
  T.startedAt = 0;
  clearPendingRound();

  if (triggerCelebration && changed) {
    const now = Date.now();
    if (now >= Number(T.victoryCooldownUntil || 0)) {
      // Audio and visual effect are separate controls. The winner timer is replaced
      // by the victory label for 5 seconds, followed by a light 10-second afterglow.
      T.victoryCooldownUntil = now + 5000;
      setTimerAudioEvent('victory');
      if (T.victoryEffectEnabled !== false) {
        T.celebrationWinner = winner;
        T.celebrationIntroUntil = now + 5000;
        T.celebrationUntil = now + 20000;
        T.celebrationPersistent = false;
        T.celebrationId = (Number(T.celebrationId) || 0) + 1;
      } else {
        T.celebrationWinner = 0;
        T.celebrationIntroUntil = 0;
        T.celebrationUntil = 0;
        T.celebrationPersistent = false;
      }
    }
  }
  return winner;
}

function resolveRound(auto = false) {
  if (!T.done1 || !T.done2 || T.running || T.matchWinner) return false;
  const a = Number(T.time1) || 0;
  const b = Number(T.time2) || 0;
  let roundWinner = 0;
  if (a > b) { T.score1 += 1; T.lastWinner = 1; T.lastDelta = a - b; roundWinner = 1; }
  else if (b > a) { T.score2 += 1; T.lastWinner = 2; T.lastDelta = b - a; roundWinner = 2; }
  else { T.lastWinner = 3; T.lastDelta = 0; }

  const matchWinner = evaluateMatchWinner(true);
  if (matchWinner) {
    // Preserve the final times (including milliseconds in the app) until reset.
    T.done1 = true;
    T.done2 = true;
    T.active = matchWinner;
  } else {
    T.time1 = 0;
    T.time2 = 0;
    T.done1 = false;
    T.done2 = false;
    T.active = 1;
    T.round += 1;
  }
  saveTimer();
  return !!roundWinner || T.lastWinner === 3;
}

function timerAction() {
  const now = Date.now();
  const cooldown = T.autoSwap ? 2000 : 180;
  if (now - lastActionAt < cooldown) return T;
  lastActionAt = now;
  if (T.matchWinner) return T;
  if (T.running) stopRunningTimer();
  else if (T.done1 && T.done2) scheduleRoundResolution();
  else startActiveTimer();
  return T;
}

function timerSwap() {
  if (T.running || T.matchWinner) return T;
  T.active = T.active === 1 ? 2 : 1;
  saveTimer();
  return T;
}

function resetTimerMatch() {
  clearPendingRound();
  const keep = {
    enabled: T.enabled,
    x: T.x, y: T.y,
    scaleUi: T.scaleUi,
    style: T.style,
    player1: T.player1,
    player2: T.player2,
    accent: T.accent,
    accentMode: T.accentMode,
    backgroundColor: T.backgroundColor,
    opacity: T.opacity,
    textShadow: T.textShadow,
    locked: T.locked,
    hotkeyAction: T.hotkeyAction,
    hotkeySwap: T.hotkeySwap,
    hotkeyReset: T.hotkeyReset,
    soundEnabled: T.soundEnabled,
    victoryEffectEnabled: T.victoryEffectEnabled,
    autoSwap: T.autoSwap,
    bestOf: T.bestOf,
    victoryCooldownUntil: T.victoryCooldownUntil,
    language: T.language
  };
  T = { ...clone(TIMER_DEF), ...keep };
  T.active = 1;
  T.audioEventType = '';
  lastActionAt = 0;
  normalizeTimer();
  saveTimer();
  timerVisibility();
  return T;
}

function normalizeAccel(v) { return String(v || '').trim().toLowerCase(); }
function legacyWinStreakHotkey() {
  try {
    const saved = JSON.parse(fs.readFileSync(legacySettingsFile(), 'utf8'));
    return String(saved?.streak?.hotkey || '');
  } catch { return ''; }
}
function hotkeyConflict(accel, owner = '') {
  const wanted = normalizeAccel(accel);
  if (!wanted) return null;
  const candidates = [
    { owner: 'timer.action', key: T?.hotkeyAction || '', label: '1v1 Timer — Iniciar / Parar / Pontuar' },
    { owner: 'timer.swap', key: T?.hotkeySwap || '', label: '1v1 Timer — Trocar player' },
    { owner: 'timer.reset', key: T?.hotkeyReset || '', label: '1v1 Timer — Resetar partida' },
    { owner: 'streak.hotkey', key: legacyWinStreakHotkey(), label: 'WinStreak' }
  ];
  return candidates.find(c => c.owner !== owner && normalizeAccel(c.key) === wanted) || null;
}

global.__dbdCheckHotkeyConflict = hotkeyConflict;

function unregisterTimerHotkeys() {
  if (registeredAction && !isMouseAccel(registeredAction)) { try { rawUnregister(registeredAction); } catch {} }
  if (registeredSwap && registeredSwap !== registeredAction && !isMouseAccel(registeredSwap)) { try { rawUnregister(registeredSwap); } catch {} }
  if (registeredReset && registeredReset !== registeredAction && registeredReset !== registeredSwap && !isMouseAccel(registeredReset)) { try { rawUnregister(registeredReset); } catch {} }
  unregisterMouseShortcut('timer.action');
  unregisterMouseShortcut('timer.swap');
  unregisterMouseShortcut('timer.reset');
  registeredAction = '';
  registeredSwap = '';
  registeredReset = '';
}

function registerTimerHotkeys() {
  if (!app.isReady() || timerQuitting || !T) return { action: false, swap: false, reset: false };
  unregisterTimerHotkeys();
  let actionOk = true;
  let swapOk = true;
  let resetOk = true;
  if (T.hotkeyAction && !hotkeyConflict(T.hotkeyAction, 'timer.action')) {
    if (isMouseAccel(T.hotkeyAction)) actionOk = registerMouseShortcut('timer.action', T.hotkeyAction, () => { if (!hotkeyInputGuard) timerAction(); });
    else { try { actionOk = globalShortcut.register(T.hotkeyAction, () => { if (!hotkeyInputGuard) timerAction(); }); } catch { actionOk = false; } }
    if (actionOk) registeredAction = T.hotkeyAction;
  } else if (T.hotkeyAction) actionOk = false;
  if (T.hotkeySwap && !hotkeyConflict(T.hotkeySwap, 'timer.swap')) {
    if (isMouseAccel(T.hotkeySwap)) swapOk = registerMouseShortcut('timer.swap', T.hotkeySwap, () => { if (!hotkeyInputGuard) timerSwap(); });
    else { try { swapOk = globalShortcut.register(T.hotkeySwap, () => { if (!hotkeyInputGuard) timerSwap(); }); } catch { swapOk = false; } }
    if (swapOk) registeredSwap = T.hotkeySwap;
  } else if (T.hotkeySwap) swapOk = false;
  if (T.hotkeyReset && !hotkeyConflict(T.hotkeyReset, 'timer.reset')) {
    if (isMouseAccel(T.hotkeyReset)) resetOk = registerMouseShortcut('timer.reset', T.hotkeyReset, () => { if (!hotkeyInputGuard) resetTimerMatch(); });
    else { try { resetOk = globalShortcut.register(T.hotkeyReset, () => { if (!hotkeyInputGuard) resetTimerMatch(); }); } catch { resetOk = false; } }
    if (resetOk) registeredReset = T.hotkeyReset;
  } else if (T.hotkeyReset) resetOk = false;
  return { action: actionOk, swap: swapOk, reset: resetOk };
}

function setTimerHotkey(which, accel) {
  accel = String(accel || '');
  const map = { action: 'timer.action', swap: 'timer.swap', reset: 'timer.reset' };
  which = ['action','swap','reset'].includes(which) ? which : 'action';
  const owner = map[which];
  const conflict = hotkeyConflict(accel, owner);
  if (conflict && accel) return { ok: false, reason: 'internal', conflict: conflict.label, state: T };
  const prop = which === 'swap' ? 'hotkeySwap' : which === 'reset' ? 'hotkeyReset' : 'hotkeyAction';
  const old = T[prop];
  T[prop] = accel;
  const result = registerTimerHotkeys();
  const ok = result[which];
  if (!ok && accel) {
    T[prop] = old;
    registerTimerHotkeys();
    return { ok: false, reason: 'system', state: T };
  }
  saveTimer();
  return { ok: true, state: T };
}

// The legacy WinStreak module clears all Electron global shortcuts when its
// shortcut changes. Re-register the timer shortcuts immediately afterwards.
globalShortcut.unregisterAll = function patchedUnregisterAll() {
  rawUnregisterAll();
  registeredAction = '';
  registeredSwap = '';
  registeredReset = '';
  if (!timerQuitting && app.isReady()) setTimeout(() => registerTimerHotkeys(), 0);
};

app.on('before-quit', () => {
  timerQuitting = true;
  clearTimeout(saveMoveTimer);
  clearTimeout(timerWriteTimer);
  clearPendingRound();
  try { flushTimerFile(); } catch {}
  try { unregisterTimerHotkeys(); } catch {}
  for (const res of [...timerSseClients]) { try { res.end(); } catch {} }
  timerSseClients.clear();
  try { timerServer?.close(); } catch {}
});

// Keep WinStreak + Confronto intact while the new Timer is tested.
require('./main.js');

// WinStreak v2: direct lock/click-through control without changing the legacy
// Confronto module. The new Streak UI persists `streak.locked` through main.js
// and calls this bridge to apply it to the actual transparent overlay window.
function findStreakOverlayWindow() {
  return BrowserWindow.getAllWindows().find(w => {
    if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return false;
    try {
      const u = decodeURIComponent(w.webContents.getURL() || '');
      return /(?:^|\/)streak\.html(?:$|[?#])/i.test(u);
    } catch { return false; }
  }) || null;
}
function applyStreakOverlayLock(locked) {
  const w = findStreakOverlayWindow();
  if (!w) return false;
  const isLocked = locked !== false;
  try { w.setIgnoreMouseEvents(isLocked); } catch {}
  try { w.setFocusable(!isLocked); } catch {}
  try { w.webContents.send('streak-lock-state', isLocked); } catch {}
  return true;
}
ipcMain.handle('streak-lock', (_, locked) => applyStreakOverlayLock(!!locked));

ipcMain.handle('hotkey-conflict-check', (_, accel, owner) => {
  const c = hotkeyConflict(accel, String(owner || ''));
  return c ? { conflict: true, label: c.label } : { conflict: false };
});
ipcMain.handle('hotkey-input-guard', (_, active) => setHotkeyInputGuard(active));
ipcMain.handle('timer-get', () => ({ state: timerSnapshot(), url: `http://127.0.0.1:${TIMER_PORT}/obs-timer`, editing: false }));
ipcMain.handle('timer-patch', (_, patch) => {
  const prevStyle = T.style;
  const prevScaleUi = T.scaleUi;
  let nextPatch = { ...(patch || {}) };
  const lockChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'locked');
  const enabledChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'enabled');
  const victoryFxChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'victoryEffectEnabled');
  let bestOfChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'bestOf');
  if (bestOfChanged) {
    const requestedBestOf = Number(nextPatch.bestOf);
    const changingFormat = requestedBestOf !== Number(T.bestOf);
    if (changingFormat && timerSeriesStarted()) {
      delete nextPatch.bestOf;
      bestOfChanged = false;
    }
  }
  T = { ...T, ...nextPatch };
  normalizeTimer();
  if (victoryFxChanged && T.victoryEffectEnabled === false) {
    T.celebrationWinner = 0;
    T.celebrationIntroUntil = 0;
    T.celebrationUntil = 0;
    T.celebrationPersistent = false;
  }
  if (bestOfChanged) evaluateMatchWinner(false);
  if (T.style !== prevStyle || T.scaleUi !== prevScaleUi) applyTimerGeometry(true);
  if (lockChanged) applyTimerInteractivity();
  saveTimer();
  if (enabledChanged) timerVisibility();
  return timerSnapshot();
});
ipcMain.handle('timer-action', () => timerAction());
ipcMain.handle('timer-swap', () => timerSwap());
ipcMain.handle('timer-score', (_, player, delta) => {
  const key = Number(player) === 2 ? 'score2' : 'score1';
  const d = Number(delta) || 0;
  // Anti-spam protection after a series victory. Minus/corrections stay available.
  if (d > 0 && Date.now() < Number(T.victoryCooldownUntil || 0)) {
    pushTimer();
    return timerSnapshot();
  }
  T[key] = Math.max(0, (Number(T[key]) || 0) + d);
  evaluateMatchWinner(d > 0);
  saveTimer();
  return timerSnapshot();
});
ipcMain.handle('timer-reset', () => resetTimerMatch());
ipcMain.handle('timer-hotkey', (_, which, accel) => setTimerHotkey(['action','swap','reset'].includes(which) ? which : 'action', accel));
// Kept only for compatibility with the first Timer test; position editing is now direct.
ipcMain.handle('timer-edit', () => T);

app.whenReady().then(() => {
  loadTimer();
  createTimerWindow();
  startTimerServer();
  registerTimerHotkeys();
  setTimeout(pushTimer, 400);
});
