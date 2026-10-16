# Workspace Toolbars Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for this approved UI change.

**Goal:** Extend the compact page toolbar to all private workspace routes.
**Architecture:** A single sticky shell target receives portals owned by each active screen. Form state, queries, event handlers and polling remain with their existing owners. PageEditor keeps its existing portal.
**Tech Stack:** React 19, TypeScript, existing CSS tokens; no new dependencies.
**Spec:** User-approved screen/tool table in this conversation; existing DESIGN.md visual rules.

## Global Constraints
- One 48px sticky toolbar; mobile targets 44px; verify 320px/390px/desktop in both themes.
- Preserve page editing, capture/template drafts, filters, task write locks and public-view isolation.
- Use temporary QA storage, disabled AI and existing fixture; do not alter user data or commit.

## Review Focus
- Persisted hidden Task/Prompt owners must not render a toolbar into another route.
- Mobile memo search must retain its value and focus, including resize/dismissal.
- Template transfer menus must remain reachable and dismissible.
- Toolbar creation must use existing page command and error recovery.
- Page tools must remain fixed while scrolling and keep editor saves intact.

### Task 1: Shared host and route actions
**Files:** src/workspace/WorkspaceToolbar.tsx, toolbar.css, src/main.tsx; existing screen components.
**Interfaces:** WorkspaceToolbar({title, children, meta?}) consumes context HTMLElement|null and portals owned React nodes. ToolbarSearch({children, active}) keeps a stable input subtree at all widths.
- [x] Add all-route toolbar assertions to scripts/qa-workspace-ui.mjs; run against current build and record failure.
- [x] Implement shared host, home actions and migrate screen controls; remove duplicate body headings; preserve list filters.
- [x] Build and run scoped browser QA: titles/actions, mobile search, task view switch, template draft roundtrip and page toolbar contracts.

### Task 2: Responsive verification and documentation
**Files:** DESIGN.md, CURRENT_IMPLEMENTATION.md, AGENTS.md, .impeccable/design.json, .omo/evidence/workspace-toolbars/.
- [x] Batch inspect desktop/mobile screenshots in both themes; correct concrete defects together.
- [x] Request scoped read-only review; resolve confirmed findings.
- [x] Run final build/scoped QA, document exact coverage and open the running local app.
