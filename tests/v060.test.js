const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameDatabase } = require('../src/database');
const { FishingEngine } = require('../src/fishing-engine');
const { LocalServer } = require('../src/local-server');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishing-v060-'));
  const db = new GameDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  for (const [key,value] of Object.entries({fishing_seconds:'0',overlay_result_seconds:'0.01',achievement_seconds:'0.01',cooldown_seconds:'0'})) db.setSetting(key,value);
  return db;
}
const user = id => ({id, login:id, displayName:id});

test('next player waits three seconds after the last result or achievement, despite slow bot', async t => {
  const db = fixture(t);
  const events = [];
  const engine = new FishingEngine(db, event => events.push({...event, at:Date.now()}));
  engine.pickByChance = items => items[0];
  engine.randomGold = () => 1;
  engine.onResult = () => new Promise(() => {});
  const first = engine.fish({channelId:'c',user:user('alice')});
  const second = engine.fish({channelId:'c',user:user('alice2')});
  const third = engine.fish({channelId:'c',user:user('alice')});
  assert.equal((await third).pending,true);
  await Promise.all([first,second]);
  const next = engine.fish({channelId:'c',user:user('alice')});
  const last = engine.fish({channelId:'c',user:user('bob')});
  await Promise.all([next,last]);
  for (let i=1;i<events.length;i++) {
    if(events[i].type!=='fishing:start')continue;
    const previous=events[i-1];
    assert.ok(events[i].at-previous.at >= previous.durationMs+3200);
  }
  assert.equal(events.filter(e=>e.type==='fishing:result').length,4);
  assert.equal(events.filter(e=>e.type==='achievement:unlocked'&&e.user.id==='alice').length,1);
});

test('overlay panels return current top five and collection totals; source size is validated', async t => {
  const db = fixture(t);
  for(let i=0;i<7;i++)db.applyCatch('local-test',user('p'+i),db.listItems()[i%2],i+10);
  const server=new LocalServer({database:db,port:0});
  server.setEngine(new FishingEngine(db,event=>server.broadcast(event)));
  await server.start();
  t.after(async()=>{for(const client of server.wss.clients)client.terminate();await server.stop();});
  const url='http://127.0.0.1:'+server.port;
  const rank=await fetch(url+'/api/overlay/panel?kind=ranking').then(r=>r.json());
  assert.equal(rank.rows.length,5);
  assert.equal(rank.rows[0].login,'p6');
  assert.equal(rank.rows[0].discovered,1);
  assert.equal(rank.rows[0].collection_total,db.listItems().length);
  db.unlockAchievements('local-test','p0');
  const achievements=await fetch(url+'/api/overlay/panel?kind=achievements&userId=p0').then(r=>r.json());
  assert.ok(achievements.achievements.some(a=>a.unlocked));
  const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/settings',{overlay_width:'400',overlay_height:'200'})).status,200);
  assert.equal(db.getSetting('overlay_width'),'400');
  assert.equal((await post('/api/settings',{overlay_width:'100'})).status,400);
  assert.equal((await post('/api/overlay/panel',{kind:'achievements',userId:'missing'})).status,400);
});
