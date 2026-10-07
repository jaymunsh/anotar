# Prompt server storage implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution in the current workspace. Preserve existing user changes and real data. No commit was requested.

**Goal:** Persist the existing prompt manager in SQLite, with browser migration and unchanged memo/preview/draft flows.

**Architecture:** Share pure template types/seeds/validation between browser and Node 24. Add a prompt store using the existing SQLite connection, immutable revisions and version/revision comparisons. Browser reads/writes the local application API lazily; no external AI calls. Explicit imports retain browser backups, adopt untouched presets, copy conflicting templates and deduplicate retries.

**Tech Stack:** Existing React/TypeScript/Vite, Node 24/node:sqlite, Chrome QA. No new packages.

**Spec:** Server-template portion of `docs/superpowers/specs/2026-09-28-ai-request-harness-design.md`; user authorized this next step on 2026-09-28. Jobs, AI execution and Capture→Page are later steps.

## Constraints and review focus

- Name 80, description 200, body 10,000, maximum 200 templates. Variables url/content/memo; one substitution pass.
- Existing saved data/drafts must survive a failed import, failed save, stale reply or other browser's edit.
- Version numbers from legacy browser storage are not server revision identities. Imported draft bases are advanced only when their legacy version matches the source being imported.
- An import retry must not create duplicate copies, alter another user's newer saved body or partially commit a batch.
- Loading/failure must not show false save success or prevent capturing a memo. Keep heavy manager code lazy, mobile body-first and context Save.
- Docker runtime includes the shared pure module; prompts survive the same DB backup/restart as other data.

## Files and tasks

### 1. Store and API

- [x] Add failing `test/prompt-store.test.mjs` and `test/prompt-api.test.mjs`: persistence/revisions, stale updates, invalid fields/variables, idempotent creation, safe/default/archive imports, rollback, same data in independent clients and restart.
- [x] Extract pure types/seeds/validation to `shared/prompts.ts`; preserve browser-format reading in `src/prompts/templates.ts`.
- [x] Implement `server/prompts.mjs` through `createPromptStore(db)`, expose list/get/create/update/import and revision reads through `openStore`.
- [x] Add GET/POST `/api/prompt-templates`, GET/PUT/PATCH `/:id`, POST `/import`; 64KB individual/16MB batch (covers worst-case JSON escaping of the valid library) JSON bounds, 400/404/409 errors.
- [x] Include shared source in both Docker stages and pass store/API tests.

### 2. Browser integration and migration

- [x] Add API-backed `usePromptLibrary(enabled)` with retry, visibility/focus refresh and same-origin tab notification; keep local recent choices and drafts.
- [x] Make explicit save/duplicate/archive async, preserve input changed during a request and avoid navigating another active selection after a late response.
- [x] Add browser-template migration notice, JSON import/export and atomic import feedback. Retain old browser data; import mappings reconcile only matching draft bases and recent choices.
- [x] Keep mobile Save/body arrangement, show truthful local-store success/loading/error and preserve original-version conflict checks.
- [x] Update Chrome prompt/draft scenarios and add independent browser, import retry/conflict and interrupted save checks.

### 3. Verification and documentation

- [x] Run `npm test`, full build/Chrome QA with temporary server data, desktop/320/390 light/dark visual inspection.
- [x] Build/run Docker against disposable volumes and verify templates survive recreation; target amd64 execution remains a deployment check.
- [x] Update current implementation, agent guidance, design sidecar, architecture and README.
- [x] Obtain one fresh read-only review and address material findings. Leave dev UI running.

## Review follow-up

- [x] Preserve the original creation snapshot across a lost response, further editing and reload; replay its UUID/payload and keep newer text as a draft against the acknowledged revision.
- [x] Reconcile the latest Capture template selection after an asynchronous import.
- [x] Accept combined server/legacy drafts (up to 401) and prevent an invalid draft envelope being overwritten by later editing.
- [x] Preserve both independent drafts when an acknowledged creation has already been edited separately in its server item view; retain the original creation snapshot and offer duplication without changing the current view.
- [x] Verify the three Important findings and this additional reconciliation case with `scripts/qa-prompt-recovery.mjs` (observed RED before each fix, final focused Chrome run GREEN).
- [x] Obtain the reviewer's final assessment: APPROVE for the bounded recheck; reviewer targeted tests 8/8, final full tests 39/39 and Chrome QA passed. See `.omo/evidence/review_prompt_server_storage.md`.
