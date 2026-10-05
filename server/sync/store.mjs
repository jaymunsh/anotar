import { randomUUID } from 'node:crypto';

// Identity belongs to the database, not a process, host name, or browser.
export function initializeSync(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      protocol_version INTEGER NOT NULL CHECK(protocol_version=1),
      workspace_id TEXT NOT NULL, epoch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_kind TEXT NOT NULL CHECK(entity_kind IN ('capture','page','task','journal')),
      entity_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('upsert','tombstone')),
      server_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sync_receipts (
      workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, device_id TEXT NOT NULL,
      request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(workspace_id,operation_id)
    );
    CREATE TABLE IF NOT EXISTS sync_uploads (
      upload_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL,
      content_hash TEXT NOT NULL, size INTEGER NOT NULL,
      name TEXT NOT NULL, mime TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','consumed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS sync_changes_entity ON sync_changes(entity_kind,entity_id,seq);
    CREATE INDEX IF NOT EXISTS sync_uploads_operation ON sync_uploads(operation_id);
  `);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='sync_changes'").get().sql;
  if (!schema.includes("'journal'")) {
    // SQLite cannot extend a CHECK in place. Preserve sequence, history and
    // every dependent trigger before replacing this one additive feed table.
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%sync_changes%'").all();
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='sync_changes' AND sql IS NOT NULL").all();
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='sync_changes'").get()?.seq ?? 0;
    db.exec('SAVEPOINT journal_sync_feed_migration');
    try {
      for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"','""')}"`);
      db.exec(`CREATE TABLE sync_changes_journal_upgrade (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_kind TEXT NOT NULL CHECK(entity_kind IN ('capture','page','task','journal')),
        entity_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('upsert','tombstone')),
        server_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO sync_changes_journal_upgrade SELECT seq,entity_kind,entity_id,action,coalesce(server_time,strftime('%Y-%m-%dT%H:%M:%fZ','now')) FROM sync_changes;
      DROP TABLE sync_changes;
      ALTER TABLE sync_changes_journal_upgrade RENAME TO sync_changes;`);
      db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'sync_changes',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='sync_changes')").run(sequence);
      db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='sync_changes'").run(sequence);
      for (const index of indexes) db.exec(index.sql);
      for (const trigger of triggers) db.exec(trigger.sql);
      db.exec('RELEASE journal_sync_feed_migration');
    } catch (error) {
      db.exec('ROLLBACK TO journal_sync_feed_migration; RELEASE journal_sync_feed_migration');
      throw error;
    }
  }
  db.prepare('INSERT OR IGNORE INTO sync_meta VALUES(1,1,?,?)').run(randomUUID(), randomUUID());
}

export function getSyncSession(db, capabilities = []) {
  const identity = db
    .prepare(
      'SELECT protocol_version AS protocolVersion, workspace_id AS workspaceId, epoch FROM sync_meta WHERE singleton=1',
    )
    .get();
  return {
    ...identity,
    headSeq: Number(db.prepare('SELECT coalesce(max(seq),0) AS seq FROM sync_changes').get().seq),
    capabilities,
    serverTime: new Date().toISOString(),
  };
}
export function rotateSyncEpochAfterRestore(db) {
  initializeSync(db);
  const epoch = randomUUID();
  db.prepare('UPDATE sync_meta SET epoch=? WHERE singleton=1').run(epoch);
  // These temporary files are not committed assets and are not part of the backup.
  db.prepare("DELETE FROM sync_uploads WHERE state='staged'").run();
  return epoch;
}

// Runtime DB handles stay private; not exposed on API entities or serializeable store values.
const databases = new WeakMap();
export function bindSyncStore(store, db) {
  databases.set(store, db);
}
export function syncDatabase(store) {
  const db = databases.get(store);
  if (!db) throw new Error('Sync store is not initialized');
  return db;
}
