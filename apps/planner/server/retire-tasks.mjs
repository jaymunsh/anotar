import {transaction} from './store.mjs';

// Explicit maintenance operation. Never called automatically at server startup.
export function retireTasks(db,now=Date.now()) {
 return transaction(db,()=>{
  const hasTasks=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get());
  const result={removedTasks:hasTasks?db.prepare('SELECT COUNT(*) n FROM tasks').get().n:0,updatedDays:0,updatedPlanning:0};
  for(const row of db.prepare('SELECT user_id,date,document FROM days').all()){
   const document=JSON.parse(row.document);let changed=false;
   for(const item of document.plans){if(Object.hasOwn(item,'taskId')){delete item.taskId;changed=true;}}
   if(changed){db.prepare('UPDATE days SET document=?,version=version+1,updated_at=? WHERE user_id=? AND date=?').run(JSON.stringify(document),now,row.user_id,row.date);result.updatedDays++;}
  }
  for(const row of db.prepare('SELECT user_id,id,document FROM planning').all()){
   const document=JSON.parse(row.document);
   if(Object.hasOwn(document,'taskIds')){delete document.taskIds;db.prepare('UPDATE planning SET document=?,version=version+1,updated_at=? WHERE user_id=? AND id=?').run(JSON.stringify(document),now,row.user_id,row.id);result.updatedPlanning++;}
  }
  if(hasTasks)db.exec('DROP TABLE tasks');
  return result;
 });
}
