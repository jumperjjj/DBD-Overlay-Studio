const path = require('path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { GameDatabase } = require('./database');
const { FishingEngine } = require('./fishing-engine');
const { LocalServer } = require('./local-server');
const { TwitchClient } = require('./twitch-client');
const {reply:queryReply}=require('./chat-commands');
const {prepareFirstRelease}=require('./first-release');

let mainWindow;
let db;
let server;
let engine;
let twitch;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 840,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0b1117',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadURL('http://127.0.0.1:8766/index.html');
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes && rest) return `${minutes} min ${rest} s`;
  if (minutes) return `${minutes} min`;
  return `${rest} s`;
}

function renderTemplate(template, values) {
  const source = String(template || '');
  return source.replace(/\{(user|item|raridade|ouro|ouro_total|pescarias|tempo)\}/gi, (_match, key) => {
    const normalized = key.toLowerCase();
    return values[normalized] ?? '';
  }).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function resultMessage(result, settings) {
  const template = String(result.item.message_template || '').trim() || (result.item.isCursed?settings.chat_cursed_template:settings.chat_result_template);
  return renderTemplate(template, {
    user: result.user.login || result.user.displayName,
    item: result.item.name,
    raridade: result.item.rarity,
    ouro: Math.abs(Number(result.item.goldAwarded || 0)).toLocaleString('pt-BR'),
    ouro_total: Number(result.player.gold || 0).toLocaleString('pt-BR'),
    pescarias: Number(result.player.totalCatches || 0).toLocaleString('pt-BR'),
    tempo: ''
  });
}

function cooldownMessage(user, remainingSeconds, settings) {
  return renderTemplate(settings.chat_cooldown_template, {
    user: user.login || user.displayName,
    item: '',
    raridade: '',
    ouro: '',
    ouro_total: '',
    pescarias: '',
    tempo: formatDuration(remainingSeconds)
  });
}

async function safeSendChat(message) {
  if (!message || !twitch?.isConnected()) return;
  try {
    await twitch.sendChatMessage(message);
    server.broadcast({ type: 'bot:sent', message });
  } catch (error) {
    server.broadcast({ type: 'twitch:error', message: error.message || String(error) });
  }
}

async function bootstrap() {
  db = new GameDatabase(app.getPath('userData'));
  prepareFirstRelease(db);
  server = new LocalServer({ database: db, port: 8766 });
  engine = new FishingEngine(db, (data) => server.broadcast(data));
  twitch = new TwitchClient(db);
  server.setEngine(engine);
  server.setTwitch(twitch);
  engine.onResult = async result => {
    const settings = db.getSettings();
    if (settings.chat_result_enabled !== '0') await safeSendChat(resultMessage(result, settings));
  };

  twitch.on('chatMessage', async ({ text, user }) => {
    try {
    const settings = db.getSettings();
    const query=queryReply(db,server.events,settings.active_channel_id,user,text);
    if(query!==null){await safeSendChat(query);return;}
    const command = String(settings.command || '!pescar').trim().toLowerCase();
    if (text.trim().toLowerCase() !== command) return;

    const result = await engine.fish({
      channelId: settings.active_channel_id,
      user
    });

    if (!result.ok && result.reason === 'cooldown') {
      server.broadcast({ type: 'fishing:cooldown', user, remainingSeconds: result.remainingSeconds });
      if (settings.chat_cooldown_enabled !== '0') {
        const message = result.pending && result.remainingSeconds === 0
          ? renderTemplate(settings.chat_pending_template || '@{user}, sua pescaria ainda está na fila ou em exibição. Aguarde o resultado!', { user: user.login || user.displayName })
          : cooldownMessage(user, result.remainingSeconds, settings);
        await safeSendChat(message);
      }
      return;
    }

    if (!result.ok && (result.reason === 'invalid_chance_total' || result.reason === 'no_items')) {
      server.broadcast({
        type: 'fishing:error',
        message: result.reason === 'no_items' ? 'Cadastre itens antes de pescar.' : `Configure pelo menos um item com chance maior que zero.`
      });
      return;
    }
    } catch (error) {
      server.broadcast({ type: 'fishing:error', message: error.message || String(error) });
    }
  });

  twitch.on('connected', (identity) => server.broadcast({ type: 'twitch:connected', identity }));
  twitch.on('disconnected', () => server.broadcast({ type: 'twitch:disconnected' }));
  twitch.on('error', (error) => server.broadcast({ type: 'twitch:error', message: error.message || String(error) }));

  await server.start();
  createWindow();
}

app.whenReady().then(bootstrap);

ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));
ipcMain.handle('copy-overlay-url', async () => {
  const { clipboard } = require('electron');
  const url = 'http://127.0.0.1:8766/overlay.html';
  clipboard.writeText(url);
  return url;
});
ipcMain.handle('twitch-complete-device-auth', async (_event, payload) => {
  const { clientId, deviceCode, interval, expiresIn, targetChannelLogin } = payload;
  const token = await twitch.pollDeviceToken(clientId, deviceCode, interval, expiresIn);
  const identity = await twitch.connect({ clientId, accessToken: token.access_token, targetChannelLogin });
  return { identity, tokenExpiresIn: token.expires_in };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try { twitch?.disconnect(); } catch {}
  try { await server?.stop(); } catch {}
  try { db?.close(); } catch {}
});
