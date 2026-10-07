# Private authentication implementation plan

> For agentic workers: use superpowers:executing-plans for inline implementation.

Goal: single-owner password/TOTP authentication with remembered browsers and preserved offline work.
Architecture: additive SQLite auth store, HTTP guard before all private routes, small browser auth surface preserving the mounted workspace.
Tech Stack: Node24 crypto/sqlite, React/TypeScript, existing sync engine.
Spec: ../specs/2026-10-04-private-auth-design.md

## Global constraints

Approved scope in conversation; proceed without repeated design permission. Existing dirty feature checkout is the source of current implementation; work in place, do not reset or commit unrelated work. Product data/secrets never used by tests. Keep secrets outside logs; no production deployment this task. Execution ledger at .omo/evidence/private-auth/PROGRESS.md. One independent final review after implementation, no per-task delegation.

## Task 1: Auth core

Files: server/auth/crypto.mjs, store.mjs, service.mjs; server/store.mjs binding; test/auth.test.mjs.
Produces: createAuthenticator({store,key,clock,secure}) and store.auth additive persistence.
Consumes: store.syncSession epoch.
- [x] Write behavior tests for password/TOTP/encryption and session/trust/recovery/expiry/revocation.
- [x] Run RED; implement contract; run GREEN.
Expected: node --test test/auth.test.mjs exit0; old store data intact.

## Task 2: Server guard and provisioning

Files: server/auth/routes.mjs, server/index.mjs, scripts/auth-setup.mjs, package.json, Dockerfile/compose.yaml/.env.example; test/auth-api.test.mjs.
Produces: /api/auth/status, login, logout, devices, reauth, revoke; all private routes require sessions in required mode.
Consumes: Task1 APIs, privateRequest guard.
- [x] Write real HTTP tests proving unconfigured/unauthenticated deny before mutations and authenticated access/CSRF/rotation.
- [x] Run RED; implement; GREEN plus private-request regression.
- [x] Add local interactive setup, OTP confirmation, recovery output only terminal. Document key and backup boundaries.
Expected: auth API tests exit0; no key/account means deny personal API, shell/status/health usable.

## Task 3: Browser login, device settings and offline behavior

Files: src/auth/*, src/main.tsx, src/settings/WorkspaceSettings.tsx, src/sync/{transport,runtime,SyncStatus}.tsx/ts, scripts/qa-private-auth.mjs; docs/AUTHENTICATION.md and implementation docs.
Consumes: Task2 endpoints and existing access/outbox states.
Produces: small login panel; first-login gate; expiry banner with modal login preserving workspace; settings security/device revoke; queue resume.
- [x] Add regression test401 queued operation remains with identical UUID and reconnect successful.
- [x] RED→GREEN, build; actual temporary Chrome QA desktop/mobile/light/dark and login/expiry/logout/edit-preservation scenarios.
- [x] Run npm test; review code with one fresh-context reviewer; fix important findings via RED→GREEN.
Expected: build and whole suite exit0; real browser QA evidence, remote/phone limitations recorded.
