// Private derived index. SQL triggers keep raw SQLite/sync/revision writes atomic too.
function referenceSelect(document) {
  return `SELECT DISTINCT target FROM (
    SELECT CASE WHEN instr(without_query,'#')>0 THEN substr(without_query,1,instr(without_query,'#')-1)
      ELSE without_query END AS target FROM (
      SELECT CASE WHEN instr(raw_target,'?')>0 THEN substr(raw_target,1,instr(raw_target,'?')-1)
        ELSE raw_target END AS without_query FROM (
    SELECT CASE WHEN json_extract(node.value,'$.type')='page'
      THEN json_extract(node.value,'$.props.pageId')
      ELSE substr(json_extract(node.value,'$.href'),8) END AS raw_target
    FROM json_tree(${document}) node WHERE node.type='object' AND (
      (json_extract(node.value,'$.type')='page' AND json_type(node.value,'$.props.pageId')='text') OR
      (json_extract(node.value,'$.type')='link' AND json_type(node.value,'$.href')='text'
        AND json_extract(node.value,'$.href') LIKE '/pages/%')
    )
    ))
  ) WHERE length(target) BETWEEN 1 AND 100 AND target NOT GLOB '*[^a-f0-9-]*'`;
}

export function createPageBacklinks(db) {
  db.exec('SAVEPOINT page_backlinks_init');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS page_backlinks (
      source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL, PRIMARY KEY(target_id,source_id)
    );
    CREATE INDEX IF NOT EXISTS page_backlinks_source ON page_backlinks(source_id);
    CREATE TABLE IF NOT EXISTS page_backlink_migrations (name TEXT PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS page_backlinks_insert AFTER INSERT ON pages BEGIN
      INSERT OR IGNORE INTO page_backlinks SELECT new.id,target FROM (${referenceSelect('new.document')});
    END;
    CREATE TRIGGER IF NOT EXISTS page_backlinks_update AFTER UPDATE OF document ON pages BEGIN
      DELETE FROM page_backlinks WHERE source_id=new.id;
      INSERT OR IGNORE INTO page_backlinks SELECT new.id,target FROM (${referenceSelect('new.document')});
    END;
    CREATE TRIGGER IF NOT EXISTS page_backlinks_delete AFTER DELETE ON pages BEGIN
      DELETE FROM page_backlinks WHERE source_id=old.id;
    END;`);
    if (!db.prepare("SELECT 1 FROM page_backlink_migrations WHERE name='links-v1'").get()) {
      const insert = db.prepare(`INSERT OR IGNORE INTO page_backlinks
        SELECT ?,target FROM (${referenceSelect('?')})`);
      for (const page of db.prepare('SELECT id,document FROM pages').iterate())
        insert.run(page.id, page.document);
      db.prepare("INSERT INTO page_backlink_migrations VALUES ('links-v1')").run();
    }
    db.exec('RELEASE page_backlinks_init');
  } catch (error) {
    db.exec('ROLLBACK TO page_backlinks_init; RELEASE page_backlinks_init');
    throw error;
  }
  return {
    listPageBacklinks(pageId, { limit = 20, offset = 0 } = {}) {
      limit = Number.isSafeInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
      offset = Number.isSafeInteger(offset) ? Math.min(100000, Math.max(0, offset)) : 0;
      // Deleted target pages have no usable connections. Never return page bodies.
      const items = db
        .prepare(
          `SELECT p.id,p.title,p.icon,p.updated_at AS updatedAt
        FROM page_backlinks b JOIN pages p ON p.id=b.source_id
        WHERE b.target_id=? AND p.id<>? AND p.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM pages WHERE id=? AND deleted_at IS NULL)
        ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`,
        )
        .all(pageId, pageId, pageId, limit + 1, offset);
      const hasMore = items.length > limit;
      return { items: items.slice(0, limit), nextOffset: hasMore ? offset + limit : null };
    },
  };
}
