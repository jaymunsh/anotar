# 서버 이전 전 완성 Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development and dispatching-parallel-agents for independently owned features. No commits/pushes/data resets are requested.

**Goal:** Complete personal workflows and verify the local deployment artifact before N100 transfer.
**Architecture:** Indexed SQLite feature stores, lazy private surfaces, explicit public projection, private/public containers with a narrow comment socket.
**Tech Stack:** React 19 / TypeScript / Node 24 / SQLite / Vite / Docker Compose.
**Spec:** docs/superpowers/specs/2026-09-30-migration-ready-design.md

## Global constraints
Preserve all existing dirty changes and actual data. No provider calls. Personal API loopback only. No public IDs, private data or SDK. Existing schemaVersion 1. Each worker owns its files and records tests/diff scope.

## Tasks and interfaces
- [x] Task 1 — global shared comments: worker owns server/sharedCommentInbox.mjs, src/comments/*, tests/qa for inbox, PageEditor deep-link integration. Produces createSharedCommentInboxStore(db, owner), listSharedCommentInbox(options), markSharedCommentRead(input), CommentsWorkspace/CommentsAttention onNavigate. Root wires store/index/main.
- [x] Task 2 — plan connections: worker owns server/planConnections.mjs, src/pages/PlanConnections*, ItineraryBlock/context bridge, public projection/render/export, own tests/QA. Root wires store/index and page context if requested. Task source/version rules and explicit share projection tested.
- [x] Task 3 — mobile collection: worker owns src/capture/*, public capture assets/worker/manifest, own tests/QA. Produces mobile capture import hooks/widgets. Root wires main/index and private HTTP if requested. Safe draft collision and no public routes tested.
- [x] Task 4 — deploy/restore: root owns Dockerfile/compose/scripts/qa-docker-share.mjs/scripts migration preflight, .env.example/docs. Test temporary Docker volumes, IPC comments, restart/restore, isolated public routes and data persistence.
- [x] Task 5 — integration: root wires shared files, runs full tests/build/target browser QA, scoped independent review, fixes findings, updates documents and evidence.

## Preflight interface conflicts
| Tasks | Shared interface | Ownership |
|---|---|---|
| 1 / 2 / 3 | server/index.mjs, server/store.mjs, src/main.tsx | root only; workers provide contracts |
| 1 / 2 | PageEditor | Task 1 owns edits; Task 2 provides context wrapper snippet |
| 2 / 4 | public render/export / deployment | distinct files, explicit selected projection |
| 3 / 4 | manifest/worker / Docker assets | root Docker includes build public assets |

## Review focus
Guest messages during read marking; hidden/revoked/deleted public content; stale task/page versions and dangling anchors; existing mobile draft on share receive; production backup CLI dependencies and restored DB socket path.

For each feature write a meaningful failing test, implement, run scoped tests and browser scenarios, record files and evidence. Then root runs npm test, npm run build, migration browser QA, docker boundary QA, backup create/verify/restore, independent review. Avoid optional repeated polish after verified bounded passes.

## 완료 기록

2026-09-30 로컬 범위 완료. 전체 261개 테스트·빌드·브라우저 회귀·최종 Docker 새 경로 복원/서비스 부팅을 통과했고 독립 검토는 APPROVE다. [마무리 기록](../../../.omo/evidence/migration-ready/REPORT.md)과 [실제 이전 절차](../../DEPLOYMENT.md)를 따른다.
