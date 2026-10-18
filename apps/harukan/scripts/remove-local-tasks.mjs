import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {retireTasks} from '../server/retire-tasks.mjs';
process.umask(0o077);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(root,'.omo/preview-data'),filename=resolve(directory,'planner.sqlite');
if(!existsSync(filename))throw Error('Local preview database not found.');
const db=new DatabaseSync(filename),apply=process.argv.includes('--apply');
try{
 const hasTasks=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get());
 const before={days:db.prepare('SELECT COUNT(*) n FROM days').get().n,planning:db.prepare('SELECT COUNT(*) n FROM planning').get().n,tasks:hasTasks?db.prepare('SELECT COUNT(*) n FROM tasks').get().n:0};
 if(!apply){console.log(JSON.stringify({apply,before,scope:'.omo/preview-data only'},null,2));}
 else {
  const backupDirectory=resolve(directory,'sample-backups');mkdirSync(backupDirectory,{recursive:true,mode:0o700});
  const backup=resolve(backupDirectory,`before-task-removal-${Date.now()}.sqlite`);db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);chmodSync(backup,0o600);
  const result=retireTasks(db);const after={days:db.prepare('SELECT COUNT(*) n FROM days').get().n,planning:db.prepare('SELECT COUNT(*) n FROM planning').get().n};
  if(after.days!==before.days||after.planning!==before.planning)throw Error('Unexpected diary/planning removal.');
  const manifest={apply,before,after,...result,backup:backup.replace(root+'/',''),at:new Date().toISOString()};
  writeFileSync(resolve(directory,'task-removal-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify(manifest,null,2));
 }
}finally{db.close();}
