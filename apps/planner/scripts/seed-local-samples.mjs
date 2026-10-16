// Explicitly local-only, additive sample data. Existing records are never updated.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDay,transaction} from '../server/store.mjs';
process.umask(0o077);
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(project,'.omo/preview-data'),filename=resolve(directory,'planner.sqlite');
const apply=process.argv.includes('--apply'),db=new DatabaseSync(filename);
const usernames=['jaymunsh','test1234'],users=usernames.map(name=>db.prepare('SELECT id,username FROM users WHERE username=?').get(name)).filter(Boolean);
if(!users.length)throw Error('No expected local preview accounts found.');
const cutoff='2026-10-12',batch='local-sample-2026-sep-oct',start=new Date('2026-09-01T12:00:00Z');
const reviews=['집중 시간을 오전에 두니 중요한 일을 먼저 마칠 수 있었다. 내일도 알림을 끄고 시작해 보자.','회의가 길어져 오후 계획을 조금 줄였다. 다음에는 작업 사이에 여유 시간을 두자.','예상보다 문서 정리에 시간이 걸렸다. 초안을 먼저 만들고 세부 내용을 채우는 편이 좋겠다.','오후에 집중력이 떨어져 산책 후 다시 시작했다. 짧은 휴식이 도움이 됐다.','계획을 너무 많이 잡았다. 내일은 꼭 해야 할 일 세 가지만 먼저 배치하자.','학습한 내용을 작은 예제로 확인했다. 설명만 읽는 것보다 기억에 남았다.','운동과 휴식을 챙겨 저녁 시간을 편하게 보냈다. 쉬는 시간도 미리 잡아두자.'];
function makeDay(date,index){const weekday=new Date(date+'T12:00:00Z').getUTCDay(),weekend=weekday===0||weekday===6,past=date<=cutoff,month=date.slice(5,7),plans=[],entries=[],priorities=[];
 const definitions=weekend?[['walk','동네 산책과 가벼운 운동',540,600,'exercise'],['reading','책 읽기 · 기록 정리',660,710,'reading'],['home','집안 정리와 장보기',840,910,'home'],['rest',index%2?'친구와 저녁 식사':'영화 보고 쉬기',1110,1230,null]]:[['morning','아침 스트레칭과 하루 준비',410,440,null],['focus',month==='09'?['서비스 요구사항 정리','일지 화면 구성 설계','포트폴리오 초안 작성'][index%3]:['랜딩페이지 문구 정리','시간표 기능 점검','서비스 출시 체크리스트'][index%3],540,650,'release'],['lunch','점심 식사와 짧은 산책',730,780,null],['build',month==='09'?['API 설계와 문서 정리','프로토타입 구현','디자인 피드백 반영'][index%3]:['모바일 화면 개선','기능 테스트와 수정','배포 문서 정리'][index%3],840,950,'release'],['learning',['TypeScript 예제 실습','서버 설계 자료 읽기','오늘 배운 내용 정리'][index%3],990,1040,'learning'],['evening',[1,3,5].includes(weekday)?'근력 운동과 정리 스트레칭':'저녁 식사와 휴식',1120,1180,[1,3,5].includes(weekday)?'exercise':null],['reading','저녁 독서와 하루 돌아보기',1260,1300,'reading']];
 if(!weekend&&[2,4].includes(weekday))definitions.splice(2,0,['meeting','진행 상황 공유와 다음 작업 정리',660,700,'release']);
 for(const [n,def] of definitions.entries()){const [key,title,a,b,task]=def,id=`local-sample-${date}-${key}`;let status='pending';if(past){status='done';if(['focus','build','learning','reading','home'].includes(key)){const score=(index*3+n*5)%23;if(score===1||score===8)status='missed';else if(score===4||score===11)status='deferred';else if(score===6||score===13||score===18)status='partial';}if(key==='meeting'&&index%9===0)status='cancelled';}
 const plan={id,title,start:a,end:b,status};if(task&&priorities.length<3){const priority={id:`local-sample-priority-${date}-${key}`,text:title,done:status==='done'};priorities.push(priority);plan.priorityId=priority.id;}plans.push(plan);
 if(past&&(status==='done'||status==='partial')){const delay=[-10,0,10,20,30][(index+n)%5],duration=status==='partial'?Math.max(20,Math.floor((b-a)*.55/10)*10):(b-a)+[0,0,10,-10][(index+n)%4],actualStart=Math.max(0,a+delay);entries.push({id:`local-sample-actual-${date}-${key}`,title,start:actualStart,end:Math.min(1440,actualStart+duration),planId:id});}}
 return {plans,entries,priorities,notes:{thoughts:`로컬 미리보기용 샘플 · 실제 기록이 아닙니다.\n${weekend?'이번 주에 쌓인 생각을 정리하고 생활 리듬을 쉬어가는 날.':'오늘은 가장 중요한 작업 하나를 오전에 끝내고, 오후에는 구현과 학습 시간을 나눠 쓰자.'}`,ideas:index%3===0?'다음 주 계획을 잡을 때 예상 시간과 실제 시간을 함께 확인해보자.':index%3===1?'반복하는 작업은 준비 과정을 체크리스트로 만들면 시작하기 쉬울 것 같다.':'작업이 잘게 나뉘면 중간에 멈춰도 다시 시작하기 편할 것 같다.',review:past?reviews[index%reviews.length]:''}};
}
const days=Array.from({length:61},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),document:makeDay(d.toISOString().slice(0,10),i)};});
const result={batch,localDatabase:'.omo/preview-data/planner.sqlite',from:days[0].date,to:days.at(-1).date,mode:apply?'applied':'dry-run',accounts:[]};
let backup;
try{if(apply){const backupDir=resolve(directory,'sample-backups');mkdirSync(backupDir,{recursive:true,mode:0o700});backup=resolve(backupDir,`before-${batch}-${Date.now()}.sqlite`);db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);chmodSync(backup,0o600);}
 transaction(db,()=>{for(const user of users){let insertedDays=0,skippedDays=0;
 for(const day of days){if(db.prepare('SELECT 1 FROM days WHERE user_id=? AND date=?').get(user.id,day.date)){skippedDays++;continue;}if(apply){const valid=validateDay(day.document,db,user.id);insertedDays+=db.prepare('INSERT INTO days(user_id,date,document,version,updated_at) VALUES(?,?,?,1,?)').run(user.id,day.date,JSON.stringify(valid),Date.now()).changes;}else insertedDays++;}
 result.accounts.push({username:user.username,insertedDays,skippedDays});}});
 if(apply){const counts={};for(const day of days)for(const p of day.document.plans)counts[p.status]=(counts[p.status]||0)+1;result.exampleStatusCountsPerAccount=counts;result.backup=backup.replace(project+'/','');writeFileSync(resolve(directory,`${batch}-manifest.json`),JSON.stringify({...result,createdAt:new Date().toISOString(),sampleDates:days.map(d=>d.date)},null,2),{mode:0o600});}console.log(JSON.stringify(result,null,2));
}finally{db.close();}
