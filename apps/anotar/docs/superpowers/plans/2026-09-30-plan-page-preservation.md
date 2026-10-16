# 계획 공유·페이지 도구·데이터 보존 실행 계획

Spec: [설계](../specs/2026-09-30-plan-page-preservation.md)

기존 변경을 보존한다. 커밋·외부 배포는 이번 요청 범위에 없다. 독립 모듈 작업은 병렬로 수행하고 공통 서버 라우팅/에디터는 주 에이전트가 통합한다.

## Task 1: 페이지 저장 기능

Files: server/pageTools.mjs, server/store.mjs, server/pageConnections.mjs, test/page-tools.test.mjs.
Interfaces: createPageTools(db,getStore), duplicatePage, savePageTemplate, listPageTemplates, createPageFromTemplate, deletePageTemplate, movePageBlocks, attachPageFiles, listPageRevisions, getPageRevision, restorePageRevision. 입력 mutation은 operationId/expectedVersion, move는 targetPageId/targetVersion/blockIds. 결과 {item}, 이동은 {item,target}; 페이지 생성/복원/첨부는 PageRecord.

- [x] 임시 DB의 복제/선택 이동/이력/첨부/템플릿, 충돌/재시도/소유자 삭제/공개 경계를 실패 테스트로 작성한다.
- [x] SQL 이관, 최신 100개 이력 트리거, Page 직접 첨부 소유·참조, 불변 UUID 영수증과 원자적 mutation을 구현한다.
- [x] 관련 저장/참조/검색 테스트로 호환성을 확인한다.

## Task 2: 페이지 도구 UI

Files: src/pages/PageToolsPanel.tsx, pageTools.css, pageToolsApi.ts. 공통 PageEditor 연결은 주 에이전트가 맡는다.
Interfaces: PageToolsPanel {page,pages,mode:'templates'|'move'|'history',selectedBlockIds,onUpdated,onCreated,onClose,disabled?}; API는 Task1의 결과와 맞춘다. PageInspector 내부에 렌더한다.

- [x] 복제/템플릿/첨부/이동/복원 API 클라이언트와 UUID 재시도 상태를 만든다.
- [x] 템플릿 선택·저장·삭제, 목적지 선택, 버전 목록·읽기 내용·복원 패널을 만든다.
- [x] 미저장/충돌/진행 상태에서 mutation을 차단하고 실패 사본을 유지한다.

## Task 3: 자동 백업

Files: server/automaticBackups.mjs, server/backupRoutes.mjs, src/backups/, test/automatic-backups.test.mjs. 공통 서버/셸 연결은 주 에이전트가 맡는다.
Interfaces: createAutomaticBackups({dataDir,backupDir,configDir?}) => status(),configure({enabled,hour,minute,retention}),runNow(),start(),stop(). handleBackupRoute(req,res,url,manager) => Promise<boolean>. BackupWorkspace는 독립 lazy 화면이다.

- [x] KST 예약·중복 실행·정상 보관·실패 보존 테스트를 먼저 작성한다.
- [x] 기본 off/04:00/7개, 설정 영속화와 스냅샷 검증 후 보관 정리, 실패/재시작 복구를 구현한다.
- [x] 화면의 설정/즉시 실행/상태/복원 안내와 Docker 볼륨 문서를 연결한다.

## Task 4: 연결된 일정 지도 블록과 통합

Files: shared/itinerary.ts, src/pages/ItineraryBlock.tsx, ItineraryMap.tsx, itinerary.css, server/pages.mjs, publicPage.mjs, public.mjs, public/share-plan.*, shared/pageMarkdown.ts, src/pages/PageEditor.tsx, src/main.tsx, server/index.mjs, scripts/seed-connected-itinerary.mjs.

- [x] 일정 모델의 날짜/시간/좌표/중복/URL과 Markdown·공개 렌더링 테스트를 먼저 작성한다.
- [x] 일정 JSON props와 편집/타임라인/지연 다중 지도, 공개 자체 JS/CSP, 새 여행 샘플을 구현한다.
- [x] Task1/2의 개인 API와 에디터 메뉴/첨부를 통합한다. Task3의 개인 백업 라우트/셸/Docker 볼륨을 연결한다.
- [x] 페이지 mutation 후 최신 페이지를 확인하고 초안·참조·사이드바 이벤트를 일치시킨다.

## Task 5: 검증·검토·문서

- [x] npm test, npm run build, 기존 QA, 새 기능 QA를 임시 데이터로 실행한다.
- [x] PC/390/320px, 테마/키보드/공유 모바일을 한 번에 살피고 발견된 문제를 묶어 고친다.
- [x] 독립 리뷰에서 저장/공개/백업 경계와 UI를 검토하고 필요한 지적을 수정한다.
- [x] CURRENT_IMPLEMENTATION, README, DESIGN, AGENTS, SHARING_AND_PLANS, 아키텍처/블록 가이드와 evidence를 갱신한다.

## Review Focus

1. 응답 유실 재시도가 같은 UUID로 결과를 돌려주며 파일을 중복 남기지 않는지.
2. 부모/자식 선택과 첨부 이동이 두 페이지의 버전·참조를 원자적으로 갱신하는지.
3. 기존 asset 스키마 이관이 AI/검색/공유·휴지통 데이터를 보존하는지.
4. 일정 자료의 HTML/JSON 삽입이 XSS를 허용하지 않고 공개 서버가 개인 API에 닿지 않는지.
5. 백업 실패·재시작·경로가 기존 성공 백업이나 실제 data/를 삭제하지 않는지.
