import { getSyncSession, syncDatabase } from './store.mjs';
import { pageTransaction } from '../pageConnections.mjs';
const tables = { capture: 'captures', page: 'pages', task: 'tasks', journal: 'journal_days' };
export function initializeSyncFeed(db) {
  for (const [kind, table] of Object.entries(tables)) {
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
    if (!columns.has('client_created_at'))
      db.exec(`ALTER TABLE ${table} ADD COLUMN client_created_at TEXT`);
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = action === 'DELETE' ? 'OLD' : 'NEW';
      const tombstone =
        action === 'DELETE'
          ? "'tombstone'"
          : kind === 'task'
            ? "'upsert'"
            : `CASE WHEN ${row}.deleted_at IS NULL THEN 'upsert' ELSE 'tombstone' END`;
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN
        INSERT INTO sync_changes(entity_kind,entity_id,action) VALUES('${kind}',${row}.id,${tombstone}); END;`);
    }
  }
  for (const table of ['assets', 'ai_jobs'])
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const rows = action === 'UPDATE' ? ['OLD', 'NEW'] : [action === 'DELETE' ? 'OLD' : 'NEW'];
      const statements = rows
        .flatMap((row) =>
          ['capture', 'page'].map(
            (kind) => `INSERT INTO sync_changes(entity_kind,entity_id,action)
      SELECT '${kind}',${row}.${kind}_id,'upsert' WHERE ${row}.${kind}_id IS NOT NULL;`,
          ),
        )
        .join('\n');
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS sync_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN ${statements} END;`,
      );
    }
}
function entityTable(kind) {
  if (!tables[kind])
    throw Object.assign(new Error('올바른 자료 종류를 선택해 주세요.'), { status: 422 });
  return tables[kind];
}
export function readSyncChanges(db, { after = 0, limit = 100 } = {}) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw Object.assign(new Error('동기화 위치가 올바르지 않아요.'), { status: 422 });
  return pageTransaction(db, () => {
    const { epoch, headSeq } = getSyncSession(db);
    const changes = db
      .prepare(
        'SELECT seq,entity_kind AS entityKind,entity_id AS entityId,action FROM sync_changes WHERE seq>? ORDER BY seq LIMIT ?',
      )
      .all(after, Math.min(100, limit));
    return { epoch, headSeq, nextAfter: changes.at(-1)?.seq ?? after, changes };
  });
}
export function readSyncEntity(store, kind, id, { metadata = false } = {}) {
  const table = entityTable(kind),
    db = syncDatabase(store);
  return pageTransaction(db, () => {
    const columns =
      kind === 'page' && metadata
        ? 'id,title,icon,parent_id,position,version,created_at,updated_at,client_created_at,deleted_at'
        : '*';
    const row = db.prepare(`SELECT ${columns} FROM ${table} WHERE id=?`).get(id),
      session = getSyncSession(db),
      readSeq = session.headSeq;
    const tombstone = Boolean(!row || row.deleted_at);
    const item = tombstone
      ? null
      : kind === 'page' && metadata
        ? {
            id: row.id,
            title: row.title,
            icon: row.icon,
            parentId: row.parent_id,
            position: row.position,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : store[{ capture: 'getCapture', page: 'getPage', task: 'getTask', journal: 'getJournal' }[kind]](id);
    if (item) item.clientCreatedAt = row.client_created_at ?? null;
    return {
      workspaceId: session.workspaceId,
      epoch: session.epoch,
      entityKind: kind,
      entityId: id,
      item,
      version: row?.version ?? null,
      readSeq,
      tombstone,
      missing: !row,
    };
  });
}
export function bootstrapSync(store, { kind, afterId = '', limit = 100 }) {
  const table = entityTable(kind),
    db = syncDatabase(store);
  if (
    typeof afterId !== 'string' ||
    afterId.length > 100 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw Object.assign(new Error('목록 요청이 올바르지 않아요.'), { status: 422 });
  const count = Math.min(100, limit);
  return pageTransaction(db, () => {
    const rows = db
      .prepare(
        `SELECT id FROM ${table} WHERE id>? ${kind === 'task' ? '' : 'AND deleted_at IS NULL'} ORDER BY id LIMIT ?`,
      )
      .all(afterId, count + 1);
    const items = rows.slice(0, count).map(({ id }) => {
      const item = readSyncEntity(store, kind, id, { metadata: kind === 'page' }).item;
      if (kind === 'page') delete item.document;
      return item;
    });
    const session = getSyncSession(db);
    return { workspaceId:session.workspaceId,epoch:session.epoch,items, nextAfterId: rows.length > count ? items.at(-1).id : null };
  });
}
