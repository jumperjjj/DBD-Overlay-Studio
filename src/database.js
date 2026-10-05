const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_ITEMS = [
  { name: 'Sardinha', rarity: 'Comum', chance: 30, goldMin: 10, goldMax: 20 },
  { name: 'Tilápia', rarity: 'Comum', chance: 25, goldMin: 15, goldMax: 30 },
  { name: 'Bota Velha', rarity: 'Lixo', chance: 20, goldMin: 1, goldMax: 5 },
  { name: 'Baiacu', rarity: 'Comum', chance: 12, goldMin: 50, goldMax: 90 },
  { name: 'Lula', rarity: 'Raro', chance: 7, goldMin: 150, goldMax: 300 },
  { name: 'Peixe-Lua', rarity: 'Épico', chance: 4, goldMin: 800, goldMax: 1200 },
  { name: 'Tubarão Dourado', rarity: 'Lendário', chance: 1.5, goldMin: 8000, goldMax: 12000 },
  { name: 'Leviatã', rarity: 'Mítico', chance: 0.5, goldMin: 50000, goldMax: 100000 }
];

class GameDatabase {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.dbPath = path.join(userDataPath, 'fishing-game.db');
    this.imagesPath = path.join(userDataPath, 'item-images');
    fs.mkdirSync(this.imagesPath, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seed();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS achievement_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        metric TEXT NOT NULL,
        target REAL NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS achievement_unlocks (
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        achievement_id INTEGER NOT NULL,
        unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, twitch_user_id, achievement_id)
      );
      CREATE TABLE IF NOT EXISTS game_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,channel_id TEXT NOT NULL,name TEXT NOT NULL,config TEXT NOT NULL,
        started_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_events_channel_idx ON game_events(channel_id,status,ends_at);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        login TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS players (
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        login TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        gold INTEGER NOT NULL DEFAULT 0,
        total_catches INTEGER NOT NULL DEFAULT 0,
        last_fished_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, twitch_user_id)
      );

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Peixe',
        rarity TEXT NOT NULL DEFAULT 'Comum',
        weight INTEGER NOT NULL DEFAULT 100,
        gold INTEGER NOT NULL DEFAULT 0,
        image_path TEXT NOT NULL DEFAULT '',
        counts_for_collection INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        chance REAL NOT NULL DEFAULT 0,
        gold_min INTEGER NOT NULL DEFAULT 0,
        gold_max INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        message_template TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS catches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        gold_awarded INTEGER NOT NULL,
        caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS collection (
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        first_caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, twitch_user_id, item_id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );
    `);

    const achievementColumns = this.db.prepare('PRAGMA table_info(achievement_definitions)').all();
    if (!achievementColumns.some(row => row.name === 'parameter')) {
      this.db.exec("ALTER TABLE achievement_definitions ADD COLUMN parameter TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS achievement_resets (
      channel_id TEXT NOT NULL, twitch_user_id TEXT NOT NULL, catch_id INTEGER NOT NULL DEFAULT 0,
      gold_baseline INTEGER NOT NULL DEFAULT 0, catches_baseline INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(channel_id, twitch_user_id)
    )`);
    this.db.exec('CREATE INDEX IF NOT EXISTS catches_player_idx ON catches(channel_id, twitch_user_id, id)');
    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map((row) => row.name));
    const addColumn = (name, sql) => {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE items ADD COLUMN ${sql};`);
    };
    addColumn('chance', 'chance REAL NOT NULL DEFAULT 0');
    addColumn('gold_min', 'gold_min INTEGER NOT NULL DEFAULT 0');
    addColumn('gold_max', 'gold_max INTEGER NOT NULL DEFAULT 0');
    addColumn('deleted', 'deleted INTEGER NOT NULL DEFAULT 0');
    addColumn('message_template', "message_template TEXT NOT NULL DEFAULT ''");

    const items = this.db.prepare('SELECT id, name, rarity, weight, gold, chance, gold_min, gold_max FROM items').all();
    // Migra também itens personalizados e parâmetros de conquistas, preservando histórico e imagens.
    this.db.exec("UPDATE items SET rarity='Comum' WHERE rarity='Incomum'");
    this.db.exec("UPDATE achievement_definitions SET parameter='Comum' WHERE parameter='Incomum' AND metric IN ('rarity_count','rarity_streak')");
    if (items.length) {
      const chanceTotal = items.reduce((sum, item) => sum + Number(item.chance || 0), 0);
      if (chanceTotal <= 0.0001 && !columns.has('chance')) {
        const defaultByName = new Map(DEFAULT_ITEMS.map((item) => [item.name, item]));
        const looksLikeOldSeed = items.length === DEFAULT_ITEMS.length && items.every((item) => defaultByName.has(item.name));
        const updateChance = this.db.prepare('UPDATE items SET chance = ? WHERE id = ?');

        if (looksLikeOldSeed) {
          const updateDefault = this.db.prepare('UPDATE items SET chance = ?, gold_min = ?, gold_max = ?, rarity = ? WHERE id = ?');
          for (const item of items) {
            const preset = defaultByName.get(item.name);
            updateDefault.run(preset.chance, preset.goldMin, preset.goldMax, preset.rarity, item.id);
          }
        } else {
          const totalWeight = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0);
          for (const item of items) {
            const chance = totalWeight > 0 ? (Math.max(0, Number(item.weight || 0)) / totalWeight) * 100 : 0;
            updateChance.run(Math.round(chance * 100) / 100, item.id);
          }
        }
      }

      const updateGoldRange = this.db.prepare(`
        UPDATE items SET
          gold_min = CASE WHEN gold_min = 0 THEN gold ELSE gold_min END,
          gold_max = CASE WHEN gold_max = 0 THEN gold ELSE gold_max END
        WHERE id = ?
      `);
      for (const item of items) updateGoldRange.run(item.id);


    }
  }

  seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM items').get().count;
    if (count === 0) {
      const insert = this.db.prepare(`
        INSERT INTO items (name, rarity, chance, gold_min, gold_max, type, weight, gold, enabled, deleted)
        VALUES (?, ?, ?, ?, ?, 'Peixe', 0, ?, 1, 0)
      `);
      for (const item of DEFAULT_ITEMS) {
        insert.run(item.name, item.rarity, item.chance, item.goldMin, item.goldMax, item.goldMin);
      }
    }

    const defaults = {
      achievements_command: '!conquistas',
      command: '!pescar',
      cooldown_seconds: '120',
      fishing_seconds: '4',
      overlay_result_seconds: '5.2',
      achievement_seconds: '4',
      achievement_overlay_enabled: '1',
      overlay_width: '640',
      overlay_height: '360',
      overlay_enabled: '1',
      overlay_sound_enabled: '1',
      overlay_show_image: '1',
      overlay_bg_color: '#07131d',
      overlay_text_color: '#ffffff',
      overlay_accent_color: '#70e0c5',
      overlay_gold_color: '#ffd45f',
      overlay_opacity: '90',
      overlay_x: '50',
      overlay_y: '86',
      overlay_scale: '100',
      overlay_image_size: '72',
      overlay_radius: '16',
      overlay_animation: 'pop',
      overlay_image_scale: '100',
      chat_cursed_template: '🕸️ @{user} pescou {item} amaldiçoado e perdeu {ouro} ouro! Saldo: {ouro_total}.',
      chat_result_enabled: '1',
      chat_cooldown_enabled: '1',
      chat_result_template: '🎣 @{user} trouxe {item} da água! +{ouro} ouro • coleção em progresso.',
      chat_cooldown_template: '⏳ @{user}, sua próxima pescaria estará disponível em {tempo}.',
      chat_pending_template: '@{user}, sua pescaria ainda está na fila ou em exibição. Aguarde o resultado!',
      twitch_client_id: '',
      target_channel_login: '',
      expected_bot_login: 'fishingbotjjj',
      bot_user_id: '',
      bot_user_login: '',
      bot_user_name: '',
      active_channel_id: 'local-test',
      active_channel_login: 'modo_teste',
      active_channel_name: 'Modo Teste'
    };

    const insertSetting = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);
    // Atualiza apenas os textos padrão antigos; mensagens personalizadas continuam intactas.
    for (const [key, previous] of [
      ['chat_result_template', '@{user} pescou {item} ({raridade}) e ganhou {ouro} de Ouro! 🎣'],
      ['chat_cooldown_template', '@{user}, sua linha precisa descansar. Lance novamente em {tempo}. 🎣']
    ]) {
      if (this.getSetting(key) === previous) this.setSetting(key, defaults[key]);
    }
    if (this.getSetting('achievement_catalog_initialized', '0') !== '1') {
      const insert = this.db.prepare('INSERT INTO achievement_definitions (name, description, metric, target) VALUES (?, ?, ?, ?)');
      for (const def of [
        ['Primeira Pescaria', 'Faça sua primeira pescaria.', 'catches', 1],
        ['Pescador Amador', 'Complete 50 pescarias.', 'catches', 50],
        ['Pescador Profissional', 'Complete 250 pescarias.', 'catches', 250],
        ['Pescador Veterano', 'Complete 1.000 pescarias.', 'catches', 1000],
        ['Baú de Ouro', 'Acumule 10.000 de ouro.', 'gold', 10000],
        ['Colecionador I', 'Descubra 25% da coleção.', 'collection', 25],
        ['Colecionador II', 'Descubra 50% da coleção.', 'collection', 50],
        ['Mestre da Coleção', 'Complete a coleção.', 'collection', 100]
      ]) insert.run(...def);
      // Registra o progresso anterior sem disparar notificações retroativas.
      for (const player of this.db.prepare('SELECT channel_id, twitch_user_id FROM players').all()) {
        this.unlockAchievements(player.channel_id, player.twitch_user_id);
      }
      this.setSetting('achievement_catalog_initialized', '1');
    }
  }

  getImagesPath() { return this.imagesPath; }

  getSetting(key, fallback = '') {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  listItems() {
    return this.db.prepare(`
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, message_template, counts_for_collection, enabled, created_at
      FROM items
      WHERE deleted = 0
      ORDER BY CASE rarity WHEN 'Lixo' THEN 0 WHEN 'Comum' THEN 1 WHEN 'Raro' THEN 2 WHEN 'Épico' THEN 3 WHEN 'Lendário' THEN 4 WHEN 'Mítico' THEN 5 WHEN 'Amaldiçoado' THEN 6 ELSE 7 END, id ASC
    `).all();
  }

  getFishingItems() {
    return this.db.prepare(`
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, message_template, counts_for_collection
      FROM items
      WHERE deleted = 0 AND enabled = 1 AND chance > 0
      ORDER BY id ASC
    `).all();
  }

  getChanceTotal() {
    const row = this.db.prepare('SELECT COALESCE(SUM(chance), 0) AS total FROM items WHERE deleted = 0 AND enabled = 1').get();
    return Number(row.total || 0);
  }

  addItem(item) {
    const chance = this.normalizeChance(item.chance);
    const { min, max } = this.normalizeGoldRange(item.goldMin, item.goldMax);
    const result = this.db.prepare(`
      INSERT INTO items (name, rarity, chance, gold_min, gold_max, type, weight, gold, image_path, message_template, counts_for_collection, enabled, deleted)
      VALUES (?, ?, ?, ?, ?, 'Peixe', 0, ?, '', ?, 1, 1, 0)
    `).run(
      String(item.name || '').trim(),
      this.normalizeRarity(item.rarity),
      chance,
      min,
      max,
      min,
      String(item.messageTemplate || '').trim()
    );
    const id = Number(result.lastInsertRowid);
    if (item.imageData) this.saveItemImage(id, item.imageData);
    return id;
  }

  setItemEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Informe se o item está habilitado.');
    return this.db.prepare('UPDATE items SET enabled = ? WHERE id = ? AND deleted = 0').run(enabled ? 1 : 0, Number(id)).changes > 0;
  }

  updateItem(id, item) {
    const itemId = Number(id);
    const chance = this.normalizeChance(item.chance);
    const { min, max } = this.normalizeGoldRange(item.goldMin, item.goldMax);
    this.db.prepare(`
      UPDATE items SET
        name = ?, rarity = ?, chance = ?, gold_min = ?, gold_max = ?, gold = ?, message_template = ?
      WHERE id = ? AND deleted = 0
    `).run(
      String(item.name || '').trim(),
      this.normalizeRarity(item.rarity),
      chance,
      min,
      max,
      min,
      String(item.messageTemplate || '').trim(),
      itemId
    );
    if (item.removeImage) this.removeItemImage(itemId);
    if (item.imageData) this.saveItemImage(itemId, item.imageData);
  }

  normalizeRarity(value) {
    const allowed = new Set(['Lixo', 'Comum', 'Raro', 'Épico', 'Lendário', 'Mítico', 'Amaldiçoado']);
    return allowed.has(value) ? value : 'Comum';
  }

  deleteItem(id) {
    this.db.prepare('UPDATE items SET deleted = 1, chance = 0, enabled = 0 WHERE id = ?').run(Number(id));
  }

  normalizeChance(value) {
    const chance = Number(value);
    if (!Number.isFinite(chance) || chance < 0 || chance > 1000000) throw new Error('Use um valor de chance entre 0 e 1.000.000.');
    return Math.round(chance * 100) / 100;
  }

  normalizeGoldRange(minValue, maxValue) {
    const min = Math.max(0, Math.floor(Number(minValue) || 0));
    const max = Math.max(0, Math.floor(Number(maxValue) || 0));
    if (max < min) throw new Error('O Ouro máximo não pode ser menor que o Ouro mínimo.');
    if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||max>1000000000)throw new Error('Use valores de ouro entre 0 e 1.000.000.000.');
    return { min, max };
  }

  saveItemImage(itemId, dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/);
    if (!match) throw new Error('Imagem inválida. Use PNG, JPG ou WEBP.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 700 * 1024) throw new Error('A imagem processada precisa ter no máximo 700 KB.');

    const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp';
    const previous = this.db.prepare('SELECT image_path FROM items WHERE id = ?').get(Number(itemId));
    const filename = `item-${Number(itemId)}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(this.imagesPath, filename), buffer);
    this.db.prepare('UPDATE items SET image_path = ? WHERE id = ?').run(`/item-images/${filename}`, Number(itemId));
    this.deleteImageFile(previous?.image_path);
    return `/item-images/${filename}`;
  }

  removeItemImage(itemId) {
    const previous = this.db.prepare('SELECT image_path FROM items WHERE id = ?').get(Number(itemId));
    this.db.prepare("UPDATE items SET image_path = '' WHERE id = ?").run(Number(itemId));
    this.deleteImageFile(previous?.image_path);
  }

  deleteImageFile(webPath) {
    const filename = String(webPath || '').split('/').pop();
    if (!filename) return;
    const fullPath = path.join(this.imagesPath, filename);
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {}
  }

  ensurePlayer(channelId, user) {
    this.db.prepare(`
      INSERT INTO players (channel_id, twitch_user_id, login, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, twitch_user_id) DO UPDATE SET
        login = excluded.login,
        display_name = excluded.display_name,
        updated_at = CURRENT_TIMESTAMP
    `).run(channelId, user.id, user.login || '', user.displayName || user.login || '');
    return this.getPlayer(channelId, user.id);
  }

  getPlayer(channelId, userId) {
    return this.db.prepare('SELECT * FROM players WHERE channel_id = ? AND twitch_user_id = ?').get(channelId, userId);
  }

  listPlayers(channelId) {
    return this.db.prepare(`
      SELECT twitch_user_id, login, display_name, gold, total_catches, last_fished_at
      FROM players WHERE channel_id = ?
      ORDER BY gold DESC, total_catches DESC, display_name COLLATE NOCASE ASC
    `).all(channelId);
  }

  markFishingStarted(channelId, user) {
    this.ensurePlayer(channelId, user);
    const now = Date.now();
    this.db.prepare(`
      UPDATE players SET last_fished_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(now, channelId, user.id);
    return now;
  }

  applyCatch(channelId, user, item, goldAwarded) {
    const previous=this.ensurePlayer(channelId,user);
    if(!Number.isSafeInteger(goldAwarded))throw new Error('Valor de ouro inválido.');
    const nextGold=Math.max(0,previous.gold+goldAwarded);
    if(!Number.isSafeInteger(nextGold))throw new Error('Saldo acima do limite permitido.');
    const delta=nextGold-previous.gold;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE players SET gold=?,total_catches=total_catches+1,updated_at=CURRENT_TIMESTAMP WHERE channel_id=? AND twitch_user_id=?').run(nextGold,channelId,user.id);
      this.db.prepare('INSERT INTO catches(channel_id,twitch_user_id,item_id,gold_awarded) VALUES(?,?,?,?)').run(channelId,user.id,item.id,delta);
      if(item.counts_for_collection)this.db.prepare(`INSERT INTO collection(channel_id,twitch_user_id,item_id,quantity) VALUES(?,?,?,1)
        ON CONFLICT(channel_id,twitch_user_id,item_id) DO UPDATE SET quantity=quantity+1,last_caught_at=CURRENT_TIMESTAMP`).run(channelId,user.id,item.id);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return {...this.getPlayer(channelId,user.id),gold_delta:delta};
  }

  deletePlayer(channelId,userId) {
    if(!this.getPlayer(channelId,userId))return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const table of ['achievement_unlocks','achievement_resets','collection','catches','players'])this.db.prepare('DELETE FROM '+table+' WHERE channel_id=? AND twitch_user_id=?').run(channelId,userId);
      this.db.prepare('DELETE FROM settings WHERE key=?').run('achievement_epoch:'+JSON.stringify([channelId,userId]));
      this.db.exec('COMMIT');
      return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getLeaderboard(channelId, limit = 100) {
    return this.db.prepare(`
      SELECT twitch_user_id, login, display_name, gold, total_catches,
        (SELECT COUNT(*) FROM collection c JOIN items i ON i.id=c.item_id
         WHERE c.channel_id=players.channel_id AND c.twitch_user_id=players.twitch_user_id
           AND c.quantity>0 AND i.deleted=0 AND i.counts_for_collection=1) AS discovered,
        (SELECT COUNT(*) FROM items WHERE deleted=0 AND counts_for_collection=1) AS collection_total
      FROM players WHERE channel_id = ?
      ORDER BY gold DESC, total_catches DESC, twitch_user_id ASC
      LIMIT ?
    `).all(channelId, Number(limit));
  }

  getPlayerPosition(channelId,userId) {
    const row=this.db.prepare('SELECT position FROM (SELECT twitch_user_id,ROW_NUMBER() OVER(ORDER BY gold DESC,total_catches DESC,twitch_user_id ASC) AS position FROM players WHERE channel_id=?) WHERE twitch_user_id=?').get(channelId,userId);
    return row?Number(row.position):null;
  }

  updatePlayerStats(channelId, userId, stats) {
    const current = this.getPlayer(channelId, userId);
    if (!current) return null;
    for (const key of ['gold', 'totalCatches', 'baseGold', 'baseCatches']) {
      if (stats[key] !== undefined && (!Number.isSafeInteger(Number(stats[key])) || Number(stats[key]) < 0)) {
        throw new Error('Ouro e pescarias devem ser números inteiros não negativos.');
      }
    }
    const gold = Math.max(0, Number(stats.gold ?? current.gold) + (stats.baseGold === undefined ? 0 : current.gold - Number(stats.baseGold)));
    const totalCatches = Math.max(0, Number(stats.totalCatches ?? current.total_catches) + (stats.baseCatches === undefined ? 0 : current.total_catches - Number(stats.baseCatches)));
    if (!Number.isSafeInteger(gold) || !Number.isSafeInteger(totalCatches)) throw new Error('Valor acima do limite permitido.');
    this.db.prepare(`
      UPDATE players SET gold = ?, total_catches = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(gold, totalCatches, channelId, userId);
    return this.getPlayer(channelId, userId);
  }

  resetPlayerRank(channelId, userId) {
    this.db.prepare(`
      UPDATE players SET gold = 0, total_catches = 0, last_fished_at = 0, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(channelId, userId);
    return this.getPlayer(channelId, userId);
  }

  getCollection(channelId, userId) {
    return this.db.prepare(`
      SELECT i.id, i.name, i.rarity, i.image_path, i.chance, i.gold_min, i.gold_max,
             COALESCE(c.quantity, 0) AS quantity, c.first_caught_at, c.last_caught_at
      FROM items i
      LEFT JOIN collection c
        ON c.item_id = i.id AND c.channel_id = ? AND c.twitch_user_id = ?
      WHERE i.deleted = 0
      ORDER BY i.id ASC
    `).all(channelId, userId);
  }

  getCollectionSummary(channelId, userId) {
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE deleted = 0 AND counts_for_collection = 1').get().count;
    const discovered = this.db.prepare(`
      SELECT COUNT(*) AS count FROM collection c
      JOIN items i ON i.id = c.item_id
      WHERE c.channel_id = ? AND c.twitch_user_id = ? AND c.quantity > 0 AND i.deleted = 0 AND i.counts_for_collection = 1
    `).get(channelId, userId).count;
    return { total: Number(total), discovered: Number(discovered) };
  }

  getGameSummary(channelId) {
    const totals=this.db.prepare('SELECT COUNT(*) AS players, COALESCE(SUM(total_catches),0) AS catches FROM players WHERE channel_id=?').get(channelId);
    return {...totals,items:this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE deleted=0').get().count};
  }

  listAchievementDefinitions() {
    return this.db.prepare('SELECT * FROM achievement_definitions ORDER BY id').all();
  }

  saveAchievement(id, data) {
    const name = String(data.name || '').trim().slice(0, 100);
    const description = String(data.description || '').trim().slice(0, 300);
    const metric = String(data.metric || '');
    const target = Number(data.target);
    const parameter = String(data.parameter || '').trim();
    const metrics = ['catches', 'gold', 'collection', 'unique_items', 'item_count', 'rarity_count', 'rarity_streak', 'total_gold', 'biggest_gold', 'fishing_days', 'daily_catches', 'daily_gold', 'rarity_variety','lost_gold'];
    if (!name || !metrics.includes(metric) || !Number.isFinite(target) || target <= 0 ||
        (metric === 'collection' && target > 100) || (metric !== 'collection' && !Number.isInteger(target))) {
      throw new Error('Informe nome, condição e meta válida. Coleção: até 100%; ouro/pescarias: números inteiros positivos.');
    }
    if (metric === 'item_count' && (!/^\d+$/.test(parameter) || !this.db.prepare('SELECT id FROM items WHERE id = ?').get(Number(parameter)))) {
      throw new Error('Escolha um item válido para essa conquista.');
    }
    if (['rarity_count', 'rarity_streak'].includes(metric) && !['Lixo','Comum','Raro','Épico','Lendário','Mítico','Amaldiçoado'].includes(parameter)) {
      throw new Error('Escolha a raridade da conquista.');
    }
    const enabled = data.enabled === false || data.enabled === 0 ? 0 : 1;
    if (id) {
      const row = this.db.prepare('UPDATE achievement_definitions SET name = ?, description = ?, metric = ?, target = ?, enabled = ?, parameter = ? WHERE id = ?')
        .run(name, description, metric, target, enabled, parameter, Number(id));
      if (!row.changes) throw new Error('Conquista não encontrada.');
      return Number(id);
    }
    return Number(this.db.prepare('INSERT INTO achievement_definitions (name, description, metric, target, enabled, parameter) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, description, metric, target, enabled, parameter).lastInsertRowid);
  }

  getAchievements(channelId, userId) {
    const player = this.getPlayer(channelId, userId) || { gold: 0, total_catches: 0 };
    const summary = this.getCollectionSummary(channelId, userId);
    const reset = this.db.prepare('SELECT * FROM achievement_resets WHERE channel_id = ? AND twitch_user_id = ?').get(channelId, userId);
    const history = this.db.prepare(`SELECT c.id, c.item_id, c.gold_awarded, i.rarity, i.counts_for_collection, i.deleted,
      date(c.caught_at, 'localtime') AS day FROM catches c JOIN items i ON i.id = c.item_id
      WHERE c.channel_id = ? AND c.twitch_user_id = ? AND c.id > ? ORDER BY c.id DESC`).all(channelId, userId, reset?.catch_id ?? 0);
    const today = this.db.prepare("SELECT date('now', 'localtime') AS day").get().day;
    const todayHistory = history.filter(row => row.day === today);
    const discoveredSinceReset = reset ? new Set(history.filter(row => row.counts_for_collection && !row.deleted).map(row => row.item_id)).size : summary.discovered;
    const values = {
      catches: reset ? history.length : player.total_catches,
      gold: reset ? Math.max(0,history.reduce((sum, row) => sum + row.gold_awarded, 0)) : player.gold,
      collection: summary.total ? discoveredSinceReset / summary.total * 100 : 0,
      unique_items: discoveredSinceReset,
      total_gold: history.reduce((sum, row) => sum + Math.max(0,row.gold_awarded), 0),
      lost_gold: history.reduce((sum,row)=>sum+Math.max(0,-row.gold_awarded),0),
      biggest_gold: history.reduce((max, row) => Math.max(max, row.gold_awarded), 0),
      fishing_days: new Set(history.map(row => row.day)).size,
      daily_catches: todayHistory.length,
      daily_gold: todayHistory.reduce((sum, row) => sum + Math.max(0,row.gold_awarded), 0),
      rarity_variety: new Set(history.map(row => row.rarity)).size
    };
    const earned = new Set(this.db.prepare('SELECT achievement_id FROM achievement_unlocks WHERE channel_id = ? AND twitch_user_id = ?')
      .all(channelId, userId).map(row => row.achievement_id));
    const achievements = this.listAchievementDefinitions().filter(def => def.enabled).map(def => {
      let progress = values[def.metric] ?? 0;
      if (def.metric === 'item_count') progress = history.filter(row => String(row.item_id) === def.parameter).length;
      if (def.metric === 'rarity_count') progress = history.filter(row => row.rarity === def.parameter).length;
      if (def.metric === 'rarity_streak') {
        progress = 0;
        for (const row of history) { if (row.rarity !== def.parameter) break; progress++; }
      }
      return { ...def, progress, eligible: progress >= def.target, unlocked: earned.has(def.id) };
    });
    return { player, summary, achievements };
  }

  unlockAchievements(channelId, userId) {
    const unlocked = [];
    const insert = this.db.prepare('INSERT OR IGNORE INTO achievement_unlocks (channel_id, twitch_user_id, achievement_id) VALUES (?, ?, ?)');
    for (const def of this.getAchievements(channelId, userId).achievements) {
      if (def.eligible && insert.run(channelId, userId, def.id).changes) unlocked.push(def);
    }
    return unlocked;
  }

  resetAchievements(channelId, userId) {
    const player = this.getPlayer(channelId, userId);
    if (!player) throw new Error('Jogador não encontrado.');
    const last = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM catches WHERE channel_id = ? AND twitch_user_id = ?').get(channelId, userId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM achievement_unlocks WHERE channel_id = ? AND twitch_user_id = ?').run(channelId, userId);
      this.db.prepare(`INSERT INTO achievement_resets(channel_id, twitch_user_id, catch_id, gold_baseline, catches_baseline) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, twitch_user_id) DO UPDATE SET catch_id = excluded.catch_id, gold_baseline = excluded.gold_baseline, catches_baseline = excluded.catches_baseline`)
        .run(channelId, userId, last.id, player.gold, player.total_catches);
      this.setSetting('achievement_epoch:' + JSON.stringify([channelId, userId]), String(this.getAchievementEpoch(channelId, userId) + 1));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.getAchievements(channelId, userId);
  }

  getAchievementEpoch(channelId, userId) {
    return Number(this.getSetting('achievement_epoch:' + JSON.stringify([channelId, userId]), '0'));
  }

  close() { this.db.close(); }
}

module.exports = { GameDatabase };
