import { randomUUID } from 'node:crypto';
import { PageValidationError, PageConflictError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { pageTransaction } from './pageConnections.mjs';
import { cleanRequestId } from './ai/contracts.mjs';
import { getBlockExcerpt, listCommentableBlocks } from '../shared/pageComments.ts';

export function createPageCommentStore(db, owner) {
  db.exec(`CREATE TABLE IF NOT EXISTS page_comment_threads(id TEXT PRIMARY KEY,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,block_id TEXT NOT NULL,excerpt TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,UNIQUE(page_id,block_id));
 CREATE TABLE IF NOT EXISTS page_comments(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES page_comment_threads(id) ON DELETE CASCADE,text TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS page_comments_thread ON page_comments(thread_id,created_at);
 CREATE TABLE IF NOT EXISTS page_comment_operations(request_id TEXT PRIMARY KEY,page_id TEXT NOT NULL,payload TEXT NOT NULL);`);
  function page(id) {
    const p = owner().getPage(id);
    if (!p) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
    return p;
  }
  function list(pageId) {
    const p = page(pageId),
      ids = new Set(listCommentableBlocks(p.document.blocks).map((b) => b.id));
    return db
      .prepare(
        'SELECT id,block_id AS blockId,excerpt,resolved,version,created_at AS createdAt FROM page_comment_threads WHERE page_id=? ORDER BY created_at,id',
      )
      .all(pageId)
      .map((t) => ({
        ...t,
        resolved: !!t.resolved,
        orphaned: !ids.has(t.blockId),
        comments: db
          .prepare(
            'SELECT id,text,created_at AS createdAt FROM page_comments WHERE thread_id=? ORDER BY created_at,rowid',
          )
          .all(t.id),
      }));
  }
  return {
    listPageComments: list,
    listPageCommentSummary(pageId) {
      page(pageId);
      return db
        .prepare(
          `SELECT t.block_id AS blockId,COUNT(c.id) AS count,t.resolved FROM page_comment_threads t LEFT JOIN page_comments c ON c.thread_id=t.id WHERE t.page_id=? GROUP BY t.id ORDER BY t.created_at,t.id`,
        )
        .all(pageId)
        .map((t) => ({ ...t, resolved: !!t.resolved }));
    },
    changePageComment(input) {
      const {
        pageId,
        threadId = null,
        blockId = null,
        text = null,
        action = 'create',
        expectedVersion = null,
        resolved = null,
      } = input;
      const requestId = cleanRequestId(input.requestId),
        payload = JSON.stringify([
          pageId,
          threadId,
          blockId,
          text,
          action,
          expectedVersion,
          resolved,
        ]);
      if (!['create', 'reply', 'resolve', 'delete'].includes(action))
        throw new PageValidationError('댓글 동작을 확인해 주세요.');
      if (
        ['create', 'reply'].includes(action) &&
        (typeof text !== 'string' || !text.trim() || text.length > 2000)
      )
        throw new PageValidationError('댓글은 1~2,000자로 입력해 주세요.');
      return pageTransaction(db, () => {
        const p = page(pageId),
          prior = db
            .prepare('SELECT * FROM page_comment_operations WHERE request_id=?')
            .get(requestId);
        if (prior) {
          if (prior.payload !== payload)
            throw new PageConflictError('같은 요청 번호에 다른 댓글 내용이 있어요.');
          return { items: list(pageId), replayed: true };
        }
        let id = threadId;
        if (action === 'create') {
          if (
            typeof blockId !== 'string' ||
            !listCommentableBlocks(p.document.blocks).some((b) => b.id === blockId)
          )
            throw new PageValidationError('저장된 블록을 선택해 주세요.');
          if (
            db
              .prepare('SELECT id FROM page_comment_threads WHERE page_id=? AND block_id=?')
              .get(pageId, blockId)
          )
            throw new PageConflictError('이미 대화가 있어요. 댓글 목록을 다시 불러와 주세요.');
          if (
            db.prepare('SELECT count(*) AS n FROM page_comment_threads WHERE page_id=?').get(pageId)
              .n >= 500
          )
            throw new PageValidationError('문서당 대화는 500개까지 남길 수 있어요.');
          id = randomUUID();
          db.prepare(
            'INSERT INTO page_comment_threads(id,page_id,block_id,excerpt,created_at) VALUES(?,?,?,?,?)',
          ).run(id, pageId, blockId, getBlockExcerpt(p.document.blocks, blockId), Date.now());
        } else {
          const thread = db
            .prepare('SELECT * FROM page_comment_threads WHERE id=? AND page_id=?')
            .get(id, pageId);
          if (!thread) throw new PageToolsNotFoundError('대화를 찾을 수 없어요.');
          if (thread.version !== expectedVersion)
            throw new PageConflictError('대화가 변경됐어요. 다시 불러온 뒤 확인해 주세요.');
          if (action === 'reply' && thread.resolved)
            throw new PageConflictError('대화를 다시 연 뒤 답글을 남겨 주세요.');
          if (action === 'resolve' && typeof resolved !== 'boolean')
            throw new PageValidationError('댓글 상태를 확인해 주세요.');
          if (action === 'delete')
            db.prepare('DELETE FROM page_comment_threads WHERE id=?').run(id);
          else
            db.prepare(
              'UPDATE page_comment_threads SET version=version+1,resolved=COALESCE(?,resolved) WHERE id=?',
            ).run(action === 'resolve' ? Number(resolved) : null, id);
        }
        if (['create', 'reply'].includes(action)) {
          if (
            db.prepare('SELECT count(*) AS n FROM page_comments WHERE thread_id=?').get(id).n >= 100
          )
            throw new PageValidationError(
              '한 대화에는 댓글과 답글을 합해 100개까지 남길 수 있어요.',
            );
          if (
            db
              .prepare(
                'SELECT count(*) AS n FROM page_comments c JOIN page_comment_threads t ON t.id=c.thread_id WHERE t.page_id=?',
              )
              .get(pageId).n >= 1000
          )
            throw new PageValidationError(
              '한 페이지에는 댓글 1,000개까지 남길 수 있어요. 이전 대화를 정리해 주세요.',
            );
        }
        if (['create', 'reply'].includes(action))
          db.prepare('INSERT INTO page_comments(id,thread_id,text,created_at) VALUES(?,?,?,?)').run(
            randomUUID(),
            id,
            text.trim(),
            Date.now(),
          );
        db.prepare('INSERT INTO page_comment_operations VALUES(?,?,?)').run(
          requestId,
          pageId,
          payload,
        );
        return { items: list(pageId), replayed: false };
      });
    },
  };
}
