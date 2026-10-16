import {
  journalId,
  validJournalDate,
  validateJournalDay,
  JournalValidationError,
} from '../shared/journal.mjs';
export class JournalConflictError extends Error {}
export function createJournalStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS journal_days (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, date TEXT NOT NULL,
    day TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    client_created_at TEXT, deleted_at TEXT,
    UNIQUE(workspace_id,date)
  );`);
  const hydrate = (row) =>
    row
      ? {
          id: row.id,
          date: row.date,
          day: JSON.parse(row.day),
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          clientCreatedAt: row.client_created_at ?? null,
        }
      : null;
  const verify = (workspaceId, date, id, day) => {
    if (!validJournalDate(date) || journalId(workspaceId, date) !== id)
      throw new JournalValidationError('일지 식별자와 날짜가 일치하지 않아요.');
    return JSON.stringify(validateJournalDay(day));
  };
  return {
    getJournal(id) {
      return hydrate(
        db.prepare('SELECT * FROM journal_days WHERE id=? AND deleted_at IS NULL').get(id),
      );
    },
    createJournal({ id, workspaceId, date, day }) {
      const document = verify(workspaceId, date, id, day),
        now = new Date().toISOString();
      db.prepare(
        'INSERT INTO journal_days(id,workspace_id,date,day,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',
      ).run(id, workspaceId, date, document, now, now);
      return this.getJournal(id);
    },
    updateJournal({ id, workspaceId, date, day, expectedVersion }) {
      const document = verify(workspaceId, date, id, day);
      const result = db
        .prepare(
          'UPDATE journal_days SET day=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND date=? AND version=? AND deleted_at IS NULL',
        )
        .run(document, new Date().toISOString(), id, workspaceId, date, expectedVersion);
      if (!result.changes) throw new JournalConflictError('다른 곳에서 먼저 일지를 수정했어요.');
      return this.getJournal(id);
    },
  };
}
