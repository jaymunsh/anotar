# Workspace UI refinement

> Execute inline in the existing workspace; preserve concurrent changes and stored data.

**Goal:** Make home, document editing, and management routes compact, consistent, and easy to use on desktop and mobile.

**Architecture:** Reuse current components and theme tokens. Page display preferences stay in browser storage. Optional outline reads the mounted editor; home continues to load metadata only. No change to document schema, sharing permissions, or AI execution.

**Stack:** React, Vite, BlockNote, existing CSS tokens, Playwright, Node test runner.

**Approved direction:** Current paper/forest and charcoal/sage themes; quick input first; short page toolbar; secondary tools in a menu; optional right panel and mobile sheet.

- [x] Shell: scrollable navigation/page tree with a separate footer, home link on the brand.
- [x] Home: bounded two-column width, fixed auxiliary column, grouped recent memo rows, search shortcut.
- [x] Documents: comments/AI/share toolbar, secondary tools menu, wide/small-text display options, optional heading outline.
- [x] Maps: collapse coordinate editing behind a location-edit control.
- [x] Management routes: consistent widths, headings, spacing, and mobile touch targets.
- [x] Verify: types/build, regression tests, existing affected browser scenarios, desktop/mobile light/dark screenshots, updated design documentation.

## Evidence

[Verification record](../../../.omo/evidence/workspace-ui-refinement.md): build, 157 unit/API tests, full browser regression, workspace/dashboard/page-AI/share scenarios, 28 workspace viewport/theme captures.

## Acceptance

- Home does not fetch full page documents or preload the editor.
- A long page tree never overlaps the sidebar footer.
- Main document actions occupy one row on mobile, with breadcrumb on a separate compact row.
- Display options and outline do not increment the stored document version.
- Markdown, undo/redo, Mermaid, sharing, AI, comments, and trash retain their behavior.
- 320px/390px mobile and desktop layouts have no horizontal overflow.
- Public sharing stays read-only; comments remain clearly labelled as an unsaved preview.
