# Memo Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `/memo`에서 일반 메모와 실행 전 AI 요청을 구분하고 실제 예시를 제공한다.

**Architecture:** 기존 Capture·상세 수정·공통 셸을 재사용한다. 요청 설정과 조립문을 Capture에 불변 사본으로 연결하고, 블록 페이지는 `/pages/:id`를 유지한다. 홈은 빠른 입력·할 일·최근 3개만 표시한다.

**Tech Stack:** 기존 React·TypeScript·Vite·Node 24 SQLite. 새 의존성 없음.

**Spec:** [메모 관리와 AI 요청 구분](../specs/2026-09-29-memo-library-design.md)

## Global Constraints

- 기존 `data/`와 사용자 문서를 덮거나 삭제하지 않는다. 샘플은 명시적 실행에서만 생성한다.
- 외부 AI·URL 수집·가짜 완료 상태를 만들지 않는다. 상태는 `prepared`이며 화면은 실행 전이다.
- 추가 요청 1,000자·템플릿 본문 10,000자·조립 요청문 64,000자. 기존 UTC 저장·한국 표시 유지.
- 입력함 첫 로드에 BlockNote·Mermaid를 싣지 않는다. 원본 수정과 보관된 요청문은 독립적이다.

## Review Focus

- AI 항목이 100개 이상이어도 일반 메모는 별도 조회에서 보인다.
- 템플릿 변경과 원본 수정 후에도 보관 시점의 요청문이 유지된다.
- 설정이 잘못되거나 첨부 등록에 실패하면 일부 저장·남은 파일이 없다.
- 앱 이동·탭 선택·늦은 조회가 최신 화면과 작성 초안을 덮지 않는다.
- 샘플 재실행이 수정한 메모·문서를 덮거나 첨부를 중복 생성하지 않는다.

### Task 1: 요청 사본과 목록 구분

**Files:** `shared/aiRequests.ts`, `src/prompts/templates.ts`, `server/store.mjs`, `server/index.mjs`, `test/memo-library.test.mjs`

**Interfaces:** `buildRequest(template, input, additional)`·`inferInputUrl(text)` 공통화. `createCapture({aiRequest?, sampleKey?})`, `listCaptures({scope?})`, `captureCounts()`; 응답 `aiRequest`, `isSample`, 목록 `counts`.

- [x] 임시 DB/API 테스트로 요청 사본·재시작·원본 수정 독립성·범위별 조회·실패 롤백·샘플 키 재실행을 검사한다.
- [x] 새 테스트의 RED를 확인한다.
- [x] 요청 조립 공통 함수와 nullable 열 이관·검증·조회·업로드 설정을 구현한다.
- [x] 전체 `npm test` GREEN을 확인한다.

### Task 2: `/memo`와 기존 셸 연결

**Files:** `src/main.tsx`, `src/memos/CaptureCollection.tsx`, `src/memos/types.ts`, `src/memos/memos.css`, `src/pages/PageWorkspace.tsx`, `scripts/qa-memo-library.mjs`, `scripts/qa-compact-pages.mjs`, 기존 QA 시나리오.

**Interfaces:** 기존 원본 상세·수정 콜백을 Collection에 연결한다. `/memo?view=ai`는 AI 목록, `/pages`·`/temp`는 `/memo` 호환 연결이다.

- [x] Chrome 시나리오에 메모 직접 진입·AI 구분·재접속·요청문 복사·홈 초안·이전 주소·좁은 화면 검사를 추가하고 RED를 확인한다.
- [x] 목록 UI를 작은 컴포넌트로 추출해 홈 최근 3개와 메모 관리에 재사용한다. 저장 시 요청 사본을 전송하고 상세에 실행 전 요청문을 보여준다.
- [x] 자동 임시 페이지 생성과 특별 진입 링크를 제거하며 기존 문서·편집 동작을 보존한다.
- [x] 새 빌드로 Chrome 전체 QA와 320/390px·양쪽 테마를 확인한다.

### Task 3: 실제 예시와 문서

**Files:** `scripts/seed-memo-samples.mjs`, `examples/`, `package.json`, 현재 구현·사용 안내·디자인·에이전트 지침.

- [x] 예시 파일과 중복 방지 스크립트를 만들고 임시 저장소에서 두 번 실행해 DB·파일 개수와 편집 보존을 검사한다.
- [x] 실제 로컬 저장소에 예시를 추가하고 Orca의 `/memo` 미리보기를 연다.
- [x] 현재 동작·요청 사본·미실행 범위를 문서에 반영한다. 빌드·전체 테스트·Chrome 증거를 기록하고 읽기 전용 리뷰로 검토한다.
