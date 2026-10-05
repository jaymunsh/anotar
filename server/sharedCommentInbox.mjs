import { PageValidationError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { pageTransaction } from './pageConnections.mjs';

const views = ['all', 'unread', 'open', 'resolved'];
const scope = `FROM shared_comment_inbox i JOIN shared_comment_threads t ON t.id=i.thread_id JOIN pages p ON p.id=i.page_id LEFT JOIN shared_comment_reads r ON r.thread_id=t.id WHERE p.deleted_at IS NULL`;
const unread = 'i.last_guest_sequence>COALESCE(r.guest_sequence,0)';
const filters = {
  all: '',
  unread: ' AND ' + unread,
  open: ' AND t.resolved=0',
  resolved: ' AND t.resolved=1',
};
function count(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS "all",COALESCE(SUM(${unread}),0) AS unread,COALESCE(SUM(t.resolved=0),0) AS open,COALESCE(SUM(t.resolved=1),0) AS resolved ${scope}`,
    )
    .get();
  return { ...row };
}
function cursorValue(value, view) {
  if (value === null || value === undefined || value === '') return null;
  try {
    if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      decoded.v !== 1 ||
      decoded.view !== view ||
      !Number.isSafeInteger(decoded.seq) ||
      decoded.seq < 0 ||
      typeof decoded.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(decoded.id)
    )
      throw new Error();
    return decoded;
  } catch {
    throw new PageValidationError('댓글 목록 커서를 확인해 주세요.');
  }
}
export function createSharedCommentInboxStore(db, owner) {
  pageTransaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS shared_comment_guest_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT NOT NULL UNIQUE REFERENCES shared_comments(id) ON DELETE CASCADE,thread_id TEXT NOT NULL REFERENCES shared_comment_threads(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS shared_comment_guest_thread ON shared_comment_guest_events(thread_id,sequence DESC);
CREATE TABLE IF NOT EXISTS shared_comment_reads(thread_id TEXT PRIMARY KEY REFERENCES shared_comment_threads(id) ON DELETE CASCADE,guest_sequence INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shared_comment_inbox(thread_id TEXT PRIMARY KEY REFERENCES shared_comment_threads(id) ON DELETE CASCADE,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,last_guest_sequence INTEGER NOT NULL DEFAULT 0,last_guest_message_id TEXT,last_message_id TEXT REFERENCES shared_comments(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS shared_comment_inbox_recent ON shared_comment_inbox(last_guest_sequence DESC,thread_id DESC);
CREATE INDEX IF NOT EXISTS shared_comment_inbox_page ON shared_comment_inbox(page_id);
CREATE TABLE IF NOT EXISTS shared_comment_inbox_meta(key TEXT PRIMARY KEY);
CREATE TRIGGER IF NOT EXISTS shared_comment_inbox_thread AFTER INSERT ON shared_comment_threads BEGIN
 INSERT INTO shared_comment_inbox(thread_id,page_id) VALUES(NEW.id,NEW.page_id);
END;
CREATE TRIGGER IF NOT EXISTS shared_comment_inbox_message AFTER INSERT ON shared_comments BEGIN
 INSERT INTO shared_comment_guest_events(message_id,thread_id) SELECT NEW.id,NEW.thread_id WHERE NEW.is_owner=0;
 UPDATE shared_comment_inbox SET last_message_id=NEW.id,last_guest_message_id=CASE WHEN NEW.is_owner=0 THEN NEW.id ELSE last_guest_message_id END,last_guest_sequence=CASE WHEN NEW.is_owner=0 THEN (SELECT sequence FROM shared_comment_guest_events WHERE message_id=NEW.id) ELSE last_guest_sequence END WHERE thread_id=NEW.thread_id;
END;
CREATE TRIGGER IF NOT EXISTS shared_comment_inbox_delete AFTER DELETE ON shared_comments WHEN EXISTS(SELECT 1 FROM shared_comment_threads WHERE id=OLD.thread_id) BEGIN
 UPDATE shared_comment_inbox SET last_message_id=(SELECT id FROM shared_comments WHERE thread_id=OLD.thread_id ORDER BY rowid DESC LIMIT 1),last_guest_message_id=(SELECT message_id FROM shared_comment_guest_events WHERE thread_id=OLD.thread_id ORDER BY sequence DESC LIMIT 1),last_guest_sequence=COALESCE((SELECT sequence FROM shared_comment_guest_events WHERE thread_id=OLD.thread_id ORDER BY sequence DESC LIMIT 1),0) WHERE thread_id=OLD.thread_id;
END;`);
    if (!db.prepare("SELECT key FROM shared_comment_inbox_meta WHERE key='v1'").get()) {
      db.exec(`INSERT OR IGNORE INTO shared_comment_guest_events(message_id,thread_id) SELECT id,thread_id FROM shared_comments WHERE is_owner=0 ORDER BY rowid;
INSERT OR IGNORE INTO shared_comment_inbox(thread_id,page_id) SELECT id,page_id FROM shared_comment_threads;
UPDATE shared_comment_inbox SET last_message_id=(SELECT id FROM shared_comments WHERE thread_id=shared_comment_inbox.thread_id ORDER BY rowid DESC LIMIT 1),last_guest_message_id=(SELECT message_id FROM shared_comment_guest_events WHERE thread_id=shared_comment_inbox.thread_id ORDER BY sequence DESC LIMIT 1),last_guest_sequence=COALESCE((SELECT sequence FROM shared_comment_guest_events WHERE thread_id=shared_comment_inbox.thread_id ORDER BY sequence DESC LIMIT 1),0);
INSERT INTO shared_comment_inbox_meta VALUES('v1');`);
    }
  });
  return {
    listSharedCommentInbox({ view = 'all', limit = 20, cursor = null } = {}) {
      if (!views.includes(view)) throw new PageValidationError('댓글 목록 상태를 확인해 주세요.');
      const size = typeof limit === 'string' ? Number(limit) : limit;
      if (!Number.isInteger(size) || size < 1 || size > 50)
        throw new PageValidationError('댓글 목록 개수는 1~50개로 요청해 주세요.');
      const after = cursorValue(cursor, view);
      return pageTransaction(db, () => {
        const rows = db
          .prepare(
            `SELECT t.id AS threadId,t.block_id AS blockId,t.excerpt,t.resolved,t.version,p.id AS pageId,p.title AS pageTitle,p.icon AS pageIcon,i.last_guest_message_id AS lastGuestMessageId,i.last_guest_sequence AS sequence,${unread} AS unread,c.name AS name,substr(c.text,1,220) AS text,c.is_owner AS isOwner,c.created_at AS createdAt ${scope.replace(' WHERE', ' LEFT JOIN shared_comments c ON c.id=i.last_message_id WHERE')}${filters[view]}${after ? ' AND (i.last_guest_sequence<? OR (i.last_guest_sequence=? AND i.thread_id<?))' : ''} ORDER BY i.last_guest_sequence DESC,i.thread_id DESC LIMIT ?`,
          )
          .all(...(after ? [after.seq, after.seq, after.id] : []), size + 1);
        const more = rows.length > size,
          visible = rows.slice(0, size),
          last = visible.at(-1);
        return {
          items: visible.map(({ sequence, ...row }) => ({
            ...row,
            resolved: !!row.resolved,
            unread: !!row.unread,
            isOwner: !!row.isOwner,
            name: row.name || '나',
            text: row.text || '',
            createdAt: row.createdAt || 0,
          })),
          counts: count(db),
          nextCursor: more
            ? Buffer.from(
                JSON.stringify({ v: 1, view, seq: last.sequence, id: last.threadId }),
              ).toString('base64url')
            : null,
        };
      });
    },
    markSharedCommentRead({ threadId, lastGuestMessageId } = {}) {
      if (typeof threadId !== 'string' || typeof lastGuestMessageId !== 'string')
        throw new PageValidationError('확인한 방문자 댓글을 선택해 주세요.');
      return pageTransaction(db, () => {
        const thread = db
          .prepare('SELECT page_id FROM shared_comment_threads WHERE id=?')
          .get(threadId);
        if (!thread || !owner().getPage(thread.page_id))
          throw new PageToolsNotFoundError('대화 또는 페이지를 찾을 수 없어요.');
        const guest = db
          .prepare(
            'SELECT sequence FROM shared_comment_guest_events WHERE thread_id=? AND message_id=?',
          )
          .get(threadId, lastGuestMessageId);
        if (!guest)
          throw new PageValidationError('이 대화에서 확인한 방문자 댓글을 선택해 주세요.');
        db.prepare(
          'INSERT INTO shared_comment_reads(thread_id,guest_sequence,updated_at) VALUES(?,?,?) ON CONFLICT(thread_id) DO UPDATE SET guest_sequence=MAX(guest_sequence,excluded.guest_sequence),updated_at=excluded.updated_at',
        ).run(threadId, guest.sequence, Date.now());
        return { item: { threadId, lastGuestMessageId }, counts: count(db) };
      });
    },
  };
}
