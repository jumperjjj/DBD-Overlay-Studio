const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {GameDatabase}=require('../src/database');const {FishingEngine}=require('../src/fishing-engine');const {LocalServer}=require('../src/local-server');const {readStyle}=require('../src/overlay-options');const {WebSocket}=require('ws');
const user=id=>({id,login:id,displayName:id});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fishing-v070-'));const db=new GameDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});return {db,dir};}
test('relative chances accept totals below/above 100 and use the actual total',t=>{
 const {db}=fixture(t);const engine=new FishingEngine(db,()=>{});const original=Math.random;t.after(()=>Math.random=original);
 const items=[{id:'a',chance:30},{id:'b',chance:70},{id:'c',chance:100}];
 Math.random=()=>0;assert.equal(engine.pickByChance(items).id,'a');Math.random=()=>.3;assert.equal(engine.pickByChance(items).id,'b');Math.random=()=>.9;assert.equal(engine.pickByChance(items).id,'c');
 assert.equal(engine.pickByChance([{id:'only',chance:2}]).id,'only');assert.equal(engine.pickByChance([{chance:0}]),null);
 assert.equal(db.normalizeChance(250),250);assert.throws(()=>db.normalizeChance(-1));
});
test('real catches work with totals below and above 100, but reject a zero total',async t=>{
 const {db}=fixture(t);for(const [key,value] of Object.entries({fishing_seconds:'0',overlay_result_seconds:'0.01',achievement_overlay_enabled:'0',cooldown_seconds:'0'}))db.setSetting(key,value);
 db.db.exec('UPDATE items SET chance=0');const items=db.listItems();const engine=new FishingEngine(db,()=>{});engine.interPlayerDelayMs=0;engine.pickByChance=available=>available[0];
 db.db.prepare('UPDATE items SET chance=40 WHERE id=?').run(items[0].id);assert.equal((await engine.fish({channelId:'c',user:user('alice')})).ok,true);
 db.db.prepare('UPDATE items SET chance=240 WHERE id=?').run(items[0].id);assert.equal((await engine.fish({channelId:'c',user:user('alice')})).ok,true);
 db.db.exec('UPDATE items SET chance=0');assert.equal((await engine.fish({channelId:'c',user:user('alice')})).ok,false);assert.equal(db.getPlayer('c','alice').total_catches,2);
});
test('rarity migration preserves custom images, catches and achievement parameters; zero chances stay zero',t=>{
 const {db,dir}=fixture(t);const item=db.listItems().find(i=>i.rarity==='Comum');
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';db.saveItemImage(item.id,image);
 const id=db.saveAchievement(null,{name:'Comuns',metric:'rarity_count',parameter:'Comum',target:1});db.applyCatch('c',user('alice'),item,7);
 db.db.prepare("UPDATE items SET name='Meu peixe',rarity='Incomum' WHERE id=?").run(item.id);db.db.prepare("UPDATE achievement_definitions SET parameter='Incomum' WHERE id=?").run(id);
 db.db.exec('UPDATE items SET chance=0');const reopened=new GameDatabase(dir);
 try{const migrated=reopened.listItems().find(i=>i.id===item.id);assert.equal(migrated.name,'Meu peixe');assert.equal(migrated.rarity,'Comum');assert.ok(migrated.image_path);assert.equal(reopened.listAchievementDefinitions().find(a=>a.id===id).parameter,'Comum');assert.equal(reopened.getAchievements('c','alice').achievements.find(a=>a.id===id).progress,1);assert.equal(reopened.getChanceTotal(),0);assert.equal(reopened.listItems()[0].rarity,'Lixo');}finally{reopened.close();}
});
test('legendary and mythic effects hold the queue until their duration before achievements and next player',async t=>{
 const {db}=fixture(t);for(const [key,value] of Object.entries({fishing_seconds:'0',overlay_result_seconds:'0.01',achievement_seconds:'0.01',cooldown_seconds:'0',legendary_overlay_duration:'0.1',mythic_overlay_duration:'0.1'}))db.setSetting(key,value);
 const events=[];const engine=new FishingEngine(db,e=>events.push({...e,at:Date.now()}));engine.interPlayerDelayMs=0;engine.randomGold=()=>1;
 let pick='Lendário';engine.pickByChance=items=>items.find(i=>i.rarity===pick);
 await engine.fish({channelId:'c',user:user('legend')});pick='Mítico';await engine.fish({channelId:'c',user:user('myth')});
 assert.deepEqual(events.filter(e=>e.type==='special:catch').map(e=>e.kind),['legendary','mythic']);
 for(const special of events.filter(e=>e.type==='special:catch')){const next=events.find(e=>e.at>=special.at&&e.type==='achievement:unlocked'&&e.user.id===special.user.id);assert.ok(next.at-special.at>=330);assert.equal(special.item.goldAwarded,1);}
});
test('independent style validation, player rank, collection snapshot and late source replay',async t=>{
 const {db}=fixture(t);db.applyCatch('local-test',user('alice'),db.listItems()[0],50);db.unlockAchievements('local-test','alice');
 const server=new LocalServer({database:db,port:0});const engine=new FishingEngine(db,e=>server.broadcast(e));engine.interPlayerDelayMs=0;server.setEngine(engine);await server.start();
 t.after(async()=>{for(const c of server.wss.clients)c.terminate();await server.stop();});const url='http://127.0.0.1:'+server.port;
 const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/overlay-style/achievements',{columns:3,bg:'#123456',earned_only:'0'})).status,200);assert.equal(readStyle(db,'achievements').columns,'3');assert.equal(readStyle(db,'ranking').bg,'#0b1825');
 assert.equal((await post('/api/overlay-style/mythic',{duration:0,bg:'#ffaaaa'})).status,400);assert.equal(readStyle(db,'mythic').bg,'#0b1825');assert.equal((await post('/api/overlay-style/collection',{columns:2.5})).status,400);
 const rank=server.panelSnapshot('ranking','alice');assert.equal(rank.focus.position,1);assert.equal(rank.focus.discovered,1);const collection=server.panelSnapshot('collection','alice');assert.equal(collection.items.filter(i=>i.quantity>0).length,1);
 server.broadcast({type:'fishing:result',user:user('alice'),durationMs:1000});server.broadcast({type:'special:catch',kind:'mythic',user:user('alice'),durationMs:1000});
 const ws=new WebSocket('ws://127.0.0.1:'+server.port+'/ws');const received=[];
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Replay missing')),2000);ws.on('error',reject);ws.on('message',raw=>{received.push(JSON.parse(raw));if(received.filter(e=>['fishing:result','special:catch'].includes(e.type)).length===2){clearTimeout(timeout);resolve();}});});ws.close();assert.ok(received.some(e=>e.type==='fishing:result'));assert.ok(received.some(e=>e.type==='special:catch'));
 const catches=db.getPlayer('local-test','alice').total_catches;const response=await post('/api/overlay-style/collection/test',{duration:1});assert.equal(response.status,200);assert.equal(db.getPlayer('local-test','alice').total_catches,catches);
});
