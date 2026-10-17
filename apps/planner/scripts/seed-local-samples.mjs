// Local-only preview data: a junior developer job seeker, June–December 2026.
// Replaces the two preview accounts' days and plans in .omo/preview-data (backup first). Dry run unless --apply. Never for production.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDay,transaction} from '../server/store.mjs';
process.umask(0o077);
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(project,'.omo/preview-data'),filename=resolve(directory,'planner.sqlite');
const apply=process.argv.includes('--apply'),db=new DatabaseSync(filename);
const users=['jaymunsh','test1234'].map(name=>db.prepare('SELECT id,username FROM users WHERE username=?').get(name)).filter(Boolean);
if(!users.length)throw Error('No expected local preview accounts found.');
const batch='local-sample-jobseeker-2026',today='2026-10-18',lastPlanned='2026-10-31';
const pick=(list,i)=>list[i%list.length];

// Goals and steps. Steps span their goal (no due dates); done = already finished by mid-October.
const goal=(id,title,note,color,focus)=>({id,kind:'goal',title,startMonth:'2026-06',endMonth:'2026-12',note,parentId:null,color,...(focus?{focus:true}:{})});
const step=(id,parentId,title,done)=>({id,kind:'step',title,startMonth:'2026-06',endMonth:'2026-12',note:'',parentId,done});
const planning=[
 goal('g-job','프론트엔드 개발자로 취업하기','12월 안에 같이 일하고 싶은 팀에서 오퍼를 받는다',11,true),
 step('s-resume','g-job','이력서 초안 완성하고 현직자 피드백 받기',true),
 step('s-companies','g-job','지원할 회사 30곳 정리',true),
 step('s-apply','g-job','하반기 공채·수시 서류 20곳 지원',false),
 step('s-cs','g-job','기술 면접 질문 100개 내 말로 정리',false),
 step('s-mock','g-job','모의 면접 3번 하고 녹화 돌려보기',false),
 goal('g-algo','코딩테스트 통과할 실력 만들기','프로그래머스 Lv2 문제를 40분 안에 푼다',8,true),
 step('s-ds','g-algo','자료구조·정렬 기본기 복습',true),
 step('s-lv2','g-algo','프로그래머스 Lv2 100문제',false),
 step('s-boj','g-algo','백준 그래프·DP 문제집 끝내기',false),
 step('s-weekly-test','g-algo','주말마다 실전처럼 모의 테스트',false),
 goal('g-portfolio','포트폴리오 프로젝트 완성','내가 매일 쓰는 서비스를 배포하고, 왜 이렇게 만들었는지 README로 설명할 수 있다',3,false),
 step('s-plan','g-portfolio','기획과 화면 설계',true),
 step('s-core','g-portfolio','Next.js로 핵심 기능 구현',true),
 step('s-auth','g-portfolio','로그인·DB 연동',true),
 step('s-deploy','g-portfolio','배포하고 도메인 연결',true),
 step('s-test','g-portfolio','테스트 코드 붙이고 리팩터링',false),
 step('s-retro','g-portfolio','개발 회고 글 쓰기',false),
 goal('g-health','체력과 생활 리듬 지키기','취준이 길어져도 아침 8시에 일어나고 주 3번은 운동한다',0,false),
 step('s-gym','g-health','동네 헬스장 등록',true),
 step('s-workout','g-health','주 3회 운동 끊기지 않게',false),
 step('s-sleep','g-health','새벽 1시 전에 자기',false),
 {id:'r-algo',kind:'routine',title:'알고리즘 2문제'},
 {id:'r-cs',kind:'routine',title:'면접 질문 5개'},
 {id:'r-gym',kind:'routine',title:'헬스 1시간'},
 {id:'r-retro',kind:'routine',title:'하루 회고'},
];

// What the season looks like: portfolio first (Jun–Aug), then applications and coding tests (Sep–), interviews (Oct–).
const phase=date=>date<'2026-07-01'?'start':date<'2026-09-01'?'build':date<'2026-10-01'?'apply':'interview';
const work={
 start:[['포트폴리오 기획: 문제 정의와 사용자 흐름','s-plan'],['화면 설계 와이어프레임','s-plan'],['Next.js 튜토리얼 따라 하며 구조 잡기','s-core']],
 build:[['일정 목록 화면 구현','s-core'],['상태 관리 정리 (Zustand)','s-core'],['로그인 붙이기 (NextAuth)','s-auth'],['Supabase 테이블 설계','s-auth'],['드래그로 순서 바꾸기 구현','s-core'],['반응형 레이아웃 손보기','s-core']],
 apply:[['Vercel 배포와 도메인 연결','s-deploy'],['README에 기술 선택 이유 쓰기','s-deploy'],['이력서 프로젝트 항목 다듬기','s-resume'],['자기소개서 지원동기 초안','s-apply'],['지원 회사 공고 정리','s-companies']],
 interview:[['자기소개서 작성','s-apply'],['컴포넌트 테스트 작성 (RTL)','s-test'],['지원서 제출','s-apply'],['면접 예상 질문 답변 다듬기','s-mock'],['리팩터링: 데이터 패칭 훅 분리','s-test']],
};
const algo={start:[['자료구조 복습: 스택·큐·해시','s-ds'],['정렬·이분 탐색 문제','s-ds']],build:[['프로그래머스 Lv2 3문제','s-lv2'],['백준 BFS·DFS','s-boj'],['프로그래머스 Lv2 3문제','s-lv2']],apply:[['백준 DP 문제집','s-boj'],['프로그래머스 Lv2 3문제','s-lv2'],['백준 그래프 최단 경로','s-boj']],interview:[['프로그래머스 Lv2 시간 재고 풀기','s-lv2'],['틀린 문제 다시 풀기','s-lv2'],['백준 DP 문제집','s-boj']]};
const cs=['운영체제: 프로세스와 스레드','네트워크: HTTP와 브라우저 렌더링','자바스크립트: 이벤트 루프·클로저','React: 렌더링과 상태','데이터베이스: 인덱스와 트랜잭션','브라우저 저장소와 보안 (CORS·XSS)'];
const thoughts=['오늘은 알고리즘이 생각보다 잘 풀렸다. 오전에 먼저 하는 게 확실히 낫다.','서류 탈락 메일을 받았다. 이력서 프로젝트 설명을 숫자로 바꿔 보자.','스터디원 한 명이 최종 합격했다. 부럽지만 자극도 된다.','에러 하나 잡느라 오후를 다 썼다. 원인은 환경 변수였다.','면접에서 이벤트 루프를 제대로 설명하지 못했다. 그림으로 다시 정리하자.','오랜만에 푹 잤더니 집중이 잘 됐다.','카페가 시끄러워서 도서관으로 옮겼다. 내일부터 바로 도서관.'];
const ideas=['포트폴리오에 다크 모드 넣으면 면접 이야깃거리가 될 듯','틀린 문제 노트를 노션 말고 깃허브에 정리해 볼까','이력서 첫 줄을 "사용자가 매일 쓰는 서비스를 만든 경험"으로','모의 면접 녹화를 1.5배로 보면서 말버릇 체크','지원 현황 시트에 마감일 열 추가'];
const reviews=['계획한 건 거의 했다. 저녁에 유튜브를 줄인 게 컸다.','오후에 지원서 하나에 너무 오래 붙잡혀 있었다. 시간 상자를 정해 두자.','운동을 건너뛰었다. 피곤해도 30분이라도 가자.','알고리즘 두 문제, CS 정리, 구현까지 다 했다. 오늘 같은 날이 계속되면 좋겠다.','면접 준비만 하다 하루가 갔다. 그래도 답변이 조금 자연스러워졌다.','늦게 일어나서 리듬이 깨졌다. 내일은 8시.'];
// A few dated events that make the season real.
const events={
 '2026-09-05':['네이버 하반기 공채 서류 마감','s-apply',1260,1380],'2026-09-19':['카카오 1차 코딩테스트','s-weekly-test',840,1140],'2026-10-10':['토스 코딩테스트','s-weekly-test',780,960],'2026-10-14':['스타트업 A 1차 기술 면접 (화상)','s-mock',900,960],
 '2026-10-21':['스타트업 B 과제 전형 제출','s-apply',1200,1320],'2026-10-24':['라인 코딩테스트','s-weekly-test',600,780],'2026-10-28':['스타트업 A 2차 면접','s-mock',1020,1110],
 '2026-11-05':['네이버 1차 기술 면접','s-mock',840,960],'2026-11-19':['네이버 2차 면접','s-mock',600,720],'2026-12-03':['스타트업 B 최종 면접','s-mock',900,990],
};

function makeDay(date,i){
 const weekday=new Date(date+'T12:00:00Z').getUTCDay(),weekend=weekday===0||weekday===6,past=date<today,p=phase(date),plans=[],priorities=[];
 const add=(key,title,start,end,planningId,priority)=>{const id=`local-sample-${date}-${key}`,missed=past&&planningId&&(i*7+key.length*3)%17===0;const plan={id,title,start,end,status:missed?'missed':'pending',...(planningId?{planningId}:{})};
  if(priority&&priorities.length<3){const pid=`local-sample-priority-${date}-${key}`;priorities.push({id:pid,text:title,done:past&&!missed});plan.priorityId=pid;}plans.push(plan);};
 if(date<=lastPlanned){
  if(weekend){
   add('wake','늦잠 · 브런치',600,660);
   if(weekday===6){add('cafe',pick(work[p],i)[0],780,1020,pick(work[p],i)[1],true);add('friends',pick(['친구 만나기','본가 들르기','영화 보기'],i),1110,1290);}
   else{add('test','주간 모의 코딩테스트',780,930,'s-weekly-test',true);add('home','장보기 · 방 정리',960,1050);add('weekly','한 주 돌아보기와 다음 주 계획',1260,1320,null,true);}
  }else{
   add('wake','기상 · 아침',480,510);
   const a=pick(algo[p],i);add('algo',a[0],540,660,a[1],true);
   add('cs',`면접 질문: ${pick(cs,i)}`,660,720,p==='start'?null:'s-cs',p!=='start');
   add('lunch','점심',720,780);
   const w=pick(work[p],i+1);add('work',w[0],810,1050,w[1],true);
   if([1,3,5].includes(weekday))add('gym','헬스',1080,1140,'s-workout');
   add('dinner','저녁',1140,1200);
   if([2,4].includes(weekday))add('study','온라인 스터디 (모각코)',1230,1350,'s-lv2');
   else add('evening',pick(['기술 블로그 정리','지원 현황 정리','강의 듣기: 프론트엔드 테스트','오픈소스 이슈 읽기'],i),1230,1320,null);
   if(i%4===1)add('night','사이드 코딩',1380,1440,'s-core');
  }
 }
 const event=events[date];if(event){const [title,planningId,start,end]=event;const clash=plans.findIndex(x=>x.start<end&&x.end>start);if(clash>=0)plans.splice(clash,1);add('event',title,start,end,planningId);priorities.unshift({id:`local-sample-priority-${date}-event-first`,text:`${title} 준비물 확인`,done:past,steps:[{id:`local-sample-step-${date}-a`,text:'시간·링크 다시 확인',done:past},{id:`local-sample-step-${date}-b`,text:'자기소개 1분 버전 소리 내 연습',done:past}]});if(priorities.length>3)priorities.length=3;plans.forEach(x=>{if(x.priorityId&&!priorities.some(q=>q.id===x.priorityId))delete x.priorityId;});}
 if(!plans.length)return null;
 plans.sort((a,b)=>a.start-b.start);
 const quiet=i%5===3;
 return {plans,entries:[],priorities,notes:{thoughts:past&&!quiet?pick(thoughts,i):'',ideas:i%3===0?pick(ideas,i):'',review:past&&!quiet&&!weekend?pick(reviews,i*2):''}};
}
const days=[];for(let d=new Date('2026-06-01T12:00:00Z'),i=0;d<=new Date('2026-12-31T12:00:00Z');d.setUTCDate(d.getUTCDate()+1),i++){const date=d.toISOString().slice(0,10),document=makeDay(date,i);if(document)days.push({date,document});}
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
