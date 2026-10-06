# leneu 작업 지침

이 파일은 `leneu-storage/` 전체에 적용된다. 코드를 수정하기 전에 현재 동작과 목표 설계를 구분해서 읽는다.

## 먼저 읽을 문서

1. [README.md](README.md): 실행 방법과 지금 쓸 수 있는 기능.
2. [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md): **현재 구현**의 UI, API, 저장 형식, 제한값. 현재 동작을 설명할 때 우선한다.
3. [PRODUCT.md](PRODUCT.md)와 [DESIGN.md](DESIGN.md): 제품 목적과 현재 화면에서 추출한 시각 규칙.
4. [TECH_ARCHITECTURE.md](TECH_ARCHITECTURE.md), [PLAN.md](PLAN.md), [PAGE_EDITOR_DESIGN.md](PAGE_EDITOR_DESIGN.md): 공유·배포·AI 후속 기능을 포함한 **목표 설계**. 현재 구현으로 표시한 범위를 확인하고 나머지를 이미 구현된 것으로 취급하지 않는다.
5. AI 실행을 다룰 때는 [실행 설계](docs/superpowers/specs/2026-09-29-ai-execution-design.md), [키워드 확장 설계](docs/superpowers/specs/2026-09-29-keyword-research-design.md), [결과 페이지 정리 설계](docs/superpowers/specs/2026-09-29-ai-result-page-design.md), [메모 수명 주기·Page AI 설계](docs/superpowers/specs/2026-09-29-memo-page-lifecycle-design.md)와 [현재 실행 규격](CURRENT_IMPLEMENTATION.md#ai-요청-실행)을 확인한다. 홈 현황·`/ai`는 [현재 모니터 규격](CURRENT_IMPLEMENTATION.md#ai-요청-모니터)과 [화면 brief](.impeccable/briefs/ai-activity.md)를 따른다.
6. 페이지 문법을 다룰 때는 [MARKDOWN_GUIDE.md](MARKDOWN_GUIDE.md), 일정·페이지 도구·수정 이력·자동 백업은 [보존 설계](docs/superpowers/specs/2026-09-30-plan-page-preservation.md)와 [현재 규격](CURRENT_IMPLEMENTATION.md#페이지-도구와-수정-이력)을 확인한다.

문서와 코드가 다르면 먼저 실행 코드와 테스트로 현재 상태를 확인하고, 작업 범위에 맞춰 문서를 함께 고친다.

## 현재 코드 지도

- `src/main.tsx`, `src/style.css`, `src/theme-dark.css`: 공통 셸, 빠른 입력, 상세 수정, 모바일 입력, 화면 모드와 `/memo` 라우팅. `src/dashboard/dashboard.css`는 홈 배치와 지역 글자·간격을 맡는다. `src/memos/`는 홈 최근 3개·메모/AI 요청 탭의 공통 목록·검색·필터와 Capture 타입을 맡는다.
- `src/pages/PageWorkspace.tsx`, `src/pages/PageEditor.tsx`, `src/pages/TocBlock.tsx`, `src/pages/PageLinkBlock.tsx`, `src/pages/PageIconPicker.tsx`, `src/pages/PageSearchPalette.tsx`, `src/pages/pageNav.ts`, `src/pages/pages.css`: 사이드바 페이지 탐색·개별 문서 편집. BlockNote와 Mermaid는 페이지 진입 시에만 불러온다. `PageCommentPreview.tsx`·공통 `shared/pageComments.ts`·`server/pageComments.mjs`는 개인 DB 댓글/답글·상태·인용문 보존을 맡는다. 이름 기반 공유 댓글은 별도 저장 계약과 댓글 전용 broker를 사용하며 개인 댓글은 공개하지 않는다. `TocBlock.tsx`는 제목을 모아 보여주는 목차 커스텀 블록, `PageLinkBlock.tsx`는 하위 페이지 링크 커스텀 블록, `PageIconPicker.tsx`는 제목 위 대표 이모지 선택 패널이고, `PageSearchPalette.tsx`는 통합검색 컴포넌트를 다시 내보내는 호환 진입점, `pageNav.ts`는 앱 안에서 페이지를 여는 이동 컨텍스트다. 페이지 메타데이터 `icon`·`parentId`·`position`은 `pages` 테이블 열로 저장하고, `parentId`가 있는 페이지는 사이드바에서 상위 아래에 들여져 보인다. 사이드바 행은 드래그로 순서·계층을 바꾸고(`PATCH /api/pages/:id`), 화살표로 접는다.
- `src/time.ts`: 사이드바의 한국 달력 날짜, UTC 저장값의 한국 시간 표시와 생성 후 24시간 `NEW` 판정.
- `src/search/SearchPalette.tsx`, `api.ts`, `types.ts`, `search.css`: 모든 화면의 사이드바 검색·`⌘K`·`Ctrl+K`로 여는 지연 통합검색. 메모·AI 요청·Page 제목/본문·파일명과 상태·더 보기·키보드/초점을 관리하며 편집기·Mermaid를 의존하지 않는다.
- `src/tasks/TaskWorkspace.tsx`, `src/tasks/TaskBoard.tsx`, `src/tasks/tasks.css`, `src/tasks/types.ts`: 하나의 상태로 홈 패널과 `/tasks` 전체 보기를 제공한다. 추가·행 편집·완료·되돌리기·실패 재시도와 충돌 초안을 관리한다. 선택적인 `pageId`는 개인 페이지 참조이며 Task의 독립 저장·상태 변경·기존 재전송을 유지한다.
- `src/prompts/`: 서버 템플릿 관리·AI 요청 미리보기. `usePromptLibrary.ts`는 지연 API 조회·탭/창 집중 갱신, `api.ts`는 저장·충돌, `migration.ts`는 초안 이관을 맡는다. `templates.ts`는 이전 브라우저 JSON·최근 선택이며, `shared/aiRequests.ts`가 공통 요청 조립과 저장 당시 사본 검증을 맡는다. `shared/prompts.ts`는 서버/브라우저 공통 변수·검증·기본값이다. `PromptWorkspace.tsx`·`AiRequestFields.tsx`는 지연 로딩하며 미리보기 자체는 실행하지 않는다.
- `server/ai/`: 제출 UUID·작업 SQLite 저장(`jobs.mjs`), 단일 비동기 worker, URL 수집·주소 고정, HTTP 게이트웨이·설치형 Devin adapter와 응답 검증. `discovery.mjs`는 키워드 후보 정규화·순차 수집, `devinOutput.mjs`는 실제 검색 export의 호출/출처 연결을 검사한다. `src/ai/`는 지연 상태·결과·이력·명시 요청과 가시 목록 요약 폴링이다. `src/drafts/captureSubmission.ts`는 브라우저 제출 사본·순서별 파일 SHA256을 보존한다. `scripts/qa-keyword-research.mjs`는 임시 fixture QA, `scripts/ai-devin-smoke.mjs`는 일반 테스트와 분리된 실호출이다.
- `src/ai/AiActivity.tsx`·`activity.css`·`api.ts`·`types.ts`: 홈 3개 현황과 `/ai`의 메모·Page 작업 모니터, 상태 필터·개수·가시 폴링·정확한 `aiJob` 링크. `server/ai/jobs.mjs`의 `listAiActivity`와 `GET /api/ai/activity`는 같은 읽기 savepoint에서 제한된 요약·전체 개수를 만든다. `test/ai-activity.test.mjs`·`scripts/qa-ai-activity.mjs`가 API·임시 로컬 worker·화면을 확인한다.
- `src/drafts/`, `src/prompts/usePromptDrafts.ts`: 같은 탭의 새로고침 복구. 텍스트는 250ms 후 `localStorage`에 쓰고 화면을 떠날 때 최신값을 저장한다. 첨부 바이트는 IndexedDB에 저장하며 진행·복구 오류를 표시한다. 탭 식별은 `sessionStorage`로 구분한다.
- `server/index.mjs`: HTTP API, 업로드, 파일 응답, 빌드된 정적 화면.
- `server/backups.mjs`·`scripts/backup-data.mjs`: SQLite 온라인 스냅샷과 DB 참조 첨부의 체크섬 백업·검증·새 경로 복원 CLI. 원본 `data/`를 덮어쓰지 않는다. `server/automaticBackups.mjs`·`server/backupRoutes.mjs`·`src/backups/`는 개인 `/backups`의 기본 꺼짐 일일 한국시간 예약·수동 실행·상태·검증 후 보관 정리를 맡는다. Compose의 `/backups`는 개인 서비스에만 별도 마운트한다.
- `server/shares.mjs`·`server/public.mjs`·`server/publicPage.mjs`: 개인 API의 페이지 공유 토큰 발급·만료·폐기와 별도 읽기 전용 공개 뷰. 공개 프로세스에 개인 API·AI·검색·업로드 경로를 추가하지 않는다. 첨부는 현재 공유 Page 본문의 `asset`·`map`·`itinerary` 블록이 직접 참조하는 ID만 노출한다. `src/pages/PageSharePanel.tsx`는 발급 전 첨부 범위와 활성 링크를 보여주며 `src/pages/MapBlock.tsx`는 좌표·Google 링크·선택적 이미지의 장소 블록이다. `scripts/seed-itinerary-sample.mjs`는 수정된 예시를 덮어쓰지 않는 여행 계획 샘플이다.
- `shared/itinerary.ts`·`itineraryPreview.ts`·`src/pages/ItineraryBlock.tsx`·`ItineraryMap.tsx`·`ItineraryPreview.tsx`·`PlanImagePicker.tsx`는 활동 유형·소요시간·겹침·이동을 제외한 방문 번호·이미지 선택·날짜별 외부 Maps 경로 링크를 맡는다. 개인 Google 지도만 지연 로딩하며 공개 `share-plan.js`는 이미지 오류 안내만 처리한다. OSM·Leaflet과 공개 Google SDK 경로는 제거했다. 기존 좌표/이름/확대·JSON version 1·파일은 보존한다.
- `server/pageTools.mjs`·`src/pages/PageToolsPanel.tsx`: 단일 페이지 복제·사용자 페이지 템플릿·선택 블록 이동·Page 직접 첨부·최신 100개 수정본과 UUID 재전송. Page 소유 자산 이관·수정본/템플릿의 개인 파일 참조를 관리한다.
- `server/store.mjs`, `server/pages.mjs`, `server/tasks.mjs`, `server/prompts.mjs`: SQLite와 페이지·할 일 검증·버전 충돌. Task·Prompt 저장은 기존 DB 핸들을 공유하는 별도 모듈이다.
- `server/search.mjs`, `server/searchText.mjs`: `search_documents`·contentless `search_fts`·`search_state`·`search_meta`의 v3 검색 스키마, 트리거·이관·커서와 평문 추출·정규화·순수 SQL 함수를 맡는다. `test/search*.test.mjs`, `scripts/qa-search.mjs`, `scripts/benchmark-search.mjs`는 correctness·Chrome·임시 1만/10만 자료 성능을 확인한다.
- `test/`, `scripts/qa.mjs`: 저장 규격 테스트와 임시 데이터 디렉터리를 쓰는 Chrome 통합 QA.
- `data/`: 실제 로컬 SQLite와 첨부 원본. 테스트나 예시 갱신을 위해 지우거나 덮어쓰지 않는다.
- `server/pageConnections.mjs`, `src/memos/CapturePageImport.tsx`, `src/memos/CaptureOrganization.tsx`, `src/pages/PageOrigins.tsx`, `src/pages/AssetBlock.tsx`: 페이지 제목 검색·참조 색인·원자적 메모 정리 완료·입력함 복귀와 지연 선택/출처 화면·첨부 블록. `CaptureRefBlock.tsx`는 기존 문서 호환용으로 숨기며 `shared/pageDocuments.ts`는 저장된 원본 블록을 편집 후에도 보존한다. `usePageResource.ts`는 참조 대상의 조회·누락·재시도를 맡는다.
- `src/ai/pageContent.ts`, `src/pages/parseMarkdown.ts`: 선택한 완료 AI 결과의 제목·출처 조립과 제출 시 지연 Markdown 파싱. `CapturePageImport.tsx`·`server/pageConnections.mjs`의 선택적 `aiResult: {jobId, document}`로 편집 가능한 Page를 만들며 첫 입력 번들에 편집기·Mermaid를 포함하지 않는다.
- `server/pageMarkdown.mjs`, `shared/pageMarkdown.ts`, `server/pageAi.mjs`, `src/pages/PageAiPanel.tsx`, `src/ai/pageSubmission.ts`: 저장된 Page 전체/선택의 제한된 Markdown 입력과 동일한 순수 미리보기·불변 문서/제목/버전 사본, 지연 요청·이력과 명시적 추가/선택 교체/하위 Page·직전 수정본 되돌리기. 페이지별 최초 제출 UUID·본문과 마지막 반영 기준을 브라우저에 보존한다.
- `server/trash.mjs`, `src/trash/`, `scripts/qa-trash.mjs`: 메모·페이지 묶음 휴지통·복원·되돌리기. `events.ts`는 활성 목록·참조를 갱신하며 열린 편집기와 초안은 교체하지 않는다.

기술 기반은 React 19·TypeScript·Vite 6, Node.js 24의 `node:sqlite`, 로컬 파일 저장소다. Docker 이미지는 추후 N100 미니PC로 옮길 수 있도록 구성돼 있다.

## 유지할 계약

- 빠른 입력은 원본 `Capture`다. 메모에 별도 제목을 추론하거나 내용을 목록·상세에서 중복 표시하지 않는다. 저장 확인은 AI 처리와 분리한다.
- 홈은 정리 전 일반 메모 최근 3개, 전체 관리·필터·검색은 `/memo`다. API의 `scope=all|memo|ai`와 `organization=inbox|organized`(기본 inbox)는 LIMIT 전에 적용하며 개수는 해당 정리 상태의 DB 전체를 집계한다. 탭·검색·정리 상태를 바꾸면 이전 범위 목록이 보이지 않게 한다. 저장·수정·충돌 후 새로 조회할 때 현재 화면의 범위·검색·정리 상태를 사용하며 홈에 숨은 필터를 적용하지 않는다.
- [홈 화면 brief](.impeccable/briefs/home-dashboard.md)의 Operate 배치를 따른다. PC 주 열은 입력·최근 메모·최근 페이지, 보조 열은 Task·AI다. 1100px 이하에서는 이어서 작업하기·입력·AI·Task·메모·페이지 순서다. 최근 페이지는 `PageWorkspace`의 목록 메타데이터에서 수정순 최대 4개를 표시하며 홈 첫 로드에 페이지 본문·편집기·Mermaid를 불러오지 않는다. 모바일 홈에는 인라인 입력과 **크게 쓰기**를 보여주고 홈의 기록 도크만 숨긴다. 일반 저장은 **저장**, AI 선택 시에는 **저장하고 AI 요청**이다.
- 홈의 별도 AI 현황은 진행 중 우선 최대 3개, 사이드바 **AI 요청**은 `/ai`의 메모·Page 실행 모니터다. 전체/진행 중/결과 준비/실패의 DB 전체 개수와 선택 상태의 최근 50개를 표시하며 정리 완료 원본은 포함하고 휴지통 소유자는 제외한다. 작업 없는 요청문은 `/memo?view=ai`로 유지한다. 행의 `aiJob` ID를 선택하고 오래된 단건의 소유자를 검사하며 Page AI를 자동으로 연다. 첫 조회는 실제 교차 알림 뒤에만, 가시·활성 탭에서는 진행 중 2초·그 외/실패 30초로 갱신하고 밖·hidden·언마운트에는 요청·타이머를 취소한다. 오류 때 마지막 확인 기준을 명시하고 초안을 유지한다. 모바일 `/ai`는 하단 도크를 숨기고 **새 AI 요청**으로 입력함을 연다. 상세 규격의 요약 한도·읽기 전용 API를 유지한다.
- 전역 검색은 개인용 `GET /api/search`의 `all|memo|ai|page|file|task|result|ocr`이다. 현재 원문·URL과 불변 AI 요청 사본, Page 제목·블록 작성 텍스트/링크/표/자식/Mermaid, 파일명만 색인한다. 참조 ID·스타일·참조 대상 원문·일반 파일 바이트는 색인하지 않는다. 별도 `server/searchExtensions.mjs`는 Task·완료 AI 결과·명시 OCR 텍스트를 같은 쓰기 트랜잭션에서 파생 색인하며 정확한 작업 ID로 이동한다. 메모 제목을 추론하지 않고 파일명 검색 결과는 정리 전 활성 소유 메모 또는 활성 현재 본문 참조 Page로 연다. 기존 `/memo` LIKE와 페이지 선택기의 `/api/pages/search` 제목 검색·50개 커서는 유지한다.
- 검색 질의는 160 UTF-16 코드 단위·12단어, NFC·소문자화·공백 정리, 리터럴 기호와 단어 AND다. 두 코드 포인트 이상 단어가 하나 필요하며 혼합 한 글자는 같은 FTS의 고유 문자 열로 확인한다. 인코딩 두 글자 토큰의 위치·필드 경계를 보존한다. 빈 질의 최근 20개·검색 20개와 제목10/URL3/본문1 BM25 순위, 변경 번호가 바뀌면 첫 페이지 `reset: true`를 유지한다. UI는 결과/커서를 즉시 무효화하고 취소·세대 번호로 오래된 응답을 막으며 뒤의 초안을 유지한다. 조합 Escape의 현재 M1 제한과 합성/네이티브 IME 증거 범위는 [현재 규격](CURRENT_IMPLEMENTATION.md#통합검색)을 따른다.
- 검색 파생 평문·FTS·변경 번호는 원본과 같은 쓰기 트랜잭션에서 트리거로 갱신한다. backfill은 최초 한 번, v1→v2는 파생 색인만 원자적으로 이관한다. 현재 v3의 Page 첨부·일정 텍스트 이관도 원본을 바꾸지 않고 최초 한 번 수행하며 정상 재시작에는 재색인하지 않는다. 원시 `DatabaseSync` 쓰기 연결·벤치마크·외부 스크립트도 원본 쓰기 전에 `registerSearchFunctions(db)`를 등록해야 한다. 두 글자 토큰·고유 문자·fold·Capture/Page 평문 함수는 결정적 순수 함수를 유지한다. 커서/결과/변경 번호는 같은 읽기 savepoint에서 만든다. 개인 검색 라우트를 미래 공개 공유 프로세스에 등록하지 않는다.
- `npm run seed:memo`는 일반 예시 4개·준비된 요청 2개·부모/하위 페이지 2개·독립 Task 예시 2개를 만든다. `captures.sample_key`, `page_roles.sample.*`, Task의 고정 `requestId`로 중복을 막고 수정한 예시와 Task 제목·상태를 보존한다. 실제 파일 바이트를 저장하며 AI 결과로 표시하지 않는다. 시작 시 자동 시드·사용자 데이터 초기화는 하지 않는다.
- 메모 목록 오류는 입력 폼의 저장 오류와 분리한다. 홈·전체 목록은 조회 실패 때 한국어 안내와 다시 불러오기를 보여주고, 작성 중인 메모를 유지한다. Task의 빈 응답·JSON이 아닌 응답도 기술적인 파서 문구 대신 재시도 안내로 처리한다.
- 저장된 `Capture`의 사용자 작성 내용·링크 주소는 상세에서 명시적으로 수정할 수 있다. `expectedVersion` 충돌은 409로 거절하고 편집 초안을 남긴다. `createdAt`과 파일 원본은 유지하며 `updatedAt`만 갱신한다. AI 결과는 별도 작업에 저장하며 원문·첨부·버전·생성/수정 시각을 바꾸지 않는다. 선택한 완료 결과를 Page로 복사해 편집할 수 있고 완료된 결과의 Task 채택은 사용자 선택/수정 후 명시 등록하며 원자적 UUID 영수증으로 중복을 막는다.
- 페이지 원본은 `schemaVersion: 1`의 블록 JSON이다. Markdown은 입력·보기·복사 형식이며 저장 기준이 아니다. 페이지 저장에는 `expectedVersion`을 포함하고 409 충돌 시 늦은 저장이 최신 내용을 덮지 않게 한다.
- 일정은 기존 JSON version 1의 최대 50개/50,000자·한국시간·고유 ID·날짜/시각·쌍 좌표·HTTP(S) 링크 검증을 유지한다. 선택적 활동 유형·소요시간·같은 날 시간 겹침 안내를 지원하고 겹침은 저장을 막지 않는다. 이동과 장소 없는 지정 활동은 방문 번호에서 제외한다. Google 화살표/자체 SVG는 같은 날의 연속 방문만 잇고 실제 도로 경로로 표현하지 않는다. 공개는 이미지·외부 Google 링크만이며 SDK/타일/iframe 요청과 지도 키 노출을 추가하지 않는다.
- Google 데모 키는 브라우저 공개값이며 사이트·API 제한이 필요하다. 비밀 서버 토큰으로 취급하지 않는다. 수동 입력은 탭의 `sessionStorage` 키 `leneu:google-maps-demo-key:v1`에만 두고 Page JSON·DB·공유 링크에 넣지 않는다. 선택적 `GOOGLE_MAPS_DEMO_KEY`는 개인 프로세스 설정이고 개인 `GET /api/maps/config`는 `{googleMapsKey}`를 반환한다. 로컬 지속 설정은 Git에서 제외한 `.env`에 두며 `npm run dev`·`npm start`·`npm run start:public`이 읽는다. 키 원문을 코드·문서·로그에 넣지 않는다. 공유에는 지도 키를 사용하거나 노출하지 않는다. `DEMO_MAP_ID`·지연 SDK·선택 시 지도 유지·키/인증/네트워크/새로고침 복구 계약은 [현재 규격](CURRENT_IMPLEMENTATION.md#google-일정-지도)을 따른다.
- 일정/장소의 선택적 `assetId`는 이미지 첨부 참조다. 새 참조의 이미지 MIME과 개인 접근, 현재 공유 범위, 수정 이력/템플릿 보존을 함께 확인한다. `plan-preview-assets-v1` 이관은 파생 참조/트리거만 갱신하며 원본 문서·파일·버전을 바꾸지 않는다.
- 일정 초안은 `leneu:itinerary-draft:v1:<block.id>`에 변경 즉시 보존하며 같은 저장 자료 base에서 새로고침 복구한다. 일정 편집 중 페이지 도구·AI·공유의 변경 동작을 막고 적용/취소 전에 초안을 덮지 않는다. Markdown 보기/복사는 `includeAppReferences: true`로 첨부 ID·하위 페이지 링크를 보존하지만 AI 입력의 기본 변환은 앱 전용 참조와 파일 바이트/대상 본문을 제외한다.
- 페이지 복제는 한 문서만 같은 상위 아래 만들고 하위 트리를 제외한다. 페이지 템플릿은 저장 당시 제목·아이콘·본문 사본이며 프롬프트 템플릿과 별개다. 복제·이동·템플릿 생성은 블록 ID를 새로 만들고 참조 첨부 바이트를 재사용한다. 이동은 선택 부모/자식을 중복 처리하지 않고 원본 `expectedVersion`·대상 `targetVersion`·문서 한도를 한 트랜잭션에서 검사한다.
- 직접 페이지 첨부는 숨은 메모 없이 `capture_id: null`·Page 소유권으로 저장한다. 기존 자산의 ID·rowid·저장 키·Capture 소유권을 이관 중 보존하고 한 소유자 제약을 유지한다. 8개·개별 25MB·총 100MB와 순서별 파일 지문을 확인하며 실패/충돌/UUID 재전송의 새 업로드는 정리한다.
- 복제·템플릿 저장/생성·첨부·블록 이동·수정본 복원의 UUID·최초 요청·응답을 보관한다. 미저장·충돌·미해결 복구·확인 대기 중 문서를 덮지 않으며 응답 유실/새로고침에는 최초 제출을 재사용한다. 템플릿 삭제는 별도 DELETE다. 프롬프트 과거 수정본 조회·복원 UI를 페이지 수정 이력 구현으로 완료 처리하지 않는다.
- 일반 수정 이력은 생성·모든 버전 변경을 DB 트리거로 저장하고 최신 100개만 유지한다. 기존 Page 현재 버전의 최초 이관은 한 번만 한다. 복원은 제목·아이콘·본문을 현재 계층/위치 그대로 새 버전으로 저장하고 현재 버전을 검사한다. 활성 Page의 수정본·남아 있는 사용자 템플릿은 개인 파일 접근을 보존하지만 공유는 현재 본문의 직접 `asset`·`map`·`itinerary` 첨부 참조만 허용한다. 파일명 검색에는 수정본/템플릿만의 파일을 추가하지 않는다.
- 자동 백업은 기본 꺼짐·04:00 한국시간·7개(1~60개)다. `BACKUP_DIR`은 `DATA_DIR`과 같거나 서로 조상/자손 관계인 경로를 거절하며 기본 `dirname(realpath(DATA_DIR)) / (basename(DATA_DIR) + '-backups')`를 유지한다. 설정/이력은 백업 폴더에 있고 검증된 새 사본 후 소유 표시가 있는 관리 백업만 정리한다. 동시 실행·재시작 중복·미완료 실행을 처리하고 실패 때 이전 정상 백업을 보존한다. 복원은 기존 CLI의 존재하지 않는 새 경로만 허용한다. 공유 서비스에는 백업·템플릿·수정 이력·업로드 API/백업 볼륨을 추가하지 않는다.
- **결과를 페이지로 정리**는 선택한 완료 작업의 결과·출처를 사용한다. 기본은 새 페이지이며 기존 페이지·선택한 상위의 새 하위 페이지도 지원한다. 새 UI는 `disposition: 'organize'`를 보내고 본문에 메모 카드·태그를 자동으로 넣지 않으며 출처·정리 완료를 별도로 저장한다. 원문·첨부는 선택적으로 포함한다. 변환 문서는 안전한 링크·허용 블록·1MB/1,000블록과 해당 Capture의 완료 작업을 검사하며 AI 본문에 개인 참조를 넣지 않는다. 전체 Markdown 보기·복사를 유지하고 Page 편집은 Capture·요청 사본·작업 결과를 바꾸지 않는다. 제출 UUID·작업 ID·문서·대상·선택은 응답 유실/새로고침 시 그대로 재사용하며 pending 동안 선택을 잠근다. 문서·참조·출처·정리 상태·영수증은 같은 트랜잭션이고 같은 UUID는 최초 응답을 반환한다. 명시적으로 새 UUID로 다시 담는 경우에는 새 블록 ID를 만든다.
- 정리 완료 Capture는 일반 메모/AI 목록·개수·통합검색에서 제외하며 **정리 완료** 필터와 **입력함으로 되돌리기**로 다시 찾고 복귀시킨다. 정리/복귀는 내용 버전·생성/수정 시각·원문·첨부·불변 AI 이력을 바꾸지 않는다. 복귀 UUID는 현재 정리 작업 ID를 검사하고 최초 영수증을 먼저 반환한다. 이전 가져오기 영수증 재전송으로 복귀한 메모를 다시 정리하지 않는다. 연결 Page 휴지통 이동은 원본을 삭제하거나 자동 복귀시키지 않는다. 파일명 검색은 정리 전 활성 소유자 또는 활성 참조 Page에서만 보이고, 개인 파일 API는 활성 원본 접근을 유지한다.
- Page AI는 저장 문서 전체가 기본이며 선택한 편집 가능 블록만 요청할 수도 있다. 서버가 Markdown 입력을 64,000자까지 만들고 당시 전체 문서·제목·버전·선택 루트 ID·요청문을 고정한다. `captureRef`·asset·페이지 링크·목차와 참조 대상 본문·파일 바이트를 자동으로 보내지 않는다. 기존 Capture 작업 이관은 ID·결과·요청·retry 관계·지문을 보존하며 작업은 Capture/Page 중 정확히 하나가 소유한다. 저장 실패·충돌·미해결 복구·휴지통 작업 중 제출을 막고 진행 중에는 편집을 허용한다.
- Page AI 결과는 **본문 아래 추가 / 선택한 블록 교체 / 새 하위 페이지**로 명시 반영한다. 전체 문서를 Markdown으로 왕복 교체하지 않는다. 교체는 비어 있지 않은 기록 선택과 요청 버전이 그대로여야 하며 반영/되돌리기는 현재 `expectedVersion`을 검사한다. 새 블록 ID를 만들고 기존 비선택 블록·첨부·목차·페이지 링크를 유지한다. 추가/교체 직전 제목·문서와 반영 영수증은 한 트랜잭션이며 되돌리기는 반영 버전 이후 편집을 덮지 않는다. 하위 Page는 기존 휴지통으로 되돌리며 일반 변경 이력 복원으로 주장하지 않는다.
- Page 요청·반영·되돌리기의 최초 UUID·본문·경로는 페이지별 `localStorage`에 전송 전 보존하고 이동/새로고침/응답 유실 재전송에도 유지한다. pending이면 새 AI 제출을 막으며 반영·되돌리기 또는 손상된 복구는 본문 편집도 잠근다. 확인된 400/404/409는 **확인된 실패 닫기**로만 해제하고 불명확한 실패는 같은 요청을 확인한다. 영수증 성공 뒤 추가/교체/되돌리기는 최신 Page를 다시 조회해 오래된 반환 문서로 새 편집을 덮지 않는다.
- 입력함의 첫 로드에 페이지 편집기나 AI 결과·실행 UI 코드를 섞지 않는다. 빠른 입력의 응답성을 우선한다.
- 시간은 UTC ISO 문자열로 저장하고 화면은 `Asia/Seoul`로 표시한다. `NEW`는 작성 후 24시간 미만에만 보이며 시간 줄의 오른쪽 끝에 고정한다. 목록·상세에서 시드 메모에 별도 예시 표시를 붙이지 않는다.
- Task는 Capture·Page·AI와 독립된 기록이다. 제목 500자, 선택적 기한 `YYYY-MM-DD`는 한국 날짜다. 수정은 `expectedVersion`으로 검사하며 홈 체크 요청은 항목별 직렬화해 마지막 선택을 보존한다. 실패 시 복원·재시도를 제공하고 충돌 초안을 덮지 않는다. `requestId`의 재시도 중복만 막고 같은 제목의 독립 작업은 합치지 않는다.
- 홈 Task는 PC 5개·모바일 3개를 먼저 표시하고, 1100px 이하에서는 AI 현황 뒤·최근 메모 앞에 배치한다. 업무 데이터를 `display: none`으로 숨기지 않는다. `/tasks` 목록은 50개씩 더 보기, 보드는 todo/doing 각 20개·done 최근 10개로 열별 조회하고 모바일은 선택한 한 열을 표시한다. `Task.status`의 open/done 계약은 유지하며 `stage`와 SQLite 추가 열 `in_progress`로 진행 여부를 확장한다. 편집·진행·실패 중인 행은 폭·작업 영역 변경에도 조작할 수 있게 유지한다.
- Task 목록 커서는 조회 위치·변경 번호·필터·한국 날짜를 포함한다. 기존 목록과 다른 변경 번호나 날짜면 서버는 첫 페이지와 `reset: true`를 반환하고 UI는 누적 목록을 교체한다. 이전 페이지의 변경으로 마지막 할 일이 누락되지 않도록 유지한다. 보드 열 커서가 reset이면 모든 열을 다시 읽고, 검색 링크의 고정 항목도 갱신하되 사용자가 선택한 목록 필터는 최초 링크 연결 뒤 강제로 바꾸지 않는다. 이미 선택된 상태 탭을 다시 누르는 동작은 목록을 비우지 않는다.
- 파일 메타데이터는 SQLite, 원본 바이트는 `data/blobs/`에 둔다. 현재 상한은 파일당 25MB, 요청당 8개·총 100MB다. 100MB는 하루 한도가 아니다.
- 휴지통은 논리 삭제다. Capture·Page의 `deleted_at`·`trash_id`, `trash_batches`·`trash_operations`를 보존하며 영구 삭제·자동 비우기를 하지 않는다. 페이지와 현재 활성 자손을 한 묶음으로 옮기고, 별도로 옮긴 자손은 합치거나 복원하지 않는다. 부모가 비활성이면 복원 대상을 최상위로 둔다. 이동·복원은 버전만 증가시키며 원문·요청 사본·첨부·생성/수정 시각을 유지한다. UUID의 최초 요청·응답을 DB에 남겨 오래된 재시도가 새 삭제/복원을 실행하지 않게 한다.
- 일반 단건·목록·개수·검색·가져오기는 휴지통 기록을 제외한다. 첨부는 활성 소유 Capture/Page·활성 Page의 현재 본문/수정본 참조 또는 사용자 페이지 템플릿이 남아 있으면 개인 API에서 열리며 원본 바이트는 항상 유지한다. 기존 누락 참조는 다른 본문 저장을 막지 않는다. 페이지 저장 중/오류/충돌/초안 복구 상태에서는 이동을 막고, 응답 확인 전 편집·다른 이동을 잠근다. 브라우저 QA는 실제 `data/` 대신 임시 저장소에서 삭제·복원을 검증한다.
- 개인 API에는 인증이 없다. 개발 서버와 Compose의 개인 포트는 루프백 전용이며 LAN이나 인터넷에 직접 노출하지 않는다. 별도 공유 서버만 토큰으로 지정 Page를 읽으며 실제 Tunnel 연결과 본인 인증은 미완료다.
- 개인 페이지는 열자마자 본문을 편집할 수 있다. BlockNote는 앱의 실제 화면 모드와 같은 `light`·`dark` 테마를 쓴다. 기본은 시스템 설정이며 한국 날짜는 로고와 같은 줄 오른쪽 끝에 둔다. 하단 프로필의 `설정 열기` 버튼은 `WorkspaceSettings` 네이티브 dialog를 연다. `화면 모드 전환` 버튼은 현재 `aria-pressed`와 해·달 아이콘/현재 모드 글자를 제공하며 수동 선택을 브라우저에 저장한다. 설정의 Tab 순환·Escape/바깥 클릭/닫기·호출 버튼으로 집중 복귀를 유지한다. Mermaid 도형·연결선도 어두운 화면에서 읽혀야 한다.
- 메모는 제목 없는 `Capture`, 페이지는 제목·블록을 가진 `Page`다. `/memo`는 일반 메모와 AI 요청의 별도 탭이며 `/memo?view=ai`로 직접 들어간다. `/pages`·`/temp`의 이전 목록 주소는 `/memo`로 연결하고 `/pages/:id` 편집기는 유지한다. 새 임시 문서 자동 생성·특별 진입 링크는 없다. 기존 임시 페이지와 호환 API는 보존한다. 메모 상세의 `내 페이지에 정리`는 기존 페이지·새 페이지·새 하위 페이지에 선택한 내용·첨부를 담고 정리 완료로 보관한다. 페이지 간 블록 분배는 아직 없다.
- 가져오기는 최신 저장된 원문을 일반 문단·URL 링크로 복사하고 첨부는 Asset ID로 재사용한다. `page_references` 갱신과 문서 저장은 같은 트랜잭션이다. 작업 UUID·최초 요청·최초 응답을 DB에 남기며 같은 요청은 재실행하지 않는다. 응답 유실 때 제출 스냅샷은 탭의 sessionStorage에 보존하며 해결 전 대상·선택을 바꾸지 않는다. 기존의 사라진 참조는 다른 본문 저장을 막지 않고 새 참조는 대상 존재를 검사한다. 기존 `captureRef`는 본문·Markdown에서 숨기되 저장된 블록 JSON을 편집 후에도 보존한다. 새 출처·기존 영수증/참조는 개인 **페이지 정보**에서 확인하고 `/captures/:id`를 직접 연다. Markdown 복사는 첨부 설명·ID만 내보내며 파일 바이트를 포함하지 않는다. 공개 공유에 개인 출처·새 첨부를 자동 포함하지 않는다.
- 모든 개인 화면은 작업 영역 전체 폭의 PC 44px·모바일 48px sticky `workspace-topbar`와 하나의 portal 대상을 사용한다. 각 화면이 `WorkspaceToolbar`로 제목·도구를 소유하며 숨은 Task/Prompt나 홈 요약은 도구를 등록하지 않는다. 문서에서는 기존 `document-topbar`를 함께 사용한다. `PageEditor`가 소유하는 경로·저장 상태·도구를 `toolbarTarget` React portal로 표시하며 문서 편집기를 재마운트하지 않는다. 모바일은 메뉴·현재 화면 이름(문서는 경로)·핵심 도구를 같은 줄에 합치고 중복 상단바를 만들지 않는다. 검색 입력·템플릿 초안·할 일 쓰기 잠금은 상단바 이동 때문에 재마운트하거나 복사하지 않는다. 즐겨찾기는 모바일 더보기에서도 조작할 수 있고 공유 설정은 스크롤 중에도 보이는 고정 패널이다. 한국 날짜는 사이드바 로고와 같은 줄 오른쪽 끝, 화면 모드는 하단 프로필의 설정 모달에 둔다. 생성일·최종 수정일은 페이지 제목 아래와 메모 상세에 유지하고 저장 성공 시에만 수정일을 갱신한다.
- 입력함에서도 공통 사이드바에 **내 페이지** 목록을 보여준다. 입력함 첫 로드에서는 페이지 편집기 묶음을 불러오지 않는다. 서비스 표시 이름은 `anotar`, 브라우저 파비콘은 `public/favicon.png`의 손글씨 a 심볼을 쓴다. 사이드바·로그인·PWA는 같은 승인 심볼을 사용한다. 기존 `leneu` 저장소·쿠키·암호화 식별자는 데이터 호환을 위해 유지한다.
- 프롬프트는 서버 SQLite에 저장하고 버전·불변 수정본 ID를 함께 검사한다. 변수는 `url`·`content`·`memo`만 한 번 치환하며 입력 안의 변수는 재해석하지 않는다. 실패·다른 기기 충돌 때 초안을 남긴다. 생성 전 UUID·최초 전송 스냅샷을 브라우저 초안에 보존하고 재시도 때 그대로 전송한다. 생성 재시도는 최초 저장 수정본, 가져오기 재시도는 최초 대상 수정본을 기준으로 삼는다. 브라우저 원본을 삭제하거나 이미 수정한 서버 내용을 가져오기로 덮지 않는다. 일치하는 이전 초안만 연결하고 오래된 초안을 최신 수정본으로 조용히 승격하지 않는다. AI 체크 후 보관은 Capture·당시 입력/템플릿/요청문 사본·UUID 제출 기록·대기 작업을 원자적으로 저장한다. 원본·템플릿 수정으로 사본을 재작성하지 않는다. 최초 템플릿 조회가 미완료·실패이면 복구한 템플릿을 직접 요청으로 바꾸어 저장하지 않는다. 사용자가 명시적으로 직접 요청을 고르면 라이브러리 없이 보관할 수 있다. 템플릿 수정 이력 복원 UI는 아직 없다.
- AI는 원본 저장 후 단일 비동기 worker가 제출 사본의 Hive 직접 API·Devin CLI 또는 기존 HTTP 게이트웨이를 호출한다. 실행기 설정은 docs/AI_CONFIGURATION.md를 따른다. Devin CLI는 실행기이며 앱이 `AI_DEVIN_MODEL`(기본 `swe-2-high`)을 명시적으로 전달한다. 작업의 실행기·모델 표시와 사용량 미보고 `null`을 유지하고 알 수 없는 비용을 추정하지 않는다. 기본 프로필은 Hive이며 키·모델이 없거나 AI_RUNNER_KIND=disabled이면 실행하지 않는다. N100 상주 LLM·제공자 자동 전환·자동 유료 재시도는 없다. 이전 `prepared`·예시를 자동 등록하지 않는다. **현재 메모로 다시 요청**은 현재 저장된 원문과 보관한 템플릿 사본·추가 지시를 재사용하고 **실패한 요청 그대로 재시도**는 이전 입력·프롬프트 사본을 유지한다. 접힌 **요청 당시 입력·프롬프트**는 선택한 작업의 사본을 보여준다. UUID·파일 순서/바이트 지문·최초 선택을 reload/응답 유실에도 유지한다. 실행 토큰·불변 이력·원본 버전 차이·휴지통 가시성과 실행/수집/폴링 한도는 [현재 규격](CURRENT_IMPLEMENTATION.md#ai-요청-실행)을 따른다.
- 리서치는 URL이 있으면 기존 단일 URL 수집을 우선하고 URL 없는 비어 있지 않은 주제만 Devin 검색으로 처리한다. 자유 요청은 검색하지 않는다. HTTP의 키워드 요청은 `research_search_unavailable`, 확인한 본문이 없으면 `research_no_sources`로 요약 전에 실패하며 원본을 보존하고 명시 재요청만 허용한다. `researchModes`는 비활성 `[]`·HTTP `['url']`·Devin `['url', 'keyword']`다. 키워드는 검색 1회·후보 5개·고유 최종 본문 3개·본문당 16,666자/합계 49,998자와 검색/요약 CLI 2회의 공유 120초·동시 작업 1개 계약을 유지한다.
- 기본 템플릿은 URL 리서치·키워드 리서치·생각 정리·여행 계획 4개다. `research-keyword` backfill은 ID가 없고 전체 템플릿이 200개 미만일 때만 추가한다. 기존 수정본·보관 상태를 덮거나 가득 찬 라이브러리를 늘리지 않는다. 종류 표시는 리서치이며 URL 템플릿 이름은 유지한다.
- Devin의 임시 요청 공간·최소 환경·도구 설정을 OS 샌드박스로 설명하지 않는다. 검색 단계의 `web_search`만 허용하며 요약에서는 웹 검색도 금지한다. 다른 에이전트 설정 가져오기·자동 업데이트를 끈다. 1MiB ATIF·실제 검색 호출 1개/관측 URL 연결·256KiB 출력 검사는 호출 후 검증이며 제공자 과금 상한이 아니다. Mac/Linux에서 소유 POSIX 프로세스 그룹에 SIGTERM→200ms 뒤 SIGKILL, 실제 close·임시 공간 정리·`drain(signal)`이 끝난 뒤 실패 기록·다음 작업·종료를 진행한다. Windows 직접 자식과 그룹을 벗어난 프로세스까지 보장하지 않는다. HTTP 중단은 제공자 과금 취소 보장이 아니다. 키·원문·공급자 오류 본문을 로그/클라이언트에 노출하지 않고 첨부 전송·OCR·결과 자동 채택·검색 색인·예약 리서치·유료 fallback을 추가한 것으로 주장하지 않는다.
- Capture 저장 응답은 보낸 스냅샷과 현재 입력이 같을 때만 초안을 비운다. 전송 중 작성한 다음 메모·설정을 지우지 않는다. 템플릿 초안 복구·보관 시 원래 `expectedVersion`·`expectedRevisionId`를 유지하며 다른 기기의 변경을 거부한다. 서버/브라우저 초안을 합쳐 최대 401개를 복구하며 손상된 원본을 이후 편집으로 덮지 않는다. 가져오기 중 바꾼 입력함의 템플릿 선택은 유지한다. 최근 템플릿은 리서치·일반 메모별로 기억하며 보관된 선택은 활성 기본값으로 대체한다.
- 모바일 프롬프트는 본문 먼저, 접힌 메타데이터, 전용 하단 저장 줄을 유지한다. 공통 빠른 입력 도크와 겹치지 않으며 메뉴를 열면 저장 줄을 숨긴다. 브라우저 초안을 서버 데이터나 백업으로 설명하지 않는다. 저장된 템플릿·수정본은 DB 백업에 포함한다. JSON 내보내기는 현재 템플릿만 담으며 주소 변경 전 미저장 초안은 저장하거나 복사한다.
- 생성 응답 유실로 새 작성 화면과 생성된 항목에 각각 초안이 남을 수 있다. 재시도 확인 때 어느 쪽도 덮지 않고 기존 생성 스냅샷을 유지한다. 현재 화면을 유지하며 별도 복제를 안내한다.

## 화면 변경 시

- 공통 화면 밀도는 `src/workspace.css`, 홈은 `src/dashboard/dashboard.css`, 페이지 도구·보조 패널은 `src/pages/pageWorkspace.css`를 따른다. 보기 설정은 브라우저 표시 상태이며 Page JSON에 넣지 않는다. 목차는 현재 편집기 문서에서 읽고 홈에서는 편집기를 미리 로드하지 않는다. `npm run qa:ui`는 임시 DB로 긴 사이드바·표시 설정·목차·지도 편집·모바일 배치를 확인한다. 추가 도구는 페이지의 더보기에 명확한 이름으로 두고 모바일 주요 도구 한 줄을 보존한다.

- [DESIGN.md](DESIGN.md)의 현재 팔레트·글꼴·레이아웃을 기준으로 기존 컴포넌트와 상태를 재사용한다. 디자인 값은 아직 CSS 파일에 직접 쓰인 곳이 많으므로 문서의 토큰과 실제 CSS를 함께 확인한다.
- 디자인 토큰이나 컴포넌트 규칙을 바꿀 때는 [디자인 사이드카](.impeccable/design.json)도 함께 갱신한다.
- 데스크톱뿐 아니라 320px·390px 모바일, 시스템 라이트·다크 모드에서 확인한다. 특히 긴 페이지 제목 줄바꿈, 본문 대비, 모바일 하단 빠른 입력과 메뉴 겹침을 본다.
- 키보드 입력, 붙여넣기, 빈 상태·저장 중·저장 실패·충돌 상태가 실제로 작동하는지 확인한다. 읽기 화면처럼 보이는 가짜 비활성 상태를 만들지 않는다.
- 서비스 문구는 한국어로 명확하게 쓴다. 기술 내부 구조는 사용자 화면에 필요한 경우에만 노출한다.

## 실행과 검증

현재 일정 활동 유형·이미지 공유의 전체 테스트 212/212·빌드·브라우저 검증 범위는 [검증 기록](.omo/evidence/itinerary-static.md)을 따른다. 이전 공개 Google SDK의 실지도 기록은 역사적 구현의 증거이며 현재 공유 화면은 SDK를 로딩하지 않는다.

`npm test`는 임시 DB·HTTP fixture·가짜 CLI를 쓰며 일반 QA 자식 서버는 AI 실행기를 강제로 비활성화한다. 키워드 QA도 임시 DB·HTTP fixture만 사용한다. 실제 Devin 호출은 `node scripts/ai-devin-smoke.mjs`를 명시적으로 선택할 때만 수행하고 합성 입력·임시 저장소를 사용한다. `DEVIN_SMOKE_RESEARCH=1 DEVIN_BIN=/installed/path/devin node scripts/ai-devin-smoke.mjs`는 외부 계정 사용량·요금이 발생할 수 있는 공개 주제 키워드 smoke이며 실행당 앱 작업 하나·순차 CLI 2회를 만든다. 사용량 미보고는 `null`로 유지하며 앱 작업 수를 제공자 내부 호출 수·비용으로 해석하지 않는다. 이전 키워드 확장의 기록은 최초 검색 probe와 키워드 작업 2개이며 전체 제공자 호출이 한 번이었다고 주장하지 않는다.

```bash
npm install
npm run dev       # Vite 5173 + API 8787
npm test          # DB·API·시간 규격
npm run qa        # 빌드 + 임시 저장소의 Chrome 실제 시나리오
npm run qa:features  # 일정·페이지 도구·수정 이력·자동 백업 대상 QA
npm run qa:google-map  # 빌드 + 임시 DB·개인 Google SDK 경계 fixture·정적 공개 뷰
npm run qa:static-plan # 활동·시간·이미지 참조·공유·모바일
npm run build     # 타입 검사 + 배포 빌드
node --test test/ai-*.test.mjs test/capture-submission.test.mjs test/devin-output.test.mjs
QA_AI_SCREENSHOTS=0 node scripts/qa-ai.mjs  # 빌드 후 임시 게이트웨이, 실호출 없음
node scripts/qa-keyword-research.mjs       # 빌드 후 임시 DB·HTTP fixture, 실호출 없음
node --test test/page-lifecycle.test.mjs test/page-ai-api.test.mjs test/page-document-visibility.test.mjs
node scripts/qa-page-ai.mjs                # 빌드 후 임시 DB·로컬 게이트웨이, 실호출 없음
node --test test/ai-activity.test.mjs
node scripts/qa-ai-activity.mjs            # 빌드 후 임시 DB·로컬 worker, 실호출 없음
node --test test/search.test.mjs test/search-api.test.mjs
QA_SEARCH_SCREENSHOTS=0 node scripts/qa-search.mjs  # 빌드 후 검색만 확인
node scripts/benchmark-search.mjs                 # 임시 1만·10만 혼합 자료
```

`npm run qa`는 실제 `data/`를 사용하지 않는다. 브라우저에서 수동 확인할 때도 가능한 한 별도 데이터 디렉터리를 쓴다. `npm run seed:showcase -- --force`는 기존 예시 페이지를 **덮어쓰므로** 명시적으로 예시를 갱신하는 작업에만 사용한다.

이전 Google 확장의 [검증 기록](.omo/evidence/google-map.md)은 최종 전체 테스트 206/206·빌드·대상 QA, 별도 실제 SDK QA와 앞선 제한된 독립 리뷰를 구분한다. `test/fixtures/google-maps-sdk.js`는 연동 경계 fixture이며 실지도 검증을 대신하지 않는다. 사용자 제공 키의 [실지도 QA](.omo/evidence/google-map-live.log)는 개인 390px·공개 데스크톱/모바일에서 세 핀·화살표·클릭/네이티브 Enter·전체 맞춤·공개 격리를 확인한 범위다. 키 원문을 문서·evidence에 기록하지 않는다. 키 없는 UI 세 캡처와 실제 지도 캡처를 구분하고 가짜 지도 화면을 실제 Google 지도 검증으로 주장하지 않는다. 전체 Google SDK 접근성·모든 장소/배치 검증으로 확대하지 않는다.

이전 검색 확장의 기록된 77/77 전체 테스트·빌드·scoped/full Chrome QA·6장 화면 증거는 [.omo/evidence/unified_search.md](.omo/evidence/unified_search.md), 측정값은 [search-benchmark-v2.json](.omo/evidence/search-benchmark-v2.json)에 있다. Apple M1 Max의 저장소 호출·임시 자료 결과이며 N100·HTTP·브라우저 지연이나 운영체제별 네이티브 IME 전체 검증으로 주장하지 않는다.

이전 키워드 확장의 [최종 전체 테스트](.omo/evidence/keyword-tests-final.log)는 123/123이며 [빌드](.omo/evidence/keyword-build.log), [전체 QA](.omo/evidence/keyword-full-qa.log), [최종 키워드 QA](.omo/evidence/keyword-ui-qa-final.log)가 통과했다. [검증 기록](.omo/evidence/keyword_research.md)과 [승인 리뷰](.omo/evidence/keyword-review.md)를 따른다. 마지막 QA fixture 출처 수 교정은 제품 UI·기존 6장 캡처를 바꾸지 않았다.

이전 AI 결과 페이지 확장의 [전체 테스트](.omo/evidence/ai-page-tests-final.log)는 131/131이고 [빌드](.omo/evidence/ai-page-build-final.log), [최종 AI 브라우저 QA](.omo/evidence/ai-page-ui-final.log), [기존 가져오기 QA](.omo/evidence/ai-page-connections-qa.log)는 통과했다. [이전 문서 확인 기록](.omo/evidence/ai-page-documentation.md)은 당시 코드·링크·서술 확인 범위를 남긴다. [당시 독립 코드·UI 리뷰](.omo/evidence/ai-page-review.md)는 Approve·Ship이며 미해결 지적은 없었다. 들여쓰기 보존 수정 뒤 [최종 AI QA](.omo/evidence/ai-page-ui-confirm.log)도 통과했다.

변경한 동작에는 관련 테스트와 문서를 갱신한다. UI 변경은 실제 화면을 확인하고, 검증 결과와 남은 제한을 작업 보고에 적는다. 문서만 바꾼 경우에는 링크·형식·서술이 현재 코드와 맞는지 확인한다. 메모 수명 주기·Page AI의 문서 확인 범위는 [수명 주기 문서 기록](.omo/evidence/lifecycle-documentation.md), AI 현황은 [모니터 문서 기록](.omo/evidence/ai-monitor-documentation.md)에 남긴다. 이전 전체 테스트 수·smoke를 새 기능의 최종 검증으로 재사용하지 않는다. 모니터 수정 verdict는 두 지적의 해결만 승인했으며 전체 `scripts/qa.mjs`의 이번 통과나 새 전체 화면 승인을 주장하지 않는다.

## 서버 이전 전 확장 계약 (2026-09-30)

- `server/pageExport.mjs`: 현재 직접 첨부만 포함하는 ZIP32 STORE 스트림. 최대 500개 참조·200MB. ASCII 안전 파일명, CRC/데이터 descriptor, 기존 공개 HTML 이스케이프를 재사용한다. 개인 댓글/작업/타 페이지를 포함하지 않는다. 공개 렌더러를 변경하면 오프라인 뷰도 검증한다.
- `server/pageComments.mjs`: 페이지 최대 500개 대화·총 1,000개 메시지, 대화 최대 100개 메시지·개별 2,000자. UUID 재전송·독립 thread version·사라진 블록 인용문을 보존한다. 댓글은 문서 버전을 올리지 않는다. 개인 댓글 API를 공개 서버에 추가하지 않는다. 공유 댓글은 별도 테이블/API/broker 계약을 따른다.
- `server/ocr.mjs`·`src/ocr/AssetOcr.tsx`: 개인 이미지의 명시 HTTP 요청·별도 큐/결과. PNG/JPEG/WebP 5MB·한 작업 60초·응답 256KiB/64,000자·동시 1·대기/처리 100. 로컬 모델/자동 전송 없음. 고정 HTTPS/루프백 URL·도구 금지·원본 보존·중단 상태·UUID를 유지한다. 실제 제공자 호출은 일반 QA에서 하지 않는다.
- `server/ai/taskAdoption.mjs`: 선택·수정한 1~50개 Task와 작업 연결 영수증을 원자적으로 저장한다. 성공 전 제출 사본을 보존하고 실패/새로고침 재전송에서 중복을 만들지 않는다.
- `server/searchExtensions.mjs`: `results-tasks-ocr-v1` 최초 파생 backfill; 이후 원본 트리거 갱신. core rebuild 시 확장도 다시 채운다. OCR은 이력의 정확한 `ocrJob`, Task는 `taskId`로 연다. 휴지통 소유자의 완료 결과는 숨긴다. 기존 검색/표시 원문 규칙은 유지한다.
- `src/prompts/PromptHistory.tsx`: 최근 100개 immutable 수정본을 읽고, 미저장 초안이 없을 때만 이전 본문을 새 초안으로 불러온다. 기존 저장/409 충돌 경로를 사용한다.
- `compose.n100.yaml`·`docs/DEPLOYMENT.md`: amd64 대상과 건강 확인/이전 경계. 실제 Tailscale/Tunnel/원격 복원/N100 측정은 수행한 증거 없이 완료라고 쓰지 않는다.
- `node scripts/qa-predeployment.mjs`: 임시 DB·로컬 OCR fixture·Chrome·실제 ZIP unzip/offline 읽기. 신규 private API는 공개 프로세스에 등록하지 않는다.

### 댓글 UX 유지 규칙 (2026-09-30)

- 편집 중 말풍선은 가벼운 `comments?view=summary`에서 받은 실제 개수/해결 상태를 사용한다. 전체 댓글을 매 저장/마우스 이동마다 읽지 않는다. 늦은 요약 응답으로 새 대화 상태를 덮지 않는다.
- `PageCommentGutter`는 PC hover·모바일 선택을 지원하며 말풍선으로 포인터를 옮겨도 버튼이 사라지지 않는다. 댓글 모드를 열면 저장 문서를 잠그는 계약은 유지한다.
- 패널의 인용/위치 버튼·대화 스크롤·하단 입력을 분리한다. 한글 조합 중 Ctrl/Cmd+Enter 등록을 막고 실패/닫기/재열기 후 초안·UUID 재시도를 보존한다. 해결한 대화는 접고 삭제는 더보기/확인을 거친다.
- 모바일 62%/88% 높이와 `visualViewport` 키보드 가시 영역을 사용한다. 브라우저 가시 영역 모의 검증을 실제 휴대폰 키보드 검증으로 주장하지 않는다.

### 이름 기반 공유 댓글 유지 규칙 (2026-09-30)

- `server/sharedComments.mjs`는 별도 공유 대화/메시지/영수증을 같은 SQLite에 저장한다. 개인 대화를 복사하거나 공개하지 않는다. 공유 대화는 페이지 단위이며 재발급한 링크에서도 이어진다.
- `commentsEnabled` 기본 false, 발급/기존 링크 PATCH로만 변경한다. 공개 매 읽기/쓰기에서 토큰·만료·폐기·현재 활성 페이지·허용을 검사한다. 공유에서 숨은 블록/자식은 댓글 읽기/쓰기도 숨긴다.
- 공개 프로세스의 DB/파일은 readonly를 유지한다. Unix socket `COMMENT_SOCKET_PATH`의 댓글 전용 broker만 방문자의 create/reply를 처리한다. 개인 관리 API를 proxy하거나 방문자가 작성자 배지·해결/삭제를 지정하게 만들지 않는다.
- 이름 1~30자(인증 아님), 메시지 2,000자, JSON8KiB, UUID재전송/대화 버전/개수 상한/동일 Origin/속도 제한을 유지한다. 초기 부하 검증의 결과를 N100 성능으로 주장하지 않는다.
- `public/share-comments.js/css`는 작은 독립 공개 UI다. 이름/본문은 textContent로 출력하고 오프라인 기본 렌더러에는 댓글 UI/데이터를 넣지 않는다. 개인 UI의 개인/공유 초안·제출 사본·가벼운 요약 조회를 분리한다.
- Compose는 `comment-ipc` Unix socket 볼륨만 공유하며 공개 서비스에 개인 네트워크·DB쓰기·백업/AI키를 주지 않는다. DNS/Tailscale/Tunnel 연결 여부는 실제 검증과 구분한다.

### 서버 이전 전 통합 계약 (2026-09-30)

- 공유 댓글 받은함은 방문자 메시지 sequence와 읽음 marker를 분리한다. 읽음은 실제 선택 대화에서 받은 guest message ID까지만 단조 증가하며 해결과 독립적이다. 홈 조회에 Page JSON을 넣지 않는다. 받은함은 private API만 제공하고 공개 token 댓글 API에는 읽음/관리 권한을 추가하지 않는다.
- `src/capture/`·`public/capture-worker.js`는 개인 설치/공유 수신을 맡는다. 좁은 share-target POST 외에는 fetch를 가로채거나 API/페이지를 cache하지 않는다. IndexedDB 대기 원본은 내구성 있는 초안 병합 후에만 소비한다. 기존 초안/첨부·UUID와 일반 capture 저장 규칙을 보존하고 일반 QA에서는 임시 브라우저 저장소만 사용한다. iOS Safari OS 공유 수신이나 실제 휴대폰 설치를 검증했다고 주장하지 않는다.
- 일정 준비 연결은 `plan_connections`의 private side table이다. 원문 Page/block/entry, relation, Task 버전을 확인하며 공유는 명시 선택한 활성 Task 제목/상태만 공개/ZIP에 투영한다. 관련 memo/page를 공개 재귀 조회하거나 사적인 targetId/relationId를 출력하지 않는다.
- 운영 이미지에 `scripts/backup-data.mjs`를 포함한다. 복원은 존재하지 않는 새 경로만 허용한다. `qa:docker-share`는 사용자 data/와 다른 임시 프로젝트/볼륨을 만들고 해당 프로젝트만 정리한다. `.env.example`에는 실제 키를 넣지 않는다. 로컬 Docker 성공을 N100/Tailscale/TLS/호스트 재부팅 검증으로 확대하지 않는다.

- 최근 열람은 홈 이어서 작업에만 표시하며 사이드바에는 추가하지 않는다. Task 보드 카드 아래 상태 선택은 없고 제목 편집에서 내용·기한·상태를 같은 버전으로 저장한다. PC 드래그·충돌·실패 재시도를 보존하고 모바일 편집은 44px/16px를 유지한다.
- 일정 경로 링크는 `itineraryRoutes`를 개인/공유에서 같이 사용한다. 최대 3개 경유지·2,048자·날짜 분리·이동 제외 계약을 보존한다. 자동 지도 캡처·SDK·API 키를 공유에 추가하지 않는다.


### Geoapify 정적 지도 유지 규칙 (2026-10-01)

- `server/geoapifyMaps.mjs`·`shared/staticMap.ts`·`MapImageControls.tsx`는 명시 지도 생성/입력 사본/조작을 맡는다. 키는 서버 `.env`/개인 Compose에만 전달하며 `maps/config`에는 bool만 추가한다. 공개 서비스에 생성 API·키·SDK·타일을 넣지 않는다.
- UUID 성공 재생, 저장 버전 검사, 같은 진행 요청 합치기, UTC 일자별 기본 20회 **시도** 제한, 고정 Geoapify 호스트/30초/8MB/PNG2048px/외부 오류 정제를 유지한다. 생성 후 충돌 파일을 삭제한다. 원문·시간표·기존 자산을 덮거나 자동 외부 호출하지 않는다.
- 이미지 props의 `imageSource`·`imageInput`을 복제·이동·수정 이력에서 보존한다. 현재 문서의 이미지를 재선택할 때 `staticMapImageMetadata`로 같은 asset의 사본을 복원한다. 좌표 없는 방문도 입력 사본에 포함해 번호 변경을 감지한다. 출처와 stale 안내는 공유/오프라인에서도 유지한다.
- GL 지도 범위는 512px world 기준이며 density 2는 논리 뷰포트를 바꾸지 않는다. POST 숫자 marker size는 실서비스에서 핀이 누락되었으므로 실PNG로 확인한 `material`·`large`·`textsize:medium`을 사용한다. 지도는 normal flow로 스크롤한다.
- `test/geoapify-map.test.mjs`와 빌드 후 `scripts/qa-geoapify-map.mjs`는 임시 저장소/모의 제공자 경계를 사용한다. 실제 키 호출·실데이터 페이지 수정은 사용자 승인 범위에서만 수행하며 fixture QA를 실제 지도 품질 검증으로 주장하지 않는다. [이번 기록](.omo/evidence/geoapify-map/REPORT.md).

- 현재 정적 지도 기본은 `defaultStaticMapStyle`의 `klokantech-basic`이다. 지역명은 제공자 Noto Sans Regular·기본 자간이며 지역명 16px/도로 13px/장소 12px를 사용한다. 기존 `osm-bright-smooth`는 지역명 강조 선택으로 유지한다. Static API의 layer/color/size만 지원하므로 임의 폰트/굵기/자간 필드를 전송하거나 웹 CSS로 PNG 내부 폰트가 바뀐다고 설명하지 않는다. 한국어 주변 지역/도로 라벨·연한 건물·fit보다 0.8단계 넓은 맥락을 보존한다. 허용 스타일은 `staticMapStyles`를 서버/클라이언트에서 같이 사용해 신규 스타일의 재시도 복구를 누락하지 않는다. 과거 문서의 osm-liberty 기본과 구분한다. 실제 지도 데이터에 없는 지역명/장소명을 임의로 삽입하지 않는다.

- 지도/시간표 읽기 배치는 개인·공유·오프라인 공통 한 열이다. 1000px 이상 2열 media 규칙과 이미지 360px 높이 상한을 다시 추가하지 않는다. 원래 비율/문서 폭·normal-flow 스크롤·주변 지역명을 유지하며 기본 지도만 공원/물/주요 도로의 지형 색을 구분한다.

- 지도 아래 장소 이름은 `staticMapStops`로 같은 좌표 핀/번호를 사용한다. 좌표 없는 장소를 번호 목록에 추가하거나 이동에 번호를 붙이지 않는다. 공유/오프라인의 이름·URL은 escape한다. 지도 설정의 editor.isEditable 조건부 unmount는 저장 잠금 해제 후 조작이 돌아오지 않을 수 있으므로 context disabled 상태로 관리한다.
- 댓글 버튼은 편집기 내부 56px 여백과 44px 버튼을 유지한다. 음수 right로 외부에 붙이거나 모바일 본문에 별도로 40px 여백을 중복 추가하지 않는다. PC의 보조 공간은 열기/닫기와 무관하게 확보하며 일정 버튼은 바깥 margin보다 실제 표면에 맞춘다.

일정 읽기 UI를 고칠 때는 [일정 읽기 brief](.impeccable/briefs/itinerary-reading.md)와 CURRENT_IMPLEMENTATION의 여행 문서 읽기 구조를 함께 확인한다. 개인/공유는 `shared/itineraryReading.ts`·`public/itinerary-timetable.css`를 공유한다. 새 공개 CSS는 `server/public.mjs` 정적 허용 목록과 `server/pageExport.mjs` 오프라인 자산 목록에 함께 추가한다. 목차 compact는 선택 속성이고, 공개 목차가 숨긴 captureRef/page/TOC 하위 제목을 다시 노출하지 않도록 한다. 일정 설명은 접거나 요약하지 않고 전체 원문을 한 번 표시하며 시간별 줄바꿈을 보존한다. 목차는 compact에서도 이름을 바꾸지 않는다. CSS의 기존 `.itinerary-duration` 입력 높이가 읽기 열의 행을 늘리지 않도록 확인한다.

일정 직접 편집은 `ItineraryInlineField.tsx`/`itineraryInline.css`와 기존 ItineraryBlock 초안·Page 자동 저장을 사용한다. 전체 폼/접힌 일정 편집 목록을 다시 도입하지 않는다. IME 중 Enter는 확정하지 않고, 설명 Enter는 줄바꿈, Escape는 해당 필드 취소다. 변경된 항목의 ID와 이미지 메타데이터를 새로 만들지 않는다. UI 회귀는 임시 DB의 `scripts/qa-itinerary-inline.mjs`로 확인하며 실제 사용자 여행 문서를 QA 입력으로 바꾸지 않는다.


여행 공유서의 새 읽기 정리는 [trip-sharing brief](.impeccable/briefs/trip-sharing.md)를 따른다. PlanConnections의 기본 summary에는 실제 항목만 표시하고 관리 도구는 행 ··· 메뉴의 manage에 둔다. 공개 선택·개인 자료 격리·UUID 재시도 계약을 변경하지 않는다. 본문에 빈 준비 버튼/0/0을 다시 넣지 않는다. 공유 rich 목록은 서식 있는 제목과 본문을 별도 flex 열로 나누지 않으며, 명시 줄바꿈을 보존한다. 문서 재정리 전 사본/expectedVersion을 확보하고 기존 블록/항목 ID·시각·지도 asset/source/input·출처·댓글 앵커를 보존한다. 이번 확인 기록은 `.omo/evidence/trip-clarity/REPORT.md`다.


### 오프라인·동기화 작업 진입점 (2026-10-03, 설계 단계)

오프라인/PWA 동기화를 구현할 때는 [설계지시서](docs/superpowers/specs/2026-10-03-offline-workspace-design.md), [실행 계획](docs/superpowers/plans/2026-10-03-offline-workspace.md), [6.1-Sol xhigh 인계](docs/handoffs/2026-10-03-offline-workspace.md)를 먼저 읽는다. 이 문서들은 **구현 전 목표**이며 현재 기능 완료 근거가 아니다. v1은 IndexedDB + outbox + 버전 충돌 보존 방식, CRDT는 후속 실험이다. 기존 실제 데이터·공유 경계를 보존한다.

### 오프라인 구현 유지 계약 (2026-10-03)

위 설계 단계 표시는 승인 당시 기록이다. 현재 구현은 CURRENT_IMPLEMENTATION의 오프라인 절·docs/OFFLINE_USAGE.md·검증 REPORT를 우선한다.

- 원본 엔티티 변경은 putEntity/removeEntity로 entities와 entitySummaries를 같은 트랜잭션에서 갱신한다. 본문을 summary에 추가하지 않는다. additive IDB v2 migration에서 원문/영수증 삭제 금지.
- workspaceFetch가 local CRUD를 맡는다. 기존 fetch PUT autosave를 병행하지 않는다. 최신 localRevision보다 오래된 ACK/remote로 입력을 교체하지 않는다.
- workflow UUID/원본/템플릿/receipt 의존성은 고정한다. 전송 후 payload 수정·응답 유실 시 다른 UUID 실행 금지. source conflict 해결 뒤 dependent 요청은 재검토한다.
- SW는 static shell만. API/본문/첨부는 IDB 경로, 공개/개인 경계 유지. pin은 직접 참조만 보관하고 자식을 재귀 다운로드하지 않는다.
- 게이트: build/test, qa-offline-*.mjs 각각, qa-sync-engine/qa-pwa-shell/qa-mobile-capture/qa-workspace-ui. 10k/1k/100 fixture는 qa-offline-performance. 실제 data/.env/AI/maps 키로 QA 금지. 실기기 미검증을 browser QA 통과와 구분한다.

### 문서 템플릿과 자료 가져오기

리서치·여행·회의·개발 문서를 작성할 때 `docs/DOCUMENT_BLUEPRINTS.md`와 `shared/documentBlueprints.ts`의 해당 버전 지침을 먼저 확인한다. 틀의 안내 문구를 사실로 취급하지 않으며 예약·가격·좌표·검증 결과를 추측하지 않는다. 원시 개인 API의 POST 페이지 생성은 본문을 받지 않는다. 반환 ID/버전을 보존하고 PUT expectedVersion으로 저장하며, 응답 유실 때 조회로 확인한다. 브라우저의 workspaceFetch 로컬 생성 계약과 혼동하지 않는다. 자료 삽입은 JSON 전송 형태로 `shared/pageValidation.mjs`를 검증한 뒤 편집기를 변경하고, 원본 및 기존 첨부/참조를 보존한다.

### 개인 인증 계약 (2026-10-04)

`docs/AUTHENTICATION.md`와 private-auth 설계/계획을 먼저 읽는다. `server/auth/`·`src/auth/`는 단일 개인 계정·기기 신뢰를 맡으며 공유 방문자 인증과 구분한다. 모든 개인 API guard는 sync/upload보다 먼저 실행한다. 공개 등록 경로·공개 프로세스의 개인 auth API·AUTH_SECRET_KEY·auth 테이블의 sync/search/HTML 노출을 추가하지 않는다. production/외부 HOST/Compose의 required 기본을 유지한다. Cookie만으로 쓰기를 허용하거나 Secure를 공개 운영에서 해제하지 않는다.

로그인/401/로그아웃 때문에 열린 편집기나 IndexedDB/outbox/초안/첨부를 삭제하지 않는다. 명시 로그아웃은 숨기고 잠금 상태를 유지하며 재로그인 시 동일 UUID를 재개한다. 초기 계정/복구 코드는 실제 사용자 데이터로 QA하지 않는다. CLI는 password/OTP를 argv/env로 받지 않고 .env를0600으로 보존한다. DB 복원에는 기존 AUTH_SECRET_KEY가 필요하고 epoch를 바꾸어 이전 세션을 무효화한다. 검증은 auth/auth-api/auth-setup 테스트와 build, `qa:auth`; 실제 TLS/휴대폰/PWA를 임시 Chrome 성공과 구분한다.


## 여행 기능 분리 (2026-10-05)

사용자 승인으로 새 작성 `/` 메뉴의 지도·일정과 기본 여행 문서 템플릿을 제외했다. `documentBlueprints`는 리서치·회의·개발 기록만 제공하며 여행 상세 API/생성 함수는 `legacyDocumentBlueprints`를 통한 호환용이다. 기존 블록 스키마·문서·이미지·공유·Markdown·오프라인 내보내기와 사용자 저장 템플릿/AI 프롬프트는 보존한다. 여행 기능을 메뉴에 다시 추가하지 않으며 신규 개발은 별도 서비스로 진행한다. 기존 여행 문서 변환과 호환 코드 삭제는 이번 작업에 포함하지 않는다. [재활용 묶음·의존성·AI 후속 인계](docs/handoffs/2026-10-05-travel-service-extraction.md)를 먼저 확인한다. 위의 이전 지도·여행 문서 규격은 기존 문서 호환을 설명한다.

## OpenCode 모델 관리 (2026-10-05)

`server/ai/opencode.mjs`는 검증된 OpenCode 1.18.34 비대화형 CLI의 stdin·고정 모델·XDG 기록 정리를 맡고 `cliProcess.mjs`는 Devin과 공통 프로세스 종료를 맡는다. `modelCatalog.mjs`·`opencodeModels.json`은 공식 Zen 86개 사본과 고정 주소 조회/검증을 맡으며 사용자 요청으로 초기 등록·공식 갱신은 확인된 무료 텍스트 모델 11개로 제한한다. `shared/aiModels.ts`·`src/settings/OpenCodeModels.tsx`는 사용자 편집 보존·기본 모델·명시 갱신/저장을 맡는다. 전체 AI disabled 및 기본 OpenCode 별도 disabled를 유지한다. 과거 job 모델을 목록 갱신으로 바꾸거나 자동 다른 제공자 전환을 추가하지 않는다. 가격 필드는 안내값이고 비용 한도가 아니다. 가짜 CLI 검증과 실제 제공자 호출/Oracle 설치를 구분한다. [AI 설정 문서](docs/AI_CONFIGURATION.md)를 따른다.

### 서비스 알림 계약 (2026-10-05)

`server/serviceNotifications.mjs`는 개인 서버 AI 실행 시작/확정 실패의 best effort Telegram 전송을 맡는다. 기본 비활성/미리보기 꺼짐이며 `.env.service-alerts`는 자동 로딩하지 않는다. 비밀정보는 잘라내기 전에 정제하되 완전한 개인정보 탐지로 설명하지 않는다. 실패 원문·봇 토큰 URL·키를 로그/클라이언트/공개 Compose 환경에 넣지 않는다. 알림 실패로 AI 작업을 실패 처리하거나 대기시키지 않는다. 모델/템플릿 사본·고정 사유와 당시 작업 링크를 유지한다. [서비스 알림 문서](docs/SERVICE_NOTIFICATIONS.md)를 따른다.

OpenCode 도구 실행은 전역/agent `ask` + 비대화형 CLI의 권한 자동 거절로 차단한다. `--auto`·`--yolo`·`--dangerously-skip-permissions`는 전달하지 않는다. CLI 버전 확인은 요청 전송보다 먼저 하며 미검증 버전을 허용하지 않는다. 버전 변경 시 공식 run 소스와 실제 파일·셸 거절을 확인한다.
