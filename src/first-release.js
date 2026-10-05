const fs=require('node:fs');
const path=require('node:path');
const RESET_KEY='release_1_0_0_progress_reset';

function prepareFirstRelease(db) {
  if(db.getSetting(RESET_KEY,''))return {reset:false};
  const backupDir=path.join(db.userDataPath,'backups','before-1.0.0-'+new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backupDir,{recursive:true});
  const backupDb=path.join(backupDir,'fishing-game.db');
  // SQLite creates a consistent copy including committed WAL contents.
  // If either backup fails, no player progress is deleted.
  db.db.prepare('VACUUM INTO ?').run(backupDb);
  fs.cpSync(db.imagesPath,path.join(backupDir,'item-images'),{recursive:true});
  const counts={};
  for(const table of ['players','catches','collection','achievement_unlocks','achievement_resets'])counts[table]=Number(db.db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count);
  const record={version:'1.0.0',at:new Date().toISOString(),backupDir,previousCounts:counts};
  db.db.exec('BEGIN IMMEDIATE');
  try {
    for(const table of ['achievement_unlocks','achievement_resets','collection','catches','players'])db.db.exec('DELETE FROM '+table);
    db.db.exec("DELETE FROM sqlite_sequence WHERE name='catches'");
    db.db.exec("UPDATE game_events SET status='stopped' WHERE status='active'");
    db.setSetting(RESET_KEY,JSON.stringify(record));
    db.db.exec('COMMIT');
  }catch(error){db.db.exec('ROLLBACK');throw error;}
  return {reset:true,...record};
}

module.exports={prepareFirstRelease,RESET_KEY};
