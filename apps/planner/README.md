# anotar planner

하루를 시간표로 계획하고 생각과 회고를 남기는 별도 서비스. 기존 개인 Anotar의 로고·색·폰트를 사용한다.

## 지금 동작하는 범위

- Notion 공식 소개 사이트의 구성 참고: 중앙 제목, 넓은 제품 예시, 시간표·할 일·메모와 회고. 한국어/영어 소개·체험·가입/로그인·플래너·정책.
- 오늘: 24시간 × 10분 시간표와 시간순 일정 목록, 일정 추가·수정·삭제, 생각·아이디어·회고.
- 계획: 분기별 세 달 계획과 연간 네 분기 로드맵. 목표·세부 계획·메모를 저장한다. 독립 할 일 기능과 내용은 로컬에서 종료했다.
- 일정: 일간·주간·월간 보기. 되짚어보기는 직접 미이행으로 표시한 일정을 모아 다시 계획한다. 모든 보관 자료는 JSON 내보내기에 포함된다.
- 머릿속 생각 → 아이디어 → 하루 돌아보기 메모. 입력 후 900ms에 저장하며 실패·버전 충돌 시 기기 초안을 보존한다.
- 설정: 한국어/영어, 글자 크기 작게/보통/크게(기본 작게), 내보내기, 비밀번호 변경, 비밀번호로 확인하는 탈퇴.
- 운영자·문의·개인정보처리방침·약관. 문성혁, 개인 운영, support@leneu.store. Osaka 운영 환경을 명시하며 시행일은 2026-10-12.

언어는 헤더·푸터 또는 설정에서 바꾼다. `?lang=ko`, `?lang=en`으로 직접 열 수 있고 다음 페이지와 재접속에서도 선택을 유지한다. 날짜·시간 길이·오류를 함께 번역하며 작성한 내용은 원문 그대로 보관한다. 모바일 로그인 후 언어는 설정에서 바꾼다. 소개·체험 화면은 API 또는 로그인 조회 실패로 가려지지 않는다. 로그인한 플래너는 세션 확인에 실패하면 재연결을 안내한다.

## 로컬 실행

Node 24 이상. 기존 개인 Anotar 포트·DB와 겹치지 않는다.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

이 경우 브라우저는 `http://127.0.0.1:8794`; `.env`의 `PUBLIC_ORIGIN`도 같은 주소로 맞춘다. 기본 회원가입은 닫혀 있다. 본인 로컬 테스트에는 `REGISTRATION_ENABLED=true`와 `NODE_ENV=development`를 사용한다.

개발 중은 API를 8794에서, `npm run dev`로 Vite를 5175에서 실행하고 `PUBLIC_ORIGIN=http://127.0.0.1:5175`로 설정한다.

현재 디자인·한영 전환 변경은 로컬 검토용이며 운영 반영을 보류했다. 한글은 `http://127.0.0.1:5175/?lang=ko`, 영어는 `http://127.0.0.1:5175/?lang=en`, 로그인 없이 체험은 `/demo`에서 확인한다.

본 작업의 로컬 미리보기는 `.omo/preview-data`를 사용한다. 모노레포에서 `.omo`는 비공개 폴더 `../../private/local/planner`를 가리키는 링크다(git 제외, 이 Mac에만 있음). 새로 클론했으면 `ln -s ../../private/local/planner .omo`. QA는 이 자료와 별개인 임시 DB에서 실행한다. 체험 화면은 계정 자료를 저장하지 않으며 날짜·페이지를 바꾸면 초기 예시로 돌아간다.

## 검증

```sh
npm test
npm run build
node scripts/qa-planner-navigation.mjs
node scripts/qa-planning-board.mjs
node scripts/qa-period-diary.mjs
# 켜진 로컬 미리보기(5175)의 API 장애 대응 확인
node scripts/qa-public-availability.mjs
```

브라우저 QA는 설치된 Chrome for Testing을 `CHROME_PATH`로 지정할 수 있다. 새 브라우저와 임시 DB를 사용한다. 기본 QA는8795, 한영 QA는8796 포트에서 실행한다. 기존 개인 서비스와 실제 계정을 사용하지 않는다. 증거는 `.omo/evidence/qa.json`, 화면은 `.impeccable/review/`에 남는다.

## 배포 및 운영

[Oracle·도메인·메일 전환 절차](docs/LAUNCH_RUNBOOK.md)와 [공개 전 확정할 운영 정보](docs/PUBLIC_INFORMATION.md)를 참고한다. 배포 파일은 별도 `/srv/anotar-planner`만 사용한다. 기존 `/srv/leneu/data-live`와 개인 인증 설정을 복사·초기화하지 않는다.

실제 전환 기록(비공개 repo `private/planner/docs/LAUNCH_EXECUTION.md`)을 먼저 확인한다. `leneu.store`는 새 플래너, `personal.leneu.store`는 기존 개인 서비스로 전환했다. 서버의 기존 자료와 인증은 유지되지만 기존 root 브라우저 초안·IndexedDB·쿠키는 새 도메인으로 자동 이동하지 않는다. 기존 계정으로 personal에서 다시 로그인한다.

## 자료와 보존

계정, 세션, 날짜별 JSON, 할 일은 `PLANNER_DATA_DIR/planner.sqlite`에 저장된다. 비밀번호는 scrypt 해시, 복구코드와 세션 토큰은 SHA-256 해시로 저장한다. 비밀번호 원문·복구코드 원문을 운영 로그에 남기지 않는다. 각 API는 로그인된 사용자 ID로 조회·수정을 제한하고 문서 버전을 검사한다.

계획되지 않은 시간에 낭비·실패라는 의미를 부여하지 않는다. 일정은 기본적으로 이행한 것으로 보고, 미이행만 사용자가 직접 표시한다(블록 hover ×, 일정 창 토글 버튼, 취소선+붉은 배경). 예전 상태값(일부 수행·완료·다시 계획)은 저장은 그대로, 화면에선 보통 일정으로 보인다. 별도 실제 기록의 집계·범례·색·추가 동작은 일지 UI에서 제외한다. 이전 entries 자료는 저장·내보내기에 보존한다.

일일 systemd timer를 운영 서버에 설치했다. 매일 04:30 한국시간에 온라인 백업을 만들며 7일 지난 사본은 다음 백업 실행 때 정리한다. `/data/deletions.json`은 무작위 탈퇴 계정 ID·시각만 8일간 보관한다. `scripts/restore.mjs`는 새 디렉터리에만 복원하고 현재 삭제 기록을 적용하며 세션을 모두 폐기한다. 자동 백업은 로컬 미리보기에서 실행하지 않는다.

## 제한과 다음 작업

동일 날짜 안의 활동(00:00–24:00)을 관리하며 자정을 넘는 활동은 두 날짜로 나눈다. 하루 계획/실제 각각 100개, 할 일 1,000개, 메모 칸당 20,000자. 시간대는 초기 Asia/Seoul. 장기 할 일 제목 편집·삭제, 시간표 블록 드래그 이동·크기 조정, 프로젝트·장기 목표, 첨부·공유·AI는 후속 범위다. 초안 충돌을 자동 병합하지 않고 내보내기와 최신 기록 확인을 제공한다.

## 현재 로컬 일지 UI 검증

http://127.0.0.1:5175 에서 소개, /demo에서 계정 없이 일지를 확인한다. 로그인 후 /app은 동일한 Journal 컴포넌트를 사용한다. 24시간 × 10분 시간표, 오늘 꼭 할 일, 머릿속 생각/아이디어/하루 돌아보기, 일간/주간/월간/미이행 보기로 구성한다. 오늘 할 일은 날짜 문서의 optional priorities 필드로 저장하고, 기존 계획·실제 기록·메모는 보존한다. 개인 Anotar 계정 자료를 새 서비스에 자동으로 옮기지 않는다.

현재 화면의 검증 명령은 `npm run build`, `npm test`, `node scripts/qa-journal.mjs`이다. 예전 화면의 `qa-bilingual.mjs`, `qa-public-availability.mjs`, `qa-finish.mjs` 캡처는 이전 UI 증거이며 현재 일지 검증을 대신하지 않는다. 새 증거는 `.impeccable/review/journal/`에 있다. 이 일지 개편은 로컬 검토 단계이며 운영 배포 전이다.

Desktop daily overview fits the remaining viewport height, with a 420px minimum workspace. Task backlog holds undated work; Past journals lists saved daily records. `node scripts/qa-overview.mjs` verifies 12 Korean/English viewport cases plus save/reload and navigation using an isolated test account.

Current activity editing uses a native modal. Week/month/quarter/year totals and status filtering are available locally. See docs/PLANNER_PERIOD_REVIEW_DESIGN.md for exact metric meanings and the future rescheduling-history model. Verify via npm test and node scripts/qa-modal-period.mjs.

Period diaries: Week is a seven-day plan/actual timetable, Month an activity calendar, Quarter three month sheets, Year twelve record maps. Current visual and drill-down checks: node scripts/qa-period-diary.mjs. Old bucket-list capture assertions are superseded.

## 일지 폭과 헤더 정렬

일지와 앱 헤더는 최대 1280px(좌우 여백 포함)의 같은 폭 기준을 사용한다. 화면이 작아지면 유동적으로 줄고 여백은 32/24/18px다. 좁은 화면의 주간표만 내부 가로 스크롤을 사용한다. `node scripts/qa-workspace-layout.mjs`는 임시 계정으로 한·영 일간/주간의 320–1920px 정렬·넘침·첫 화면 높이를 검사한다. 증거는 `.impeccable/review/workspace-layout/qa.json`이다.

월간은 월 제목·직접 월 선택·이전 달/다음 달/이번 달을 제공한다. 헤더 브랜드는 PC 이미지 28px·글자 22px, 모바일 이미지 26px·글자 21px로 축소했다. `qa-workspace-layout.mjs`는 월간도 검사하고 연도 경계·윤년·이번 달 이동을 확인한다. 분기·연간 계획표 방향은 `docs/GOAL_TASK_PLANNING_PROPOSAL.md`의 제안이며 아직 구현되지 않았다.

일간 시간표는 일반 일정의 완료 색·체크 아이콘을 표시하지 않는다. PC의 여유롭게/한눈에 버튼으로 기본 24시간 맞춤 보기와 32px 행 간격의 페이지 스크롤 보기를 전환한다. 계획 참고 요약의 일간·주간·월간 연결은 설계 제안 단계다.

## 분기·연간 계획표

현재 분기·연간은 기존 기록 달력 대신 별도의 목표/세부 계획을 저장하는 계획표다. 자세한 기능·저장·샘플·후속 범위는 [PLANNING_BOARDS.md](docs/PLANNING_BOARDS.md)를 따른다. `node scripts/qa-planning-board.mjs`가 현재 계획표의 UI 검증이며, `qa-period-diary.mjs`는 일간/주간/월간 기록 경로를 검증한다. 일간·주간·월간의 계획 참고 요약, 모달 저장, Task ID 연결, JSON 내보내기와 계정 삭제를 지원한다. 날짜/보기 링크는 새로고침 뒤에도 유지한다.

## 2026-10-13 로컬 상태

상단은 일정·계획·되짚어보기. 독립 할 일 메뉴·API·등록 내용·연결 필드는 제거했다. 일간의 오늘 꼭 할 일(우선순위)은 별도 기능으로 유지한다. `/app/tasks`는 계획으로 이동하고 `/api/tasks`는410을 반환한다. 로컬 삭제 전에 백업하고 일지122개/계획28개 본문을 보존했다. [삭제·후속 연결 방향](docs/PLAN_CONNECTIONS.md). 운영 반영은 하지 않았다.

`qa.mjs`, `qa-bilingual.mjs`, `qa-journal.mjs`, `qa-overview.mjs`에는 이전 할 일/구형 랜딩 전제 검증이 남아 있어 현재 기능의 승인 근거로 사용하지 않는다. 현재 기본 검증은 `qa-planner-navigation.mjs`·`qa-planning-board.mjs`·`qa-period-diary.mjs`·`qa-carry-over.mjs`·`qa-routines.mjs`다(실행: `CHROME_PATH=<Chrome 경로> node scripts/<이름>.mjs`). 이 스크립트들은 시간표를 모든 폭에서 '하루' 보기로 시작한다(휴대폰 기본은 '목록').

**지난 날에서 가져오기**: 일정이 빈 날에는 최근 7일 안에서 일정이 있는 가장 가까운 날의 일정(취소 제외)을 새 '예정' 항목으로 복사하는 버튼이, 가장 최근에 오늘 할 일을 적은 날에 체크하지 않은 항목이 있으면 빈 칸부터 채워 넣는 버튼이 나온다. 하루/목록 선택은 브라우저에 기억하고, 처음엔 760px 이하에서 목록으로 연다.

**계획 화면**: 분기는 달마다 세부 계획을 목표별로 묶어 한 줄씩 보이고, 계획마다 그 달 시간표에 연결된 시간(목표는 분기 합계), 연간은 목표 × 분기 칸 합계(0이면 숨김). 루틴은 계획의 세 번째 탭(`/app/plans?view=routines`). 시간 합계는 화면이 불러온 날(기본 최근 400일) 기준. **되짚어보기**: 주 단위 요약(계획한 시간·꼭 할 일 완료·미이행·목표별 시간·그 주 하루 돌아보기, `src/journal/WeeklyReview.tsx`) 아래에 미이행 목록(5개 넘으면 접힘).

**사용 안내** `/guide`(`src/Guide.tsx`, 그림 `public/guide/day.png`은 /demo 화면): 공개 페이지. 상단 메뉴·앱 헤더 `?`·푸터·빈 시간표 안내에서 연결. **기능을 바꾸면 이 페이지의 해당 문단도 같이 고친다.** 빈 날(일정·할 일·메모가 모두 빈 날)은 머릿속 생각 ①, 첫 할 일 ②, 시간표 ③ 안내가 흐리게 보인다.

**일간 화면**: 넓은 화면은 2단(왼쪽 380px: 오늘 꼭 할 일 → 머릿속 생각·아이디어·하루 돌아보기, 메모는 쓴 만큼 늘어남 | 시간표). 상단 계획 줄의 이번 기간 칩을 누르면 카드(상위 목표·이번 주 시간표에 잡은 시간·시간표에 넣기)가 열린다. 할 일은 1–3번이 크게, 시간표에 들어간 할 일은 시작 시각을 보이고, 체크하면 연결된 블록이 흐려진다. 내용을 지우면 할 일이 지워진다(1–3번은 빈 칸으로 남음). 시간표 블록은 마우스로 끌어 옮기고 오른쪽 끝으로 길이를 바꾼다(10분 단위). 단축키: ←/→ 이전·다음, T 오늘, N 새 일정. 오늘을 볼 때 현재 시각 선이 보인다. 블록 완료 표시는 강제하지 않는다(완료는 할 일 체크로).

**루틴**: 이름만 있는 저장 목록이다(`/api/planning`의 `kind:'routine'`, 계정당 50개). 계획의 ‘루틴’ 탭에서 만들고·이름 바꾸고·지운다. 일간 화면 상단 계획 줄(왼쪽 이번 기간 목표·세부 계획, 오른쪽 루틴)의 루틴 칩(또는 할 일의 시간 잡기)을 누르면 30분 활동 창이 열리고(오늘이면 지금 이후 첫 빈 30분, 다른 날은 09:00)(PC는 시간표로 끌어 놓기도 됨), 저장하면 그날만의 일반 활동이 된다. 반복 규칙·자동 배치·횟수 목표는 없다. 루틴을 지워도 이미 넣은 활동은 남는다. 최신 인계 문서에서 실제 실행 여부를 확인한다.
