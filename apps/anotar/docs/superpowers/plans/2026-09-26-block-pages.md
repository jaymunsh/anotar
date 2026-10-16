# Block Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate, durable block page editor with direct Markdown typing and paste, Mermaid diagrams, and a read-only presentation mode for later sharing.

**Architecture:** SQLite stores versioned page metadata and lossless block JSON. A `/pages` client route loads the editor only when opened, preserving the quick capture bundle. BlockNote handles block input; the server validates documents and rejects stale saves.

**Tech Stack:** Node 24 `node:sqlite`, React 19, Vite 6, BlockNote 0.55, Mermaid diagram block.

**Spec:** `PAGE_EDITOR_DESIGN.md` sections 1–4 and 8. Public sharing and page attachments remain later milestones from sections 5 and 7.

## Global Constraints

- Keep all page data in the existing `data/storage.sqlite`; do not touch existing captures.
- Keep the capture screen's initial JavaScript free of editor and Mermaid modules.
- Store canonical block JSON, never Markdown as the only copy.
- Reject stale page versions rather than overwriting another tab's edits.
- Treat pasted HTML as data, never as raw page markup.

## Review Focus

- A pasted multi-line Markdown document should retain heading and list structure.
- A Mermaid block should survive save, reload, and Markdown export.
- Rapid typing should not be overwritten by an earlier delayed save response.
- A second tab should receive a conflict and retain its local draft.
- Narrow mobile screens should allow page editing without horizontal overflow.

---

### Task 1: Page storage and HTTP contract

**Files:** `server/pages.mjs`, `server/store.mjs`, `server/index.mjs`, `test/pages.test.mjs`

**Interfaces:** `createPage`, `listPages`, `getPage`, `updatePage({id,title,document,expectedVersion})`; `/api/pages` GET/POST and `/api/pages/:id` GET/PUT.

- [x] Write failing storage tests for create/reopen, validation, and version conflict.
- [x] Add SQLite page table, document validation, and optimistic version update.
- [x] Add JSON API endpoints with a body limit and clear 400/404/409 responses.
- [x] Run `npm test` and confirm all storage tests pass.

### Task 2: Lazy page editor and Markdown workflow

**Files:** `src/pages/PageWorkspace.tsx`, `src/pages/PageEditor.tsx`, `src/pages/pages.css`, `src/main.tsx`, `package.json`, `package-lock.json`

**Interfaces:** `/pages` list and `/pages/:id` editor; editor reads block JSON and sends versioned saves.

- [x] Add a navigation entry to pages and a lazy route so the input screen stays light.
- [x] Add page creation, selection, title editing, BlockNote Korean UI, Mermaid block, and a read-only preview.
- [x] Convert pasted Markdown to blocks, preserve rich HTML paste, and offer Markdown copy/export.
- [x] Add debounced autosave, local draft recovery, and conflict/error states.
- [x] Run the production build and inspect chunk sizes.

### Task 3: Browser QA and documentation

**Files:** `scripts/qa.mjs`, `README.md`, `CURRENT_IMPLEMENTATION.md`, `PAGE_EDITOR_DESIGN.md`

- [x] Verify create, Markdown paste, Mermaid edit, autosave/reload, conflict, and mobile width in a temporary data directory.
- [x] Verify desktop and mobile screenshots once, fix visible defects, and rerun the relevant checks.
- [x] Document the supported first release and later sharing boundary.
