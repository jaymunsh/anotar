import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deletionRecords} from '../server/deletions.mjs';

// Restore only into a new, private directory; never overwrite the live database.
export async function restorePlanner(source,directory,journalDirectory,now=Date.now()) {
  const records=deletionRecords(journalDirectory,now);
  await mkdir(directory,{mode:0o700});
  const target=join(directory,'planner.sqlite'),original=new DatabaseSync(source,{readOnly:true});
  try{if(original.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup integrity check failed');await backup(original,target);}finally{original.close();}
  await chmod(target,0o600);
  const restored=new DatabaseSync(target);try{
    restored.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    for(const record of records)restored.prepare('DELETE FROM users WHERE id=?').run(record.id);
    restored.exec('DELETE FROM sessions; COMMIT');
    if(restored.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Restored database integrity check failed');
  }finally{restored.close();}
  return target;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  if(process.argv.length!==5)throw Error('Usage: node scripts/restore.mjs <backup.sqlite> <new-directory> <current-data-directory>');
  await restorePlanner(...process.argv.slice(2));console.log('Restored to new directory; recent account deletions reapplied and all sessions revoked.');
}
