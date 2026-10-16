import {initializeExtendedSearch} from './searchExtensions.mjs';
import { pageTransaction } from './pageConnections.mjs';
import {
  encodeSearchText,
  encodeSearchCharacters,
  foldSearchText,
  registerSearchFunctions,
  searchSnippet,
} from './searchText.mjs';

export class SearchValidationError extends Error {
  name = 'SearchValidationError';
}
const types = ['all', 'memo', 'ai', 'page', 'file', 'task', 'result', 'ocr'];
const fields =
  'target_kind, target_id, category, title, body, url, icon, kind, created_at, updated_at';
const upsert = `ON CONFLICT(target_kind, target_id) DO UPDATE SET
 category=excluded.category, title=excluded.title, body=excluded.body, url=excluded.url,
 icon=excluded.icon, kind=excluded.kind, created_at=excluded.created_at, updated_at=excluded.updated_at`;
const visible = `(c.id IS NOT NULL AND c.deleted_at IS NULL AND c.organized_at IS NULL) OR EXISTS (
 SELECT 1 FROM page_references r JOIN pages p ON p.id=r.page_id
 WHERE r.target_type='asset' AND r.target_id=a.id AND p.deleted_at IS NULL)`;
const captureSelect = `SELECT 'capture', c.id, CASE WHEN c.ai_request IS NULL THEN 'memo' ELSE 'ai' END,
 '', search_capture_text(c.text, c.url, c.ai_request), COALESCE(c.url,''), '', c.kind, c.created_at, c.updated_at
 FROM captures c WHERE c.deleted_at IS NULL AND c.organized_at IS NULL`;
const pageSelect = `SELECT 'page', p.id, 'page', p.title, search_page_text(p.document), '', p.icon, '', p.created_at, p.updated_at
 FROM pages p WHERE p.deleted_at IS NULL`;
const assetSelect = `SELECT 'asset', a.id, 'file', a.name, '', '', '', a.mime,
 COALESCE(c.created_at,o.created_at), COALESCE(c.updated_at,o.updated_at)
 FROM assets a LEFT JOIN captures c ON c.id=a.capture_id LEFT JOIN pages o ON o.id=a.page_id WHERE (${visible})`;

function syncCapture(condition) {
  return `INSERT INTO search_documents (${fields}) ${captureSelect} AND (${condition}) ${upsert};
 DELETE FROM search_documents WHERE target_kind='capture' AND target_id IN
 (SELECT c.id FROM captures c WHERE (${condition}) AND (c.deleted_at IS NOT NULL OR c.organized_at IS NOT NULL));`;
}
function syncPage(condition) {
  return `INSERT INTO search_documents (${fields}) ${pageSelect} AND (${condition}) ${upsert};
 DELETE FROM search_documents WHERE target_kind='page' AND target_id IN
 (SELECT p.id FROM pages p WHERE (${condition}) AND p.deleted_at IS NOT NULL);`;
}
function syncAsset(condition) {
  return `INSERT INTO search_documents (${fields}) ${assetSelect} AND (${condition}) ${upsert};
 DELETE FROM search_documents WHERE target_kind='asset' AND target_id IN
 (SELECT a.id FROM assets a LEFT JOIN captures c ON c.id=a.capture_id WHERE (${condition}) AND NOT (${visible}));`;
}

export function createSearchStore(db) {
  registerSearchFunctions(db);
  let rebuiltPrimary = false;
  let rebuildExtras = () => {};
  pageTransaction(db, () => {
    db.exec('CREATE TABLE IF NOT EXISTS search_schema_migrations(name TEXT PRIMARY KEY)');
    const pageAssetsMigration = !db
      .prepare("SELECT name FROM search_schema_migrations WHERE name='page-assets-v1'")
      .get();
    const itineraryMigration = !db
      .prepare("SELECT name FROM search_schema_migrations WHERE name='itinerary-text-v1'")
      .get();
    const existingColumns = db.prepare('PRAGMA table_info(search_fts)').all();
    const migrating =
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='search_meta'").get() &&
      db.prepare('SELECT version FROM search_meta WHERE id=1').get()?.version !== 3;
    if (migrating || pageAssetsMigration)
      db.exec(
        'DROP TRIGGER IF EXISTS search_capture_update; DROP TRIGGER IF EXISTS search_capture_insert; DROP TRIGGER IF EXISTS search_asset_insert; DROP TRIGGER IF EXISTS search_asset_update; DROP TRIGGER IF EXISTS search_reference_insert; DROP TRIGGER IF EXISTS search_reference_delete; DROP TRIGGER IF EXISTS search_page_update;',
      );
    if (existingColumns.length && !existingColumns.some((column) => column.name === 'characters')) {
      db.exec(`DROP TRIGGER IF EXISTS search_document_insert;
      DROP TRIGGER IF EXISTS search_document_update;
      DROP TRIGGER IF EXISTS search_document_delete;
      DROP TABLE search_fts;
      DELETE FROM search_meta;`);
    }
    db.exec(`
 CREATE TABLE IF NOT EXISTS search_documents (
   row_id INTEGER PRIMARY KEY, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
   category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL,
   icon TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
   UNIQUE(target_kind,target_id)
 );
 CREATE INDEX IF NOT EXISTS search_recent ON search_documents(updated_at DESC,row_id DESC);
 CREATE INDEX IF NOT EXISTS search_category_recent ON search_documents(category,updated_at DESC,row_id DESC);
 CREATE TABLE IF NOT EXISTS search_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
 INSERT OR IGNORE INTO search_state VALUES (1,0);
 CREATE TABLE IF NOT EXISTS search_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(title,body,url,category,characters,content='',contentless_delete=1);
 INSERT INTO search_fts(search_fts,rank) VALUES('rank','bm25(10.0,1.0,3.0,0.0,0.0)');
 CREATE TRIGGER IF NOT EXISTS search_document_insert AFTER INSERT ON search_documents BEGIN
   INSERT INTO search_fts(rowid,title,body,url,category,characters) VALUES(NEW.row_id,search_tokens(NEW.title),search_tokens(NEW.body),search_tokens(NEW.url),'t'||NEW.category,search_characters(NEW.title||char(10)||NEW.body||char(10)||NEW.url));
   UPDATE search_state SET revision=revision+1 WHERE id=1;
 END;
 CREATE TRIGGER IF NOT EXISTS search_document_update AFTER UPDATE ON search_documents BEGIN
   DELETE FROM search_fts WHERE rowid=OLD.row_id;
   INSERT INTO search_fts(rowid,title,body,url,category,characters) VALUES(NEW.row_id,search_tokens(NEW.title),search_tokens(NEW.body),search_tokens(NEW.url),'t'||NEW.category,search_characters(NEW.title||char(10)||NEW.body||char(10)||NEW.url));
   UPDATE search_state SET revision=revision+1 WHERE id=1;
 END;
 CREATE TRIGGER IF NOT EXISTS search_document_delete AFTER DELETE ON search_documents BEGIN
   DELETE FROM search_fts WHERE rowid=OLD.row_id;
   UPDATE search_state SET revision=revision+1 WHERE id=1;
 END;
 CREATE TRIGGER IF NOT EXISTS search_capture_insert AFTER INSERT ON captures BEGIN ${syncCapture('c.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_capture_update AFTER UPDATE OF text,url,ai_request,deleted_at,organized_at ON captures BEGIN
   ${syncCapture('c.id=NEW.id')} ${syncAsset('a.capture_id=NEW.id')}
 END;
 CREATE TRIGGER IF NOT EXISTS search_capture_delete AFTER DELETE ON captures BEGIN
   DELETE FROM search_documents WHERE target_kind='capture' AND target_id=OLD.id;
 END;
 CREATE TRIGGER IF NOT EXISTS search_page_insert AFTER INSERT ON pages BEGIN ${syncPage('p.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_page_update AFTER UPDATE OF title,document,icon,deleted_at ON pages BEGIN
   ${syncPage('p.id=NEW.id')}
   ${syncAsset("a.page_id=NEW.id OR a.id IN (SELECT target_id FROM page_references WHERE page_id=NEW.id AND target_type='asset')")}
 END;
 CREATE TRIGGER IF NOT EXISTS search_page_delete AFTER DELETE ON pages BEGIN
   DELETE FROM search_documents WHERE target_kind='page' AND target_id=OLD.id;
 END;
 CREATE TRIGGER IF NOT EXISTS search_asset_insert AFTER INSERT ON assets BEGIN ${syncAsset('a.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_asset_update AFTER UPDATE ON assets BEGIN ${syncAsset('a.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_asset_delete AFTER DELETE ON assets BEGIN
   DELETE FROM search_documents WHERE target_kind='asset' AND target_id=OLD.id;
 END;
 CREATE TRIGGER IF NOT EXISTS search_reference_insert AFTER INSERT ON page_references WHEN NEW.target_type='asset' BEGIN ${syncAsset('a.id=NEW.target_id')} END;
 CREATE TRIGGER IF NOT EXISTS search_reference_delete AFTER DELETE ON page_references WHEN OLD.target_type='asset' BEGIN ${syncAsset('a.id=OLD.target_id')} END;
 `);
    if (
      pageAssetsMigration ||
      itineraryMigration ||
      db.prepare('SELECT version FROM search_meta WHERE id=1').get()?.version !== 3
    )
      rebuildSearchIndex();
    if (pageAssetsMigration)
      db.prepare('INSERT INTO search_schema_migrations(name) VALUES(?)').run('page-assets-v1');
    if (itineraryMigration)
      db.prepare('INSERT INTO search_schema_migrations(name) VALUES(?)').run('itinerary-text-v1');
  });
  rebuildExtras = initializeExtendedSearch(db);
  if (rebuiltPrimary) rebuildExtras();
  function rebuildSearchIndex() {
    rebuiltPrimary = true;
    return pageTransaction(db, () => {
      db.exec(`DELETE FROM search_documents;
       INSERT INTO search_documents (${fields}) ${captureSelect};
       INSERT INTO search_documents (${fields}) ${pageSelect};
       INSERT INTO search_documents (${fields}) ${assetSelect};
       INSERT INTO search_meta VALUES(1,3) ON CONFLICT(id) DO UPDATE SET version=3;
       UPDATE search_state SET revision=revision+1 WHERE id=1;`);
      rebuildExtras();
      db.exec("INSERT INTO search_fts(search_fts) VALUES('integrity-check')");
    });
  }
  const parentStatement = db.prepare(
    'SELECT title,parent_id FROM pages WHERE id=? AND deleted_at IS NULL',
  );
  function pagePath(id) {
    const path = [];
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const row = parentStatement.get(id);
      if (!row) break;
      path.unshift(row.title);
      id = row.parent_id;
    }
    return path.join(' / ');
  }
  const assetContext = db.prepare(`SELECT a.capture_id,
   EXISTS(SELECT 1 FROM captures c WHERE c.id=a.capture_id AND c.deleted_at IS NULL AND c.organized_at IS NULL) AS owner_active,
   (SELECT r.page_id FROM page_references r JOIN pages p ON p.id=r.page_id
    WHERE r.target_type='asset' AND r.target_id=a.id AND p.deleted_at IS NULL ORDER BY p.updated_at DESC,p.id LIMIT 1) AS page_id
   FROM assets a WHERE a.id=?`);
  const captureLabel = db.prepare(
    'SELECT text,url FROM captures WHERE id=? AND deleted_at IS NULL',
  );
  const taskState = db.prepare('SELECT status,in_progress FROM tasks WHERE id=?');
  function result(row, terms) {
    let href = '/' + (row.target_kind === 'page' ? 'pages' : 'captures') + '/' + row.target_id;
    let context =
      row.category === 'ai'
        ? 'AI 요청 원본'
        : row.target_kind === 'page'
          ? pagePath(row.target_id)
          : '메모';
    if (row.target_kind === 'asset') {
      const link = assetContext.get(row.target_id);
      href = link.owner_active ? '/captures/' + link.capture_id : '/pages/' + link.page_id;
      context = link.owner_active ? '메모의 첨부' : pagePath(link.page_id);
    }
    if (row.target_kind === 'task') {
      href = '/tasks?taskId=' + row.target_id;
      const task = taskState.get(row.target_id);
      context = task?.status === 'done' ? '완료한 할 일' : task?.in_progress ? '진행 중 할 일' : '대기 중 할 일';
    }
    if(row.target_kind==='ai_job'){
      const job=db.prepare('SELECT capture_id,page_id FROM ai_jobs WHERE id=?').get(row.target_id);
      href=(job.page_id?'/pages/'+job.page_id:'/captures/'+job.capture_id)+'?aiJob='+row.target_id;context='완료된 AI 결과';
    }
    if(row.target_kind==='ocr'){
      const asset=db.prepare('SELECT asset_id FROM ocr_jobs WHERE id=?').get(row.target_id),link=assetContext.get(asset.asset_id);
      href=(link.owner_active?'/captures/'+link.capture_id:'/pages/'+link.page_id)+'?ocrAsset='+asset.asset_id+'&ocrJob='+row.target_id;context='이미지 인식 텍스트';
    }
    const original = row.target_kind === 'capture' ? captureLabel.get(row.target_id) : null;
    const label = original
      ? searchSnippet(original.text || original.url, [], 180) || '첨부 메모'
      : row.title;
    const previewTerms = terms.filter((term) => !foldSearchText(label).includes(term));
    return {
      id: row.target_id,
      type: row.category,
      label,
      snippet:
        original && !previewTerms.length
          ? ''
          : searchSnippet(row.body || row.url, original ? previewTerms : terms),
      icon: row.icon,
      kind: row.kind,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      href,
      context,
    };
  }
  return {
    rebuildSearchIndex,
    searchRecords({ query = '', type = 'all', cursor = null } = {}) {
      if (typeof query !== 'string' || query.length > 160)
        throw new SearchValidationError('검색어는 160자까지 입력해 주세요.');
      if (!types.includes(type)) throw new SearchValidationError('검색 종류가 올바르지 않아요.');
      const q = foldSearchText(query);
      const terms = q ? [...new Set(q.split(' '))] : [];
      if (q && q.split(' ').length > 12)
        throw new SearchValidationError('검색어는 12단어까지 입력해 주세요.');
      const long = terms.filter((term) => Array.from(term).length >= 2);
      let previous = null;
      if (cursor !== null) {
        try {
          if (typeof cursor !== 'string' || cursor.length > 2000) throw new Error();
          previous = JSON.parse(Buffer.from(cursor, 'base64url').toString());
          if (
            previous.q !== q ||
            previous.type !== type ||
            !Number.isSafeInteger(previous.revision) ||
            previous.revision < 0 ||
            !Number.isSafeInteger(previous.id) ||
            previous.id < 1
          )
            throw new Error();
          if (
            q
              ? !Number.isFinite(previous.rank)
              : typeof previous.updatedAt !== 'string' ||
                new Date(previous.updatedAt).toISOString() !== previous.updatedAt
          )
            throw new Error();
        } catch {
          throw new SearchValidationError('검색 커서가 올바르지 않아요. 다시 검색해 주세요.');
        }
      }
      if (q && !long.length)
        return { items: [], nextCursor: null, reset: false, reason: 'short_query' };
      db.exec('SAVEPOINT search_read');
      try {
        const revision = db.prepare('SELECT revision FROM search_state WHERE id=1').get().revision;
        const reset = Boolean(previous && previous.revision !== revision);
        if (reset) previous = null;
        let rows;
        if (!q) {
          const where = [],
            parameters = [];
          if (type !== 'all') {
            where.push('category=?');
            parameters.push(type);
          }
          if (previous) {
            where.push('(updated_at<? OR (updated_at=? AND row_id<?))');
            parameters.push(previous.updatedAt, previous.updatedAt, previous.id);
          }
          rows = db
            .prepare(
              `SELECT * FROM search_documents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC,row_id DESC LIMIT 21`,
            )
            .all(...parameters);
        } else {
          const match = long.map((term) => '"' + encodeSearchText(term) + '"');
          for (const term of terms.filter((term) => Array.from(term).length < 2))
            match.push('characters:"' + encodeSearchCharacters(term) + '"');
          if (type !== 'all') match.push('category:"t' + type + '"');
          const where = [],
            parameters = [match.join(' AND ')];
          if (previous) {
            where.push('(rank>? OR (rank=? AND f.rowid<?))');
            parameters.push(previous.rank, previous.rank, previous.id);
          }
          rows = db
            .prepare(
              `WITH hits AS (
           SELECT f.rowid AS row_id,rank FROM search_fts f
           WHERE search_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY rank,f.rowid DESC LIMIT 21
          ) SELECT d.*,h.rank FROM hits h JOIN search_documents d ON d.row_id=h.row_id ORDER BY h.rank,d.row_id DESC`,
            )
            .all(...parameters);
        }
        const items = rows.slice(0, 20).map((row) => result(row, terms));
        const last = rows[19];
        const nextCursor =
          rows.length > 20
            ? Buffer.from(
                JSON.stringify({
                  q,
                  type,
                  revision,
                  id: last.row_id,
                  ...(q ? { rank: last.rank } : { updatedAt: last.updated_at }),
                }),
              ).toString('base64url')
            : null;
        db.exec('RELEASE search_read');
        return { items, nextCursor, reset, reason: null };
      } catch (error) {
        db.exec('ROLLBACK TO search_read; RELEASE search_read');
        throw error;
      }
    },
  };
}
