# 메모를 페이지에 담기 구현 계획

> **For agentic workers:** superpowers:executing-plans로 현재 작업 공간에서 순서대로 구현한다. 기존 사용자 변경은 보존하고 자동 커밋하지 않는다.

**Goal:** 보관한 메모에서 기존 페이지·새 하위 페이지를 선택해 원본 참조, 편집 가능한 글과 선택한 첨부를 담는다.

**Architecture:** 페이지 블록 JSON이 원본이며 참조 색인은 같은 SQLite 트랜잭션에서 갱신한다. 가져오기는 최신 페이지 끝에 추가하고 UUID 작업 기록으로 응답 유실 재시도의 중복을 막는다. 선택 UI와 BlockNote 참조·첨부 렌더러는 필요할 때만 불러온다.

**Tech Stack:** React 19, TypeScript, Vite 6, BlockNote 0.55, Node 24 SQLite.

**Spec:** `docs/superpowers/specs/2026-09-27-capture-page-connection-design.md`의 2026-09-29 방향.

## 유지할 계약

- Capture 원문·첨부 바이트는 보존한다. AI 실행·URL 수집은 하지 않는다.
- 페이지는 schemaVersion 1, 제목 160자, 문서 1MB·1,000블록 상한이다.
- 내용은 줄바꿈을 보존한 일반 문단으로 복사하고 Markdown 명령으로 해석하지 않는다.
- 파일은 Asset ID를 참조한다. 저장 키·디스크 경로를 블록에 넣지 않는다.
- 공개 공유는 아직 구현하지 않는다. captureRef는 개인용이며 첨부 공개에는 향후 별도 허용이 필요하다.
- 페이지 간 블록 분배·직접 업로드·삭제·휴지통은 후속 작업이다.

## Review Focus

- 가져오기 응답 유실 후 재시도: 최초 작업·대상·선택을 그대로 보내며 중복 사본·빈 자식을 만들지 않는다.
- 오래 열린 편집기: 가져오기 이후 자동 저장은 409가 되며 로컬 초안을 유지한다.
- 원본 또는 파일이 없어진 기존 참조: 블록 안에서 안내하고 문서의 다른 부분은 저장한다.
- 큰 목록·깊은 계층·동일 제목: 대상의 계층 경로를 보여주고 200개 이후·깊이 8 이후도 찾는다.
- 모바일·키보드·오류: 320/390px 양쪽 테마에서 선택과 확인이 가능하고 실패 시 선택을 보존한다.

## Task 1: 페이지 탐색과 계층 안정화

**Files:** `server/store.mjs`, `server/pageConnections.mjs`, `src/pages/PageWorkspace.tsx`, `test/page-connections.test.mjs`.

- [x] 없는 상위로 이동 거절, 200개 이후 목록·제목 검색·계층 경로 테스트를 먼저 작성해 실패를 확인한다.
- [x] 목록의 200개 제한을 없애고 서버 제목 검색을 50개씩 반환한다. 검색 커서는 질의와 위치를 검증한다.
- [x] 사이드바 깊이 제한을 없애고 들여쓰기 폭은 8단계까지만 늘린다.
- [x] 관련 테스트를 실행한다.

## Task 2: 참조 색인과 원자적 가져오기

**Files:** `server/pages.mjs`, `server/pageConnections.mjs`, `server/store.mjs`, `server/index.mjs`, `test/page-connections.test.mjs`, `test/page-connections-api.test.mjs`.

**Interfaces:** `importCaptureIntoPage({pageId, operationId, captureId, copyContent, assetIds})`와 `createPageWithCapture({title, icon, parentId, captureImport})`는 `{item, blockIds}`를 반환한다. HTTP 생성은 기존 `{item}`과 호환하며 가져올 때 `blockIds`도 반환한다.

- [x] 텍스트·URL·선택 첨부·다중 페이지 재사용·재시도·충돌·롤백·재시작 참조 보존 테스트를 작성해 실패를 확인한다.
- [x] captureRef·asset 속성을 검증하고 페이지 생성·수정과 같은 트랜잭션에서 page_references를 갱신한다. 기존 문서 참조는 최초 마이그레이션에서 색인한다.
- [x] 작업 기록에 요청과 최초 응답을 저장한다. 같은 UUID의 다른 요청은 409, 없는 대상은 404, 상한·소속 오류는 400이다.
- [x] API에 페이지 검색, 기존 페이지 가져오기, 가져오기를 포함한 자식 생성, 연결된 페이지 목록, Asset 메타데이터를 등록한다.
- [x] DB/API 테스트를 실행한다.

## Task 3: 메모 상세에서 담기와 페이지 렌더링

**Files:** `src/memos/CapturePageImport.tsx`, `src/memos/capturePageImport.css`, `src/main.tsx`, `src/pages/CaptureRefBlock.tsx`, `src/pages/AssetBlock.tsx`, `src/pages/PageEditor.tsx`, `src/pages/pages.css`, `scripts/qa-page-connections.mjs`.

- [x] 실제 브라우저 흐름 QA를 먼저 작성하고 담기 버튼이 없는 실패를 확인한다.
- [x] 상세 안에서 선택 화면으로 전환한다. 기존 페이지·새 페이지, 검색·더 보기, 내용 복사·파일 선택, 재시도, 연결된 페이지 목록을 제공한다.
- [x] `/captures/:id`는 원본 상세를 직접 연다. 성공 후 `/pages/:id?import=blockId`로 이동해 가져온 위치를 보여준다.
- [x] captureRef는 유형·시간·미리보기·첨부 수를 표시하고 원본을 연다. asset은 이미지·다운로드를 제공한다. 없거나 조회 실패한 대상은 안내와 재시도를 제공한다.
- [x] Markdown 보기·복사는 참조·첨부를 앱 전용 ID와 설명으로 내보내고 파일 바이트가 포함되지 않음을 안내한다.
- [x] 사용자 초안과 기존 페이지 충돌 동작을 확인한다.

## Task 4: 통합 검증과 문서

**Files:** `scripts/qa.mjs`, `AGENTS.md`, `README.md`, `CURRENT_IMPLEMENTATION.md`, `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, 연결 설계, `.omo/evidence/capture_page_connection.md`.

- [x] `npm test`, `npm run build`, 연결 브라우저 QA와 기존 전체 QA를 실행한다.
- [x] 1327/390/320px 밝음·어두움 화면을 한 번에 검토하고 발견한 실제 결함을 한 묶음으로 수정한다.
- [x] 변경한 파일을 대상으로 디자인 검출기를 한 번 실행한다.
- [x] 기존 디자인 체계를 유지하며 현재 구현·후속 범위를 문서에 반영한다.
- [x] skill이 요구하는 새 컨텍스트 리뷰와 문서 확인을 완료한다. 실제 사용자 데이터는 검증 때문에 생성·수정하지 않는다.

## 실행 결과 (2026-09-29)

- 현재 공유 작업 공간에서 기존 변경과 실제 사용자 데이터를 보존했다. 자동 커밋하지 않았다.
- `npm test`: 58/58 통과 (`/tmp/leneu-connections-final-tests.log`).
- `npm run build`: 타입 검사·빌드 통과 (`/tmp/leneu-connections-final-build.log`). 기존 편집기/다이어그램의 대형 chunk 안내는 남아 있다.
- 전체 브라우저 QA 통과 (`/tmp/leneu-connections-full-qa.log`), 1327/390/320px·두 테마의 정리/페이지 화면 12개를 확인했다.
- 복구 화면 초점·선택 하위 노출 재현을 먼저 실패시키고 수정했다. 이후 추가한 원본 직접 경로의 비JSON 실패·재시도도 실패→통과를 확인했다 (`/tmp/leneu-connections-route-red.log`, `/tmp/leneu-connections-route-green.log`). 마지막 기능 검증은 `QA_CAPTURE_SCREENSHOTS=0 node scripts/qa-page-connections.mjs`이며 기존 화면을 다시 생성하지 않았다.
- 변경 범위 layout 검출 1회 결과 `[]`, 별도 리뷰의 기존 두 P2 수정 평가 `ship`, 별도 디자인 문서 반영을 완료했다.
- 근거: `.omo/evidence/capture_page_connection.md`, `review_capture_page_connection.md`, `document_capture_page_connection.md`.
