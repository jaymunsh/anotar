# Prompt preview implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement the approved preview in this workspace. Preserve existing changes; no commit was requested.

**Goal:** Feel the prompt manager and capture AI request controls without an AI/API integration.

**Architecture:** A small browser template library supplies the capture controls and a lazy `/prompts` workspace. Templates persist in `localStorage`; captures keep their existing save API. Preview substitutes user input once and never fetches URLs, calls a model, or creates a job/result.

**Tech Stack:** Existing React, TypeScript, Vite, lucide-react, Node test runner and Chrome QA. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-ai-request-harness-design.md` describes the eventual system. This preview intentionally stops before server template storage, immutable revisions, jobs and provider integration, per the latest user request.

## Constraints and review focus

- Keep the paper/forest and charcoal/sage tokens; verify 320px, 390px and desktop.
- Template fields: name (80), description (200), kind (`research`/`free`), body (10,000). Known variables: `{{url}}`, `{{content}}`, `{{memo}}`.
- User input containing placeholders must not be substituted again. Unknown variables show an actionable error.
- Saving must report storage failures and preserve the draft. Compare versions before replacing another tab's template.
- Archive/restore and duplicate must work; archiving all templates must not bring defaults back.
- Going to prompt management and back must preserve the memo and AI settings. Unsaved template drafts remain while navigating inside the app.
- No pretend AI completion; the capture save control and feedback clearly describe saving only.

## Tasks

### 1. Template library

- [x] Test one-pass substitution, unsupported variables, persistent edits/archives, stale saves, corrupt/quota failures.
- [x] Implement `src/prompts/templates.ts` and `usePromptLibrary.ts`, with three editable starter templates and no network code.

### 2. UI preview

- [x] Add lazy `PromptWorkspace.tsx` with list, edit, duplicate, archive/restore, input preview and clipboard copy.
- [x] Add lazy `AiRequestFields.tsx` under the capture checkbox. Use one template dropdown, optional extra request and inline preview.
- [x] Connect shell navigation, preserve drafts, and style with existing theme tokens in `prompts.css`.

### 3. Verification and documentation

- [x] Run unit tests and full build/Chrome QA against temporary data, including prompt persistence and no URL/AI requests.
- [x] Inspect desktop/mobile screenshots in both themes; fix concrete layout failures.
- [x] Update current implementation, agent guidance and design documentation to distinguish this browser preview from the future server/AI system.

## Progress

- Scope ruling: browser persistence replaces the earlier proposed server template API for this UI preview, matching the user's narrower request. No external or new backend integration.
- Template tests: expected missing-module RED → 4/4 GREEN. Direct request URL duplication: behavior regression RED → 5/5 GREEN. Full suite: 27/27.
- `npm run qa`: build and Capture/Page/Task/Prompt Chrome integration passed, using temporary data and isolated browser contexts. Initial preview network assertion included existing Google Fonts requests; narrowed that assertion to research URLs/external services while allowing existing font assets.
- Independent read-only review: approved, no blockers. Deferred minor: variable error guidance mentions the two primary tokens but not the supported `memo` alias; supported tokens are documented here and in current implementation.
- Visual round 1: desktop light/dark legible; 320px capture tab labels wrap. The 390px capture caught the existing sidebar resize transition; QA now waits for its closed position and captures mobile viewports.
- Mobile tab regression: 320px label-height assertion RED → smaller horizontal padding, no wrapping and fixed icon width → targeted Chrome QA GREEN. Final build and formatting/diff checks passed. Visual round 2 confirmed 390px prompt management and 320px expanded AI preview with the save footer visible; no further visual iteration.
- Existing local dev servers remain on 5173/8787. Opened and inspected `/prompts` in Orca's embedded browser; three actual starter templates are visible. Tests did not touch real `data/`. No commit made.

## Approved usability follow-up (2026-09-28)

User approved memo/AI-setting and template draft recovery, mobile body-first editing with a context save action, and last template memory for research/free input. Existing flows and browser prototype scope remain; no AI/provider API is added.

- [x] Add per-tab text drafts with a 250ms debounce and immediate pagehide/visibility flush; IndexedDB attachment bytes with progress/error handling.
- [x] Keep input typed during an in-flight Capture save; clear only the unchanged submitted draft after success.
- [x] Persist unsaved template drafts with their original expected version, and remember research/free choices independently.
- [x] Put mobile body before collapsed metadata, replace capture dock with template actions, and keep actions above visual viewport changes/hidden under menu.
- [x] Record browser-origin migration limits and local-to-N100 Docker/data/environment steps in current/architecture documents.
- [x] Complete fresh build, full browser QA, visual checks and independent read-only review.

Verification: baseline refresh scenario RED; helper tests 4/4 GREEN, full unit suite 31/31. Final `npm run qa` exited 0 after fresh build and Capture/Page/Task/Prompt/Draft Chrome scenarios, using temporary data. Reviewer found variable insertion could exceed 10,000 and invalidate recovery; reproduced 9,995→10,006 (RED), bounded insertion and confirmed refresh keeps 9,995 (GREEN). Stale template archive could promote an old draft version; reproduced archived=true (RED), compared the preserved expected version and confirmed refusal/latest body/draft preservation (GREEN). The old mobile navigation assertion now accepts **바로 기록하기** and **이어서 기록하기**, because restored drafts correctly change the label. Desktop light/dark, 390px light and 320px dark were visually checked; 320px header wrapping was fixed. Formatting and diff checks passed. Current initial JS is 285.67 kB raw / 89.17 kB gzip; page editor remains lazy. Physical-phone keyboard and N100 Linux/amd64 execution remain target-environment checks. Existing dev servers and actual Orca `/prompts` tab remain ready. No commit requested or created.
