// Local-only preview data (scripts/sample-data.mjs): a junior developer job seeker, June–December 2026.
// Replaces the two preview accounts' days and plans in .omo/preview-data (backup first). Dry run unless --apply. Never for production.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDay,transaction} from '../server/store.mjs';
import {planning,days} from './sample-data.mjs';
process.umask(0o077);
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(project,'.omo/preview-data'),filename=resolve(directory,'planner.sqlite');
const apply=process.argv.includes('--apply'),db=new DatabaseSync(filename);
const users=['jaymunsh','test1234'].map(name=>db.prepare('SELECT id,username FROM users WHERE username=?').get(name)).filter(Boolean);
if(!users.length)throw Error('No expected local preview accounts found.');
const batch='local-sample-jobseeker-2026';
const result={batch,localDatabase:'.omo/preview-data/planner.sqlite',from:days[0].date,to:days.at(-1).date,days:days.length,planning:planning.length,mode:apply?'applied':'dry-run',accounts:users.map(u=>u.username)};
try{
 if(apply){
  const backupDir=resolve(directory,'sample-backups');mkdirSync(backupDir,{recursive:true,mode:0o700});const backup=resolve(backupDir,`before-${batch}-${Date.now()}.sqlite`);db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);chmodSync(backup,0o600);result.backup=backup.replace(project+'/','');
  const now=Date.now();
  transaction(db,()=>{for(const user of users){
   db.prepare('DELETE FROM days WHERE user_id=?').run(user.id);db.prepare('DELETE FROM planning WHERE user_id=?').run(user.id);
   for(const item of planning){const {id,...document}=item;db.prepare('INSERT INTO planning VALUES(?,?,?,?,?)').run(id,user.id,JSON.stringify(document),1,now);}
   for(const day of days)db.prepare('INSERT INTO days(user_id,date,document,version,updated_at) VALUES(?,?,?,1,?)').run(user.id,day.date,JSON.stringify(validateDay(day.document,db,user.id)),now);
  }});
  writeFileSync(resolve(directory,`${batch}-manifest.json`),JSON.stringify({...result,createdAt:new Date().toISOString()},null,2),{mode:0o600});
 }else for(const user of users)for(const day of days)validateDay(day.document,db,user.id);
 console.log(JSON.stringify(result,null,2));
}finally{db.close();}
