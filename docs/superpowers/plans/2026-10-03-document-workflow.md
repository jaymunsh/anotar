# Document workflow implementation plan

> For agentic workers: use superpowers:subagent-driven-development. User approved implementation; continue without re-requesting authorization.

**Goal:** 자료에서 읽기 좋은 편집 문서를 만드는 흐름과 reusable agent templates.
**Architecture:** Existing BlockNote + local-first repository and existing inspector; pure versioned built-in blueprint definitions; existing itinerary read/render contract.
**Tech Stack:** React/TypeScript/Node24/SQLite, existing dependencies only.
**Spec:** docs/superpowers/specs/2026-10-03-document-workflow-design.md

## Global constraints

No commit/push/deploy, no resetting dirty files/data, no API keys in artifacts, no AI/maps paid calls, no share link issuance. Reuse current local autosave/locks and preserve original source documents. Shared/HTML rendering stays private-data safe. Existing branch is the authorized workspace.

## Review focus

- Generated template IDs are fresh; offline creation resumes without duplicate source mutation.
- Default templates do not claim invented bookings, facts, coordinates, or sources.
- Selecting/changing source while async loads finish cannot insert stale source.
- Inserting material during editor conflict/recovery/pending mutation must be blocked.
- Timeline overflow at320px and inline editing on private vs public read-only parity.

### Task 1: Default templates and agent contract

Owner files: shared/documentBlueprints.ts, server blueprint read module + route registration, src/pages/DocumentBlueprintPicker.tsx/css, documentation, focused template tests. Integration points supplied by root. Export blueprints with id/title/icon/description/version/instructions and buildDocumentBlueprint(id, inputs?) returning {title,icon,document}; unique IDs per call; no external requests. API read-only private /api/document-blueprints and /:id. Built-in selector exposes onSelect(payload) and onClose, no direct persistence. Inputs minimal: optional title and travel startDate/days (1–14). Root owns editor/new-page integrations.

- [x] Define reusable registry, validation and meaningful assertions.
- [x] Implement selector, private reads and agent usage guide.
- [x] Test fresh IDs, date boundaries, supported BlockNote/itinerary JSON, facts placeholders, API private-only; review.

### Task 2: Travel readability

Owner files: public/itinerary-timetable.css, shared/itineraryReading.ts if needed, src/pages/ItineraryPreview.tsx and src/pages/itinerary.css only where necessary; no schema changes. Read and preserve both renderers. Root handles actual content transformation.

- [x] Inspect current preview/inline/public flows and identify focused information-order/spacing changes.
- [x] Implement private/public compatible travel reading improvements preserving full notes and edit positions.
- [x] Verify actual fixtures320/390/1440 light/dark, existing itinerary reading/edit/public tests; review.

### Task 3: Integration and source panel

Owner root: src/pages/PageEditor.tsx, PageWorkspace.tsx, new PageMaterialsPanel.tsx/css, inspector hookups and tests; blueprint entry points. Read local memo/page endpoints and AI result reads; source changes cancel stale loads. Explicit selected-text or plain text insertion through editor APIs; no metadata/raw file copy. Builtin insertion on blankpage or new page preserves working draft.

- [x] Integrate blueprint selection in new-page/empty-page and existing templates affordance.
- [x] Implement reference search/read panel and safe explicit insertion into editor.
- [x] Test original unchanged, saving/reopening, lock guards, keyboard/mobile, async stale responses.

### Task 4: Travel sample and verification

- [x] Inspect existing Kansai source, back up before any update, preserve IDs/coordinates/map metadata and all factual content.
- [x] Apply focused structural/text readability edits with expectedVersion or keep existing content if no safe benefit; write a concrete new template-based example if needed.
- [x] Build, relevant tests + browser QA, independent final review and one focused fixes pass; document evidence/remaining limits.
