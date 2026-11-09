const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
try { process.loadEnvFile(path.join(__dirname,'..','.env')); } catch(error) { if(error.code!=='ENOENT')throw error; }
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required.');
const sourcePath=path.resolve(process.env.SQLITE_MIGRATION_SOURCE || './data/pro-quiz.sqlite');
if (!fs.existsSync(sourcePath)) throw Error('SQLite source does not exist.');
const source=new DatabaseSync(sourcePath,{readOnly:true});
const directory=path.join(path.dirname(sourcePath),'backups');fs.mkdirSync(directory,{recursive:true});
const backup=path.join(directory,`before-postgres-${Date.now()}.sqlite`);
source.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
process.env.DATABASE_DRIVER='postgres';
const db=require('../server/database');
const tables=['users','app_meta','question_sets','questions','options','attempts','wrong_answers','chat_messages'];
(async()=>{
 try {
  await db.ready;
  source.exec('BEGIN');
  const data=Object.fromEntries(tables.map(table=>[table,source.prepare(`SELECT * FROM ${table}`).all()]));
  await db.transaction(async()=>{
   // Nothing is overwritten. Serialize the empty-target check with the import.
   await db.prepare('LOCK TABLE '+tables.join(',')+' IN EXCLUSIVE MODE').run();
   for(const table of tables)if((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count)throw Error('Target is not empty; migration cancelled.');
   for(const table of tables){
    for(const row of data[table]){
     const columns=Object.keys(row);
     if(columns.some(column=>!/^[a-z_]+$/.test(column)))throw Error('Unexpected source column.');
     await db.prepare(`INSERT INTO ${table} (${columns.map(column=>'"'+column+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
    }
    const count=(await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count;
    if(count!==data[table].length)throw Error('Row count mismatch.');
    if(!['users','app_meta'].includes(table))await db.prepare(`SELECT setval(?, COALESCE(MAX(id),1), COUNT(*)>0) FROM ${table}`).get(table+'_id_seq');
   }
  });
  source.exec('COMMIT');
  console.log(JSON.stringify({migrated:true,backup,counts:Object.fromEntries(tables.map(table=>[table,data[table].length]))}));
 } catch(error){try{source.exec('ROLLBACK');}catch{}console.error(error.message==='Target is not empty; migration cancelled.'?error.message:'Migration failed; source retained. Code: '+(error.code||'unknown'));process.exitCode=1;}
 finally {source.close();await db.close();}
})();
