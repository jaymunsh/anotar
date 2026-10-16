# Block Comments Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive, clearly temporary block comment preview on the existing Page editor.

**Architecture:** Keep the temporary thread model in React memory, keyed by stable BlockNote block IDs. The existing editor owns page data and autosave; a separate panel renders comment interactions. Event delegation on the editor wrapper selects a block without changing ProseMirror-managed DOM.

**Tech Stack:** React 19, TypeScript, BlockNote, CSS, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-block-comments-preview-design.md`

## Global Constraints

- Preserve existing page data, autosave, dark theme, 320px/390px responsive behavior, and the private API boundary.
- Do not create public share URLs or persist preview comments.
- Keep copy in Korean and label the preview's temporary state.

## Review Focus

- Unsaved page edits: the preview must not present an old saved document as current.
- Empty or deleted block: selection and excerpt must remain stable.
- Nested blocks: click selection must resolve the nearest BlockNote block ID.
- Mobile keyboard: the composer and close button must remain reachable.
- Escape and exit: the editor must regain its editable state.

---

### Task 1: Interactive preview

**Files:**
- Create: `src/pages/PageCommentPreview.tsx`
- Create: `src/pages/pageComments.ts`
- Create: `src/pages/pageCommentPreview.css`
- Modify: `src/pages/PageEditor.tsx`
- Test: `scripts/qa-page-comment-preview.mjs`
- Modify: `scripts/qa.mjs`

**Interfaces:**
- `PageEditor` owns `commentPreviewOpen` and `selectedCommentBlockId`, passing the current `editor.document` blocks to `PageCommentPreview`.
- `PageCommentPreview` owns session-only threads and calls `onClose`; it never calls page APIs.
- `getBlockExcerpt(blocks: unknown[], id: string): string` extracts a short plain-text anchor.

- [x] Write browser QA for entry, read-only state, block selection, comment/reply/resolve/reopen, exit/reset, and widths/themes.
- [x] Run `node scripts/qa.mjs` and observe the missing preview control fail.
- [x] Implement the model, editor integration, panel, and responsive styles.
- [x] Run `npm run build`, `npm test`, and `node scripts/qa.mjs`; inspect desktop/mobile screenshots. The final mobile picker adjustment passed a focused browser QA after the full run.
- [x] Update `CURRENT_IMPLEMENTATION.md`, `DESIGN.md`, and `.impeccable/design.json` with the actual state and component rule.

### Task 2: Solo workspace rollout plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-30-solo-workspace-roadmap.md`
- Modify: `PLAN.md`

**Interfaces:** Later plans consume the documented access, backup, content capture, attention, and structured page milestones.

- [x] Record the independent milestone order and acceptance checks for backup/restore and revision history; personal access and read-only sharing; mobile capture/OCR/URL retention; task reminders; and structured page views.
- [x] Explicitly reserve public comment storage/API for the identity and permission decision.
- [x] Check links and assertions against current docs and code.
