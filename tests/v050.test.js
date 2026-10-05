const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameDatabase } = require('../src/database');
const { FishingEngine } = require('../src/fishing-engine');
const { LocalServer } = require('../src/local-server');
const { TwitchClient } = require('../src/twitch-client');
const { WebSocket } = require('ws');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishing-v050-'));
  const db = new GameDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return db;
}
const user = id => ({ id, login: id, displayName: id });

test('rank edit preserves captures arriving after the editor was opened', t => {
  const db = fixture(t);
  db.ensurePlayer('c', user('alice'));
  db.updatePlayerStats('c', 'alice', { gold: 100, totalCatches: 10 });
  db.applyCatch('c', user('alice'), db.listItems()[0], 7);
  const merged = db.updatePlayerStats('c', 'alice', { gold: 200, totalCatches: 5, baseGold: 100, baseCatches: 10 });
  assert.equal(merged.gold, 207);
  assert.equal(merged.total_catches, 6);
  assert.throws(() => db.updatePlayerStats('c', 'alice', { gold: -1 }), /inteiros/);
});

test('extended conditions count item, rarity, streak, gold, days and variety', t => {
  const db = fixture(t);
  const items = db.listItems();
  const rare = items.find(item => item.rarity === 'Raro');
  const trash = items.find(item => item.rarity === 'Lixo');
  const defs = [
    ['item_count', String(rare.id), 2], ['rarity_count', 'Raro', 2], ['rarity_streak', 'Raro', 2],
    ['total_gold', '', 90], ['biggest_gold', '', 50], ['fishing_days', '', 1],
    ['daily_catches', '', 3], ['daily_gold', '', 90], ['rarity_variety', '', 2], ['unique_items', '', 2]
  ];
  const ids = defs.map(([metric, parameter, target]) => db.saveAchievement(null, { name: metric, metric, parameter, target }));
  db.applyCatch('c', user('alice'), trash, 10);
  db.applyCatch('c', user('alice'), rare, 30);
  db.applyCatch('c', user('alice'), rare, 50);
  const earned = db.unlockAchievements('c', 'alice');
  for (const id of ids) assert.ok(earned.some(def => def.id === id), 'Missing metric ID ' + id);
  assert.equal(db.unlockAchievements('c', 'alice').length, 0);
});

test('reset affects one player and starts achievement progress from new catches', t => {
  const db = fixture(t);
  const item = db.listItems()[0];
  db.applyCatch('c', user('alice'), item, 12);
  db.applyCatch('c', user('bob'), item, 12);
  db.unlockAchievements('c', 'alice'); db.unlockAchievements('c', 'bob');
  const epoch = db.getAchievementEpoch('c', 'alice');
  const reset = db.resetAchievements('c', 'alice');
  assert.equal(reset.achievements.some(def => def.unlocked), false);
  assert.equal(db.unlockAchievements('c', 'alice').length, 0);
  assert.equal(db.getPlayer('c', 'alice').gold, 12);
  assert.equal(db.getCollectionSummary('c', 'alice').discovered, 1);
  assert.equal(db.getAchievements('c', 'bob').achievements.some(def => def.unlocked), true);
  assert.equal(db.getAchievementEpoch('c', 'alice'), epoch + 1);
  db.applyCatch('c', user('alice'), item, 4);
  assert.ok(db.unlockAchievements('c', 'alice').some(def => def.name === 'Primeira Pescaria'));
});

test('connection is announced ready only after EventSub chat subscription', async t => {
  const db = fixture(t);
  const client = new TwitchClient(db);
  client.validateToken = async () => ({});
  client.loadOwnIdentity = async () => ({ id: 'bot', login: 'fishingbotjjj', display_name: 'FishingBotJJJ' });
  client.loadUserByLogin = async () => ({ id: 'channel', login: 'streamer', display_name: 'Streamer' });
  let finish;
  client.openEventSubSocket = () => { finish = () => { client.ready = true; client.emit('connected', {}); }; };
  let resolved = false;
  const connecting = client.connect({ clientId: 'test-client', accessToken: 'test-token', targetChannelLogin: 'streamer' }).then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.equal(client.isConnected(), false);
  finish(); await connecting;
  assert.equal(client.isConnected(), true);
});

test('one HTTP test produces a catch; late overlay receives current event', async t => {
  const db = fixture(t);
  for (const [key, value] of Object.entries({ fishing_seconds: '0.1', overlay_result_seconds: '0.1', achievement_seconds: '0.1' })) db.setSetting(key, value);
  const server = new LocalServer({ database: db, port: 0 });
  server.setEngine(new FishingEngine(db, data => server.broadcast(data)));
  await server.start();
  const port = server.server.address().port;
  t.after(async () => { for (const client of server.wss.clients) client.terminate(); await server.stop(); });
  const result = await fetch('http://127.0.0.1:' + port + '/api/test-fish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(res => res.json());
  assert.equal(result.ok, true);
  assert.equal(db.getPlayer('local-test', 'test-user').total_catches, 1);
  server.broadcast({ type: 'fishing:result', user: user('late'), item: db.listItems()[0], durationMs: 1000 });
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  const replay = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No replay event')), 3000);
    socket.on('error', reject);
    socket.on('message', raw => { const event = JSON.parse(raw); if (event.type === 'fishing:result') { clearTimeout(timeout); resolve(event); } });
  });
  assert.equal(replay.user.id, 'late');
  assert.ok(replay.durationMs > 0 && replay.durationMs <= 1000);
  socket.close();
});
