# 통합검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite 인덱스로 메모·준비된 요청·페이지 본문·파일명을 찾는 통합검색을 기존 빠른 찾기에 연결한다.

**Architecture:** 순수 평문/두 글자 토큰 변환, SQLite 파생 문서+contentless FTS5, 같은 DB 트리거로 저장과 색인을 원자적으로 갱신한다. 20개 커서 API와 지연 검색 팔레트를 붙이고 임시 DB로 성능을 확인한다.

**Tech Stack:** Node 24 node:sqlite, React 19·TypeScript·Vite, 기존 Playwright·Chrome. 새 패키지 없음.

**Spec:** `docs/superpowers/specs/2026-09-29-unified-search-design.md`

## Global Constraints

- 기존 작업 트리·실제 `data/`·저장 계약·초안을 보존한다. 커밋·외부 배포는 하지 않는다.
- 질의 160 UTF-16 코드 단위, 최대 12단어, 검색에는 최소 2 코드 포인트 단어 하나가 필요하다. 긴 단어와 함께 쓰인 한 글자는 같은 FTS의 문자 열로 확인한다.
- 응답 최대 20개·미리보기 최대 180 코드 포인트·200ms 입력 대기. 결과마다 현재 활성 이동 대상을 선택한다.
- 제목/URL/본문 BM25 가중치 10/3/1. raw Capture를 제목으로 바꾸지 않는다.
- 모든 색인 변경은 원문 쓰기와 같은 트랜잭션. 휴지통 기록 제외, 공유된 첨부 가시성 유지.
- Operate 기존 디자인 유지, 320·390·1327px·라이트/다크·44px 조작 확인.

## Review Focus

1. 서로 떨어진 같은 두 글자와 필드 경계 때문에 없는 문자열이 검색되지 않아야 한다. Task 1의 연속 구문/필드 경계 테스트.
2. 파일 소유 메모가 삭제되어도 활성 Page가 참조하면 파일 결과가 열려야 한다. Task 1/2 가시성·이동 테스트.
3. 표 셀·링크·접힌 자식·Mermaid·NFC 및 리터럴 기호가 본문에서 검색되어야 한다. Task 1 평문/유니코드 테스트.
4. 더 보기 중 쓰기/휴지통/필터 변경 뒤 오래된 응답이 최신 결과를 덮지 않아야 한다. Task 2 커서 리셋·Task 3 지연 응답 QA.
5. 한글 Enter 조합·Escape·키보드 초점이 열린 기록의 초안을 닫거나 바꾸면 안 된다. Task 3 실제 조합·초안 QA.

## 파일과 인터페이스

- `server/searchText.mjs`: `foldSearchText(value)`, `encodeSearchText(value)`, `encodeSearchCharacters(value)`, `pageSearchText(document)`, `captureSearchText(text, url, aiRequest)`, `registerSearchFunctions(db)`.
- `server/search.mjs`: `createSearchStore(db)` → `searchRecords({query='',type='all',cursor=null})`, `rebuildSearchIndex()`; `SearchValidationError`.
- `server/store.mjs`: 기존 모듈 초기화 뒤 search 모듈 등록. `server/index.mjs`: 조회 경로와 400 처리.
- `src/search/types.ts`, `api.ts`, `SearchPalette.tsx`, `search.css`: 경량 결과 계약·조회·키보드 팔레트. 기존 `PageSearchPalette.tsx`는 호환 재수출.
- `src/main.tsx`: lazy 팔레트, 모든 화면 공통 단축키, 검색 Escape 우선 처리.
- `test/search.test.mjs`, `test/search-api.test.mjs`, `scripts/qa-search.mjs`, `scripts/benchmark-search.mjs`: 임시 자료와 동작/비용 증거.

### Task 1: 저장소와 원자적 검색 인덱스

**Consumes:** 기존 `captures`, `pages`, `assets`, `page_references`와 동일한 DatabaseSync.
**Produces:** `createSearchStore`, 평문 변환·키워드 검색·더 보기/리셋 계약.

- [x] 임시 저장소 테스트 작성: 메모/AI/Page/파일, title 가중치, 두 글자 부분 검색, 분리된 bigram 오탐, 기호/이모지/NFC, 짧은 입력, 160자·12단어 검사.
- [x] 기존 원문 먼저 등록한 DB 이관, 정상 재시작 색인 재작성 없음, 재구축, 20개 페이지/쓰기 리셋 테스트를 작성한다.
- [x] 가져오기/409/원문+색인 롤백, 휴지통 하위 묶음/복원/공유 첨부 가시성 테스트를 작성한다.
- [x] `node --test test/search.test.mjs` → `store.searchRecords is not a function` RED를 확인한다.
- [x] 순수 변환·contentless FTS5·파생 테이블·트리거·읽기 트랜잭션 검색을 구현하고 store에 등록한다.
- [x] `npm test` → 전체 GREEN, 로그와 계약 결정을 ledger에 남긴다.

### Task 2: 검색 HTTP API

**Consumes:** Task 1 `searchRecords({query,type,cursor})`.
**Produces:** `GET /api/search`의 20개 JSON·400·변경 리셋 계약.

- [x] 임시 서버 HTTP 테스트: 파라미터·400·본문 검색·파일 이동·휴지통 제외·커서 질의 불일치·20개·쓰기에 따른 리셋.
- [x] `node --test test/search-api.test.mjs` → 검색 404 RED를 확인한다.
- [x] 조회 경로·SearchValidationError 처리만 추가한다.
- [x] `npm test` → 전체 GREEN, Task 2 완료를 ledger에 기록한다.

### Task 3: 기존 검색창 통합

**Consumes:** Task 2 API와 기존 앱 `navigate`, 휴지통 이벤트.
**Produces:** 모든 화면의 검색/단축키, 조회 상태·더 보기·IME·초점·오래된 응답 보호.

- [x] Chrome QA에 실제 검색, 방향키/Enter, 모바일 메뉴, Escape 초안 보존, 한글 조합, 지연 응답/필터/더 보기와 실패 재시도 시나리오를 작성한다.
- [x] 기존 빌드에서 `node scripts/qa-search.mjs` → 통합검색 다이얼로그/본문 결과 없는 RED를 확인한다.
- [x] craft-floor를 읽고 incumbent 팔레트를 확장한다. types/API/팔레트/CSS·main의 lazy 연결과 공통 단축키를 구현한다.
- [x] `npm run build`와 scoped Chrome QA → GREEN. 같은 QA에서 320·390·1327px 두 모드 화면과 조작 크기를 기록한다.

### Task 4: 성능·회귀·문서·완료 리뷰

**Consumes:** 앞선 모든 계약과 실제 UI 캡처.
**Produces:** 기능/자원 증거·현재 문서·독립 리뷰.

- [x] 임시 DB 1만·10만 건 생성·검색/전수 비교·쓰기·재시작·RSS/파일 크기를 재현하는 benchmark를 작성하고 실행한다. N100 수치로 주장하지 않는다.
- [x] scoped QA를 기존 `scripts/qa.mjs`에 연결하고 `npm test`, `npm run build`, 전체 Chrome QA와 `git diff --check`를 확인한다.
- [x] 변경 UI detector를 한 번 실행하고 기계적인 문제를 처리한다. 캡처를 직접 열어 유효성을 확인한다.
- [x] 새로운 검색 코드·계획·증거·Review Focus를 fresh reviewer에게 한 번 전달한다. Important 이상은 실패 재현→수정→전체 GREEN의 한 수정 묶음으로 해결한다.
- [x] 문서 담당자에게 CURRENT/README/AGENTS/검색 설계 사이드카의 변경 경계를 전달한다. 실제 코드와 문서를 대조한다.
- [x] 사용자가 보는 로컬 검색 화면을 열고 완료·검증·N100 실측 범위를 보고한다.

## 실행 기록

- 기존 사용자 작업 트리에서 직접 진행한다. 커밋하지 않으며 task ledger와 `.omo/evidence/unified_search.md`에 검증 기록을 남긴다.
- 이 기록은 구현 진행과 필요에 따라 갱신한다.
- 측정에 따른 변경: 10만 건에서 혼합 한 글자 조건의 본문 확인 p95 260.815ms를 확인하여 같은 FTS에 문자 열을 추가했다. 최종 p95 19.005ms, FTS 104.50MiB다. v1 → v2 원자적 이관과 후보 본문 재정규화 0회 테스트를 추가했다.
