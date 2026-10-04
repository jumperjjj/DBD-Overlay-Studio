const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 17384;
const STREAK_BASE_VISUAL = { w: 400, h: 230 };
const STREAK_BASE_COMPACT = { w: 266, h: 230 };
const MATCH_BASE = { w: 640, h: 200 };
const MATCH_VERTICAL_BASE = { w: 320, h: 360 };
const KILLER_GUTTER = 120;
const SCALE_LIMITS = {
  streak: { min: 0.60, max: 1.40 },
  match: { min: 0.60, max: 1.30 }
};

let ui, streakWin, matchWin, streakGuide, matchGuide, tray, server;
let quitting = false;
let editing = false;
let lastHotkey = 0;
let streakIncrementTimer = null;
let streakIncrementCommitTimer = null;
let streakPulseSeq = 0;
let dragSession = null;
let resizeSession = null;
const directMoveSaveTimers = { streak: null, match: null };

const DEF = {
  schema: 282,
  language: 'pt',
  uiTheme: 'dark',
  uiSize: 'standard',
  quickPalette: true,
  streak: {
    enabled: false, x: 40, y: 40, scale: 0.8,
    style: 0, title: 'WIN STREAK', value: 0,
    streakV3: 1, mode: 'killer', customText: '', survivorStreakText: 'WIN STREAK', killerImage: '', survivorImage: '', survivorVisual: false,
    killerStreaks: {}, killerRecords: {}, survivorValue: 0, survivorRecord: 0,
    nameColor: '#ffffff', valueColor: '#d7b84a', accent: '#f97316', bg1: '#0d1118',
    opacity: 1, nameSize: 18, valueSize: 36, nameX: 0, valueX: 0,
    bold: true, shadow: true, glow: 70,
    fontName: 'Segoe UI', fontValue: 'Impact', hotkey: '',
    recordShow: false, recordTitle: 'RECORD', recordValue: 0,
    recordNameColor: '#ffffff', recordValueColor: '#d7b84a', recordBg: '#15191f', recordAccent: '#d7b84a', recordX: 0, recordY: 0,
    record2Show: false, record2Title: 'OPCIONAL', record2Value: 0,
    record2NameColor: '#ffffff', record2ValueColor: '#d7b84a', record2Bg: '#15191f', record2Accent: '#d7b84a', record2X: 0, record2Y: 25
  },
  match: {
    enabled: false, x: 500, y: 55, scale: 1,
    style: 0,
    teamA: 'TIME A', teamB: 'TIME B', scoreA: 0, scoreB: 0,
    colorA: '#3b82f6', colorB: '#22c55e',
    setText: 'CAMPEONATO', showSetText: true, setTextSize: 9, footerShow: true, footer: 'SET / MAP', footerCenter: false,
    bg: '#15181d', panel: '#282c31', text: '#ffffff', killerBg: '#0b0e14',
    setColor: '#d7dce5', scoreSepColor: '#f2f2f2', footerColor: '#f2f2f2', footerBg: '#15181d',
    fontName: 'Segoe UI', fontNumber: 'Segoe UI', fontSet: 'Segoe UI', glow: 20,
    edgeBorder: false,
    killerImage: '', killerName: '', showKillerName: true, killerLeft: true,
    rows: [
      { show: true, label: 'INFO 1', text: '', color: '#3b82f6', textColor: '#ffffff' },
      { show: true, label: 'INFO 2', text: '', color: '#22c55e', textColor: '#ffffff' },
      { show: false, label: 'INFO 3', text: '', color: '#f0b84b', textColor: '#ffffff' },
      { show: false, label: 'INFO 4', text: '', color: '#4bb7f0', textColor: '#ffffff' }
    ]
  }
};

let S;
const settingsFile = () => path.join(app.getPath('userData'), 'settings-v270.json');
const killerDir = () => path.join(__dirname, 'killers');
const survivorDir = () => path.join(__dirname, 'Survivors');
const clone = x => JSON.parse(JSON.stringify(x));

function loadState() {
  S = clone(DEF);
  let loadedSchema = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (saved && typeof saved === 'object') {
      const savedSchema = Number(saved.schema) || 0;
      loadedSchema = savedSchema;
      S.language = ['pt','en','es'].includes(saved.language) ? saved.language : 'pt';
      S.uiTheme = ['dark','light','midnight','violet'].includes(saved.uiTheme) ? saved.uiTheme : 'dark';
      S.uiSize = ['compact','standard','large'].includes(saved.uiSize) ? saved.uiSize : 'standard';
      S.quickPalette = savedSchema < 275 ? true : saved.quickPalette !== false;
      if (saved.streak) S.streak = { ...S.streak, ...saved.streak };
      if (saved.match) S.match = { ...S.match, ...saved.match };
      if (Array.isArray(saved.match?.rows)) {
        S.match.rows = DEF.match.rows.map((r, i) => ({ ...r, ...(saved.match.rows[i] || {}) }));
      }
      if (savedSchema < 272 && Number(S.streak.record2Y) === 0) S.streak.record2Y = 25;
      S.schema = 282;
    }
  } catch {}
  normalizeState();
  // WinStreak V3.1: migrate the current streak from the old single value into the selected bucket once.
  if (loadedSchema < 281) {
    const legacyValue = Math.max(0, Math.floor(Number(S.streak.value) || 0));
    if (S.streak.mode === 'survivor') S.streak.survivorValue = legacyValue;
    else if (S.streak.killerImage) S.streak.killerStreaks = { ...(S.streak.killerStreaks || {}), [S.streak.killerImage]: legacyValue };
  }
  syncCurrentStreakBucket();
  localizeDefaultMatchText();
  // Beta 2.0.0: Timer is the default module; legacy overlays start hidden.
  S.streak.enabled = false;
  S.match.enabled = false;
}

function localizeDefaultMatchText(){
  const aDefaults=['TIME A','TEAM A','EQUIPO A'], bDefaults=['TIME B','TEAM B','EQUIPO B'], topDefaults=['CAMPEONATO','CHAMPIONSHIP'];
  if(aDefaults.includes(S.match.teamA)) S.match.teamA=S.language==='en'?'TEAM A':S.language==='es'?'EQUIPO A':'TIME A';
  if(bDefaults.includes(S.match.teamB)) S.match.teamB=S.language==='en'?'TEAM B':S.language==='es'?'EQUIPO B':'TIME B';
  if(topDefaults.includes(S.match.setText)) S.match.setText=S.language==='en'?'CHAMPIONSHIP':'CAMPEONATO';
}

function normalizeState() {
  S.streak.scale = clamp(Number(S.streak.scale) || 1, SCALE_LIMITS.streak.min, SCALE_LIMITS.streak.max);
  S.match.scale = clamp(Number(S.match.scale) || 1, SCALE_LIMITS.match.min, SCALE_LIMITS.match.max);
  S.match.killerBg = /^#/.test(S.match.killerBg||'') ? S.match.killerBg : '#0b0e14';
  S.match.rows = (S.match.rows||[]).map((r,i)=>({ ...DEF.match.rows[i], ...r, textColor: /^#/.test(r?.textColor||'') ? r.textColor : '#ffffff' }));
  S.streak.value = Math.max(0, Math.floor(Number(S.streak.value) || 0));
  S.streak.recordValue = Math.max(0, Math.floor(Number(S.streak.recordValue) || 0));
  S.streak.record2Value = Math.max(0, Math.floor(Number(S.streak.record2Value) || 0));
  S.streak.style = clampInt(S.streak.style, 0, 3);
  S.streak.mode = S.streak.mode === 'survivor' ? 'survivor' : 'killer';
  S.streak.customText = String(S.streak.customText || '').slice(0, 32);
  S.streak.survivorStreakText = String(S.streak.survivorStreakText || 'WIN STREAK').slice(0, 24);
  S.streak.killerImage = String(S.streak.killerImage || '');
  S.streak.survivorImage = String(S.streak.survivorImage || '');
  S.streak.survivorVisual = !!S.streak.survivorVisual;
  S.streak.killerStreaks = S.streak.killerStreaks && typeof S.streak.killerStreaks === 'object' && !Array.isArray(S.streak.killerStreaks) ? S.streak.killerStreaks : {};
  S.streak.killerRecords = S.streak.killerRecords && typeof S.streak.killerRecords === 'object' && !Array.isArray(S.streak.killerRecords) ? S.streak.killerRecords : {};
  S.streak.survivorValue = Math.max(0, Math.floor(Number(S.streak.survivorValue) || 0));
  S.streak.survivorRecord = Math.max(0, Math.floor(Number(S.streak.survivorRecord) || 0));
  S.streak.opacity = clamp(Number(S.streak.opacity ?? 1), 0, 1);
  S.streak.glow = clampInt(S.streak.glow ?? 20, 0, 100);
  S.streak.accent = /^#[0-9a-f]{6}$/i.test(String(S.streak.accent || '')) ? S.streak.accent : '#f97316';
  S.streak.bg1 = /^#[0-9a-f]{6}$/i.test(String(S.streak.bg1 || '')) ? S.streak.bg1 : '#0d1118';
  S.match.style = clampInt(S.match.style, 0, 15);
  if (S.match.style === 12) S.match.style = 14;
  if (!['dark','light','midnight','violet'].includes(S.uiTheme)) S.uiTheme = 'dark';
  if (!['compact','standard','large'].includes(S.uiSize)) S.uiSize = 'standard';
  S.quickPalette = !!S.quickPalette;
  S.match.setTextSize = clampInt(S.match.setTextSize ?? 9, 8, 16);
  S.match.showSetText = S.match.showSetText !== false;
  S.match.scoreA = Math.max(0, Number(S.match.scoreA) || 0);
  S.match.scoreB = Math.max(0, Number(S.match.scoreB) || 0);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function clampInt(v, min, max) { return Math.round(clamp(Number(v) || 0, min, max)); }
function saveState() {
  try {
    const persisted = clone(S);
    if (persisted.streak) {
      delete persisted.streak.pulsePending;
      delete persisted.streak.pulseId;
      delete persisted.streak.pulseDelta;
      delete persisted.streak.pulseStartedAt;
    }
    fs.writeFileSync(settingsFile(), JSON.stringify(persisted, null, 2));
  } catch {}
  pushState();
}
function pushState() {
  [ui, streakWin, matchWin].forEach(w => {
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('state', S);
  });
}
function killerFiles() {
  try { return fs.readdirSync(killerDir()).filter(x => /\.(png|jpe?g|webp)$/i.test(x)).sort(); }
  catch { return []; }
}
function survivorFiles() {
  try { return fs.readdirSync(survivorDir()).filter(x => /\.(png|jpe?g|webp)$/i.test(x)).sort(); }
  catch { return []; }
}
function currentStreakValue() {
  if (S.streak.mode === 'survivor') return Math.max(0, Math.floor(Number(S.streak.survivorValue) || 0));
  const file = String(S.streak.killerImage || '');
  const map = S.streak.killerStreaks && typeof S.streak.killerStreaks === 'object' ? S.streak.killerStreaks : {};
  return file ? Math.max(0, Math.floor(Number(map[file]) || 0)) : 0;
}
function setCurrentStreakValue(value) {
  const v = Math.max(0, Math.floor(Number(value) || 0));
  if (S.streak.mode === 'survivor') {
    S.streak.survivorValue = v;
  } else {
    const file = String(S.streak.killerImage || '');
    if (file) {
      const map = { ...(S.streak.killerStreaks || {}) };
      map[file] = v;
      S.streak.killerStreaks = map;
    }
  }
  S.streak.value = v;
  return v;
}
function currentStreakRecord() {
  if (S.streak.mode === 'survivor') return Math.max(0, Math.floor(Number(S.streak.survivorRecord) || 0));
  const file = String(S.streak.killerImage || '');
  const map = S.streak.killerRecords && typeof S.streak.killerRecords === 'object' ? S.streak.killerRecords : {};
  return file ? Math.max(0, Math.floor(Number(map[file]) || 0)) : 0;
}
function setCurrentStreakRecord(value) {
  const v = Math.max(0, Math.floor(Number(value) || 0));
  if (S.streak.mode === 'survivor') {
    S.streak.survivorRecord = v;
  } else {
    const file = String(S.streak.killerImage || '');
    if (file) {
      const map = { ...(S.streak.killerRecords || {}) };
      map[file] = v;
      S.streak.killerRecords = map;
    }
  }
  S.streak.recordValue = v;
  return v;
}
function syncCurrentStreakBucket() {
  S.streak.value = currentStreakValue();
  S.streak.recordValue = currentStreakRecord();
}
function updateRecordFromStreak() {
  const value = currentStreakValue();
  S.streak.value = value;
  const record = currentStreakRecord();
  if (value > record) setCurrentStreakRecord(value);
  else S.streak.recordValue = record;
}

function commitStreakPlus(target) {
  if (target.mode === 'survivor') {
    const next = Math.max(0, Math.floor(Number(S.streak.survivorValue) || 0)) + 1;
    S.streak.survivorValue = next;
    if (next > Math.max(0, Math.floor(Number(S.streak.survivorRecord) || 0))) S.streak.survivorRecord = next;
  } else if (target.killerImage) {
    const values = { ...(S.streak.killerStreaks || {}) };
    const records = { ...(S.streak.killerRecords || {}) };
    const next = Math.max(0, Math.floor(Number(values[target.killerImage]) || 0)) + 1;
    values[target.killerImage] = next;
    if (next > Math.max(0, Math.floor(Number(records[target.killerImage]) || 0))) records[target.killerImage] = next;
    S.streak.killerStreaks = values;
    S.streak.killerRecords = records;
  } else {
    S.streak.value = Math.max(0, Math.floor(Number(S.streak.value) || 0)) + 1;
    S.streak.recordValue = Math.max(S.streak.recordValue || 0, S.streak.value);
  }
  syncCurrentStreakBucket();
  // Keep pulsePending true: the +1 is still fading out and controls remain locked.
  saveState();
}

function beginStreakPlusPulse() {
  if (S.streak.pulsePending) return false;
  const target = { mode: S.streak.mode === 'survivor' ? 'survivor' : 'killer', killerImage: String(S.streak.killerImage || '') };
  S.streak.pulsePending = true;
  S.streak.pulseId = ++streakPulseSeq;
  S.streak.pulseDelta = 1;
  S.streak.pulseStartedAt = Date.now();
  pushState();
  clearTimeout(streakIncrementCommitTimer);
  clearTimeout(streakIncrementTimer);
  // Commit while +1 is already fading, but before the real value is allowed to fade back in.
  // This avoids ever showing the old value changing into the new one on screen.
  streakIncrementCommitTimer = setTimeout(() => commitStreakPlus(target), 2150);
  // Keep the full 3 second input lock so the animation cannot be interrupted.
  streakIncrementTimer = setTimeout(() => {
    S.streak.pulsePending = false;
    S.streak.pulseDelta = 0;
    S.streak.pulseStartedAt = 0;
    syncCurrentStreakBucket();
    saveState();
  }, 3000);
  return true;
}

function matchTitleSpace() {
  if (S.match.showSetText === false) return 0;
  const fs = clampInt(S.match.setTextSize ?? 9, 8, 16);
  const titleH = Math.max(24, fs + 14);
  return titleH + 2;
}
function isVerticalMatch() { return Number(S.match.style) >= 10; }
function logicalBase(key) {
  if (key === 'streak') {
    const compact = S.streak.mode === 'survivor' && S.streak.survivorVisual !== true;
    return compact ? STREAK_BASE_COMPACT : STREAK_BASE_VISUAL;
  }
  const base = isVerticalMatch() ? MATCH_VERTICAL_BASE : MATCH_BASE;
  return { w: base.w + (S.match.killerImage ? KILLER_GUTTER : 0), h: base.h + matchTitleSpace() };
}
function scaleFor(key) { return S[key].scale; }
function windowSize(key) {
  const b = logicalBase(key), sc = scaleFor(key);
  return { width: Math.round(b.w * sc), height: Math.round(b.h * sc) };
}
function windowFor(key) { return key === 'streak' ? streakWin : matchWin; }
function guideFor(key) { return key === 'streak' ? streakGuide : matchGuide; }

function clampToDisplay(rect) {
  const d = screen.getDisplayMatching(rect);
  const b = d.bounds;
  const width = Math.min(rect.width, b.width);
  const height = Math.min(rect.height, b.height);
  let x = clamp(rect.x, b.x, b.x + b.width - width);
  let y = clamp(rect.y, b.y, b.y + b.height - height);
  const snap = 10;
  if (Math.abs(x - b.x) <= snap) x = b.x;
  if (Math.abs((x + width) - (b.x + b.width)) <= snap) x = b.x + b.width - width;
  if (Math.abs(y - b.y) <= snap) y = b.y;
  if (Math.abs((y + height) - (b.y + b.height)) <= snap) y = b.y + b.height - height;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function applyWindowGeometry(key, keepCenter = false) {
  const w = windowFor(key);
  if (!w || w.isDestroyed()) return;
  const old = w.getBounds();
  const size = windowSize(key);
  let x = S[key].x ?? old.x, y = S[key].y ?? old.y;
  if (keepCenter) {
    x = Math.round(old.x + old.width / 2 - size.width / 2);
    y = Math.round(old.y + old.height / 2 - size.height / 2);
  }
  const b = clampToDisplay({ x, y, ...size });
  w.setBounds(b);
  // Window size scales; zoom makes the renderer keep stable logical dimensions.
  try { w.webContents.setZoomFactor(S[key].scale); } catch {}
  S[key].x = b.x; S[key].y = b.y;
  syncGuide(key);
}


function applyStreakSideGrowth(oldBounds) {
  const w = streakWin;
  if (!w || w.isDestroyed()) return;
  const size = windowSize('streak');
  const old = oldBounds || w.getBounds();
  // Survivor without image is the compact right-hand card. Enabling the image adds only the left visual section.
  const x = Math.round(old.x + old.width - size.width);
  const y = S.streak.y ?? old.y;
  const b = clampToDisplay({ x, y, ...size });
  w.setBounds(b);
  try { w.webContents.setZoomFactor(S.streak.scale); } catch {}
  S.streak.x = b.x; S.streak.y = b.y;
  syncGuide('streak');
}

function applyMatchTopGrowth(oldBounds) {
  const w = matchWin;
  if (!w || w.isDestroyed()) return;
  const size = windowSize('match');
  const old = oldBounds || w.getBounds();
  const x = S.match.x ?? old.x;
  const y = Math.round(old.y + old.height - size.height);
  const b = clampToDisplay({ x, y, ...size });
  w.setBounds(b);
  try { w.webContents.setZoomFactor(S.match.scale); } catch {}
  S.match.x = b.x; S.match.y = b.y;
  syncGuide('match');
}

function createOverlay(file, key) {
  const size = windowSize(key);
  const w = new BrowserWindow({
    x: S[key].x, y: S[key].y, width: size.width, height: size.height,
    show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: true, focusable: true, skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Beta 2.0.0: every local overlay can be dragged directly with the mouse.
  w.setIgnoreMouseEvents(false);
  w.loadFile(file);
  w.webContents.once('did-finish-load', () => {
    try { w.webContents.setZoomFactor(S[key].scale); } catch {}
    pushState();
    visibility();
  });
  w.on('move', () => {
    if (!w || w.isDestroyed() || !S?.[key]) return;
    const [x, y] = w.getPosition();
    S[key].x = x; S[key].y = y;
    clearTimeout(directMoveSaveTimers[key]);
    directMoveSaveTimers[key] = setTimeout(() => saveState(), 180);
  });
  return w;
}

function makeGuide() {
  const g = new BrowserWindow({
    show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#00000000'
  });
  g.setIgnoreMouseEvents(true);
  g.setAlwaysOnTop(true, 'screen-saver');
  const html = '<!doctype html><html><body style="margin:0;box-sizing:border-box;width:100vw;height:100vh;border:4px solid #ff2a2a;background:transparent"></body></html>';
  g.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return g;
}
function syncGuide(key) {
  if (!editing) return;
  const w = windowFor(key), g = guideFor(key);
  if (!w || w.isDestroyed() || !g || g.isDestroyed()) return;
  g.setBounds(w.getBounds());
  if (!g.isVisible()) g.showInactive();
  g.moveTop();
}

function safeVisible(w, show) {
  if (!w || w.isDestroyed()) return;
  if (show) { if (!w.isVisible()) w.showInactive(); w.moveTop(); }
  else if (w.isVisible()) w.hide();
}
function visibility() {
  if (editing) { safeVisible(streakWin, true); safeVisible(matchWin, true); return; }
  safeVisible(streakWin, S.streak.enabled);
  safeVisible(matchWin, S.match.enabled);
}
function setEdit(v) {
  editing = !!v;
  for (const key of ['streak','match']) {
    const w = windowFor(key), g = guideFor(key);
    if (!w || w.isDestroyed()) continue;
    if (editing) {
      w.setIgnoreMouseEvents(false);
      w.setFocusable(true);
      w.showInactive(); w.moveTop();
      if (g && !g.isDestroyed()) { g.setBounds(w.getBounds()); g.showInactive(); g.moveTop(); }
    } else {
      // Beta 2.0.0: every local overlay can be dragged directly with the mouse.
  w.setIgnoreMouseEvents(false);
      w.setFocusable(false);
      if (g && !g.isDestroyed()) g.hide();
    }
    w.webContents.send('edit', editing);
  }
  if (!editing) visibility();
  ui?.webContents.send('edit', editing);
}

const UI_SIZES = {
  compact: { width: 1020, height: 720 },
  standard: { width: 1120, height: 820 },
  large: { width: 1280, height: 900 }
};
function uiWindowSize() { return UI_SIZES[S.uiSize] || UI_SIZES.standard; }
function applyUIWindowSize() {
  if (!ui || ui.isDestroyed()) return;
  const next = uiWindowSize(), old = ui.getBounds();
  const area = screen.getDisplayMatching(old).workArea;
  const width = Math.min(next.width, area.width), height = Math.min(next.height, area.height);
  const x = Math.max(area.x, Math.min(old.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(old.y, area.y + area.height - height));
  ui.setBounds({ x, y, width, height });
}

function createUI() {
  const uiSize = uiWindowSize();
  ui = new BrowserWindow({
    width: uiSize.width, height: uiSize.height,
    resizable: false, maximizable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0d0f13',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  ui.setResizable(false);
  ui.setMaximizable(false);
  ui.setMenuBarVisibility(false);
  ui.loadFile('app.html');
  ui.on('close', e => { if (!quitting) { e.preventDefault(); ui.hide(); } });
}
function showMainWindow() {
  if (!ui || ui.isDestroyed()) return;
  if (ui.isMinimized()) ui.restore();
  ui.show();
  ui.focus();
}

function createAll() {
  createUI();
  streakWin = createOverlay('streak.html', 'streak');
  matchWin = createOverlay('match.html', 'match');
  streakGuide = makeGuide(); matchGuide = makeGuide();
  visibility();
  const trayPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon = nativeImage.createFromPath(trayPath);
  if (!trayIcon.isEmpty()) trayIcon = trayIcon.resize({ width: 20, height: 20, quality: 'best' });
  tray = new Tray(trayIcon);
  tray.setToolTip('DBD Overlay Studio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: showMainWindow },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showMainWindow);
}

function hotkey(k) {
  const next = String(k || '').trim();
  const conflict = next && global.__dbdCheckHotkeyConflict ? global.__dbdCheckHotkeyConflict(next, 'streak.hotkey') : null;
  if (conflict) return false;
  if (global.__dbdUnregisterMouseShortcut) global.__dbdUnregisterMouseShortcut('streak.hotkey');
  globalShortcut.unregisterAll();
  const action = () => {
    const now = Date.now();
    if (S.streak.pulsePending || now - lastHotkey < 1000) return;
    lastHotkey = now;
    beginStreakPlusPulse();
  };
  if (next) {
    if (global.__dbdIsMouseAccel?.(next)) {
      if (!global.__dbdRegisterMouseShortcut?.('streak.hotkey', next, action)) return false;
    } else {
      try { if (!globalShortcut.register(next, action)) return false; }
      catch { return false; }
    }
  }
  S.streak.hotkey = next;
  saveState();
  return true;
}

function resetStreak() {
  const keep = {
    x: S.streak.x, y: S.streak.y, enabled: S.streak.enabled, hotkey: S.streak.hotkey,
    killerStreaks: { ...(S.streak.killerStreaks || {}) }, killerRecords: { ...(S.streak.killerRecords || {}) },
    survivorValue: Math.max(0, Number(S.streak.survivorValue) || 0), survivorRecord: Math.max(0, Number(S.streak.survivorRecord) || 0)
  };
  S.streak = { ...clone(DEF.streak), ...keep };
  syncCurrentStreakBucket();
  applyWindowGeometry('streak', false);
  saveState();
}
function resetMatch() {
  const keep = { x: S.match.x, y: S.match.y, enabled: S.match.enabled };
  S.match = { ...clone(DEF.match), ...keep };
  localizeDefaultMatchText();
  applyWindowGeometry('match', false);
  saveState();
}

function startServer() {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/killer?')) {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const name = path.basename(u.searchParams.get('name') || '');
        const file = path.join(killerDir(), name);
        if (!name || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        const ext = path.extname(name).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      } catch { res.writeHead(400); return res.end(); }
    }
    if (req.url.startsWith('/survivor?')) {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const name = path.basename(u.searchParams.get('name') || '');
        const file = path.join(survivorDir(), name);
        if (!name || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        const ext = path.extname(name).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      } catch { res.writeHead(400); return res.end(); }
    }
    if (req.url === '/streak-render.css' || req.url === '/streak-render.js') {
      const file = path.join(__dirname, req.url.slice(1));
      const type = req.url.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    if (req.url.startsWith('/state')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(S));
    }
    const files = { '/overlay':'obs.html', '/obs-streak':'obs-streak.html', '/obs-match':'obs-match.html' };
    if (files[req.url]) {
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, files[req.url]), 'utf8'));
    }
    res.writeHead(404); res.end();
  }).listen(PORT, '127.0.0.1');
}

ipcMain.handle('get', () => ({ state: S, url: `http://127.0.0.1:${PORT}/overlay`, killers: killerFiles(), survivors: survivorFiles() }));
ipcMain.handle('patch', (_, section, patch) => {
  if (section === 'root') {
    S = { ...S, ...patch };
    normalizeState();
    if (Object.prototype.hasOwnProperty.call(patch, 'language')) localizeDefaultMatchText();
    if (Object.prototype.hasOwnProperty.call(patch, 'uiSize')) applyUIWindowSize();
  } else if (section === 'streak' || section === 'match') {
    const oldK = S.match.killerImage;
    const oldStreakBounds = section === 'streak' && streakWin && !streakWin.isDestroyed() ? streakWin.getBounds() : null;
    const oldMatchBounds = section === 'match' && matchWin && !matchWin.isDestroyed() ? matchWin.getBounds() : null;
    S[section] = { ...S[section], ...patch };
    normalizeState();
    if (section === 'streak') {
      const switchedBucket = Object.prototype.hasOwnProperty.call(patch, 'mode') || Object.prototype.hasOwnProperty.call(patch, 'killerImage');
      if (switchedBucket) syncCurrentStreakBucket();
      if (Object.prototype.hasOwnProperty.call(patch, 'value')) {
        setCurrentStreakValue(patch.value);
        updateRecordFromStreak();
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'recordValue') && !Object.prototype.hasOwnProperty.call(patch, 'killerRecords') && !Object.prototype.hasOwnProperty.call(patch, 'survivorRecord')) {
        setCurrentStreakRecord(patch.recordValue);
      }
      const layoutChanged = Object.prototype.hasOwnProperty.call(patch, 'mode') || Object.prototype.hasOwnProperty.call(patch, 'survivorVisual');
      if (layoutChanged) applyStreakSideGrowth(oldStreakBounds);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'scale')) applyWindowGeometry(section, false);
    if (section === 'match') {
      const killerChanged = Object.prototype.hasOwnProperty.call(patch, 'killerImage') && !!oldK !== !!S.match.killerImage;
      const styleChanged = Object.prototype.hasOwnProperty.call(patch, 'style');
      const topChanged = Object.prototype.hasOwnProperty.call(patch, 'setTextSize') || Object.prototype.hasOwnProperty.call(patch, 'showSetText');
      if (styleChanged || killerChanged) applyWindowGeometry('match', false);
      else if (topChanged) applyMatchTopGrowth(oldMatchBounds);
    }
  }
  saveState(); visibility(); return S;
});
ipcMain.handle('reset', (_, section) => { section === 'streak' ? resetStreak() : resetMatch(); return S; });
ipcMain.handle('streak-value', (_, mode, n) => {
  const delta = Number(n) || 0;
  if (mode === 'delta' && delta > 0) {
    beginStreakPlusPulse();
    return S;
  }
  if (S.streak.pulsePending) return S;
  let v = Math.max(0, Number(S.streak.value) || 0);
  if (mode === 'delta') v = Math.max(0, v + delta);
  else v = Math.max(0, Number(n) || 0);
  setCurrentStreakValue(Math.floor(v));
  updateRecordFromStreak();
  saveState(); return S;
});
ipcMain.handle('hotkey', (_, k) => hotkey(k));
ipcMain.handle('edit', (_, v) => { setEdit(v); return S; });
ipcMain.handle('save-bounds', () => { setEdit(false); saveState(); ui?.webContents.send('dirty', false); return S; });
ipcMain.handle('quit-app', () => { quitting = true; app.quit(); });
ipcMain.handle('copy', (_, text) => { clipboard.writeText(String(text || '')); return true; });

ipcMain.on('drag-start', (_, key, mouse) => {
  if (!editing) return;
  const w = windowFor(key); if (!w || w.isDestroyed()) return;
  dragSession = { key, w, start: w.getBounds(), mx: mouse.x, my: mouse.y };
});
ipcMain.on('drag-move', (_, mouse) => {
  const z = dragSession; if (!z || !editing) return;
  const x = z.start.x + mouse.x - z.mx, y = z.start.y + mouse.y - z.my;
  const b = clampToDisplay({ x, y, width: z.start.width, height: z.start.height });
  z.w.setPosition(b.x, b.y); S[z.key].x = b.x; S[z.key].y = b.y; syncGuide(z.key);
  ui?.webContents.send('dirty', true);
});
ipcMain.on('drag-end', () => { dragSession = null; });

ipcMain.on('resize-start', (_, key, edge, mouse) => {
  if (!editing) return;
  const w = windowFor(key); if (!w || w.isDestroyed()) return;
  resizeSession = { key, edge, w, start: w.getBounds(), mx: mouse.x, my: mouse.y, startScale: S[key].scale };
});
ipcMain.on('resize-move', (_, mouse) => {
  const z = resizeSession; if (!z || !editing) return;
  const base = logicalBase(z.key);
  const dx = mouse.x - z.mx, dy = mouse.y - z.my;
  const dw = z.edge.includes('w') ? -dx : dx;
  const dh = z.edge.includes('n') ? -dy : dy;
  const desired = Math.max((z.start.width + dw) / base.w, (z.start.height + dh) / base.h);
  const lim = SCALE_LIMITS[z.key];
  S[z.key].scale = clamp(desired, lim.min, lim.max);
  let x = z.start.x, y = z.start.y;
  const size = windowSize(z.key);
  if (z.edge.includes('w')) x = z.start.x + z.start.width - size.width;
  if (z.edge.includes('n')) y = z.start.y + z.start.height - size.height;
  const b = clampToDisplay({ x, y, ...size });
  z.w.setBounds(b); try { z.w.webContents.setZoomFactor(S[z.key].scale); } catch {}
  S[z.key].x = b.x; S[z.key].y = b.y; syncGuide(z.key); pushState();
  ui?.webContents.send('dirty', true);
});
ipcMain.on('resize-end', () => { resizeSession = null; saveState(); });

app.setAppUserModelId('com.saranked.dbdoverlaymapwinstreak');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
    const options = {
      type: 'info',
      title: 'DBD Overlay Studio',
      message: 'O aplicativo já está aberto.',
      detail: 'A janela que já estava em execução foi trazida para frente.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true
    };
    if (ui && !ui.isDestroyed()) dialog.showMessageBox(ui, options).catch(() => {});
    else dialog.showMessageBox(options).catch(() => {});
  });

  app.whenReady().then(() => {
    loadState(); startServer(); createAll(); if (S.streak.hotkey) hotkey(S.streak.hotkey); setTimeout(pushState, 300);
  });
}
app.on('before-quit', () => { quitting = true; clearTimeout(streakIncrementCommitTimer); clearTimeout(streakIncrementTimer); clearTimeout(directMoveSaveTimers.streak); clearTimeout(directMoveSaveTimers.match); globalShortcut.unregisterAll(); server?.close(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
