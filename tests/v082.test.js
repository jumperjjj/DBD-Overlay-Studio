const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {GameDatabase}=require('../src/database'),{FishingEngine}=require('../src/fishing-engine'),{LocalServer}=require('../src/local-server');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fishing-v082-')),db=new GameDatabase(dir);t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});return{db,dir};}
test('item enable toggle persists, limits catches to selected item and preserves existing progress',async t=>{
 const {db,dir}=fixture(t),items=db.listItems(),only=items.find(i=>i.rarity==='Lendário'),user={id:'alice',login:'alice',displayName:'Alice'};
 db.applyCatch('c',user,only,7);const oldCollection=db.getCollection('c','alice');
 for(const item of items)assert.equal(db.setItemEnabled(item.id,item.id===only.id),true);
 assert.deepEqual(db.getFishingItems().map(i=>i.id),[only.id]);assert.equal(db.getChanceTotal(),only.chance);assert.deepEqual(db.getCollection('c','alice'),oldCollection);
 const reopened=new GameDatabase(dir);assert.deepEqual(reopened.getFishingItems().map(i=>i.id),[only.id]);reopened.close();
 for(const[key,value]of Object.entries({fishing_seconds:'0',legendary_overlay_duration:'0.01',overlay_result_seconds:'0.01',achievement_overlay_enabled:'0'}))db.setSetting(key,value);
 const events=[],engine=new FishingEngine(db,e=>events.push(e));engine.interPlayerDelayMs=0;
 const result=await engine.fish({channelId:'c',user,bypassCooldown:true});assert.equal(result.item.id,only.id);assert.equal(result.special.kind,'legendary');assert.equal(result.durationMs,360);assert.equal(events.find(e=>e.type==='special:catch').presentation,'fishing');
 db.setItemEnabled(only.id,false);assert.equal((await engine.fish({channelId:'c',user,bypassCooldown:true})).reason,'no_items');assert.equal(db.listItems().find(i=>i.id===only.id).chance,only.chance);assert.throws(()=>db.setItemEnabled(only.id,'false'));assert.equal(db.setItemEnabled(99999,true),false);
});
test('special test endpoints play the complete fishing sequence without changing players, gold or catches',async t=>{
 const {db}=fixture(t),events=[],server=new LocalServer({database:db,port:0}),engine=new FishingEngine(db,e=>server.broadcast(e));engine.interPlayerDelayMs=0;server.setEngine(engine);db.setSetting('fishing_seconds','0');await server.start();t.after(async()=>{for(const c of server.wss.clients)c.terminate();await server.stop();});const broadcast=server.broadcast.bind(server);server.broadcast=e=>{events.push(e);broadcast(e);};const url='http://127.0.0.1:'+server.port;
 const before=db.getGameSummary('local-test');
 for(const kind of ['legendary','mythic']){events.length=0;const response=await fetch(url+'/api/overlay-style/'+kind+'/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:1,title:'Meu teste',scale:60})});assert.equal(response.status,200);assert.deepEqual(events.filter(e=>e.type.startsWith('fishing:')).map(e=>e.type),['fishing:start','fishing:result']);const result=events.find(e=>e.type==='fishing:result');assert.equal(result.preview,true);assert.equal(result.special.kind,kind);assert.equal(result.special.style.title,'Meu teste');assert.equal(result.special.style.scale,'60');assert.equal(events.find(e=>e.type==='special:catch').presentation,'fishing');assert.deepEqual(db.getGameSummary('local-test'),before);}
 const item=db.listItems()[0];const toggle=await fetch(url+'/api/items/'+item.id+'/enabled',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});assert.equal(toggle.status,200);assert.equal(db.listItems().find(i=>i.id===item.id).enabled,0);assert.deepEqual(db.getGameSummary('local-test'),before);
});
