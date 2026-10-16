# leneu 개인 작업 공간: 오프라인·온라인 동기화 설계지시서

작성: 2026-10-03 · 대상 실행 모델: **GPT-6.1-Sol / xhigh**
상태: **구현 전 설계**. 이 문서는 현재 동작을 설명하는 문서가 아니다.
실행 계획: [단계별 구현](../plans/2026-10-03-offline-workspace.md)
인계 진입점: [실행 지시문](../../handoffs/2026-10-03-offline-workspace.md)

## 1. 목표와 사용 장면

서버 한 대를 기준으로 PC 웹과 모바일 PWA를 오가며 사용하는 개인 작업 공간이다. 메모는 제목·분류 없이 급하게 담는 원본, 페이지는 초안부터 계속 작성하는 문서, 할 일은 실행할 행동이다. AI는 원본에 대한 명시적 요청이다.

성공 장면:

1. 최초 온라인 준비가 끝난 모바일에서 비행기 모드로 앱을 다시 열고 메모·사진을 저장한다.
2. 앱을 닫았다 다시 열어도 기기에 저장한 내용과 전송 대기 상태가 유지된다.
3. 서버에 다시 연결되면 한 번만 반영되고 PC에서 확인된다.
4. 미리 보관한 여행 페이지·지도 이미지·선택 첨부를 오프라인으로 읽고 문서를 수정한다.
5. PC와 모바일의 변경이 겹치면 둘 다 보존하고 선택할 수 있다. 최신 시각 기준으로 조용히 덮어쓰지 않는다.
6. 페이지로 정리한 메모는 중복 생성 없이 기존 수명 주기대로 정리 완료가 된다.

현재 색감·44px PC 도구막대·페이지 블록·댓글·공유 계약을 보존한다. 대규모 화면 재디자인을 이 작업에 섞지 않는다.

## 2. 현재 구현에서 확인한 사실

| 근거 파일                                            | 현재 동작                                                | 필요한 변화                                            |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `public/capture.webmanifest`                         | 설치 진입 `/capture`, share_target 선언                  | 앱 전체 오프라인 실행 준비·설치 정체성 보존            |
| `public/capture-worker.js`                           | `/capture/share` POST만 처리, 나머지 fetch 미캐시        | 정적 앱 실행 자산의 버전별 캐시와 오프라인 내비게이션  |
| `src/capture/registration.ts`                        | HTTPS 여부 확인, root scope worker 등록                  | 기존 worker를 확장. root scope worker를 둘 만들지 않기 |
| `src/drafts/`                                        | 텍스트 localStorage 초안, 첨부 IndexedDB                 | 영속 로컬 엔티티·outbox·상태 저장과 기존 초안 이관     |
| `src/pages/PageEditor.tsx`                           | localStorage 초안 + 750ms debounce PUT + expectedVersion | 기기 저장과 서버 동기화 분리, 로컬 문서로 부팅         |
| `server/store.mjs`, `server/tasks.mjs`               | UUID·버전·SQLite, 일부 제출 중복 방지                    | 전 엔티티 변경 피드·영수증·동기화 작업 경계            |
| `server/pageConnections.mjs`, `server/pageTools.mjs` | 원자적 정리/도구 작업과 기존 제출 UUID                   | 온라인 작업과 오프라인 대기 작업을 같은 의미로 처리    |
| `server/public.mjs`, `server/shares.mjs`             | 별도 공유 프로세스·토큰·첨부 범위 제한                   | 개인 캐시/동기화 API를 공개 프로세스에 추가하지 않기   |

현재 개인 API에는 계정 인증이 없다. 기존 loopback 제한을 유지한다. 로컬 개발 완료를 인터넷 배포 완료로 보고하지 않는다.

## 3. 확정한 기술 선택

### 3.1 v1: 안전한 단일 사용자 다기기 동기화

- 서버: 기존 Node 24 + SQLite + 파일 저장. 별도 Redis/Postgres/클라우드 동기화 서비스는 도입하지 않는다.
- 클라이언트: IndexedDB가 로컬 콘텐츠와 전송 대기의 저장소. Cache Storage는 정적 앱 실행 자산만 담당한다.
- 모든 편집은 먼저 로컬 트랜잭션으로 저장한다. 서버 반영 여부는 별도 상태다.
- 서버 쓰기는 고유 operationId·고정 payload·expectedVersion으로 재전송해도 한 번만 적용한다.
- 페이지는 현재 **블록 JSON schemaVersion 1**을 그대로 보존한다. v1은 문서 단위 충돌을 감지하고 양쪽을 보존한다. 문서/블록/문자 단위 자동 병합을 하지 않는다.
- 서버의 블록 JSON이 검색·공유·Markdown·수정 이력의 기준이다. Markdown은 내보내기 형식이며 동기화 원본으로 바꾸지 않는다.
- 최초 온라인 연결/자료 다운로드 없이 한 번도 방문하지 않은 앱이나 페이지를 오프라인으로 열 수 있다고 약속하지 않는다.

### 3.2 Yjs는 후속 선택이며 v1 필수 의존성이 아니다

앞선 제안의 Yjs는 검토 후보였다. 현재 일정 props에 JSON 문자열이 있고, AI 적용·이력 복원·페이지 정리·댓글 blockId가 동일 문서를 수정한다. 라이브러리만 연결해 무손실 병합을 보장할 수 없다.

v1에서는 **안전한 충돌 처리까지 완성**한다. Yjs를 원하는 경우 §16의 독립 실험·승인 후 별도 계획으로 진행한다. 실행 모델이 자동 병합 범위를 임의로 추가하거나 v1 완료 조건에 끼워 넣지 않는다.

### 3.3 파일/용량 기준

기존 계약: 파일 하나 25 MiB, 한 제출 전체 100 MiB, 파일 최대 8개; 문서 직렬화 최대 1 MiB. 서버 검증 코드를 재사용하며 한도를 우회하지 않는다. JSON 작업 요청은 최대 1100 KiB, 파일은 별도 staged upload로 전송한다.

오프라인 보관의 기본 다운로드 예산은 200 MiB이며 절대 보장 용량이 아니다. `navigator.storage.estimate()`가 제공되면 사용 가능 용량도 확인한다. 공간이 부족하면 완료라고 표시하지 않고 사용자가 보관 대상을 조절한다. 미전송 내용·충돌 사본은 앱의 자동 정리 대상이 아니다.

## 4. 범위와 단계

| 단계 | 완성할 사용자 기능                                                        | 이 단계에서 온라인 전용                                   |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| A    | 오프라인 앱 부팅, 메모 생성/편집/첨부, 할 일 생성/편집, 재연결, 상태 패널 | 페이지 수정, AI 제출, 정리/공유/댓글/지도 생성            |
| B    | 선택 페이지와 첨부 보관, 새 페이지·본문 편집, 충돌 선택, 모바일 문서 편집 | 공유 발급·댓글 쓰기·지도 생성·복잡한 구조/관리 작업       |
| C    | 메모→페이지 정리 대기, AI 요청 대기, 복구·업데이트·운영 검증              | AI 실행 자체, 외부 지도 생성, 공유 발급/폐기, 방문자 댓글 |

개인 페이지의 이동·복제·이력 복원·휴지통·복원·즐겨찾기 변경은 v1 온라인 전용이다. 일반 메모 휴지통도 온라인 전용이다. 버튼을 누르기 전 이유를 표시하고 로컬 편집 중인 대상에는 서버 변경을 강행하지 않는다. 서버에서 일어난 이런 변경은 pull로 반영한다.

설치 PWA와 일반 브라우저의 로컬 저장소가 공유된다고 가정하지 않는다. 각각 독립 기기로 bootstrap·동기화하며 동일 서버를 통해 합친다.

오프라인 검색은 다운로드한 메모·Task·페이지에만 적용하고 `이 기기에 보관한 항목`이라고 범위를 표시한다. 온라인 통합검색은 기존 서버 FTS를 유지한다. 전체 문서를 내려받거나 오프라인 FTS 엔진을 추가하지 않는다.

## 5. 구현 모듈과 책임

신규 경로는 제안된 소유 경계이며 기존 파일을 확인한 뒤 최소 추출한다. 기존 거대 컴포넌트 전체를 재작성하지 않는다.

| 경로                                  | 책임                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `shared/sync.ts`                      | protocolVersion, 작업/결과/오류/엔티티 타입                            |
| `server/sync/store.mjs`               | sync_meta, changes, receipts, staged upload 메타데이터                 |
| `server/sync/operations.mjs`          | 검증→영수증→기존 도메인 연산→변경 기록의 원자적 실행                   |
| `server/sync/routes.mjs`              | 개인 API만 제공하는 session/bootstrap/changes/operations/upload 라우트 |
| `src/sync/db.ts`                      | IndexedDB schema/upgrade/트랜잭션·기존 초안 이관                       |
| `src/sync/repository.ts`              | 콘텐츠 로컬 저장·dirty 상태·읽기·알림                                  |
| `src/sync/engine.ts`                  | 단일 활성 실행, push/pull, 재시도, 수명 주기                           |
| `src/sync/transport.ts`               | JSON/파일 HTTP, 상태별 오류 해석, timeout                              |
| `src/sync/conflicts.ts`               | 서버/로컬/기준 사본 보존과 명시 해결                                   |
| `src/sync/SyncStatus.tsx`, `sync.css` | 간결한 전역 상태·항목별 대기/오류/충돌 패널                            |
| `src/offline/`                        | 페이지 보관 manifest, 자산 다운로드/상태/용량 관리                     |
| `scripts/build-offline-manifest.mjs`  | 빌드 산출물 기반 버전/정적 자산 목록                                   |
| `public/capture-worker.js`            | 기존 공유 수신 + 앱 실행 캐시; 콘텐츠 동기화 주 실행기는 아님          |

기존 `src/main.tsx`, 메모·Task·페이지 API 호출은 순서대로 repository를 거치도록 연결한다. 온라인 화면과 오프라인 화면을 별도 복제하지 않는다.

## 6. 데이터 모델

### 6.1 서버

- `sync_meta`: protocolVersion=1, workspaceId(UUID), epoch(UUID), 설치 정체성. workspaceId는 DB에 저장하며 도메인/IP로 추론하지 않는다.
- `sync_changes`: 단조 증가 seq(INTEGER PRIMARY KEY AUTOINCREMENT), entityKind, entityId, action(upsert/tombstone), 서버시각. 원문 전체를 로그에 반복 저장하지 않는다.
- `sync_receipts`: (workspaceId, operationId) unique, deviceId, requestHash, 결과 JSON, 생성시각. 성공 효과와 동일 트랜잭션에서 영수증을 기록한다.
- `sync_uploads`: uploadId, operationId, contentHash, size, 원래 파일명/mime, stage/consumed, 최종 storageKey, 생성시각. 기존 asset 소유권 검사를 재사용한다.
- v1에서는 changes/receipts를 시간 기준으로 자동 삭제하지 않는다. 오래 오프라인인 기기에 대한 정확한 재생이 우선이다. 임의 정리 기능을 추가하지 않는다.

기존 엔티티 테이블의 INSERT/UPDATE/DELETE와 soft-delete/복원 변경에 DB trigger를 연결해 **기존 API와 새 API의 모든 쓰기 경로**를 기록한다. AI 상태/자산 변경은 해당 소유 메모/페이지 무효화 이벤트를 기록한다. search trigger와 공존시킨다. 관련 테이블 목록을 구현 시 증거로 남기고 도구·복원·AI 반영·정리 경로를 누락하지 않는다.

### 6.2 IndexedDB `leneu-offline-v1`

모든 콘텐츠 key는 `(workspaceId, entityKind, entityId)` 또는 workspaceId를 포함하는 동등 복합키다.

- `entities`: 서버 기준 사본/baseVersion, 현재 로컬 사본, localRevision, dirty, 서버 변경 여부, 마지막 로컬 저장시각, 마지막으로 적용한 원격 readSeq.
- `outbox`: operationId(UUID), deviceId, epoch, kind, entityId, payload, hash, baseVersion, localRevision, dependencies[], state, attempt, nextAttemptAt. 전송하려는 사본은 생성 후 불변.
- `blobs`: localBlobId, Blob, hash, 파일 메타데이터, uploadId, 참조. IndexedDB에 바이트까지 커밋된 뒤 저장 완료 처리.
- `conflicts`: operationId, 기준 사본, 로컬 사본, 서버 사본 또는 tombstone, 해결 상태.
- `pins`: 보관한 pageId, 서버 버전, 참조 자산/해시, 필요한 정적 실행 자산 버전, 완료/부분/갱신 중.
- `meta`: deviceId, workspaceId, epoch, pull cursor, schemaVersion, appVersion, 마지막 동기화시각.
- `leases`: 동일 origin 탭/worker 사이 실행 소유권·만료시각·fencing counter.

localStorage는 theme 등 가벼운 설정만 남긴다. 최초 workspace 바인딩 전에 남아 있는 초안은 사용자가 접속한 서버를 확인한 후 그 partition에 이관한다. 기존 초안은 IndexedDB 쓰기·재읽기 성공 후에만 제거한다. 이관 실패 시 원본 키를 유지하고 복구 UI를 제공한다. 새 데이터가 기존 초안을 덮지 않게 한다.

## 7. API 계약

모든 `/api/sync/*`는 private server에만 존재한다. public server는 404다. 응답은 `Cache-Control: no-store`이고 service worker가 캐시하지 않는다.

### 7.1 읽기

- `GET /api/sync/session` → `{protocolVersion:1, workspaceId, epoch, headSeq, capabilities, serverTime}`. capabilities는 단계별 가능한 작업 이름 배열이다.
- `GET /api/sync/bootstrap?kind=capture|task|page&afterId=<uuid>&limit=100` → `{items,nextAfterId}`. UUID keyset 순서. page는 본문 없는 메타데이터만 기본 제공.
- `GET /api/sync/changes?after=<seq>&limit=100` → `{epoch,headSeq,nextAfter,changes:[{seq,entityKind,entityId,action}]}`. 정렬 seq ASC, 최대 limit100. 한 응답 조회는 같은 SQLite read transaction이다.
- `GET /api/sync/entities/:kind/:id` → 현재 canonical record와 version 및 같은 read transaction에서 얻은 `readSeq`, 또는 `readSeq`가 포함된 명시 tombstone. 알 수 없는 ID와 휴지통은 구분하되 private 권한 범위 내에서만 반환.

첫 bootstrap 직전 headSeq를 c0로 저장하고 keyset 목록을 끝까지 읽은 뒤 c0 이후 변경을 pull한다. 목록 중 변경·삭제가 생겨도 feed에서 보완된다. 목록을 모두 읽기 전 기존 캐시를 삭제하지 않는다.

변경 피드는 무효화 알림이다. 이후 entity fetch는 더 최신 버전을 반환할 수 있다. 같은 epoch에서 더 낮은 readSeq 응답은 무시하고 낮은 version으로 되돌리지 않는다. 같은 version이어도 자산/AI 상태가 달라질 수 있으므로 readSeq가 새로우면 메타데이터를 갱신한다. 늦은 upsert 응답이 더 최신 tombstone을 되돌리지 못하게 한다. dirty 항목에는 서버 응답을 현재 로컬 문서 위에 덮지 않고 기준/원격 사본으로 별도 저장한다. page body는 pinned/open/pending 대상만 내려받는다.

cursor는 해당 batch의 canonical fetch 결과·tombstone·충돌 사본을 로컬에 보존한 후에만 전진한다. 중간 실패는 같은 batch를 재처리한다. 명시 tombstone 없이 네트워크 오류/HTML 응답/401/404를 삭제로 간주하지 않는다.

### 7.2 쓰기

`POST /api/sync/operations`는 한 번에 **작업 하나**를 받는다.

```ts
// shared/sync.ts: payload는 아래 kind별 discriminated union으로 작성한다.
type SyncOperation = {
  protocolVersion: 1;
  workspaceId: string;
  epoch: string;
  operationId: string;
  deviceId: string;
  kind:
    | 'capture.create'
    | 'capture.update'
    | 'task.create'
    | 'task.update'
    | 'page.create'
    | 'page.update'
    | 'capture.organize'
    | 'ai.submit';
  entityId: string; // 클라이언트가 생성한 안정적 UUID
  baseVersion: number | null;
  payload: unknown; // 구현 타입에서는 kind별 기존 validator 입력으로 대체
};
```

- create는 baseVersion=null, update는 정수 버전 필수. 서버에서 UUID·소유권·부모·파일·본문·현재 상태를 검증한다.
- 기존 create 함수는 **sync 내부용 선택 id 인자**를 받을 수 있게 확장한다. 기존 호출은 여전히 서버 UUID 생성. sync UUID 충돌은 기존 대상을 덮지 않고 conflict다.
- kind별 payload: capture.create=`{kind,text,url,uploadIds,aiRequest:null}`; capture.update=`{text,url}`; task.create=`{title,dueDate}`; task.update=`{title,dueDate,stage}`; page.create=`{title,icon,parentId,document}`; page.update=`{title,icon,document}`. 정리와 AI는 §12에서 정의한다. 모든 값은 기존 validator/한도를 사용한다. create payload에는 선택적 `clientCreatedAt`(ISO8601)을 허용하고 별도 nullable 서버 컬럼으로 최초 한 번 보존한다. createdAt/updatedAt은 서버가 부여한다. 목록 작성 시각은 clientCreatedAt이 있으면 이를 사용하되 동기화 순서/충돌/NEW의 기준 서버 규칙은 클라이언트 시각에 의존하지 않는다. 기기 시계 이상이 있으면 서버 접수 시각도 상세에서 확인할 수 있게 한다.
- operationId 재전송: canonical payload hash가 같으면 기존 결과를 반환, 다르면 409 `operation_payload_mismatch`. hash는 순서 안정적인 JSON과 파일의 검증된 해시로 계산한다.
- 성공: `{status:'applied', operationId, replayed, item, version}`. 정리/AI는 기존 작업 결과도 포함. 서버 적용 후 응답이 유실돼도 같은 ID로 조회/재전송해 결과를 회수한다.
- 충돌: HTTP409 `{code:'version_conflict'|'entity_deleted'|'entity_exists', current}`. 기기 데이터는 그대로 둔다.
- 잘못된 데이터: 422(validation); 전송 한도:413; 인증:401/403; 프로토콜 불일치:426; epoch mismatch:409 별도 code. 이 오류를 무한 자동 재시도하지 않는다.
- 요청 성공 효과·수정 이력·참조색인·영수증·변경 기록은 같은 SQLite 트랜잭션으로 커밋한다. 기존 함수의 BEGIN을 중첩하지 않도록 savepoint/transaction-aware helper로 최소 추출한다. 외부 AI 호출/파일 네트워크 전송을 DB 트랜잭션 안에서 수행하지 않는다.

### 7.3 첨부 업로드

`PUT /api/sync/uploads/:uploadId`는 raw bytes를 받는다. 메타데이터는 `X-Leneu-Operation-Id`(UUID), `X-Leneu-Content-SHA256`(64자리 hex), `X-Leneu-File-Name`(UTF-8 percent-encoded), `Content-Type` 헤더로 전달한다. 파일명은 디코딩 후 기존 validator로 정제하고 storage 경로는 서버가 생성한다. 작업별 파일 개수/전체 크기는 stage와 최종 적용 모두에서 검사한다. uploadId/operationId/hash는 재시도에서 고정한다. 실제 크기/hash는 서버가 계산한다. 같은 ID 다른 바이트는409. content-type 문자열을 신뢰해 실행 가능한 파일로 제공하지 않는다.

파일을 임시 경로에 완전히 쓰고 최종 경로에 원자적으로 이동한 후 staged로 기록한다. 해당 작업 적용 때 기존 asset record에 연결하고 consumed 처리한다. 파일 준비 전에 메모를 서버 저장 완료로 표시하지 않는다.

한 번에 업로드1개, 작업1개. 파일 하나를 다시 전송하는 v1이며 chunk resume는 범위 밖이다. 서버 미사용 stage는 7일 뒤 청소할 수 있다. 만료 응답이면 **같은 바이트/해시/ID**로 stage 재생성 후 같은 작업을 재시도한다. 아직 ambiguous receipt가 있으면 먼저 작업 재전송 결과를 확인한다. 서버는 receipt 재생을 stage 유효성 검사보다 먼저 수행한다. ack 전 로컬 Blob 삭제 금지.

## 8. 로컬 쓰기·outbox 알고리즘

1. 사용자 입력마다 메모리에 즉시 반영한다. 텍스트 편집의 IndexedDB 저장은 250ms debounce, blur/페이지 숨김에서 가능한 즉시 flush. 이것만으로 종료 직전 저장을 보장한다고 표현하지 않는다.
2. 명시 저장 버튼은 debounce를 우회하고 **본문 + Blob 참조/바이트 + 로컬 변경 상태** 트랜잭션 완료를 기다린다. 완료 전 성공 UI/입력 비우기 금지.
3. 페이지는 로컬 dirty 사본을 저장하고 750ms 편집 안정 시 전송 사본을 만든다. 해당 entity의 head operation이 있으면 그 payload를 수정하지 않는다. 새 편집은 더 높은 localRevision으로 별도 current 사본에 보존한다.
4. 한 entity에 전송 head는 하나. head ack가 오면 ack의 localRevision보다 새로운 로컬 편집이 없는 경우에만 dirty를 해제한다. 최신 편집이 있으면 ack 버전을 기준으로 새 작업 ID의 후속 사본을 만든다.
5. 충돌이면 head와 최신 local 사본 모두 보존하고 해당 entity와 의존 작업을 중지한다. 다른 entity의 작업은 계속한다.
6. 새 페이지/메모/할 일 ID는 기기에서 UUID 생성. 부모/정리 대상/원본 생성 ack에 dependencies로 연결한다. 미해결 부모 실패는 자식만 대기하며 자동 root 이동 금지.
7. 동일 탭 재실행/다중 탭: IndexedDB lease를 원자적으로 획득(30초 만료, 활성 10초 갱신). lease 획득마다 fencing counter 증가. 오래된 소유자는 매 로컬 상태 커밋 때 counter를 검사한다. 중복 네트워크 요청이 있어도 서버 receipt가 마지막 방어다. BroadcastChannel은 갱신 알림 최적화일 뿐 정확성 전제가 아니다.

## 9. 연결·재시도·복원

- 앱 시작, visible 복귀, online 이벤트, 수동 재시도, 새 로컬 작업에서 drain 시작. `navigator.onLine`은 힌트이며 session/실제 API 성공이 서버 연결 근거다.
- 활성 visible 상태에서는 30초 간격으로 changes 확인. 작업이 생기면 즉시 전송. hidden에서는 새 주기 polling을 만들지 않는다. Background Sync는 선택 최적화로만 추후 연결한다.
- 네트워크/timeout/5xx: 2·5·15·30·60초 상한 backoff에 ±20% jitter, Retry-After는 존중하되 5분 상한. 새 foreground/수동 재시도는 즉시 한 번 가능. 반복 재시도에 새 operationId를 만들지 않는다.
- JSON 요청 timeout15초, 파일60초. timeout은 실패 확정이 아닌 ack 미확인이다. 같은 ID로 확인한다.
- 인증 만료는 전송을 멈추고 로그인/접근 확인 필요 표시. 로컬 내용을 지우거나 다른 계정에 재전송하지 않는다.
- workspaceId가 달라지면 별도 partition. epoch가 달라지거나 cursor가 head보다 크면 원격 복원/교체로 판단해 전송 중지·로컬 사본 유지·재bootstrap과 사용자 확인 후 새 작업으로 재제출한다. 옛 큐를 새 서버에 자동 재생하지 않는다.
- 기능 rollback은 UI 기능을 숨기더라도 미전송 local store/receipt/서버 additive schema를 지우지 않는다. 이전 앱 버전이 새 pending을 처리할 수 없으면 읽기·내보내기·업데이트 안내만 허용하고 기존 REST autosave로 우회하지 않는다.
- 서버 백업 복원/교체 절차에서 epoch를 새로 발급한다. 같은 DB를 정상 재시작하는 것은 epoch 변경 사유가 아니다.

## 10. 페이지 충돌·기존 기능 보존

UI: `다른 기기에서 수정했어요` → `서버 내용 보기`, `내 변경 보기`, `서버 내용 사용`, `내 변경으로 반영`, `새 페이지로 보관`.

- 서버 내용 사용: 버린 로컬 사본을 conflicts 보관 기록에 남긴 뒤 current 교체. 선택 전까지 원문을 보존한다.
- 내 변경으로 반영: 표시된 current.version으로 새 작업 생성. 다시 변경되면 재충돌; 강제 덮어쓰기 endpoint 금지.
- 새 페이지로 보관: UUID와 필요한 블록/참조를 기존 페이지 복제 규칙대로 생성한다. 다른 페이지의 댓글/공유 토큰은 복제하지 않는다.
- 서버 휴지통 vs 로컬 수정: 자동 부활 금지. 내 변경을 새 페이지로 보관하거나 명시 로컬 변경 버리기. 복원은 기존 온라인 휴지통 도구 사용.
- dirty 문서를 편집 중일 때 background pull/AI 결과/이력 복원이 editor.replaceBlocks로 커서를 옮기거나 초안을 지우면 안 된다.
- `/`, Markdown 붙여넣기, 표·Mermaid·목차, 일정 inline 편집, 선택 해제, Tab/IME, 실행 취소, 댓글 blockId를 회귀 검사한다.
- 일정 version1/entry.id와 custom props를 손실 없이 직렬화한다. 지도 asset·imageSource·imageInput과 AI 당시 문서 사본을 보존한다.
- 서버 최신본을 받은 뒤 정리·AI 적용·복원 등 온라인 작업을 수행하려면 해당 문서의 로컬 pending을 먼저 해결한다. pending이면 UI에서 이유를 표시한다.

## 11. 앱 실행 캐시·오프라인 페이지 보관

- root scope는 기존 capture worker 하나만 사용. scope/manifest id(`/capture`)는 설치 정체성이므로 임의 변경 금지. start_url을 바꾸더라도 기존 설치/공유 수신 회귀 확인.
- Vite 산출물 manifest로 hashed JS/CSS, 폰트, 아이콘, 앱 index의 동일 build 집합을 기록한다. 편집기 지연 chunk도 오프라인 문서 작성 가능 상태 전 필요한 집합을 캐시한다. 홈 시작 시 실행/평가하지 않는다.
- 새 cache version 설치는 필요한 자산 전부 성공해야 ready. 네트워크 HTML 오류를 앱 index로 저장하지 않는다. navigation fallback은 개인 앱 route만, `/api`, `/s`, 공유 origin, 업로드, 외부 URL에는 적용 금지.
- 현재 unconditional skipWaiting/clients.claim을 그대로 사용하지 않는다. 새 버전 ready→안내→로컬 저장 성공 후 사용자가 새로고침. unsent를 지우지 않고 구버전 캐시는 열린 클라이언트와 호환성 확인 전 삭제하지 않는다. 앱 코드 교체 중 IndexedDB downgrade 금지.
- `오프라인 보관` 클릭 시 문서 버전+직접 참조한 자산 목록을 manifest로 저장하고 필요한 Blob을 내려받는다. 관련 다른 페이지 전체를 재귀 공개/다운로드하지 않는다. 하위 페이지는 개별 선택.
- 모든 필수 파일과 실행 자산이 준비되어야 `오프라인 사용 가능`. 실패하면 `일부 자료 미보관`과 항목별 재시도. 문서만 준비되어도 읽기는 허용하되 누락을 표시한다.
- 여행 지도는 기존 정적 이미지. 오프라인에서 외부 지도 SDK/API를 호출하지 않는다. Google 링크는 연결 후 열 수 있다는 안내.
- 보관 취소는 pending/conflict/다른 pin에서 참조하는 Blob을 지우지 않는다. local pending 자료는 quota 정리 대상이 아니다. Blob 참조계수는 트랜잭션으로 갱신한다.
- `navigator.storage.persist()` 요청은 설치/보관 설정에서 명시 맥락을 제공하고 결과를 표시한다. 거절되어도 실패가 아닌 best-effort 상태이며 영구 보존 보장은 하지 않는다.

## 12. 단계 C: 정리와 AI 대기

### 12.1 메모→페이지

`capture.organize` payload는 기존 정리 API의 requestId·선택 원본 버전·대상 페이지/부모·문서 사본·선택 첨부 계약을 감싼다. operationId를 기존 제출 UUID와 동일하게 사용하고 별도 두 요청으로 쪼개지 않는다.

화면에는 `페이지에 정리 대기`로 표시하고 원본을 서버 정리 완료처럼 숨기지 않는다. 로컬 편집 중인 대상 페이지/원본은 먼저 앞선 작업을 ack 받아야 한다. 요청 대상 버전이 바뀌면 자동 append 재작성 대신 충돌로 멈추고 다시 확인한다. 서버 성공에서만 페이지 변경과 원본 정리 완료를 함께 반영한다. 중복 재시도는 동일 페이지/블록/자산/작업 결과를 반환한다.

### 12.2 AI 요청

`ai.submit` payload는 기존 request snapshot, source version, 대상/선택 블록, 기존 submission UUID를 보존한다. operationId와 AI 요청 UUID를 연결해 한 번만 job을 생성한다. local pending source가 ack되기 전 제출하지 않는다. source가 원격에서 바뀌면 원래 요청 사본을 바꾸지 말고 재확인 상태로 둔다.

`기기에서 전송 대기`와 서버의 `대기 중/처리 중/결과 준비`는 다른 상태다. 오프라인 저장 직후 AI가 실행 중이라고 표시하지 않는다. 전송 전 취소만 로컬 큐에서 가능하며 서버 접수 여부가 불명확하면 기존 UUID로 먼저 확인한다. 자동 새 요청·새 유료 호출을 만들지 않는다. 템플릿은 마지막 동기화된 사본만 오프라인 사용; 로드하지 않은 템플릿은 불가.

공유 발급·지도 생성·방문자 댓글 작성은 온라인 전용으로 유지하고 큐에 넣지 않는다. 공개 공유에는 서버에 반영된 내용만 보인다.

## 13. UX 규격

상단 저장 상태는 다음을 구분한다.

- `저장 중…`: 로컬 트랜잭션 미완료
- `기기에 저장됨 · 동기화 대기 N건`
- `동기화 중`
- `동기화 완료`: 이 작업의 서버 ack와 로컬 ack 기록이 완료된 상태
- `변경 확인 필요 N건`
- `저장 공간 부족`: 성공으로 보이면 안 됨

상태 클릭 시 항목별 제목/종류·상태·마지막 성공 시각·재시도·충돌 열기 제공. N은 outbox head와 dirty 후속 문서 수를 중복 없이 센다. 파일 전송 중에는 전체 파일 수/완료 수를 보여주고 모르는 퍼센트를 꾸미지 않는다.

모바일 기본은 메모 작성 접근을 유지한다. 별도 오프라인 전용 화면이나 복잡한 클라우드 설정 대시보드를 만들지 않는다. 설정에 `기기 저장소`(보관 페이지·용량·전송 대기·내보내기)만 추가한다. 로컬 데이터 초기화/다른 서버 연결은 미전송 내용이 있으면 내보내기/동기화/명시 삭제 선택 전 진행 금지.

모든 상태 라벨은 한국어. 44px 터치 영역·16px 모바일 입력·기존 다크모드 토큰을 유지한다. 배경 polling 때문에 입력 포커스/스크롤/댓글 위치가 움직이지 않아야 한다.

## 14. 인증·배포·공유 경계

로컬 개발은 임시 데이터/loopback에서 진행한다. 실제 개인 원격 접근의 v1 경로는 **본인에게 제한한 Tailscale + HTTPS Serve**를 우선한다. 기존 private 포트를 LAN/인터넷에 열지 않는다. ACL·비인가 기기 차단·HTTPS·휴대폰 접근이 실제 확인되기 전 원격 사용 준비 완료라고 하지 않는다. 이 문서는 Tailscale 계정/도메인 생성이나 배포를 자동 승인하지 않는다.

일반 인터넷 로그인 배포가 필요하면 별도 인증 설계가 선행되어야 한다. deviceId/workspaceId는 인증 토큰이 아니다. Origin 검증/CSRF·기존 요청 경계를 보존한다. 개인 서버와 공개 공유 서버의 캐시·키·DB 쓰기·백업 권한은 분리한다. 공개 페이지 링크 폐기는 이미 내려받은 오프라인 사본을 원격 삭제하지 못한다.

## 15. 수락 테스트와 완료 판정

임시 DB·임시 브라우저 profile·모의 외부 제공자만 사용한다. 사용자 `data/`, `.env`, 실AI 호출, 실제 지도 quota에 테스트 쓰기 금지.

| ID  | 시나리오                                      | 반드시 성립할 결과                                   |
| --- | --------------------------------------------- | ---------------------------------------------------- |
| A01 | 온라인 준비→완전 offline→새 탭/앱 실행        | 앱 shell 및 지원 화면 열림                           |
| A02 | offline 메모+사진 저장→브라우저 종료→재실행   | 본문/바이트/hash 유지, 서버 저장 완료라고 표시 안 함 |
| A03 | 서버 적용 직후 응답 유실→같은 작업 5회 재시도 | 생성·이력·AI job 모두 한 번만                        |
| A04 | 같은 operationId 다른 payload                 | 409, 기존/로컬 내용 보존                             |
| A05 | 두 탭이 같은 큐를 실행하고 한 탭 lease 만료   | 오래된 ack가 최신 localRevision을 지우지 않음        |
| A06 | quota 실패·IDB blocked upgrade                | 입력 유지, 저장 성공 UI 없음, 기존 초안 미삭제       |
| A07 | 인터넷 연결됨·서버 다운/HTML응답/401          | 서버 연결로 오인 안 함, 적절 재시도/중지             |
| A08 | 구 API로 Task/메모 수정 및 삭제               | 새 기기 pull에 반영, cursor 이후 누락 없음           |
| B01 | cached 문서 편집·종료·재연결                  | JSON/custom props/blockId/첨부 일치                  |
| B02 | 두 기기 같은 page version 오프라인 수정       | 양쪽 사본 보존, 조용한 덮어쓰기 없음                 |
| B03 | ack 대기 중 다시 입력                         | 최신 입력 유지, 다음 작업 기준 버전 정확             |
| B04 | 원격 휴지통·이력 복원·페이지 이동             | 자동 부활/초안 삭제 없음, 메타데이터 정확            |
| B05 | 보관 자산 다운로드 일부 실패·quota            | partial 상태, 누락 자료 명시, 이전 자료 유지         |
| B06 | offline 320px에서 일정 inline/한글 IME/Tab    | 기존 편집/키보드 계약 유지, 가로 넘침 없음           |
| C01 | 정리 성공 응답 유실→재전송                    | 페이지 내용/원본 상태 원자적·중복 없음               |
| C02 | AI 전송 대기→재연결·중복 재시도               | 고정 입력 사본, 서버 job 하나                        |
| C03 | 새 SW 설치 중 실패·dirty 상태 update          | 구 앱 실행 가능, 미전송 자료 보존                    |
| C04 | 서버 DB 복원·epoch 변경                       | 옛 큐 자동 재생 안 함, 복구/재확인 동선              |
| C05 | 공개 서버로 sync API/개인 캐시 접근           | 404, 개인 데이터/키 노출 없음                        |
| C06 | 네트워크 전환·화면 잠금·앱 강제종료           | 실기기별 측정; 미실시 플랫폼은 미검증 표기           |

완료는 A/B/C 각각 별도로 보고한다. `로컬 자동 QA 완료`, `iOS/Android 실기기 검증`, `원격 서버 운영 준비`를 분리한다. 브라우저 자동화 결과로 PWA 앱 종료/OS 저장소 정책/백그라운드 동작을 검증했다고 쓰지 않는다.

## 16. Yjs 후속 실험의 진입 조건

v1 사용 중 다기기 충돌 빈도가 불편할 때만 별도 진행한다. 현재 설치된 BlockNote API를 먼저 확인하고 실험 fixture를 사용한다.

통과 조건: 기존 document를 두 번 열어도 중복 초기화 없음; 서로 다른 문단 동시 편집; 같은 문장 편집; 일정 JSON의 서로 다른 entry 변경; 삭제/이동/undo; 댓글 blockId·AI 적용·이력 복원·공유 snapshot 보존; 앱/서버 crash 뒤 재개. 특히 단일 string prop의 일정 JSON이 last-writer-wins로 소실되면 구조를 항목별 CRDT로 바꾸는 별도 migration을 설계한다. 실패를 숨기거나 일부 블록만 병합하면서 전체 무손실이라고 표시하지 않는다.

CRDT 채택 시 한 문서의 권위 저장 경로는 하나만 둔다. REST snapshot PUT과 CRDT writer가 독립적으로 같은 문서를 갱신하게 하지 않는다. 공유/검색용 JSON은 검증된 materialized snapshot으로 생성해야 한다.

## 17. 근거와 문서의 지위

확인일 2026-10-03. 외부 문서의 API는 실행 시 설치 버전과 대조한다.

- [MDN Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API): 지원이 제한적이므로 correctness 전제에서 제외.
- [WebKit 저장 정책](https://www.webkit.org/blog/14403/updates-to-storage-policy/): best-effort/영구 저장 요청·quota 차이를 UX에 반영.
- [BlockNote collaboration](https://www.blocknotejs.org/docs/features/collaboration), [Yjs offline](https://docs.yjs.dev/getting-started/allowing-offline-editing): 후속 CRDT 실험의 근거, 현재 구현 완료 근거가 아님.

이 설계는 기존 사용자의 원본·첨부·공유 경계를 우선한다. 실행 중 예상과 다른 기존 코드가 발견되면 증거를 기록하고 이 계약에 맞게 최소 수정한다. 사용자 데이터 손실 또는 권한 경계가 달라지는 결정만 재논의하며, 일반 파일명/함수 추출/테스트 fixture 선택은 실행자가 자율 결정한다.
