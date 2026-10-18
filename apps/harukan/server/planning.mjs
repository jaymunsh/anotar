import {transaction} from './store.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validMonth=value=>typeof value==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(value);
const rowValue=row=>{const {taskIds,...document}=JSON.parse(row.document);return {...document,id:row.id,version:row.version};};
export function listPlanning(db,userId){return db.prepare('SELECT id,document,version FROM planning WHERE user_id=? ORDER BY rowid').all(userId).map(rowValue);}
export function savePlanning(db,userId,id,data,now){
 if(!Number.isInteger(data.version)||data.version<0)fail(400,'저장 버전을 확인해 주세요.');
 // A routine is just a saved name the day view can drop onto the timetable.
 if(data.kind==='routine'){
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>100)fail(400,'루틴 이름을 1–100자로 입력해 주세요.');
  return transaction(db,()=>{
   const current=db.prepare('SELECT document,version FROM planning WHERE user_id=? AND id=?').get(userId,id);
   if((current?.version||0)!==data.version)fail(409,'계획이 다른 기기에서 변경됐어요. 새로 불러온 뒤 확인해 주세요.');
   if(current&&JSON.parse(current.document).kind!=='routine')fail(400,'계획 종류는 변경할 수 없어요.');
   if(!current&&db.prepare("SELECT COUNT(*) n FROM planning WHERE user_id=? AND json_extract(document,'$.kind')='routine'").get(userId).n>=50)fail(400,'루틴은 50개까지 만들 수 있어요.');
   const value={kind:'routine',title:data.title.trim()};
   db.prepare('INSERT INTO planning VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET document=excluded.document,version=excluded.version,updated_at=excluded.updated_at').run(id,userId,JSON.stringify(value),data.version+1,now);
   return {...value,id,version:data.version+1};
  });
 }
 // A 하루 틀 (day template) is a named set of timed blocks the day view can lay down on an empty day.
 if(data.kind==='template'){
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>100)fail(400,'틀 이름을 1–100자로 입력해 주세요.');
  if(!Array.isArray(data.blocks)||data.blocks.length>50)fail(400,'틀에는 일정을 50개까지 넣을 수 있어요.');
  const blocks=data.blocks.map(b=>{if(!b||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.start<0||b.end>1440||b.end<=b.start)fail(400,'틀 일정의 제목과 시간을 확인해 주세요.');return {title:b.title.trim(),start:b.start,end:b.end};}).sort((a,b)=>a.start-b.start);
  return transaction(db,()=>{
   const current=db.prepare('SELECT document,version FROM planning WHERE user_id=? AND id=?').get(userId,id);
   if((current?.version||0)!==data.version)fail(409,'계획이 다른 기기에서 변경됐어요. 새로 불러온 뒤 확인해 주세요.');
   if(current&&JSON.parse(current.document).kind!=='template')fail(400,'계획 종류는 변경할 수 없어요.');
   if(!current&&db.prepare("SELECT COUNT(*) n FROM planning WHERE user_id=? AND json_extract(document,'$.kind')='template'").get(userId).n>=10)fail(400,'하루 틀은 10개까지 만들 수 있어요.');
   const value={kind:'template',title:data.title.trim(),blocks};
   db.prepare('INSERT INTO planning VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET document=excluded.document,version=excluded.version,updated_at=excluded.updated_at').run(id,userId,JSON.stringify(value),data.version+1,now);
   return {...value,id,version:data.version+1};
  });
 }
 if(!['goal','step'].includes(data.kind)||typeof data.title!=='string'||!data.title.trim()||data.title.length>200||!validMonth(data.startMonth)||!validMonth(data.endMonth)||data.startMonth>data.endMonth||typeof data.note!=='string'||data.note.length>2000)fail(400,'계획의 제목과 기간을 확인해 주세요.');
 // Goals may carry one of 16 palette colours and a 집중 (focus) mark; steps may be checked off (끝났다고 체크).
 if(data.color!==undefined&&(data.kind!=='goal'||!Number.isInteger(data.color)||data.color<0||data.color>15))fail(400,'목표 색을 확인해 주세요.');
 if(data.focus!==undefined&&(data.kind!=='goal'||typeof data.focus!=='boolean'))fail(400,'집중 표시를 확인해 주세요.');
 if(data.done!==undefined&&(data.kind!=='step'||typeof data.done!=='boolean'))fail(400,'세부 계획의 완료 표시를 확인해 주세요.');
 const value={kind:data.kind,title:data.title.trim(),startMonth:data.startMonth,endMonth:data.endMonth,note:data.note,parentId:data.parentId||null,...(data.color!==undefined?{color:data.color}:{}),...(data.done!==undefined?{done:data.done}:{}),...(data.focus!==undefined?{focus:data.focus}:{})};
 if(value.kind==='goal'&&value.parentId)fail(400,'목표에는 상위 목표를 연결하지 않아요.');
 return transaction(db,()=>{
  const current=db.prepare('SELECT id,document,version FROM planning WHERE user_id=? AND id=?').get(userId,id);
  if((current?.version||0)!==data.version)fail(409,'계획이 다른 기기에서 변경됐어요. 새로 불러온 뒤 확인해 주세요.');
  if(current&&JSON.parse(current.document).kind!==value.kind)fail(400,'계획 종류는 변경할 수 없어요.');
  if(!current&&db.prepare('SELECT COUNT(*) n FROM planning WHERE user_id=?').get(userId).n>=300)fail(400,'목표와 세부 계획은 300개까지 보관할 수 있어요.');
  const items=listPlanning(db,userId);
  if(value.parentId){const parent=items.find(item=>item.id===value.parentId&&item.kind==='goal');if(!parent)fail(400,'연결할 목표를 찾을 수 없어요.');if(value.startMonth<parent.startMonth||value.endMonth>parent.endMonth)fail(400,'세부 계획의 기간은 목표 기간 안에 있어야 해요.');}
  if(value.kind==='goal'&&items.some(item=>item.parentId===id&&(item.startMonth<value.startMonth||item.endMonth>value.endMonth)))fail(400,'연결된 세부 계획을 포함하도록 목표 기간을 선택해 주세요.');
  db.prepare('INSERT INTO planning VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET document=excluded.document,version=excluded.version,updated_at=excluded.updated_at').run(id,userId,JSON.stringify(value),data.version+1,now);
  return {...value,id,version:data.version+1};
 });
}
export function deletePlanning(db,userId,id,version,now){
 if(!Number.isInteger(version)||version<1)fail(400,'저장 버전을 확인해 주세요.');
 return transaction(db,()=>{
  const current=db.prepare('SELECT version FROM planning WHERE user_id=? AND id=?').get(userId,id);
  if(!current||current.version!==version)fail(409,'계획이 다른 기기에서 변경됐어요. 새로 불러온 뒤 확인해 주세요.');
  // Removing a goal preserves its steps as independent plans.
  for(const item of listPlanning(db,userId).filter(item=>item.parentId===id)){
   const {id:childId,version:childVersion,...document}=item;document.parentId=null;
   db.prepare('UPDATE planning SET document=?,version=?,updated_at=? WHERE user_id=? AND id=?').run(JSON.stringify(document),childVersion+1,now,userId,childId);
  }
  db.prepare('DELETE FROM planning WHERE user_id=? AND id=?').run(userId,id);
  return {ok:true};
 });
}
