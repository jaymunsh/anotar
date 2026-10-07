# AI Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Inline execution is authorized by the user's request to continue in this directory; preserve the existing dirty tree and do not commit this increment without a new commit request.

**Goal:** AI 체크로 저장한 메모를 백엔드 작업으로 처리하고 상태·결과·재요청을 확인한다.

**Architecture:** 같은 SQLite의 persistent queue와 단일 비동기 worker. 입력과 결과를 별도 스냅샷으로 저장하고 HTTP 실행기 계약을 통해 제공자를 교체한다. UI는 lazy 상세·제한된 폴링이다.

**Tech Stack:** Node 24 native SQLite/HTTP, TypeScript/React/Vite, Node tests, Playwright Chrome.

**Spec:** [AI execution design](../specs/2026-09-29-ai-execution-design.md), [harness](../specs/2026-09-28-ai-request-harness-design.md).

## Global Constraints

- Concurrency 1; job 120sec; output 256KiB; research 10sec/3 redirects/2MiB/50,000 chars.
- 원본/수정/검색/첨부 접근 보존. 실제 data/ 사용 금지. 현재 dirty 작업과 새 작업을 구별한다.
- Prompt additional 1000 chars; no resident local LLM; no automatic paid retries.
- Persist UUID and selected request snapshot; keep NEW row height and themes/320px UX.

## Review Focus

- 응답 유실 후 reload: 같은 UUID·파일 바이트·템플릿으로 기존 저장 반환.
- 삭제/수정과 job completion 경합: 원본 불변, 활성 소유자만 조회, 오래된 기준 표시.
- timeout/restart/late result: 이전 token은 완료 불가, auto rerun 없음.
- DNS/redirect/oversized response: private network와 credentials에 자료를 전송하지 않음.
- polling close/hidden/source switch: stale UI 결과·영구 polling·무거운 초기 번들 없음.

---

### Task 1: Atomic admission and durable job store

**Files:** create `server/ai/jobs.mjs`, `server/ai/contracts.mjs`, `test/ai-jobs.test.mjs`; modify `server/store.mjs`, `src/drafts/useCaptureDraft.ts`.

**Interfaces:** createAiJobStore(db, getStore) produces enqueueAiJob({captureId, requestId, expectedVersion, retryOf?}), getAiJob(id), listAiJobs(captureId), claimAiJob(), completeAiJob(id, token, result), failAiJob(id, token, code), interruptAiJobs(). Capture hydrate gains latestAiJob summary. Capture creation consumes optional UUID and exposes replay flag without changing existing return value.

- [x] Write tests for atomic save/job, legacy prepared migration no enqueue, UUID replay/conflict/file digest, immutable snapshot/retry/history/source changes, claim/token/restart and trash visibility.
- [x] Run `node --test test/ai-jobs.test.mjs` and observe RED.
- [x] Implement job DDL/store and same transaction Capture admission, UUID canonical fingerprint and lightweight summary lookup.
- [x] Run the above task tests GREEN and record evidence. Keep changes uncommitted.

### Task 2: Worker, research collection and HTTP execution API

**Files:** create `server/ai/worker.mjs`, `server/ai/research.mjs`, `server/ai/runner.mjs`, `server/ai/devin.mjs`, `server/ai/devinOutput.mjs`, `test/ai-worker.test.mjs`, `test/ai-api.test.mjs`, `test/ai-research.test.mjs`, `test/ai-runner.test.mjs`, `test/ai-devin.test.mjs`, `test/devin-output.test.mjs`; modify `server/index.mjs`.

**Interfaces:** createAiWorker({store, runner, collect, timeoutMs}) produces start/wake/stop. Runner run({job, materials}, signal) returns validated markdown/sources/usage and exposes nonsecret metadata. collectResearch(url, signal) returns text/finalURL/fetchedAt. POST save admits UUID and wakes worker after saving; ai status/API routes register requests/retries and hide trashed records.

- [x] Write RED tests: nonblocking HTTP save, missing runner, ordered concurrency, bounds/schema, timeout/late finish, interruptions; SSRF IP/DNS/redirect/byte limits; multipart replay cleanup/order and explicit job replay/stale version.
- [x] Observe failures with `node --test test/ai-worker.test.mjs test/ai-research.test.mjs test/ai-api.test.mjs`.
- [x] Implement fixed remote JSON adapter, verified opt-in Devin CLI adapter with tool deny/minimal environment, source collection with address-pinned lookup, worker life cycle and shutdown, multipart digest/order and replay cleanup, metadata and private job routes. Synthetic samples only for real CLI smoke; no user data or automatic provider fallback.
- [x] Run task tests GREEN and record evidence; keep uncommitted.

### Task 3: Status/results UX, verification and documentation

**Files:** create `src/ai/{types.ts,api.ts,AiJobPanel.tsx,ai.css}`, `scripts/qa-ai.mjs`, `.impeccable/briefs/ai-execution.md`; modify `src/main.tsx`, `src/memos/{types.ts,CaptureCollection.tsx}`, `src/prompts/AiRequestFields.tsx`, `src/drafts/useCaptureDraft.ts`, docs and QA entry.

**Interfaces:** AiJobPanel({capture,onChange?}) reads jobs, polls active visible jobs, copy result and explicitly enqueue current version or retry snapshot. latestAiJob summary status maps to compact labels. Submission journal uses SHA256 fingerprint of exact ordered inputs/template and requestId in local draft key before HTTP.

- [x] Read incumbent design context/craft floor before UI edits. Add failing QA expectations for save→status/result, copy/retry/stale source, disabled/failed runner, reload replay, source switch/hidden polling and viewport overflow.
- [x] Run RED QA against temporary fixture services.
- [x] Implement lazy panel/status plus durable browser submission journal; update copy to describe backend behavior.
- [x] Run `npm test`, `npm run build`, temporary AI and core regression QA. Inspect desktop/390/320 light/dark screenshots in at most two author rounds and run scoped detector once.
- [x] Dispatch one fresh final code/UI reviewer as required by executing-plans and impeccable; fix Important/Critical with RED→GREEN tests. Document implemented state and exact external-call limits with a scoped documenter. Retain uncommitted ledger/artifacts.
