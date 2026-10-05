const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{GameDatabase}=require('../src/database'),{prepareFirstRelease,RESET_KEY}=require('../src/first-release');const{DatabaseSync}=require('node:sqlite');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fishing-release-')),db=new GameDatabase(dir);t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});return{db,dir};}
test('first release backs up all channels, clears only player progress once and preserves catalog/settings/images',t=>{
 const{db,dir}=fixture(t);const user={id:'alice',login:'alice',displayName:'Alice'},item=db.listItems()[0];
 db.saveItemImage(item.id,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
 db.setItemEnabled(item.id,false);db.setSetting('twitch_client_id','public-test-id');db.setSetting('overlay_scale','75');
 for(const channel of ['one','two']){db.applyCatch(channel,user,item,123);db.unlockAchievements(channel,user.id);db.resetAchievements(channel,user.id);}
 db.db.prepare("INSERT INTO game_events(channel_id,name,config,started_at,ends_at,status) VALUES(?,?,?,?,?,'active')").run('one','Teste','{}',Date.now(),Date.now()+60000);
 const items=db.listItems(),definitions=db.listAchievementDefinitions();const reset=prepareFirstRelease(db);assert.equal(reset.reset,true);assert.equal(reset.previousCounts.players,2);
 for(const table of ['players','catches','collection','achievement_unlocks','achievement_resets'])assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count,0);
 assert.deepEqual(db.listItems(),items);assert.deepEqual(db.listAchievementDefinitions(),definitions);assert.equal(db.getSetting('twitch_client_id'),'public-test-id');assert.equal(db.getSetting('overlay_scale'),'75');assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM game_events WHERE status='active'").get().count,0);
 const old=new DatabaseSync(path.join(reset.backupDir,'fishing-game.db'),{readOnly:true});try{assert.equal(old.prepare('SELECT COUNT(*) AS count FROM players').get().count,2);assert.equal(old.prepare('SELECT COUNT(*) AS count FROM catches').get().count,2);assert.equal(old.prepare("SELECT COUNT(*) AS count FROM game_events WHERE status='active'").get().count,1);}finally{old.close();}
 const imageFile=db.listItems().find(i=>i.id===item.id).image_path.split('/').pop();assert.deepEqual(fs.readFileSync(path.join(reset.backupDir,'item-images',imageFile)),fs.readFileSync(path.join(db.imagesPath,imageFile)));
 db.applyCatch('one',user,item,9);assert.equal(prepareFirstRelease(db).reset,false);assert.equal(db.getPlayer('one','alice').gold,9);assert.ok(db.getSetting(RESET_KEY));
 const reopened=new GameDatabase(dir);try{assert.equal(prepareFirstRelease(reopened).reset,false);assert.equal(reopened.getPlayer('one','alice').gold,9);}finally{reopened.close();}
});
test('backup failure leaves player progress and reset marker untouched',t=>{
 const{db}=fixture(t),user={id:'alice',login:'alice',displayName:'Alice'};db.applyCatch('c',user,db.listItems()[0],55);
 const original=fs.cpSync;fs.cpSync=()=>{throw new Error('Simulated image backup failure');};try{assert.throws(()=>prepareFirstRelease(db),/backup failure/);}finally{fs.cpSync=original;}
 assert.equal(db.getPlayer('c','alice').gold,55);assert.equal(db.getSetting(RESET_KEY,''),'');assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM catches').get().count,1);
});
