import { randomUUID } from 'node:crypto';
import { PageValidationError, PageConflictError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { pageTransaction } from './pageConnections.mjs';
import { cleanRequestId } from './ai/contracts.mjs';
import { getBlockExcerpt, listSharedCommentableBlocks } from '../shared/pageComments.ts';
import { cleanItinerary } from '../shared/itinerary.ts';
import { lookupSharedPage } from './shares.mjs';

export function createSharedCommentStore(db, owner) {
  db.exec(`CREATE TABLE IF NOT EXISTS shared_comment_threads(id TEXT PRIMARY KEY,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,block_id TEXT NOT NULL,excerpt TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,UNIQUE(page_id,block_id));
 CREATE TABLE IF NOT EXISTS shared_comments(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES shared_comment_threads(id) ON DELETE CASCADE,name TEXT NOT NULL,is_owner INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS shared_comments_thread ON shared_comments(thread_id,created_at);
 CREATE TABLE IF NOT EXISTS shared_comment_operations(request_id TEXT PRIMARY KEY,page_id TEXT NOT NULL,payload TEXT NOT NULL);`);
  function publicCommentableBlocks(blocks) {
    const candidates = new Set(listSharedCommentableBlocks(blocks).map((b) => b.id));
    const result = [];
    function visit(items) {
      for (const b of items || []) {
        if (['captureRef', 'page', 'tableOfContents'].includes(b.type)) continue;
        let visible = candidates.has(b.id);
        if (
          b.type === 'asset' &&
          !db.prepare('SELECT id FROM assets WHERE id=?').get(b.props?.assetId || '')
        )
          visible = false;
        if (
          b.type === 'map' &&
          (!Number.isFinite(b.props?.latitude) || !Number.isFinite(b.props?.longitude))
        )
          visible = false;
        if (b.type === 'itinerary') {
          try {
            cleanItinerary(b.props?.data);
          } catch {
            visible = false;
          }
        }
        if (visible) result.push({ id: b.id });
        visit(b.children);
      }
    }
    visit(blocks);
    return result;
  }
  function page(id) {
    const p = owner().getPage(id);
    if (!p) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
    return p;
  }
  function shared(token) {
    const p = lookupSharedPage(db, token);
    if (!p) throw new PageToolsNotFoundError('공유 페이지를 찾을 수 없어요.');
    if (!p.commentsEnabled)
      throw new PageToolsNotFoundError('이 공유 링크는 댓글을 허용하지 않아요.');
    return p;
  }
  function list(pageId, visible = null) {
    const p = page(pageId),
      ids = new Set(publicCommentableBlocks(p.document.blocks).map((b) => b.id));
    const messages = new Map();
    // Two bounded queries rather than one message query for every conversation.
    for (const { threadId, ...comment } of db
      .prepare(
        `SELECT c.thread_id AS threadId,c.id,c.name,c.is_owner AS isOwner,c.text,c.created_at AS createdAt FROM shared_comments c JOIN shared_comment_threads t ON t.id=c.thread_id WHERE t.page_id=? ORDER BY c.created_at,c.rowid`,
      )
      .all(pageId)) {
      if (!messages.has(threadId)) messages.set(threadId, []);
      messages.get(threadId).push({ ...comment, isOwner: !!comment.isOwner });
    }
    return db
      .prepare(
        'SELECT id,block_id AS blockId,excerpt,resolved,version,created_at AS createdAt FROM shared_comment_threads WHERE page_id=? ORDER BY created_at,id',
      )
      .all(pageId)
      .filter((t) => !visible || visible.has(t.blockId))
      .map((t) => ({
        ...t,
        resolved: !!t.resolved,
        orphaned: !ids.has(t.blockId),
        comments: messages.get(t.id) || [],
      }));
  }
  function change(input, guestToken = null) {
    const {
      pageId,
      threadId = null,
      blockId = null,
      text = null,
      action = 'create',
      expectedVersion = null,
      resolved = null,
    } = input;
    if (
      !(guestToken ? ['create', 'reply'] : ['create', 'reply', 'resolve', 'delete']).includes(
        action,
      )
    )
      throw new PageValidationError('댓글 동작을 확인해 주세요.');
    const requestId = cleanRequestId(input.requestId);
    const writing = ['create', 'reply'].includes(action);
    const rawName = guestToken ? input.name : '나';
    if (
      writing &&
      (typeof rawName !== 'string' ||
        !rawName.trim() ||
        rawName.length > 30 ||
        /[\u0000-\u001f\u007f]/.test(rawName))
    )
      throw new PageValidationError('이름은 1~30자로 입력해 주세요.');
    if (writing && (typeof text !== 'string' || !text.trim() || text.length > 2000))
      throw new PageValidationError('댓글은 1~2,000자로 입력해 주세요.');
    const payload = JSON.stringify([
      pageId,
      threadId,
      blockId,
      text,
      action,
      expectedVersion,
      resolved,
      rawName,
      !!guestToken,
    ]);
    return pageTransaction(db, () => {
      const p = guestToken ? shared(guestToken) : page(pageId);
      const visible = guestToken
        ? new Set(publicCommentableBlocks(p.document.blocks).map((b) => b.id))
        : null;
      const prior = db
        .prepare('SELECT payload FROM shared_comment_operations WHERE request_id=?')
        .get(requestId);
      // A replay never bypasses the current token policy or visibility restrictions.
      if (guestToken && action === 'create' && !visible.has(blockId))
        throw new PageValidationError('공유 중인 블록을 선택해 주세요.');
      if (guestToken && action === 'reply') {
        const anchor = db
          .prepare('SELECT block_id FROM shared_comment_threads WHERE id=? AND page_id=?')
          .get(threadId, pageId);
        if (!anchor) throw new PageToolsNotFoundError('대화를 찾을 수 없어요.');
        if (!visible.has(anchor.block_id))
          throw new PageValidationError('공유 중인 블록을 선택해 주세요.');
      }
      if (prior) {
        if (prior.payload !== payload)
          throw new PageConflictError('같은 요청 번호에 다른 댓글 내용이 있어요.');
        return { items: list(pageId, visible), replayed: true };
      }
      let id = threadId;
      if (action === 'create') {
        if (
          typeof blockId !== 'string' ||
          !publicCommentableBlocks(p.document.blocks).some((b) => b.id === blockId)
        )
          throw new PageValidationError('저장된 블록을 선택해 주세요.');
        if (
          db
            .prepare('SELECT id FROM shared_comment_threads WHERE page_id=? AND block_id=?')
            .get(pageId, blockId)
        )
          throw new PageConflictError('이미 대화가 있어요. 댓글 목록을 다시 불러와 주세요.');
        if (
          db.prepare('SELECT count(*) AS n FROM shared_comment_threads WHERE page_id=?').get(pageId)
            .n >= 500
        )
          throw new PageValidationError('문서당 대화는 500개까지 남길 수 있어요.');
        id = randomUUID();
        db.prepare(
          'INSERT INTO shared_comment_threads(id,page_id,block_id,excerpt,created_at) VALUES(?,?,?,?,?)',
        ).run(id, pageId, blockId, getBlockExcerpt(p.document.blocks, blockId), Date.now());
      } else {
        const thread = db
          .prepare('SELECT * FROM shared_comment_threads WHERE id=? AND page_id=?')
          .get(id, pageId);
        if (!thread) throw new PageToolsNotFoundError('대화를 찾을 수 없어요.');
        if (thread.version !== expectedVersion)
          throw new PageConflictError('대화가 변경됐어요. 다시 불러온 뒤 확인해 주세요.');
        if (action === 'reply' && thread.resolved)
          throw new PageConflictError('대화를 다시 연 뒤 답글을 남겨 주세요.');
        if (action === 'resolve' && typeof resolved !== 'boolean')
          throw new PageValidationError('댓글 상태를 확인해 주세요.');
        if (action === 'delete')
          db.prepare('DELETE FROM shared_comment_threads WHERE id=?').run(id);
        else
          db.prepare(
            'UPDATE shared_comment_threads SET version=version+1,resolved=COALESCE(?,resolved) WHERE id=?',
          ).run(action === 'resolve' ? Number(resolved) : null, id);
      }
      if (writing) {
        if (
          db.prepare('SELECT count(*) AS n FROM shared_comments WHERE thread_id=?').get(id).n >= 100
        )
          throw new PageValidationError('한 대화에는 댓글과 답글을 합해 100개까지 남길 수 있어요.');
        if (
          db
            .prepare(
              'SELECT count(*) AS n FROM shared_comments c JOIN shared_comment_threads t ON t.id=c.thread_id WHERE t.page_id=?',
            )
            .get(pageId).n >= 1000
        )
          throw new PageValidationError('한 페이지에는 댓글 1,000개까지 남길 수 있어요.');
        db.prepare(
          'INSERT INTO shared_comments(id,thread_id,name,is_owner,text,created_at) VALUES(?,?,?,?,?,?)',
        ).run(randomUUID(), id, rawName.trim(), Number(!guestToken), text.trim(), Date.now());
      }
      db.prepare('INSERT INTO shared_comment_operations VALUES(?,?,?)').run(
        requestId,
        pageId,
        payload,
      );
      return { items: list(pageId, visible), replayed: false };
    });
  }
  return {
    listSharedComments: list,
    listSharedCommentSummary(pageId) {
      page(pageId);
      return db
        .prepare(
          `SELECT t.block_id AS blockId,COUNT(c.id) AS count,t.resolved FROM shared_comment_threads t LEFT JOIN shared_comments c ON c.thread_id=t.id WHERE t.page_id=? GROUP BY t.id ORDER BY t.created_at,t.id`,
        )
        .all(pageId)
        .map((t) => ({ ...t, resolved: !!t.resolved }));
    },
    changeSharedComment(input) {
      return change(input);
    },
    listPublicSharedComments(token) {
      const p = shared(token);
      return list(p.id, new Set(publicCommentableBlocks(p.document.blocks).map((b) => b.id)));
    },
    changePublicSharedComment(token, input) {
      const p = shared(token);
      return change({ ...input, pageId: p.id }, token);
    },
  };
}
