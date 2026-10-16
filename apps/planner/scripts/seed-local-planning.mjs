// Local preview samples only. Existing planning data and diary/task records are untouched.
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {savePlanning} from '../server/planning.mjs';
process.umask(0o077);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(root,'.omo/preview-data'),file=resolve(directory,'planner.sqlite');
if(!existsSync(file))throw Error('Local preview database not found.');
const db=new DatabaseSync(file),apply=process.argv.includes('--apply'),now=Date.now();
try{
 const users=['jaymunsh','test1234'].map(username=>db.prepare('SELECT id,username FROM users WHERE username=?').get(username)).filter(Boolean);
 if(!users.length)throw Error('No expected local preview users.');
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planning'").get();
 if(!tables)throw Error('Start the updated local API once before seeding.');
 const result={apply,accounts:[]};
 const backupDirectory=resolve(directory,'sample-backups');
 if(apply){mkdirSync(backupDirectory,{recursive:true,mode:0o700});const backup=resolve(backupDirectory,`before-local-planning-${now}.sqlite`);db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);chmodSync(backup,0o600);result.backup=backup.replace(root+'/','');}
 for(const user of users){
  if(db.prepare('SELECT COUNT(*) n FROM planning WHERE user_id=?').get(user.id).n){result.accounts.push({username:user.username,skipped:'already has planning data'});continue;}
  const goal=(key,title,startMonth,endMonth)=>({id:'local-planning-'+key,kind:'goal',title,startMonth,endMonth,note:'로컬 미리보기용 샘플 계획',parentId:null,version:0});
  const step=(key,title,month,parent)=>({id:'local-planning-'+key,kind:'step',title,startMonth:month,endMonth:month,note:'로컬 미리보기용 샘플 · 직접 수정하거나 삭제할 수 있어요.',parentId:'local-planning-'+parent,version:0});
  const samples=[goal('service','작게 공개하고 사용자와 개선하기','2026-01','2026-12'),goal('learning','배운 것을 직접 만들어 보기','2026-01','2026-12'),goal('routine','꾸준히 유지할 생활 리듬 만들기','2026-01','2026-12'),step('research','사용자 문제와 필요한 기능 정리','2026-03','service'),step('prototype','작은 기능부터 시제품 만들기','2026-06','service'),step('review','첫 화면과 모바일 사용성 확인','2026-09','service'),step('release','첫 사용자에게 플래너 공개','2026-10','service'),step('feedback','사용자 의견으로 불편한 흐름 고치기','2026-11','service'),step('stability','안정화하고 다음 해 우선순위 정하기','2026-12','service'),step('reading','독서한 내용을 작은 예제로 정리','2026-09','learning'),step('practice','TypeScript 예제 프로젝트 만들기','2026-10','learning'),step('server','서버 설계 학습과 실습 정리','2026-11','learning'),step('exercise','주 3회 운동 시간을 먼저 배치','2026-10','routine'),step('home','생활 공간과 주간 루틴 정리','2026-11','routine')];
  if(apply)for(const item of samples)savePlanning(db,user.id,item.id,item,now);
  result.accounts.push({username:user.username,planningItems:samples.length});
 }
 if(apply)writeFileSync(resolve(directory,'local-planning-manifest.json'),JSON.stringify({...result,createdAt:new Date(now).toISOString()},null,2),{mode:0o600});
 console.log(JSON.stringify(result,null,2));
}finally{db.close();}
