const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {GameDatabase}=require('../src/database');const {GameEvents,DEFAULT_DRAFT,validateDraft}=require('../src/game-events');const {FishingEngine}=require('../src/fishing-engine');const {LocalServer}=require('../src/local-server');
const user=id=>({id,login:id,displayName:id});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fishing-v080-'));const db=new GameDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});return {db,dir};}
test('event options validate independently and combined bonuses preserve the base catalog',async t=>{
 const {db}=fixture(t);const messages=[];const manager=new GameEvents(db,()=>{},async text=>{messages.push(text);});t.after(()=>manager.close());
 assert.throws(()=>validateDraft({...DEFAULT_DRAFT,goldEnabled:false}),/pelo menos/);assert.throws(()=>validateDraft({...DEFAULT_DRAFT,cooldownReduction:101}),/inválido/);
 const draft={...DEFAULT_DRAFT,name:'Hora da maré',goldBonus:25,rareEnabled:true,rareBonus:100,rarities:['Raro'],frenzyEnabled:true,cooldownReduction:80,curseEnabled:true,curseBonus:50};
 await manager.start('c',draft);assert.equal(manager.gold('c',100),125);assert.equal(manager.gold('c',-100),-100);assert.ok(Math.abs(manager.cooldown('c',120)-24)<1e-8);
 const catalog=[{rarity:'Comum',chance:60},{rarity:'Raro',chance:20},{rarity:'Amaldiçoado',chance:2}];const boosted=manager.items('c',catalog);assert.deepEqual(boosted.map(i=>i.chance),[60,40,3]);assert.deepEqual(catalog.map(i=>i.chance),[60,20,2]);assert.equal(manager.gold('other',100),100);
 manager.saveDraft('c',{...draft,goldBonus:500});assert.equal(manager.active('c').goldBonus,25);await assert.rejects(()=>manager.start('c',draft),/Encerre/);
 await manager.stop('c');assert.equal(manager.cooldown('c',120),120);assert.equal(manager.gold('c',100),100);assert.equal(messages.length,2);assert.match(messages[0],/ouro \+25%/);
});
test('event survives restart, expires automatically and sends one ending notice',async t=>{
 const {db,dir}=fixture(t);const manager=new GameEvents(db);await manager.start('c',{...DEFAULT_DRAFT,announce:false});manager.close();
 const reopened=new GameDatabase(dir);const messages=[];const restored=new GameEvents(reopened,()=>{},async text=>messages.push(text));
 try{assert.equal(restored.active('c').name,DEFAULT_DRAFT.name);const row=reopened.db.prepare("SELECT * FROM game_events WHERE status='active'").get();const config={...JSON.parse(row.config),announce:true};reopened.db.prepare('UPDATE game_events SET ends_at=?,config=? WHERE id=?').run(Date.now()+70,JSON.stringify(config),row.id);restored.schedule(reopened.db.prepare('SELECT * FROM game_events WHERE id=?').get(row.id));await new Promise(r=>setTimeout(r,160));assert.equal(restored.active('c'),null);assert.equal(restored.state('c').history[0].status,'expired');assert.equal(messages.length,1);await restored.stop('c');assert.equal(messages.length,1);}finally{restored.close();reopened.close();}
});
test('cursed capture deducts only available gold; gain and loss achievement metrics are separate',async t=>{
 const {db}=fixture(t);const id=db.addItem({name:'Peixe fantasma',rarity:'Amaldiçoado',chance:.1,goldMin:1000,goldMax:5000});const curse=db.listItems().find(i=>i.id===id);
 const lost=db.saveAchievement(null,{name:'Tributo',metric:'lost_gold',target:30});const cursed=db.saveAchievement(null,{name:'Susto',metric:'rarity_count',parameter:'Amaldiçoado',target:1});const earned=db.saveAchievement(null,{name:'Ganhos',metric:'total_gold',target:20});
 db.ensurePlayer('c',user('alice'));db.updatePlayerStats('c','alice',{gold:40,totalCatches:0});
 const result=db.applyCatch('c',user('alice'),curse,-1000);assert.equal(result.gold,0);assert.equal(result.gold_delta,-40);assert.equal(db.getCollectionSummary('c','alice').discovered,1);
 const unlocks=db.unlockAchievements('c','alice');assert.ok(unlocks.some(a=>a.id===lost));assert.ok(unlocks.some(a=>a.id===cursed));assert.ok(!unlocks.some(a=>a.id===earned));
 const empty=db.applyCatch('c',user('alice'),curse,-3000);assert.equal(empty.gold_delta,0);
 db.applyCatch('c',user('alice'),db.listItems()[0],20);const data=db.getAchievements('c','alice').achievements;assert.equal(data.find(a=>a.id===earned).progress,20);assert.equal(data.find(a=>a.id===lost).progress,40);
 for(const [key,value] of Object.entries({cooldown_seconds:'0',fishing_seconds:'0',overlay_result_seconds:'0.01',achievement_overlay_enabled:'0'}))db.setSetting(key,value);
 const manager=new GameEvents(db);t.after(()=>manager.close());await manager.start('c',{...DEFAULT_DRAFT,goldBonus:1000,announce:false});const engine=new FishingEngine(db,()=>{});engine.events=manager;engine.interPlayerDelayMs=0;engine.pickByChance=items=>items.find(i=>i.id===id);engine.randomGold=()=>1000;
 const capture=await engine.fish({channelId:'c',user:user('alice')});assert.equal(capture.item.isCursed,true);assert.equal(capture.item.goldAwarded,-20);assert.equal(capture.player.gold,0);
});
test('event benefits are fixed at cast start, even if the event ends during the animation',async t=>{
 const {db}=fixture(t);for(const [key,value] of Object.entries({cooldown_seconds:'0',fishing_seconds:'0.1',overlay_result_seconds:'0.01',achievement_overlay_enabled:'0'}))db.setSetting(key,value);
 const manager=new GameEvents(db);t.after(()=>manager.close());await manager.start('c',{...DEFAULT_DRAFT,goldBonus:100,announce:false});const engine=new FishingEngine(db,()=>{});engine.events=manager;engine.interPlayerDelayMs=0;engine.pickByChance=items=>items[0];engine.randomGold=()=>10;
 const catching=engine.fish({channelId:'c',user:user('alice')});await new Promise(r=>setTimeout(r,30));await manager.stop('c');assert.equal((await catching).item.goldAwarded,20);assert.equal((await engine.fish({channelId:'c',user:user('bob')})).item.goldAwarded,10);
});
test('player deletion clears only that channel, rejects pending catches, and new participation starts fresh',async t=>{
 const {db}=fixture(t);for(const channel of ['local-test','other']){db.applyCatch(channel,user('alice'),db.listItems()[0],10);db.unlockAchievements(channel,'alice');}
 const server=new LocalServer({database:db,port:0});const engine=new FishingEngine(db,e=>server.broadcast(e));server.setEngine(engine);await server.start();t.after(async()=>{for(const c of server.wss.clients)c.terminate();await server.stop();});
 const url='http://127.0.0.1:'+server.port;const key=JSON.stringify(['local-test','alice']);engine.pending.add(key);assert.equal((await fetch(url+'/api/players/alice',{method:'DELETE'})).status,409);engine.pending.delete(key);
 assert.equal((await fetch(url+'/api/players/alice',{method:'DELETE'})).status,200);assert.equal(db.getPlayer('local-test','alice'),undefined);assert.equal(db.getCollectionSummary('local-test','alice').discovered,0);assert.equal(db.getAchievements('local-test','alice').achievements.some(a=>a.unlocked),false);assert.equal(db.getPlayer('other','alice').gold,10);
 assert.equal(db.ensurePlayer('local-test',user('alice')).gold,0);
});
test('event endpoints announce through bot and report offline delivery without reverting the event',async t=>{
 const {db}=fixture(t);const server=new LocalServer({database:db,port:0});server.setEngine(new FishingEngine(db,e=>server.broadcast(e)));await server.start();t.after(()=>server.stop());
 const url='http://127.0.0.1:'+server.port;const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
 const offline=await post('/api/events/start',DEFAULT_DRAFT);assert.equal(offline.ok,true);assert.match(offline.chatWarning,/conecte o bot/);assert.ok(server.events.active('local-test'));
 await post('/api/events/stop',{});const messages=[];server.setTwitch({isConnected:()=>true,sendChatMessage:async text=>messages.push(text)});const online=await post('/api/events/start',{...DEFAULT_DRAFT,frenzyEnabled:true});assert.equal(online.chatWarning,null);await post('/api/events/stop',{});assert.equal(messages.length,2);assert.match(messages[0],/começou/);assert.match(messages[1],/terminou/);
});
