# Keyword Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 AI 요청에서 키워드 검색과 실제 출처 본문 기반 정리를 지원한다.

**Architecture:** Devin의 선택적 discovery와 기존 collector·요약 worker를 연결한다. 불변 요청 및 작업 스키마를 유지하며 검색 capability가 없는 실행기는 명확하게 실패한다.

**Tech Stack:** Node.js 24·SQLite·Devin CLI, 기존 React/TypeScript/Vite.

**Spec:** `docs/superpowers/specs/2026-09-29-keyword-research-design.md`

## Global Constraints

- 동시 실행 1개·작업 전체 120초; 자동 유료 재시도 없음.
- 후보 최대 5개·확인 본문 최대 3개·각 16,666자, 전체 49,998자.
- 검색 호출 후 ATIF 1MiB·출력 256KiB 검증; 실제 web_search 1회·질의 240자 이내·다른 도구 호출 거부.
- 실제 data/는 테스트에 사용하지 않는다. 기존 변경을 보존하고 커밋은 요청받기 전 만들지 않는다.
- UI는 기존 토큰·지연 경계를 보존한다. 직접 자유 요청은 검색하지 않는다.

## Review Focus

- URL이 본문에 섞인 키워드 요청: URL 경로 우선, 미리보기 설명과 실제 동작 일치.
- 일부 출처가 차단·중복 redirect일 때: 확인한 본문만 사용하고 수집 범위를 알린다.
- 검색 없이 그럴듯한 출처 JSON을 반환할 때: 실패하고 요약을 실행하지 않는다.
- 검색 중 종료·기한 초과: 네이티브 capacity 해제 후 다음 작업, 원문 유지.
- 수정·보관된 기본 템플릿/가득 찬 라이브러리: 업데이트가 사용자의 설정을 덮거나 시작을 막지 않는다.

---

### Task 1: 검색 증거와 네이티브 discovery

**Files:** `server/ai/devin.mjs`, `devinOutput.mjs`, 신규 `server/ai/discovery.mjs`; `test/ai-devin.test.mjs`, 신규 `test/ai-discovery.test.mjs`.

**Interfaces:** Produces `runner.discover({job}, signal): Promise<{url:string,title:string}[]>`, `parseDevinSearch(stdout, transcript)` and `collectKeywordResearch(candidates, signal, collect)`; 기존 `run`·`drain` 유지.

- [x] 증거 없는 검색/위조 URL/다른 도구/중복 후보 거부·정규화, 실제 임시 CLI export 읽기·정리·중단의 실패 테스트 작성.
- [x] `node --test test/ai-discovery.test.mjs test/ai-devin.test.mjs` 실행. Expected: 새 검색 경로/검증 부재로 FAIL.
- [x] 검색 단계만 web_search 허용, 요약 단계 검색 금지, 크기 제한 export와 실제 관측값 검증 구현. 수집 helper는 실패 건너뛰기·최종 URL 중복 제거·본문 한도·0개 거부.
- [x] 같은 명령 실행. Expected: PASS; `npm test`도 PASS.
- [x] task-done으로 전체 테스트 증거 저장, 변경은 미커밋 유지.

### Task 2: 작업 경로와 템플릿 선택

**Files:** `server/ai/worker.mjs`, `contracts.mjs`, `server/index.mjs`, `server/prompts.mjs`, `shared/prompts.ts`, `src/prompts/AiRequestFields.tsx`, `PromptWorkspace.tsx`; 관련 worker/prompt/API 테스트.

**Interfaces:** Consumes Task 1의 discovery·collector. Produces 기존 result_ready JSON과 additive `researchModes: ('url'|'keyword')[]`; `research-keyword` 기본 템플릿.

- [x] 키워드 저장→실제 출처 결과·원문 불변/URL 우선/자유 요청 검색 없음/검색 없는 실행기 실패·timeout, 템플릿 이관/보관/200개 시작 테스트 작성.
- [x] `node --test test/ai-worker.test.mjs test/prompt-store.test.mjs test/prompts.test.mjs test/ai-api.test.mjs` 실행. Expected: 새 동작 부재로 FAIL.
- [x] worker를 연결하고 수집 범위 안내·오류/상태 capability·누락 기본 템플릿 보강·선택란 종류/설명을 구현.
- [x] `npm test`, `npm run build` 실행. Expected: PASS; 기존 편집기 chunk 경고는 기록.
- [x] 임시 DB에서 browser 선택·저장/결과·모바일·회귀, 공개 합성 키워드 opt-in 실호출 확인. Expected: 출처 본문과 원문 보존, 실제 데이터 미사용.
- [x] task-done 전체 테스트; fresh code/UI review 1회와 필요한 1차 수정. 완료 후 scoped documenter로 README/현재 규격/설계 설명을 갱신하고 증거를 남긴다.

## 자체 검토

기존 URL 수집기·네이티브 lifecycle은 재사용하며 외부 검색만 임시 fake executable로 대체한다. 두 Task가 공유하는 discovery 반환형과 단일 signal lifecycle을 검토했다. 기존 checkout에서 직접 실행하도록 허가된 작업의 연속이므로 추가 승인·작업 트리·커밋을 만들지 않는다. 문서 생성은 마지막 코드 수정 뒤에 수행한다.
