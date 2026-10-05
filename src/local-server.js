const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { KINDS,readStyle,validateStyle } = require('./overlay-options');
const { GameEvents } = require('./game-events');
const {listCommands,saveCommands}=require('./chat-commands');

class LocalServer {
  constructor({ database, port = 8766 }) {
    this.db = database;
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.activeOverlay = null;
    this.activeOverlays = new Map();
    this.overlaySettings = null;
    this.wss.on('connection', client => {
      client.send(JSON.stringify({ type: 'settings:updated', settings: this.overlaySettings || this.db.getSettings(), previewSettings: true }));
      for(const overlay of this.activeOverlays.values()) {
        const remaining=overlay.expiresAt-Date.now();
        if(remaining>0)client.send(JSON.stringify({...overlay.data,durationMs:remaining,resumed:true}));
      }
    });
    this.events=new GameEvents(this.db,data=>this.broadcast(data),async message=>{
      if(!this.twitch?.isConnected())return 'Evento aplicado; conecte o bot para que os avisos sejam enviados no chat.';
      await this.twitch.sendChatMessage(message);
      this.broadcast({type:'bot:sent',message});
      return null;
    });
    this.engine = null;
    this.twitch = null;

    this.app.use(express.json({ limit: '1mb' }));
    this.app.use('/item-images', express.static(this.db.getImagesPath()));
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.registerRoutes();
  }

  setEngine(engine) { this.engine = engine; engine.events=this.events; }
  setTwitch(twitch) { this.twitch = twitch; }

  broadcast(data) {
    if (data.type === 'settings:updated') this.overlaySettings = data.settings;
    if (['fishing:start', 'fishing:result', 'achievement:unlocked', 'panel:show', 'special:catch'].includes(data.type)) {
      this.activeOverlay = { data, expiresAt: Date.now() + Math.max(0, Number(data.durationMs ?? 5200)) };
      const key=['panel:show','special:catch'].includes(data.type)?data.kind:'fishing';
      this.activeOverlays.set(key,this.activeOverlay);
    }
    const json = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(json);
    }
  }

  activeChannelId() {
    return this.db.getSetting('active_channel_id', 'local-test');
  }

  registerRoutes() {
    this.app.get('/api/chat-commands',(_req,res)=>res.json(listCommands(this.db)));
    this.app.post('/api/chat-commands',(req,res)=>{try{res.json(saveCommands(this.db,req.body));}catch(error){res.status(400).json({error:error.message});}});
    this.app.get('/api/events',(_req,res)=>res.json(this.events.state(this.activeChannelId())));
    this.app.post('/api/events/draft',(req,res)=>{try{res.json({ok:true,draft:this.events.saveDraft(this.activeChannelId(),req.body||{})});}catch(error){res.status(400).json({error:error.message});}});
    this.app.post('/api/events/start',async(req,res)=>{try{res.json(await this.events.start(this.activeChannelId(),req.body||{}));}catch(error){res.status(400).json({error:error.message});}});
    this.app.post('/api/events/stop',async(_req,res)=>{try{res.json(await this.events.stop(this.activeChannelId()));}catch(error){res.status(400).json({error:error.message});}});
    this.app.delete('/api/players/:userId',(req,res)=>{
      const channel=this.activeChannelId(),id=req.params.userId;
      if(this.engine?.pending.has(JSON.stringify([channel,id])))return res.status(409).json({error:'Aguarde a pescaria deste jogador terminar antes de excluí-lo.'});
      try{if(!this.db.deletePlayer(channel,id))return res.status(404).json({error:'Jogador não encontrado.'});res.json({ok:true});}catch(error){res.status(400).json({error:error.message});}
    });
    this.app.get('/api/summary', (_req,res)=>res.json(this.db.getGameSummary(this.activeChannelId())));
    this.app.get('/api/status', (_req, res) => {
      const settings = this.db.getSettings();
      const channelId = this.activeChannelId();
      const players = this.db.listPlayers(channelId);
      res.json({
        ok: true,
        version: '1.0.0',
        twitchConnected: Boolean(this.twitch?.isConnected()),
        overlayUrl: `http://127.0.0.1:${this.port}/overlay.html`,
        settings,
        chanceTotal: this.db.getChanceTotal(),
        summary: {
          players: players.length,
          catches: players.reduce((sum, row) => sum + Number(row.total_catches || 0), 0),
          items: this.db.listItems().length
        }
      });
    });

    this.app.get('/api/items', (_req, res) => {
      res.json({ items: this.db.listItems(), chanceTotal: this.db.getChanceTotal() });
    });

    this.app.patch('/api/items/:id/enabled', (req,res) => {
      try {
        if(!this.db.setItemEnabled(req.params.id,req.body?.enabled))return res.status(404).json({error:'Item não encontrado.'});
        res.json({ok:true,chanceTotal:this.db.getChanceTotal()});
      }catch(error){res.status(400).json({error:error.message});}
    });

    this.app.post('/api/items', (req, res) => {
      try {
        if (!req.body?.name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
        const id = this.db.addItem(req.body);
        res.json({ ok: true, id, chanceTotal: this.db.getChanceTotal() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.put('/api/items/:id', (req, res) => {
      try {
        if (!req.body?.name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
        this.db.updateItem(req.params.id, req.body);
        res.json({ ok: true, chanceTotal: this.db.getChanceTotal() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/api/items/:id', (req, res) => {
      this.db.deleteItem(req.params.id);
      res.json({ ok: true, chanceTotal: this.db.getChanceTotal() });
    });

    this.app.post('/api/settings', (req, res) => {
      const allowed = [
        'command',
        'cooldown_seconds',
        'fishing_seconds',
        'overlay_result_seconds',
        'achievement_seconds',
        'achievement_overlay_enabled',
        'chat_pending_template',
        'overlay_enabled',
        'overlay_sound_enabled',
        'overlay_show_image',
        'overlay_bg_color',
        'overlay_text_color',
        'overlay_accent_color',
        'overlay_gold_color',
        'overlay_opacity',
        'overlay_x',
        'overlay_y',
        'overlay_scale',
        'overlay_image_size',
        'overlay_image_scale',
        'overlay_radius',
        'overlay_animation',
        'overlay_layout',
        'overlay_width',
        'overlay_height',
        'chat_result_enabled',
        'chat_cooldown_enabled',
        'chat_result_template',
        'chat_cursed_template',
        'chat_cooldown_template',
        'twitch_client_id',
        'target_channel_login',
        'expected_bot_login'
      ];
      const body = req.body || {};
      for (const [key, min, max] of [['cooldown_seconds', 0, 86400], ['fishing_seconds', 0, 120],
        ['overlay_result_seconds', 1, 60], ['achievement_seconds', 1, 60], ['overlay_width', 320, 1920], ['overlay_height', 180, 1080], ['overlay_image_size',36,320], ['overlay_image_scale',50,300]]) {
        if (Object.prototype.hasOwnProperty.call(body, key) &&
          (String(body[key]).trim() === '' || !Number.isFinite(Number(body[key])) || Number(body[key]) < min || Number(body[key]) > max)) {
          return res.status(400).json({ error: 'Tempo inválido: ' + key + '. Use entre ' + min + ' e ' + max + ' segundos.' });
        }
      }
      if (body.overlay_layout !== undefined && !['classic', 'compact', 'showcase'].includes(body.overlay_layout)) {
        return res.status(400).json({ error: 'Modelo de overlay inválido.' });
      }
      if(body.command!==undefined&&listCommands(this.db).some(def=>def.enabled&&def.command.toLowerCase()===String(body.command).trim().toLowerCase()))return res.status(400).json({error:'Esse nome já está em uso por uma consulta do chat.'});
      if (body.command !== undefined && !/^![^\s{}]{1,40}$/.test(String(body.command).trim())) {
        return res.status(400).json({ error: 'O comando deve começar com ! e não conter espaços (até 40 caracteres).' });
      }
      for (const key of ['chat_result_template', 'chat_cursed_template', 'chat_cooldown_template', 'chat_pending_template']) {
        if (body[key] !== undefined && (!String(body[key]).trim() || String(body[key]).length > 500)) {
          return res.status(400).json({ error: 'As mensagens devem ter entre 1 e 500 caracteres.' });
        }
      }
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) this.db.setSetting(key, req.body[key]);
      }
      const settings = this.db.getSettings();
      this.broadcast({ type: 'settings:updated', settings });
      res.json({ ok: true, settings });
    });

    this.app.post('/api/overlay/test', async (req, res) => {
      const execute = async () => {
        const settings = { ...this.db.getSettings(), ...(req.body?.settings || {}) };
        const values = ['overlay_x','overlay_y','overlay_scale','overlay_opacity','overlay_image_size','overlay_radius'];
        for (const key of values) if (!Number.isFinite(Number(settings[key]))) throw new Error('Configuração de overlay inválida.');
        const user = { id: 'overlay-preview', login: 'preview', displayName: 'Prévia do Overlay' };
        const item = this.db.listItems()[0] || { name: 'Peixe de exemplo', rarity: 'Raro', image_path: '' };
        // A prévia entra na mesma fila visual, mas não muda banco, cooldown ou chat.
        this.broadcast({ type: 'settings:updated', previewSettings: true, settings: { ...settings, overlay_enabled: '1', achievement_overlay_enabled: '1' } });
        try {
          this.broadcast({ type: 'fishing:start', user, durationMs: 1500 });
          await new Promise(resolve => setTimeout(resolve, 1500));
          this.broadcast({ type: 'fishing:result', user, item: { ...item, goldAwarded: 42 }, player: { gold: 42, totalCatches: 1 }, durationMs: 2500, preview: true });
          await new Promise(resolve => setTimeout(resolve, 2750));
          this.broadcast({ type: 'achievement:unlocked', user, achievement: { name: 'Estreia no lago', description: 'Exemplo de conquista.' }, durationMs: 2500, preview: true });
          await new Promise(resolve => setTimeout(resolve, 2750));
        } finally { this.broadcast({ type: 'settings:updated', settings: this.db.getSettings() }); }
        await new Promise(resolve => setTimeout(resolve, this.engine.interPlayerDelayMs));
        return { ok: true };
      };
      const promise = this.engine.queue.then(execute, execute);
      this.engine.queue = promise.catch(() => {});
      try { res.json(await promise); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });

    this.app.post('/api/test-fish', async (req, res) => {
      if (!this.engine) return res.status(503).json({ error: 'Motor não iniciado.' });
      const settings = this.db.getSettings();
      const user = {
        id: req.body?.userId || 'test-user',
        login: req.body?.login || 'pescador_teste',
        displayName: req.body?.displayName || 'Pescador Teste'
      };
      const result = await this.engine.fish({
        channelId: settings.active_channel_id || 'local-test',
        user,
        bypassCooldown: true
      });
      if (!result.ok && result.reason === 'invalid_chance_total') {
        return res.status(400).json({
          error: `Configure pelo menos um item com chance maior que zero.`
        });
      }
      res.json(result);
    });

    this.app.get('/api/overlay-style/:kind', (req,res)=>{
      if(!KINDS.includes(req.params.kind))return res.status(404).json({error:'Overlay inválido.'});
      res.json(readStyle(this.db,req.params.kind));
    });
    this.app.post('/api/overlay-style/:kind', (req,res)=>{
      try {
        const values=validateStyle(req.params.kind,req.body||{});
        for(const [key,value] of Object.entries(values))this.db.setSetting(req.params.kind+'_overlay_'+key,value);
        this.broadcast({type:'settings:updated',settings:this.db.getSettings()});
        res.json({ok:true,style:readStyle(this.db,req.params.kind)});
      }catch(error){res.status(400).json({error:error.message});}
    });
    this.app.get('/api/overlay-style/:kind/preview', (req,res)=>{
      if(!KINDS.includes(req.params.kind))return res.status(404).json({error:'Overlay inválido.'});
      res.json(this.panelSnapshot(req.params.kind,'',true));
    });
    this.app.post('/api/overlay-style/:kind/test', async (req,res)=>{
      try {
        const kind=req.params.kind;
        const style={...readStyle(this.db,kind),...validateStyle(kind,req.body||{}),enabled:'1'};
        await this.enqueuePanel(kind,'',style,true);
        res.json({ok:true});
      }catch(error){res.status(400).json({error:error.message});}
    });
    this.app.post('/api/overlay/panel', async (req,res)=>{
      const kind=req.body?.kind,userId=String(req.body?.userId||'');
      if(!['ranking','achievements','collection'].includes(kind))return res.status(400).json({error:'Painel inválido.'});
      if((kind!=='ranking'||userId)&&!this.db.getPlayer(this.activeChannelId(),userId))return res.status(400).json({error:'Selecione um jogador.'});
      try{await this.enqueuePanel(kind,userId);res.json({ok:true});}
      catch(error){res.status(400).json({error:error.message});}
    });
    this.app.get('/api/overlay/panel',(req,res)=>{
      const kind=req.query.kind;
      if(!['ranking','achievements','collection'].includes(kind))return res.status(400).json({error:'Painel inválido.'});
      res.json(this.panelSnapshot(kind,String(req.query.userId||'')));
    });

    this.app.get('/api/leaderboard', (_req, res) => {
      res.json(this.db.getLeaderboard(this.activeChannelId(), 100));
    });

    this.app.put('/api/leaderboard/:userId', (req, res) => {
      try {
        const player = this.db.updatePlayerStats(this.activeChannelId(), req.params.userId, req.body || {});
        if (!player) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json({ ok: true, player });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/leaderboard/:userId/reset', (req, res) => {
      const player = this.db.resetPlayerRank(this.activeChannelId(), req.params.userId);
      if (!player) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ ok: true, player });
    });

    this.app.get('/api/players', (_req, res) => {
      res.json(this.db.listPlayers(this.activeChannelId()));
    });

    this.app.get('/api/collection', (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) return res.status(400).json({ error: 'Informe o usuário.' });
      res.json({
        items: this.db.getCollection(this.activeChannelId(), userId),
        summary: this.db.getCollectionSummary(this.activeChannelId(), userId)
      });
    });

    this.app.get('/api/achievement-definitions', (_req, res) => res.json(this.db.listAchievementDefinitions()));
    this.app.post('/api/achievement-definitions', (req, res) => {
      try { res.json({ ok: true, id: this.db.saveAchievement(null, req.body || {}) }); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });
    this.app.put('/api/achievement-definitions/:id', (req, res) => {
      try { res.json({ ok: true, id: this.db.saveAchievement(req.params.id, req.body || {}) }); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });
    this.app.post('/api/test-cooldown', async (_req, res) => {
      try {
        if (!this.twitch?.isConnected()) return res.status(400).json({ error: 'Conecte a conta do bot à Twitch antes deste teste.' });
        const message = this.db.getSetting('chat_cooldown_template', '').replace(/\{(user|tempo|item|raridade|ouro|ouro_total|pescarias)\}/gi,
          (_match, key) => key.toLowerCase() === 'user' ? 'pescador_teste' : key.toLowerCase() === 'tempo' ? '10 s' : '').trim().slice(0, 500);
        if (!message.trim()) return res.status(400).json({ error: 'Salve uma mensagem de cooldown antes de testar.' });
        await this.twitch.sendChatMessage(message);
        this.broadcast({ type: 'bot:sent', message });
        res.json({ ok: true });
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    this.app.post('/api/achievements/:userId/reset', (req, res) => {
      try {
        res.json({ ok: true, ...this.db.resetAchievements(this.activeChannelId(), req.params.userId) });
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    this.app.get('/api/achievements', (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) return res.status(400).json({ error: 'Informe o usuário.' });
      res.json(this.db.getAchievements(this.activeChannelId(), userId));
    });

    this.app.post('/api/twitch/device', async (req, res) => {
      try {
        const clientId = String(req.body?.clientId || this.db.getSetting('twitch_client_id', '')).trim();
        if (!clientId) return res.status(400).json({ error: 'Informe o Client ID da Twitch.' });
        this.db.setSetting('twitch_client_id', clientId);
        const device = await this.twitch.startDeviceAuth(clientId);
        res.json(device);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  panelSnapshot(kind,userId='',demo=false) {
    const channel=this.activeChannelId();
    const player=demo?{display_name:'Pescador de exemplo',login:'pescador'}:this.db.getPlayer(channel,userId);
    if(['legendary','mythic'].includes(kind)) {
      const rarity=kind==='legendary'?'Lendário':'Mítico';
      const item=this.db.listItems().find(item=>item.rarity===rarity)||{name:kind==='mythic'?'Leviatã':'Tubarão Dourado',rarity,image_path:''};
      return {user:{displayName:'Pescador de exemplo'},item:{...item,goldAwarded:item.gold_min||42}};
    }
    if(kind==='ranking') {
      if(demo)return {kind,rows:Array.from({length:5},(_,i)=>({display_name:['JumperJJJ','Pescador do lago','Maré Azul','Capitão','Peixe de Ouro'][i],gold:5000-i*650,total_catches:30-i*3,discovered:5-i,collection_total:8}))};
      const rows=this.db.getLeaderboard(channel,5);
      let focus=null;
      if(player) {
        const rank=this.db.db.prepare('SELECT position FROM (SELECT twitch_user_id, ROW_NUMBER() OVER(ORDER BY gold DESC,total_catches DESC,twitch_user_id ASC) AS position FROM players WHERE channel_id=?) WHERE twitch_user_id=?').get(channel,userId);
        const collection=this.db.getCollectionSummary(channel,userId);
        focus={...player,position:rank?.position,discovered:collection.discovered,collection_total:collection.total};
      }
      return {kind,rows,focus};
    }
    if(kind==='collection') {
      const items=demo?this.db.listItems().filter(item=>item.counts_for_collection).map((item,i)=>({...item,quantity:i<5?i+1:0})):this.db.getCollection(channel,userId);
      return {kind,player,items};
    }
    const data=demo?{player,achievements:this.db.listAchievementDefinitions().filter(a=>a.enabled).map((a,i)=>({...a,unlocked:i<5,progress:i<5?a.target:0}))}:this.db.getAchievements(channel,userId);
    return {kind,...data};
  }

  async enqueuePanel(kind,userId='',override=null,demo=false) {
    if(!this.engine)throw new Error('Motor não iniciado.');
    const job=async()=>{
      const style=override||readStyle(this.db,kind);
      if(style.enabled==='0')throw new Error('Ative este overlay em Outros overlays.');
      const snapshot=this.panelSnapshot(kind,userId,demo);
      let durationMs=Number(style.duration)*1000;
      if(['legendary','mythic'].includes(kind)&&demo) {
        const fishingMs=Math.max(300,Number(this.db.getSetting('fishing_seconds','4'))*1000);
        this.broadcast({type:'fishing:start',user:snapshot.user,durationMs:fishingMs,preview:true});
        await new Promise(resolve=>setTimeout(resolve,fishingMs));
        durationMs+=350;
        this.broadcast({type:'fishing:result',...snapshot,special:{kind,style,transitionMs:350},durationMs,preview:true});
        this.broadcast({type:'special:catch',kind,...snapshot,style,durationMs,preview:true,presentation:'fishing'});
      }else this.broadcast({type:['legendary','mythic'].includes(kind)?'special:catch':'panel:show',kind,userId,snapshot,style,durationMs,preview:demo});
      await new Promise(resolve=>setTimeout(resolve,durationMs+250+this.engine.interPlayerDelayMs));
    };
    const promise=this.engine.queue.then(job,job);
    this.engine.queue=promise.catch(()=>{});
    return promise;
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => { this.port = this.server.address().port; resolve(this.port); });
    });
  }

  stop() {
    this.events.close();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

module.exports = { LocalServer };
