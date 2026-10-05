const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { GameDatabase } = require('../src/database');
const { FishingEngine } = require('../src/fishing-engine');
const { TwitchClient } = require('../src/twitch-client');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishing-test-'));
  const db = new GameDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.setSetting('fishing_seconds', '0');
  db.setSetting('overlay_result_seconds', '0.01');
  db.setSetting('achievement_seconds', '0.01');
  return { db, dir };
}
const user = id => ({ id, login: id, displayName: id });

test('zero cooldown, pending guard, overlay ordering, one-time achievement', async t => {
  const { db } = fixture(t);
  db.setSetting('cooldown_seconds', '0');
  const events = [];
  const engine = new FishingEngine(db, event => events.push(event));
  engine.pickByChance = items => items[0];
  engine.randomGold = () => 1;
  const first = engine.fish({ channelId: 'channel', user: user('alice') });
  const blocked = await engine.fish({ channelId: 'channel', user: user('alice') });
  assert.equal(blocked.pending, true);
  assert.equal(blocked.remainingSeconds, 0);
  const second = engine.fish({ channelId: 'channel', user: user('bob') });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(events.map(e => e.type), [
    'fishing:start', 'fishing:result', 'achievement:unlocked',
    'fishing:start', 'fishing:result', 'achievement:unlocked'
  ]);
  assert.equal(events[2].user.id, 'alice');
  assert.equal(events[2].achievement.name, 'Primeira Pescaria');
  const again = await engine.fish({ channelId: 'channel', user: user('alice') });
  assert.equal(again.ok, true);
  assert.equal(again.achievements.some(a => a.name === 'Primeira Pescaria'), false);
  assert.equal(engine.pending.size, 0);
});

test('cooldown rejection has remaining time and does not increment catches', async t => {
  const { db } = fixture(t);
  db.setSetting('cooldown_seconds', '120');
  const engine = new FishingEngine(db, () => {});
  engine.pickByChance = items => items[0];
  engine.randomGold = () => 1;
  const first = engine.fish({ channelId: 'c', user: user('alice') });
  const during = await engine.fish({ channelId: 'c', user: user('alice') });
  assert.equal(during.reason, 'cooldown');
  assert.ok(during.remainingSeconds > 0);
  await first;
  const after = await engine.fish({ channelId: 'c', user: user('alice') });
  assert.equal(after.reason, 'cooldown');
  assert.equal(after.pending, undefined);
  assert.equal(db.getPlayer('c', 'alice').total_catches, 1);
});

test('custom achievements validate, persist, and survive rank reset', async t => {
  const { db, dir } = fixture(t);
  const id = db.saveAchievement(null, { name: 'Duas pescarias', description: 'Pesque duas vezes', metric: 'catches', target: 2 });
  assert.throws(() => db.saveAchievement(null, { name: 'Inválida', metric: 'collection', target: 101 }));
  const engine = new FishingEngine(db, () => {});
  engine.pickByChance = items => items[0];
  engine.randomGold = () => 1;
  db.setSetting('cooldown_seconds', '0');
  await engine.fish({ channelId: 'c', user: user('alice') });
  const result = await engine.fish({ channelId: 'c', user: user('alice') });
  assert.ok(result.achievements.some(a => a.id === id));
  const reopened = new GameDatabase(dir);
  try {
    assert.equal(reopened.getAchievements('c', 'alice').achievements.find(a => a.id === id).unlocked, true);
    reopened.resetPlayerRank('c', 'alice');
    assert.equal(reopened.getAchievements('c', 'alice').achievements.find(a => a.id === id).unlocked, true);
    reopened.saveAchievement(id, { name: 'Duas pescarias', description: '', metric: 'catches', target: 2, enabled: false });
    assert.equal(reopened.getAchievements('c', 'alice').achievements.some(a => a.id === id), false);
  } finally { reopened.close(); }
});

test('old progress is registered during migration without erasing data', t => {
  const { db, dir } = fixture(t);
  db.ensurePlayer('c', user('veterano'));
  db.updatePlayerStats('c', 'veterano', { gold: 15000, totalCatches: 60 });
  db.setSetting('chat_result_template', 'Minha mensagem {user}');
  db.setSetting('chat_cooldown_template', '@{user}, sua linha precisa descansar. Lance novamente em {tempo}. 🎣');
  db.db.exec("DROP TABLE achievement_unlocks; DROP TABLE achievement_definitions; DELETE FROM settings WHERE key = 'achievement_catalog_initialized';");
  const reopened = new GameDatabase(dir);
  try {
    assert.equal(reopened.getPlayer('c', 'veterano').gold, 15000);
    assert.equal(reopened.getSetting('chat_result_template'), 'Minha mensagem {user}');
    assert.match(reopened.getSetting('chat_cooldown_template'), /próxima pescaria/);
    assert.equal(reopened.unlockAchievements('c', 'veterano').length, 0);
    assert.equal(reopened.getAchievements('c', 'veterano').achievements.filter(a => a.unlocked).length, 3);
  } finally { reopened.close(); }
});

test('bot uses its own identity and reports dropped cooldown messages', async t => {
  const { db } = fixture(t);
  const client = new TwitchClient(db);
  client.token = 'test-token'; client.clientId = 'test-client';
  client.ready = true;
  client.botIdentity = { id: 'bot-id' }; client.channelIdentity = { id: 'channel-id' };
  const calls = [];
  const fetchOriginal = global.fetch;
  t.after(() => { global.fetch = fetchOriginal; });
  global.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ data: [{ is_sent: true }] }) };
  };
  await client.sendChatMessage('Aguarde 10 s');
  assert.equal(calls[0].sender_id, 'bot-id');
  assert.equal(calls[0].broadcaster_id, 'channel-id');
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ is_sent: false, drop_reason: { message: 'Mensagem bloqueada' } }] }) });
  await assert.rejects(client.sendChatMessage('Aguarde'), /Mensagem bloqueada/);
});

test('browser scripts compile and DOM selectors reference existing controls', () => {
  const pub = path.join(__dirname, '../src/public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of app.matchAll(/\$\('#([A-Za-z0-9]+)'\)/g)) {
    // Os controles do editor de itens/ranking são criados dinamicamente no próprio app.js.
    assert.ok(ids.includes(match[1]) || app.includes('id="' + match[1] + '"'), 'Missing control: ' + match[1]);
  }
  new vm.Script(app);
  const overlay = fs.readFileSync(path.join(pub, 'overlay.html'), 'utf8');
  new vm.Script(overlay.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

test('actual API handlers validate settings and send a cooldown test through the bot', async t => {
  const { db } = fixture(t);
  const routes = new Map();
  const app = function () {};
  app.use = () => {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (url, fn) => routes.set(method + ' ' + url, fn);
  const express = () => app;
  express.json = express.static = () => () => {};
  const moduleStub = { exports: {} };
  const file = path.join(__dirname, '../src/local-server.js');
  const factory = vm.runInThisContext('(function(require,module,__dirname){' + fs.readFileSync(file, 'utf8') + '\n})');
  factory(name => name === 'express' ? express : name === 'ws' ? { WebSocketServer: class { constructor() { this.clients = new Set(); } on() {} } } : name === './overlay-options' ? require('../src/overlay-options') : name === './game-events' ? require('../src/game-events') : name === './chat-commands' ? require('../src/chat-commands') : require(name), moduleStub, path.dirname(file));
  const server = new moduleStub.exports.LocalServer({ database: db });
  function response() {
    return { code: 200, body: null, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  }
  let res = response();
  routes.get('post /api/settings')({ body: { cooldown_seconds: '0', fishing_seconds: '2', command: '!fisgar' } }, res);
  assert.equal(res.code, 200);
  assert.equal(db.getSetting('cooldown_seconds'), '0');
  res = response();
  routes.get('post /api/settings')({ body: { cooldown_seconds: '-1', command: '!changed' } }, res);
  assert.equal(res.code, 400);
  assert.equal(db.getSetting('command'), '!fisgar');
  res = response();
  routes.get('post /api/settings')({ body: { chat_cooldown_template: '' } }, res);
  assert.equal(res.code, 400);
  res = response();
  await routes.get('post /api/test-cooldown')({}, res);
  assert.equal(res.code, 400);
  let message = '';
  server.setTwitch({ isConnected: () => true, sendChatMessage: async text => { message = text; } });
  res = response();
  await routes.get('post /api/test-cooldown')({}, res);
  assert.equal(res.code, 200);
  assert.match(message, /pescador_teste/);
  assert.match(message, /10 s/);
});

