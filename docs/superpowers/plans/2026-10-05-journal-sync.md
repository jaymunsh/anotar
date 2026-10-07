# Journal implementation plan

1. Add shared typed day validation/normalization and deterministic workspace/date identity. Add server journal schema/store and extend existing sync capabilities, feed, route validation and operation dispatch. Migrate the sync feed CHECK additively without dropping sequence/history/triggers.
2. Extend existing client operation dispatch and journal bootstrap for already connected clients. Add journal storage adapter using existing queueValue/repository, accepted-view revision/base checks and idempotent archival migration. Bind the legacy source once per device, preserve dirty local queues, and provide explicit local-copy migration choices. Integrate controller adapter and preserve preview-only storage.
3. Add stable priority links, desktop drop plus accessible planning button, immutable snapshots and explicit plan-again. Extend week/month/review readouts using existing layout tokens.
4. Extend recovery journal handling and archival export. Test fixture backup restore, sync operations and migration. Browser QA offline/reconnect, focused cross-device/same-device conflict, late ACK, dirty-local migration choice, workspace isolation, app/preview mobile/dark; run typecheck/build and report limitations.

Implemented all four steps. Final evidence and practical limits are recorded in `.omo/evidence/journal-sync/REPORT.md`.
