// English copy of the sample season (scripts/sample-data.mjs) for the English guide pictures.
// Same ids, dates and times; only the Korean text is swapped. A missing entry fails loudly so nothing Korean slips through.
import {planning as ko,days as koDays} from './sample-data.mjs';

const en={
 '프론트엔드 개발자로 취업하기':'Land a front-end developer job','12월 안에 같이 일하고 싶은 팀에서 오퍼를 받는다':'Get an offer from a team I want to work with by December',
 '이력서 초안 완성하고 현직자 피드백 받기':'Finish the résumé and get feedback from a working developer','지원할 회사 30곳 정리':'List 30 companies to apply to',
 '하반기 공채·수시 서류 20곳 지원':'Send 20 applications this autumn','기술 면접 질문 100개 내 말로 정리':'Write up 100 interview questions in my own words',
 '모의 면접 3번 하고 녹화 돌려보기':'Do 3 mock interviews and watch the recordings','코딩테스트 통과할 실력 만들기':'Get good enough to pass coding tests',
 '프로그래머스 Lv2 문제를 40분 안에 푼다':'Solve a medium problem in under 40 minutes','자료구조·정렬 기본기 복습':'Review data structures and sorting',
 '프로그래머스 Lv2 100문제':'100 medium problems','백준 그래프·DP 문제집 끝내기':'Finish the graph and DP problem sets','주말마다 실전처럼 모의 테스트':'A timed mock test every weekend',
 '포트폴리오 프로젝트 완성':'Finish the portfolio project','내가 매일 쓰는 서비스를 배포하고, 왜 이렇게 만들었는지 README로 설명할 수 있다':'Ship an app I use every day and explain the choices in the README',
 '기획과 화면 설계':'Plan and design the screens','Next.js로 핵심 기능 구현':'Build the core features in Next.js','로그인·DB 연동':'Add sign-in and the database',
 '배포하고 도메인 연결':'Deploy and connect a domain','테스트 코드 붙이고 리팩터링':'Add tests and refactor','개발 회고 글 쓰기':'Write a project retrospective',
 '체력과 생활 리듬 지키기':'Keep my energy and routine','취준이 길어져도 아침 8시에 일어나고 주 3번은 운동한다':'Up by 8 and working out 3 times a week, however long the search takes',
 '동네 헬스장 등록':'Join the local gym','주 3회 운동 끊기지 않게':'Keep up 3 workouts a week','새벽 1시 전에 자기':'In bed before 1 a.m.',
 '알고리즘 2문제':'2 algorithm problems','면접 질문 5개':'5 interview questions','헬스 1시간':'1 hour at the gym','하루 회고':'Daily review',
 '평일':'Weekday','기상 · 아침':'Wake up · breakfast','알고리즘 풀기':'Algorithm practice','면접 질문 정리':'Interview prep','점심':'Lunch',
 '포트폴리오 · 지원서':'Portfolio · applications','저녁':'Dinner','공부 정리':'Study notes','주말':'Weekend','늦잠 · 브런치':'Sleep in · brunch',
 '모의 코딩테스트':'Mock coding test','장보기 · 방 정리':'Groceries · tidy up','한 주 돌아보기':'Weekly review',
 '자료구조 복습: 스택·큐·해시':'Review: stacks, queues, hash maps','운영체제: 프로세스와 스레드':'OS: processes and threads','화면 설계 와이어프레임':'Screen wireframes',
 '헬스':'Gym','기술 블로그 정리':'Tech blog post',
 '오늘은 알고리즘이 생각보다 잘 풀렸다. 오전에 먼저 하는 게 확실히 낫다.':'Algorithms went better than expected. Doing them first thing really helps.',
 '포트폴리오에 다크 모드 넣으면 면접 이야깃거리가 될 듯':'Dark mode in the portfolio could be a good interview story',
 '계획한 건 거의 했다. 저녁에 유튜브를 줄인 게 컸다.':'Did almost everything I planned. Less YouTube in the evening made the difference.',
 '정렬·이분 탐색 문제':'Sorting and binary search problems','네트워크: HTTP와 브라우저 렌더링':'Networking: HTTP and browser rendering',
 'Next.js 튜토리얼 따라 하며 구조 잡기':'Follow the Next.js tutorial to set up the structure','온라인 스터디 (모각코)':'Online study group','사이드 코딩':'Side coding',
 '서류 탈락 메일을 받았다. 이력서 프로젝트 설명을 숫자로 바꿔 보자.':'Got a rejection email. Rewrite the project section of the résumé with numbers.',
 '운동을 건너뛰었다. 피곤해도 30분이라도 가자.':'Skipped the workout. Even when tired, go for 30 minutes.',
 '자바스크립트: 이벤트 루프·클로저':'JavaScript: event loop and closures','포트폴리오 기획: 문제 정의와 사용자 흐름':'Portfolio plan: problem and user flow',
 '강의 듣기: 프론트엔드 테스트':'Course: front-end testing',
 '스터디원 한 명이 최종 합격했다. 부럽지만 자극도 된다.':'Someone from the study group got an offer. Jealous, but motivated.',
 '면접 준비만 하다 하루가 갔다. 그래도 답변이 조금 자연스러워졌다.':'The whole day went on interview prep. At least my answers sound more natural.',
 'React: 렌더링과 상태':'React: rendering and state','모의 면접 녹화를 1.5배로 보면서 말버릇 체크':'Watch mock interviews at 1.5× and note verbal tics',
 '데이터베이스: 인덱스와 트랜잭션':'Databases: indexes and transactions',
 '면접에서 이벤트 루프를 제대로 설명하지 못했다. 그림으로 다시 정리하자.':'Couldn’t explain the event loop well in the interview. Redo it as a diagram.',
 '영화 보기':'Movie night','오랜만에 푹 잤더니 집중이 잘 됐다.':'Finally slept well, and focus was much better.','주간 모의 코딩테스트':'Weekly mock coding test',
 '한 주 돌아보기와 다음 주 계획':'Review the week, plan the next',
 '카페가 시끄러워서 도서관으로 옮겼다. 내일부터 바로 도서관.':'The café was loud so I moved to the library. Straight to the library tomorrow.',
 '틀린 문제 노트를 노션 말고 깃허브에 정리해 볼까':'Keep the mistakes log on GitHub instead of Notion?','오픈소스 이슈 읽기':'Read open-source issues','지원 현황 정리':'Update application tracker',
 '지원 현황 시트에 마감일 열 추가':'Add a deadline column to the application sheet',
 '에러 하나 잡느라 오후를 다 썼다. 원인은 환경 변수였다.':'Spent the whole afternoon on one bug. It was an environment variable.',
 '브라우저 저장소와 보안 (CORS·XSS)':'Browser storage and security (CORS, XSS)','친구 만나기':'See friends',
 '이력서 첫 줄을 "사용자가 매일 쓰는 서비스를 만든 경험"으로':'Open the résumé with “built an app people use every day”','본가 들르기':'Visit my parents',
 '프로그래머스 Lv2 3문제':'3 medium problems','상태 관리 정리 (Zustand)':'Tidy up state management (Zustand)','백준 BFS·DFS':'BFS and DFS problems',
 '로그인 붙이기 (NextAuth)':'Add sign-in (NextAuth)','Supabase 테이블 설계':'Design the Supabase tables','일정 목록 화면 구현':'Build the schedule list screen',
 '드래그로 순서 바꾸기 구현':'Drag to reorder','반응형 레이아웃 손보기':'Fix the responsive layout','백준 그래프 최단 경로':'Shortest-path problems',
 '자기소개서 지원동기 초안':'Draft the cover letter','백준 DP 문제집':'DP problem set','지원 회사 공고 정리':'Collect job postings',
 'Vercel 배포와 도메인 연결':'Deploy to Vercel and connect the domain','README에 기술 선택 이유 쓰기':'Explain tech choices in the README',
 '네이버 하반기 공채 서류 마감':'Naver application deadline','시간·링크 다시 확인':'Double-check the time and link','자기소개 1분 버전 소리 내 연습':'Practise the 1-minute intro out loud',
 '이력서 프로젝트 항목 다듬기':'Polish the résumé projects','카카오 1차 코딩테스트':'Kakao coding test','면접 예상 질문 답변 다듬기':'Polish answers to likely questions',
 '프로그래머스 Lv2 시간 재고 풀기':'Timed medium problems','리팩터링: 데이터 패칭 훅 분리':'Refactor: split out data-fetching hooks','지원서 제출':'Submit applications',
 '틀린 문제 다시 풀기':'Redo missed problems','자기소개서 작성':'Write cover letters','컴포넌트 테스트 작성 (RTL)':'Write component tests (RTL)','토스 코딩테스트':'Toss coding test',
 '스타트업 A 1차 기술 면접 (화상)':'Startup A technical interview (video)','스타트업 B 과제 전형 제출':'Submit Startup B take-home','라인 코딩테스트':'LINE coding test',
 '스타트업 A 2차 면접':'Startup A second interview','네이버 1차 기술 면접':'Naver technical interview','네이버 2차 면접':'Naver second interview','스타트업 B 최종 면접':'Startup B final interview',
};
const word=s=>{if(!/[가-힣]/.test(s))return s;
 let m=s.match(/^면접 질문: (.+)$/);if(m)return `Interview prep: ${word(m[1])}`;
 m=s.match(/^(.+) 준비물 확인$/);if(m)return `Get ready for ${word(m[1])}`;
 if(!(s in en))throw Error(`sample-data-en: no English for "${s}"`);return en[s];};
const swap=v=>typeof v==='string'?word(v):Array.isArray(v)?v.map(swap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,swap(x)])):v;
export const planning=swap(ko),days=swap(koDays);
