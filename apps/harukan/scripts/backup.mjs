import {DatabaseSync,backup} from 'node:sqlite';
import {chmod,mkdir,readdir,stat,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export async function backupPlanner({source,directory,now=Date.now()}){
  await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  const target=join(directory,`planner-${new Date(now).toISOString().replace(/[:.]/g,'-')}.sqlite`);
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,target);await chmod(target,0o600);}finally{db.close();}
  const check=new DatabaseSync(target,{readOnly:true});try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup integrity check failed');}finally{check.close();}
  for(const name of await readdir(directory)){if(!/^planner-20\d\d-.*\.sqlite(-wal|-shm)?$/.test(name))continue;const file=join(directory,name);if((await stat(file)).mtimeMs<now-7*86400000)await unlink(file);}
  return target;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  const source=join(process.env.PLANNER_DATA_DIR||'/data','planner.sqlite'),directory=process.env.PLANNER_BACKUP_DIR||'/backups';
  await backupPlanner({source,directory});console.log('Planner backup verified; older planner backups pruned after 7 days.');
}
