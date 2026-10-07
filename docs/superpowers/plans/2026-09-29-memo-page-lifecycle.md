# Memo to Page and Page AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove memo cards from Page bodies, organize transferred memos out of the inbox, and let the user request AI from the saved Page and deliberately apply or undo results.

**Architecture:** Preserve Capture originals and existing immutable jobs/receipts. Extend the shared job store and single worker to Page ownership; use transactional organization/provenance and result application with version checks. Keep Page AI and provenance UI lazy and reuse the editor, templates, Markdown parser and theme.

**Tech Stack:** React 19, TypeScript, Vite, BlockNote, Node 24 SQLite; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-memo-page-lifecycle-design.md`, accepted by the user's 2026-09-29 instruction to proceed.

## Global Constraints

- Preserve preexisting dirty work. No commits, reset/clean, real-data fixture writes, paid AI calls, external publication, or provider/model changes. Keep `swe-2-high`.
- Page body and Markdown output contain no automatic memo card/tag. Preserve legacy raw documents and derive their origins for Page info; hide legacy memo blocks in the editor without rewriting user records.
- Organize transfers hide source Capture from normal memo/AI lists/counts/search while preserving originals, attachments and immutable job history. Provide an explicit restore-to-inbox path. Legacy receipt replay remains valid and does not re-organize a restored memo.
- Whole saved Page is the default AI input. Support explicitly selected editable blocks as an optional scope. References' target content, private assets and attachments are never automatically sent.
- Request and apply UUIDs and first request bodies survive lost responses/reload. Page edits may continue during execution; result application is explicit. Selected-block replacement requires the request version; apply and undo require the current expected version.
- Apply result and save the prior Page revision in one transaction. Preserve other blocks and source/job snapshots. No automatic whole-page Markdown round-trip replacement.
- Keep the existing palette/fonts, desktop and 320/390px light/dark behavior, lazy initial capture bundle and visible-only status polling.

## Review Focus

- Legacy jobs with retries and pending UUIDs survive migration/restart without changing their input, result or identity.
- Organizing/restoring changes default search visibility and file routing in the same transaction; Page deletion does not remove the original or asset bytes.
- Responses lost after commit and Page navigation/reload reuse the submitted snapshot and never apply twice or over newer edits.
- AI completes after manual Page edits; replacement refuses stale documents and undo refuses to overwrite newer content.
- Legacy hidden captureRef blocks and selected nested blocks preserve all other Page content and cause no hidden external fetches.

## Task 1: Integrated production change

**Ownership:** One implementation worker owns `server/`, `shared/`, `src/` and `test/` for this feature. Coordinator owns QA scripts, specification/plan, root docs, evidence and live server/browser. Do not edit the coordinator's files or dispatch agents.

**Suggested files:** `server/store.mjs`, `server/pageConnections.mjs`, `server/ai/jobs.mjs`, `server/search.mjs`, `server/index.mjs`; focused `server/pageAi.mjs` and `server/pageMarkdown.mjs` if needed; `src/memos/CapturePageImport.tsx`, `src/memos/types.ts`, `src/main.tsx`, `src/pages/PageEditor.tsx`, `src/pages/CaptureRefBlock.tsx`, `src/pages/pages.css`, `src/ai/types.ts`, new lazy Page AI/origin components. Relevant store/API/migration tests.

**Pinned interfaces:**

- Extend imports with optional `disposition: 'organize'`; absent means the legacy copy contract. New UI explicitly sends organize, includes chosen text/result/files, creates no captureRef and atomically records provenance + organization. Return the existing `{item, blockIds, replayed}`.
- `GET /api/captures?organization=inbox|organized`, default inbox; returned `counts` match that organization. Capture includes `organizedAt`, `organizedPageId`, and an organization operation identity, preserving content version/timestamps on metadata-only transition.
- `POST /api/captures/:id/unorganize` receives `{operationId, expectedOrganizedOperationId}`; durable idempotent restore without ABA re-organizing/restore errors.
- `GET /api/pages/:id/origins` returns `{items:[{capture, job, operationId}]}` with job nullable. Legacy references/import receipts are included; source details are private Page info, not editor content.
- `GET /api/pages/:id/ai-jobs` returns `{items: AiJob[]}`.
- `POST /api/pages/:id/ai-jobs` receives `{requestId, expectedVersion, aiRequest:{template,additional}, blockIds?:string[], retryOf?:string|null}`. Omitted/empty blockIds uses whole Page. Server extracts saved Page Markdown and records the exact source document/title/version and selected IDs. Returns `{item: AiJob}` and wakes the existing single worker. Retry reuses the old snapshot. AiJob adds nullable `pageId`, nullable `captureId`, `targetBlockIds`, preserving old Capture records and responses.
- `POST /api/pages/:id/ai-applies` receives `{operationId,expectedVersion,jobId,mode:'append'|'replace'|'child',document,title?}`. Uses a completed job owned by that Page, validates/rekeys the supplied converted result document, requires nonempty recorded selection and exact source version for replace, and creates a child in child mode. Returns `{item:PageRecord,operationId,replayed}`. Source-page revision is recorded for append/replace.
- `POST /api/pages/:id/ai-applies/:operationId/undo` receives `{operationId,expectedVersion}`. Undo restores the prior saved document/title as a new version with a durable receipt; refuses intervening edits. Return `{item:PageRecord,replayed}`. Child creation is restored through existing child-page trash, not by overwriting source Page.

- [x] Add meaningful failing tests for organize/restore/visibility/legacy replay, schema migration and Page jobs, application/undo/version conflict and transaction rollback.
- [x] Implement the contracts using current store validation/transactions and bounded source serialization, with no dependency additions.
- [x] Add lazy Page AI UI in the compact Page tool row. Reuse template selection and saved-request/result status/history patterns; new panel has Page-specific copy and explicit request/apply actions. No fake Capture owner.
- [x] Block request/apply while unsaved/conflict/recovery/trash or unknown pending state. Preserve one pending request/apply body across navigation/reload. Provide friendly retry errors.
- [x] Hide legacy captureRef rendering and exclude it from Markdown output, retaining saved bytes and origin access in Page info. Add organized-memo filter/restore and required event refreshes without disrupting drafts.
- [x] Run focused tests + `npm test` + `npm run build`; format touched source. Write `.omo/evidence/lifecycle-implementation.md` with exact commands/logs/changed files, interface deviations and limits; return a short report. No commit.

## Task 2: Coordinator integration QA and documentation

**Ownership:** Coordinator scripts/docs/evidence; fresh reviewer owns only its report; fresh documentation proxy owns only named root docs/brief.

- [x] Add `scripts/qa-page-ai.mjs` using temporary DB and local HTTP fixture. Cover organize/restore and old-card absence; whole saved Page request and immutable source snapshot; edited-during-job result, append/selection replacement/child/undo; version conflict; lost request/apply responses and reload replay; preserved source/job/assets; mobile and light/dark.
- [x] Run one batched visual capture pass and one bounded post-fix confirmation. Run detector once with scoped triage. Existing AI/memo/search/connection regressions get only required fixture/contract corrections.
- [x] Package the task-only diff against `lifecycle-baseline.json`; obtain one fresh combined final spec/code/UI review, fix valid findings with focused verification.
- [x] Update current documentation through the scoped documentation proxy, validate links, formatting and design hashes, and record final evidence.
- [x] Leave the configured live dev session running and open an existing Page read-only so the user can try Page AI. Preserve actual data; no real AI test invocation.
