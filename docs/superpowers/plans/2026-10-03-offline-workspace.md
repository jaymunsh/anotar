# Offline Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 기본 실행은 사용자가 지정한 **GPT-6.1-Sol / xhigh의 순차 실행**이다. 다중 에이전트는 별도 지시 또는 적용되는 필수 리뷰 지침이 있을 때만 사용한다.

**Goal:** 서버 한 대와 PC 웹·모바일 PWA 사이에서 메모/페이지/할 일을 기기에 먼저 저장하고 데이터 손실 없이 재연결한다.

**Architecture:** IndexedDB repository와 불변 작업 outbox를 기존 React 화면 앞에 둔다. 서버는 기존 SQLite 도메인 연산에 변경 피드·원자적 영수증을 더한다. v1 페이지는 블록 JSON과 버전 충돌 보존을 사용하며 CRDT는 별도 후속 실험이다.

**Tech Stack:** 현재 잠금된 React/TypeScript/Vite/BlockNote, Node 24 node:sqlite, IndexedDB, Service Worker/Cache Storage. 새로운 DB/클라우드 서비스 없음.

**Spec:** [2026-10-03-offline-workspace-design.md](../specs/2026-10-03-offline-workspace-design.md)

## Global Constraints

- 실제 repo는 `leneu-storage/`. 부모 폴더 전체를 git add하지 않는다. 기존 대규모 dirty tree를 보존한다.
- 사용자 `data/`·`.env`·원본 문서·실제 AI·실제 지도 API를 테스트에 사용하지 않는다.
- protocolVersion=1; IndexedDB `leneu-offline-v1`; 문서 schemaVersion=1, 일정 version=1 유지.
- 파일 25 MiB/개·100 MiB/제출·최대 8개; 문서 1 MiB; JSON operation 최대1100 KiB.
- 작업 payload는 생성 후 불변. operationId 재시도 유지. 새 사용자 결정만 새 ID를 만든다.
- 페이지 자동 병합/last-write-wins/CRDT를 v1에 넣지 않는다. 충돌 양쪽 사본과 tombstone을 보존한다.
- private sync API만 추가하며 public 프로세스·공유 cache에 개인 데이터/키를 넣지 않는다.
- 새 root service worker를 병렬 등록하지 않는다. 기존 share_target/manifest id를 보존한다.
- runtime 라이브러리 버전 변경은 필요한 호환성 증거가 있을 때만 최소 적용한다. 최신 문서 예제를 그대로 설치 버전에 붙이지 않는다.
- 현재 온라인 편집·AI 요청·댓글·공유·검색·백업 기능의 회귀는 같은 단계에서 해결한다.
- 이 문서는 실행 계획이다. 작성 시점에 제품 코드는 변경하지 않았다. 서버 배포·키 발급·실기기 완료 주장을 포함하지 않는다.

## Review Focus

1. 성공 응답 유실 + 두 탭 lease 교체 → Task 2/4에서 receipt 단일 효과와 fencing을 검사.
2. 파일/저장소 quota + 앱 종료 직전 → Task 3/5/6에서 거짓 저장 성공·초안 삭제를 검사.
3. 원격 휴지통/정리/복원 + 로컬 dirty → Task 2/8/10에서 부활·원본 소실·참조 오류를 검사.
4. SW 교체/서버 epoch 복원 + 오래된 outbox → Task 6/11에서 잘못된 재생·캐시 손실을 검사.
5. 일정 JSON·블록 ID·댓글·AI가 같은 페이지를 변경 → Task 8/9/10에서 전체 문서 사본과 기존 회귀를 검사.

## 실행과 기록 규칙

먼저 사용자에게 인계 문서·설계·계획이 검토 대상으로 제공됐는지 확인한다. 사용자가 이 계획으로 실행하라고 지시하면 같은 내용을 매 단계 재승인받지 않는다. 제품 구현을 시작하라는 지시가 없는 현재 문서 작성 요청만으로 구현하지 않는다.

각 Task는 관련 실패 테스트 → 실패 확인 → 최소 구현 → 성공 확인 → evidence/progress 기록으로 끝낸다. 필수 게이트가 실패하면 뒤 단계의 UI를 쌓지 말고 해당 실패를 해결한다. 실기기나 배포 자격 증명이 없으면 가능한 로컬 작업을 끝내고 해당 검증만 미실시로 남긴다.

진행 파일: `.omo/evidence/offline-workspace/PROGRESS.md`. 단계/완료 checkbox/수정 파일/명령 결과/한계/다음 작업을 기록한다. 토큰/컨텍스트가 부족해지면 중단 완료라고 하지 말고 이 파일에서 이어간다. 커밋은 사용자 요청이 있을 때 관련 파일만 명시적으로 stage한다.

기본 확인: `npm run build`, 관련 `node --test test/<name>.test.mjs`, 해당 QA script. 전체 `npm test`는 단계 릴리스에서 실행한다. 무관한 전체 QA를 각 작은 수정마다 반복하지 않는다.

---

## Stage A — 앱 실행과 오프라인 메모·할 일

### Task 1: 계약·마이그레이션 경계 고정

**Files**

- Create: `shared/sync.ts`, `server/sync/store.mjs`, `test/sync-schema.test.mjs`
- Modify: `server/store.mjs`의 store 초기화만 최소 연결

**Interfaces**

- `initializeSync(db): void`
- `getSyncSession(db): {protocolVersion:1,workspaceId:string,epoch:string,headSeq:number,capabilities:string[],serverTime:string}`
- `SyncOperation`, `SyncApplyResult`, `SyncEntityKind`, `SyncConflict`, `SyncSession` 타입은 spec §7과 일치.

- [ ] **1. 기준 기록:** git status, package 버전, 기존 store/서버 경로, 온라인 기본 동작을 기록한다. 기존 uncommitted 변경을 실행자 변경으로 보고하지 않는다.
- [ ] **2. 실패 테스트:** 빈 DB/기존 schema 임시 DB에서 초기화, 재실행, 재시작 identity 유지, 기존 pages/captures/tasks/asset rows 불변을 assert한다.
- [ ] **3. 실패 확인:** `node --test test/sync-schema.test.mjs`가 새 초기화/테이블 부재로 실패해야 한다.
- [ ] **4. 구현:** spec §6의 additive tables와 idempotent 초기화. 새 runtime 코드에서 기존 데이터 삭제/리셋 금지.
- [ ] **5. 검증:** 위 테스트 PASS, 기존 `test/store.test.mjs` PASS. schema 파일 및 마이그레이션 근거 기록.

### Task 2: 변경 피드와 정확히 한 번 적용되는 서버 작업

**Files**

- Create: `server/sync/operations.mjs`, `server/sync/routes.mjs`, `test/sync-operations.test.mjs`, `test/sync-feed.test.mjs`
- Modify: `server/index.mjs`, `server/store.mjs`, `server/tasks.mjs`; 필요시 도메인 transaction helper 최소 추출

**Interfaces**

- `applySyncOperation(store, operation): SyncApplyResult`
- `readSyncChanges(db, {after,limit}): {epoch,headSeq,nextAfter,changes}`
- `handleSyncRequest(request,response,{store}): Promise<boolean>` — 처리한 경우 true, 기존 router fallthrough 보존.
- spec §7의 session/bootstrap/changes/entities/operations endpoint. 처음 capabilities에는 capture/task 작업만 공개.

- [ ] **1. 실패 테스트:** create 5회 재전송이 같은 ID/version/row와 한 mutation receipt를 반환. 동일 ID 다른 payload409. 낡은 version409. 존재 ID create409. receipt insert를 강제 실패시키면 도메인 변경도 rollback.
- [ ] **2. feed 실패 테스트:** 기존 REST/store로 생성·수정·soft-delete·복원, asset/AI 상태 변경이 owner invalidation에 반영. bootstrap 도중 삽입/삭제와 재pull 후 목록 정확. 전송 batch는 seq 순서이며 100개 상한. 늦은 canonical 응답의 readSeq가 최신 tombstone보다 낮으면 부활시키지 않음. clientCreatedAt 재전송 불변과 서버 접수 시각 분리를 검사.
- [ ] **3. 실패 확인:** `node --test test/sync-operations.test.mjs test/sync-feed.test.mjs`.
- [ ] **4. 구현:** payload discriminator/validator, stable JSON hash, 내부 UUID create 지원, receipt 우선 재생, 원자적 transaction/savepoint. 기존 nested BEGIN 경로를 조사하고 실제 원자성을 검증한다.
- [ ] **5. 검증:** 새 테스트와 `test/store.test.mjs test/tasks.test.mjs` PASS. `server/public.mjs`에서는 새 API404 테스트 추가. trigger 대상 표와 누락 검사 결과 기록.

### Task 3: IndexedDB repository와 기존 초안 보존

**Files**

- Create: `src/sync/db.ts`, `src/sync/repository.ts`, `scripts/qa-offline-repository.mjs`
- Modify: `src/drafts/localDraft.ts`, `useCaptureDraft.ts`, `attachmentDraft.ts`의 이관/조회 연결

**Interfaces**

- `openWorkspaceDb(): Promise<IDBDatabase>`
- `saveLocalEntity({workspaceId,kind,id,value,blobs?}): Promise<{id,localRevision}>`
- `readLocalEntity({workspaceId,kind,id})`
- `subscribeLocalChanges(listener): () => void` — BroadcastChannel 부재도 지원.
- `migrateLegacyDrafts({workspaceId}): Promise<{migrated:number,failed:number}>`

- [ ] **1. 실패 시나리오:** 텍스트+Blob commit 후 새 context 아닌 같은 persistent profile 재실행; exact bytes/hash 확인. quota/transaction abort 시 저장 성공 반환 없음. 다른 workspace 파티션에 내용 노출 없음.
- [ ] **2. 이관 시나리오:** 기존 탭별 초안/파일/제출 receipt 유지. IDB 실패 시 old localStorage key 미삭제. 두 번 이관해도 중복 없음.
- [ ] **3. 실패 확인:** 위 케이스를 새 repository를 호출하는 임시 QA harness에서 실행한다. 사용자 origin 저장소를 지우는 QA 금지.
- [ ] **4. 구현:** spec §6 IDB stores, 명시 commit 대기, localRevision, Blob 참조, 오류 분류. 저장소 unavailable을 빈 문서로 해석하지 않는다.
- [ ] **5. 검증:** `node scripts/qa-offline-repository.mjs` PASS; 기존 `test/drafts.test.mjs`와 `scripts/qa-drafts.mjs`의 임시 DB 패턴을 사용해 초안 복구 회귀 확인.

### Task 4: 동기화 엔진·대기열·탭 조정

**Files**

- Create: `src/sync/engine.ts`, `src/sync/transport.ts`, `src/sync/conflicts.ts`, `test/sync-engine.test.mjs`, `scripts/qa-sync-engine.mjs`

**Interfaces**

- `createSyncEngine({repository,transport,clock,random}): {start,stop,requestSync,subscribe}`
- `SyncTransport.session/pullChanges/fetchEntity/applyOperation/upload` — spec 응답 타입 사용.
- 엔진 timer/clock/network를 주입해 단위 테스트에서 실제 sleep 반복하지 않기.

- [ ] **1. 실패 테스트:** 서버 commit 후 ack 유실; 응답 재정렬; head 대기 중 입력 revision 증가; lease 만료 후 stale owner ack; entity A conflict 중 entity B 진행; dependency 실패/복구.
- [ ] **2. 실패 테스트:** 401/403/409/413/422/426/HTML/timeout/5xx 처리와 2/5/15/30/60초 backoff. cursor는 canonical fetch 로컬 commit 전에 전진하지 않음.
- [ ] **3. 실패 확인:** 순수 엔진 테스트와 두 탭 임시 browser QA에서 각각 실패 확인.
- [ ] **4. 구현:** spec §8–9. 완성되지 않은 페이지/정리/AI kind는 capabilities에서 제외해 조용히 접수하지 않음.
- [ ] **5. 검증:** 단위·두 탭 QA PASS. pending 중 reload/앱 종료 이후 같은 operationId/bytes가 재생됨을 evidence로 저장.

### Task 5: 첨부 staging과 메모·할 일 화면 연결

**Files**

- Create: `server/sync/uploads.mjs`, `test/sync-uploads.test.mjs`, `src/sync/SyncStatus.tsx`, `src/sync/sync.css`, `scripts/qa-offline-capture.mjs`
- Modify: `src/main.tsx`, `src/memos/CaptureCollection.tsx`, `src/tasks/TaskWorkspace.tsx`, `server/sync/routes.mjs`

**Interfaces**

- `stageUpload(store,{uploadId,operationId,metadata,stream})`
- `<SyncStatus />` observes engine/repository; no second polling engine.
- 기존 capture/task CRUD는 local repository → engine 경로를 사용. 숨겨진 online-only save가 중복 호출되지 않게 한다.

- [ ] **1. 실패 테스트:** 25MiB 초과/전체100MiB 초과/9개파일/해시 불일치/같은ID 다른파일 차단. 업로드 완료 후 메모실패에서 private orphan만 남고 공개되지 않음.
- [ ] **2. 실패 QA:** offline 입력+사진→명시 저장→앱 재실행→reconnect→서버 한 건. 서버 ack 전에 로컬 파일 지우지 않음. Task 생성·완료·충돌도 실행.
- [ ] **3. 실패 확인:** `node --test test/sync-uploads.test.mjs`, `node scripts/qa-offline-capture.mjs`.
- [ ] **4. 구현:** 단계적 upload ack + canonical entity 연결. 로컬 저장 실패 시 입력창 미초기화. status 한국어/44px/키보드·다크 테마 규칙 적용.
- [ ] **5. 검증:** 새 QA PASS, `scripts/qa-task-board.mjs` PASS. 원격 conflict와 캐시 목록의 row count/정리 상태가 일치하는지 확인.

### Task 6: 실제 오프라인 부팅과 Stage A gate

**Files**

- Create: `scripts/build-offline-manifest.mjs`, `src/offline/update.ts`, `scripts/qa-pwa-shell.mjs`
- Modify: `public/capture-worker.js`, `src/capture/registration.ts`, `src/main.tsx`, `package.json`, Vite build hook(필요시)

**Interfaces**

- build output `dist/offline-manifest.json`: `{appVersion,assets:[{url,hash}],editorAssets:[{url,hash}]}`. allowlist만 캐시.
- `prepareOfflineShell(): Promise<{ready:boolean,appVersion:string}>`

- [ ] **1. 실패 QA:** production build로 한 번 online 준비→네트워크완전차단→새 browser page/앱 route navigation. `/api`/외부 요청/공유 링크에는 index fallback 안 됨.
- [ ] **2. 실패 QA:** service worker install 도중 자산404, 이전캐시유지, IndexedDB 초안유지, 기존 share-target 수신·검토흐름 보존.
- [ ] **3. 구현:** spec §11. 개발 Vite HMR 캐시를 production 오프라인 동작으로 착각하지 않는다. 기존 SW를 확장하고 unconditional takeover 제거. 최초 성공한 workspace 연결 뒤 앱 진입에서 등록하며 설치 도움말을 열어야만 등록되는 구조로 두지 않는다.
- [ ] **4. 검증:** build + pwa-shell QA + offline-capture QA + `npm test`. 기능 플래그가 있다면 기본 동작/업그레이드 경로도 검증.
- [ ] **5. Stage A 기록:** A01–A08 통과 결과·PC/모바일 자동화 범위를 기록하고 이후 B로 계속 진행. 실기기 미검증을 명시하며 전체 완료라고 하지 않는다.

---

## Stage B — 보관 페이지와 오프라인 편집

### Task 7: 페이지·지도·첨부 보관 패키지

**Files**

- Create: `src/offline/pageCache.ts`, `src/offline/OfflinePageControl.tsx`, `src/offline/storage.ts`, `scripts/qa-offline-pages.mjs`
- Modify: `src/pages/PageWorkspace.tsx`, `src/pages/PageToolsPanel.tsx`, `src/settings/WorkspaceSettings.tsx`

**Interfaces**

- `pinPage({pageId,assetSelection}): Promise<PinResult>`
- `unpinPage(pageId): Promise<void>`
- `getOfflineAvailability(pageId): 'ready'|'partial'|'missing'|'updating'`

- [ ] **1. 설정 연결 확인:** `src/settings/WorkspaceSettings.tsx`에 기기 저장소 진입점을 연결할 위치를 확인하고 PROGRESS에 기록. main 전체를 재작성하지 않는다.
- [ ] **2. 실패 QA:** 3개 자산 중 하나 실패하면 partial; 지도/본문은 이전 성공본 유지; 중복 자산은 하나 저장; pending Blob은 unpin으로 삭제되지 않음.
- [ ] **3. 실패 QA:** cached page와 uncached page를 offline에서 각각 열어 정확한 상태 표시; 하위/참조 페이지를 자동 재귀 다운로드하지 않음.
- [ ] **4. 구현:** spec §11. 초기 200MiB 다운로드 예산, estimate/persist 결과, 실행 chunk 준비까지 ready 조건에 포함.
- [ ] **5. 검증:** offline-pages QA와 기존 static itinerary/share export QA 중 자산 표시 관련 시나리오 PASS. 실제 외부 지도 생성 호출 금지.

### Task 8: 페이지 로컬 편집·새 페이지·충돌 처리

**Files**

- Create: `src/pages/useLocalPage.ts`, `src/sync/ConflictPanel.tsx`, `test/sync-pages.test.mjs`, `scripts/qa-offline-page-edit.mjs`
- Modify: `src/pages/PageEditor.tsx`, `PageWorkspace.tsx`, `server/sync/operations.mjs`

**Interfaces**

- `useLocalPage(pageId)` returns local record/save status/pending remote change, repository만 호출.
- `resolveConflict({id,choice:'server'|'local'|'fork',expectedRemoteVersion})`
- server capabilities에 page.create/page.update 추가; 기존 PageDocument validation/참조색인/이력 재사용.

- [ ] **1. 실패 단위 테스트:** page.create 문서·UUID·parent validation. v1 replay/expectedVersion/삭제충돌. custom props/entry ids/block ids roundtrip 동일.
- [ ] **2. 실패 QA:** 두 context 같은 base 문서 수정→충돌양쪽유지; 응답대기 중 입력→최신revision보존; 삭제vs수정→자동부활없음; 서버내용사용전 로컬사본보존.
- [ ] **3. 실패 QA:** offline 새 부모·자식 페이지 후 reconnect dependency순서, 부모실패 시 자식만대기. 서로 다른계정/epoch 문서 혼합없음.
- [ ] **4. 구현:** online PUT autosave와 새 저장 engine이 동시에 실행되지 않게 전환. cursor/selection/undo를 유지하고 remote update는 dirty에 강제 replace하지 않는다.
- [ ] **5. 검증:** sync-pages/offline-page-edit PASS. `scripts/qa-itinerary-inline.mjs` 및 `scripts/qa-page-ai.mjs`의 임시 DB 회귀. 충돌본 내보내기/새페이지분기에서 댓글토큰복제없음.

### Task 9: 편집 일관성·오프라인 검색·Stage B gate

**Files**

- Create: `src/offline/search.ts`, `scripts/qa-offline-workspace.mjs`
- Modify: `src/search/SearchPalette.tsx`, 페이지/일정 컨트롤의 온라인 전용 가드, 관련 CSS

**Interfaces**

- `searchLocalWorkspace({query,kinds,limit:50})` — 보관한 자료 범위만, 원격 total을 꾸미지 않음.
- 온라인 전용 controller들은 `canPerformOnlineAction`과 대상 pending 상태를 공통으로 확인.

- [ ] **1. 실패 QA:** offline search의 범위label/결과/없는자료안내, pending신규페이지검색, 한글/URL/긴제목.
- [ ] **2. 실패 QA:** `/`, Markdown paste, 표, Mermaid, 목차, IME/Tab, 긴 일정, 실행취소, selectionclear를 390/320px offline에서 확인. 지원안되는공유/지도생성/관리작업은 클릭전 이유표시.
- [ ] **3. 구현:** 기존 문서 디자인을 유지하며 비동기 상태의 포커스/스크롤 이동만 최소 수정. 새 자체 에디터 구현 금지.
- [ ] **4. 검증:** offline-workspace + offline-page-edit + build + `npm test`. B01–B06 evidence 기록.

---

## Stage C — 정리·AI·운영 안정성

### Task 10: 정리·AI 제출의 의존성 있는 대기 작업

**Files**

- Modify: `server/sync/operations.mjs`, `server/pageConnections.mjs`, `server/pageAi.mjs`, `src/memos/CapturePageImport.tsx`, `src/ai/pageSubmission.ts`, `src/drafts/captureSubmission.ts`
- Create: `test/sync-workflows.test.mjs`, `scripts/qa-offline-workflows.mjs`

**Interfaces**

- `capture.organize`, `ai.submit` — spec §12, 기존 UUID/입력사본/트랜잭션 재사용.
- local `queued_on_device`는 서버 AiStatus에 혼입하지 않고 SyncStatus로 표시.

- [ ] **1. 실패 테스트:** 새 원본 저장→정리/AI dependency, 원본 버전 변경→재확인, 정리 성공 직후 응답 유실→본문/원본 중복 없음.
- [ ] **2. 실패 테스트:** AI 같은 UUID 재전송 5회→job 1개; template 사본 불변; 취소 시점 ambiguity에는 서버 receipt 먼저 확인. 모의 runner만 사용.
- [ ] **3. 구현:** pending 대상 페이지 강제 편집 잠금/서버 overwrite가 생기지 않게 spec 조건 적용. 정리 대기 UI에서 원본을 숨기지 않음.
- [ ] **4. 검증:** 새 테스트/QA + 기존 `scripts/qa-page-connections.mjs`, `scripts/qa-ai-activity.mjs`의 영향 시나리오 PASS.

### Task 11: 서버 복원·앱 업데이트·데이터 구조 복구

**Files**

- Modify: `server/backups.mjs`, `scripts/backup-data.mjs`, `src/offline/update.ts`, `src/sync/engine.ts`
- Create: `src/offline/exportPending.ts`, `test/sync-recovery.test.mjs`, `scripts/qa-offline-recovery.mjs`

**Interfaces**

- `exportPendingWorkspace(workspaceId)` → JSON manifest + 필요한 Blob이 있는 ZIP/동등한 무손실 묶음. 기존 page export가 private pending을 포함한다고 오인하지 않기.
- `rotateSyncEpochAfterRestore(db)` — 명시 복원 활성화 경계에서만; 정상 서버 재시작에서는 금지.

- [ ] **1. 실패 QA:** 앱 cache v1→v2 설치 실패/성공·편집 중 새로고침; IDB upgrade가 다른 탭에 blocked된 상태·reload 후 복구; local pending 초기화 거부.
- [ ] **2. 실패 테스트:** 백업 복원 epoch 변경→오래된 큐 전송 중지·snapshot 보존, 재확인 후 새 operation; cursor>head도 보수적으로 중지.
- [ ] **3. 실패 QA:** 다른 workspace 전환, 저장소 부족, pending export의 텍스트/파일 hash 일치, quota 정리에서 unsynced 삭제 없음.
- [ ] **4. 구현:** 로그에 비밀키/본문 전체 없음. backup 형식 변경 시 기존 verify/restore 호환 및 문서 갱신.
- [ ] **5. 검증:** recovery 테스트/QA + `test/backups.test.mjs test/automatic-backups.test.mjs` PASS.

### Task 12: 최종 통합·성능·실기기 인계

**Files**

- Update: `CURRENT_IMPLEMENTATION.md`, `README.md`, `AGENTS.md`, `DESIGN.md`, `docs/DEPLOYMENT.md`
- Create: `.omo/evidence/offline-workspace/REPORT.md`, `docs/OFFLINE_USAGE.md`

- [ ] **1. 자동 게이트:** `npm run build`, `npm test`, Stage A/B/C 새 QA 전체를 임시 DB에서 실행. 기존 `scripts/qa-workspace-ui.mjs` 통과. 실패를 환경 문제로 제외하려면 재현 증거·사용 영향 기록.
- [ ] **2. 성능 확인:** 임시 10,000 메모/1,000 page metadata/100 cached pages, 반복 10회 입력→로컬 commit p50/p95/최대 측정. 250ms debounce 포함/제외를 구분. 목록 DOM 500행 일괄 mount 금지, 로컬 조회는 50개 페이지 단위. CI 머신 결과를 N100 성능으로 표현하지 않음.
- [ ] **3. 시각 확인:** 1440/390/320 라이트·다크, pending/conflict/quota/uncached 화면을 batch 검사. 발견한 결함을 한 batch 수정 후 확인. 기존 디자인을 기회 삼아 재설계하지 않음.
- [ ] **4. 실기기 표:** iOS Safari 설치PWA/Android Chrome 설치PWA 각 설치·종료 재실행·잠금·비행기 모드·사진 첨부·네트워크 전환·공유 수신을 측정. 기기가 없으면 미실시와 수동 절차를 명확히 기록.
- [ ] **5. 원격 체크:** Tailscale 본인 제한/HTTPS/비인가 접근 거부/서버 재시작/backup 복원은 실제 서버에서 별도 확인. 자격 증명/서버가 없으면 배포하지 않고 정확한 남은 단계를 문서화.
- [ ] **6. 완료 보고:** 단계별 완료/실기기 미검증/원격 미검증을 구분. 새 의존성·migration·rollback·사용자 데이터 변경 여부·정확한 테스트 근거 제시. 자동 병합 구현 완료라는 표현 금지.

## 최종 자기 검토 체크

- [ ] 설계 §1–17 모두 Task 또는 명시 후속 범위에 대응한다.
- [ ] 새 함수/파일 이름은 이 계획에서 일관되며 현재 실제 경로와 대조했다.
- [ ] 모든 쓰기 경로의 invalidation trigger를 점검했고 새 endpoint만 로그를 남기는 오류가 없다.
- [ ] 이전 autosave와 새 engine의 이중 쓰기가 없다.
- [ ] `current local`, `base server`, `remote incoming`, `in-flight snapshot`을 혼동하지 않는다.
- [ ] 한 단계가 통과하기 전 다음 단계 완료 체크를 하지 않는다.
