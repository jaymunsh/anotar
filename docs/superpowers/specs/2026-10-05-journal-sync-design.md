# Journal sync and linked planning

Authorized extension of the existing journal controller and workspace protocol. Keep 00:00–24:00, ten minute editing and the standalone preview sample storage. Do not add dragging an empty area to create plans.

Each workspace/date has one typed `journal` entity, a deterministic UUID, schema version 1, a server version, and the existing IndexedDB entity/outbox/conflict lifecycle. SQLite enforces workspace/date uniqueness; the private authenticated `/api/sync` routes are the only transport. Existing workspace bindings also bootstrap journal data once. Whole-day conflicts preserve local/base/server copies and require a user choice; no automatic merge.

Priorities receive stable IDs. Dragging a nonempty priority onto the timetable creates a separate plan with priority ID, source date, and immutable title snapshot. Multiple plans can refer to one priority. Plan deletion/missed marking never changes priority completion. Review offers explicit planning again with a date/time dialog and a new plan ID/source reference; the old missed record remains.

Weekly comparison shows priority titles/completion, planned duration, missed titles and feedback. Monthly view retains marked calendar and adds a continuous dated feedback list. Existing old `actual` entries remain stored, hidden as before.

Idempotent migration archives exact `anotar:journal:v1` JSON in existing IndexedDB meta. A device-wide source owner binds this legacy key to the active workspace before initialization or workspace reset can import it; retained or changed source JSON is never automatically copied into another workspace. Empty dates use the existing outbox. A collision with a clean server date uses the existing explicit conflict review. A collision with pending local edits keeps the entity and immutable queued operations intact and offers two clearly labeled local copies: keep the current device day, or explicitly queue the legacy day as a new revision. Both copies and the choice remain exportable. Original localStorage and sample storage are retained indefinitely. Invalid migration data is reported and retained.

The storage adapter advances its visible day/base/revision only when the controller accepts that view. Focused input can retain its old view while another tab or device changes the cached day. Saving that input uses the captured visible base and preserves both copies through the existing conflict path. A read-to-queue race also uses an explicit captured base. Own acknowledgements can advance the base when the prior visible day is still identical.

Server journal tables are included in existing SQLite backups. Recovery ZIP retains full JSON, migration archives and conflicts; restored journal IDs retain workspace/date identity.

Verify using temporary databases and isolated Chrome contexts: validation, replay, uniqueness, version conflict, migration repeated/collision preservation, offline/reconnect, late ACK, priority links, plan-again, recovery JSON and backup restore. Verify app and preview at 390px/dark and typecheck/build. Never read secrets or touch actual data.
