import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { createSharedCommentInboxStore } from '../server/sharedCommentInbox.mjs';
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-inbox-')),
    s = openStore(dir),
    db = new DatabaseSync(join(dir, 'storage.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  try {
    const inbox = createSharedCommentInboxStore(db, () => s);
    fn(s, inbox, db);
  } finally {
    db.close();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
function guest(s, p, text = '방문자 질문') {
  const link = s.createPageShare(p.id, { commentsEnabled: true });
  return s.changePublicSharedComment(link.token, {
    requestId: randomUUID(),
    blockId: p.document.blocks[0].id,
    action: 'create',
    name: '민수',
    text,
  }).items[0];
}
function reply(s, p, t, name = '민수') {
  const link = s.createPageShare(p.id, { commentsEnabled: true });
  return s.changePublicSharedComment(link.token, {
    requestId: randomUUID(),
    threadId: t.id,
    action: 'reply',
    expectedVersion: t.version,
    name,
    text: '새 답글',
  }).items[0];
}
test('guest unread state is independent of resolved and read advances through known viewed message only', () =>
  fixture((s, inbox) => {
    const p = s.createPage(),
      before = JSON.stringify(p);
    let t = guest(s, p),
      first = t.comments[0].id;
    let batch = inbox.listSharedCommentInbox();
    assert.deepEqual(batch.counts, { all: 1, unread: 1, open: 1, resolved: 0 });
    assert.equal(batch.items[0].lastGuestMessageId, first);
    assert.equal(batch.items[0].pageId, p.id);
    t = reply(s, p, t);
    const newer = t.comments.at(-1).id;
    inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: first });
    assert.equal(inbox.listSharedCommentInbox().counts.unread, 1);
    t = s.changeSharedComment({
      pageId: p.id,
      requestId: randomUUID(),
      action: 'resolve',
      threadId: t.id,
      expectedVersion: t.version,
      resolved: true,
    }).items[0];
    assert.deepEqual(inbox.listSharedCommentInbox().counts, {
      all: 1,
      unread: 1,
      open: 0,
      resolved: 1,
    });
    inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: newer });
    assert.equal(inbox.listSharedCommentInbox().counts.unread, 0);
    inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: first });
    assert.equal(inbox.listSharedCommentInbox().counts.unread, 0);
    assert.equal(JSON.stringify(s.getPage(p.id)), before);
  }));
test('inbox excludes private comments and trashed pages; owner replies cannot forge guest read receipt', () =>
  fixture((s, inbox) => {
    const p = s.createPage(),
      other = s.createPage();
    s.changePageComment({
      pageId: p.id,
      blockId: p.document.blocks[0].id,
      requestId: randomUUID(),
      text: 'private secret',
    });
    let t = guest(s, p);
    const foreign = guest(s, other);
    t = s.changeSharedComment({
      pageId: p.id,
      requestId: randomUUID(),
      action: 'reply',
      threadId: t.id,
      expectedVersion: t.version,
      text: 'Owner answer',
    }).items[0];
    assert.throws(
      () =>
        inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: t.comments.at(-1).id }),
      /방문자|댓글/,
    );
    assert.throws(
      () =>
        inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: foreign.comments[0].id }),
      /방문자|댓글/,
    );
    assert.ok(!JSON.stringify(inbox.listSharedCommentInbox()).includes('private secret'));
    s.trashRecord({
      kind: 'page',
      id: p.id,
      expectedVersion: p.version,
      operationId: randomUUID(),
    });
    assert.equal(inbox.listSharedCommentInbox().counts.all, 1);
    assert.throws(
      () => inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: t.comments[0].id }),
      /대화|페이지/,
    );
    const own = s.createPage();
    s.changeSharedComment({
      pageId: own.id,
      requestId: randomUUID(),
      blockId: own.document.blocks[0].id,
      text: 'owner only',
    });
    assert.deepEqual(inbox.listSharedCommentInbox().counts, {
      all: 2,
      unread: 1,
      open: 2,
      resolved: 0,
    });
  }));
test('inbox paginates bounded recent guest order without parsing page documents and rejects bad cursors', () =>
  fixture((s, inbox, db) => {
    const pages = [];
    for (let i = 0; i < 7; i++) {
      const p = s.createPage({ title: 'Plan ' + i });
      pages.push(p);
      guest(s, p, 'comment ' + i);
    }
    let b = inbox.listSharedCommentInbox({ limit: 3 });
    assert.equal(b.items.length, 3);
    assert.equal(b.items[0].pageTitle, 'Plan 6');
    const seen = new Set(b.items.map((t) => t.threadId));
    while (b.nextCursor) {
      b = inbox.listSharedCommentInbox({ limit: 3, cursor: b.nextCursor });
      for (const t of b.items) {
        assert.ok(!seen.has(t.threadId));
        seen.add(t.threadId);
      }
    }
    assert.equal(seen.size, 7);
    assert.throws(() => inbox.listSharedCommentInbox({ cursor: 'bad' }), /목록|커서/);
    assert.throws(() => inbox.listSharedCommentInbox({ limit: 51 }), /목록|개수/);
    assert.throws(() => inbox.listSharedCommentInbox({ view: 'bad' }), /목록|상태/);
    const cursor = inbox.listSharedCommentInbox({ limit: 1 }).nextCursor;
    assert.throws(() => inbox.listSharedCommentInbox({ view: 'unread', cursor }), /목록|커서/);
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='shared_comment_inbox_recent'",
        )
        .get(),
    );
  }));
test('inbox backfills existing guest messages once, preserves reads across restart and handles conversation deletion', () =>
  fixture((s, inbox, db) => {
    const p = s.createPage();
    let t = guest(s, p);
    inbox.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: t.comments[0].id });
    const again = createSharedCommentInboxStore(db, () => s);
    assert.equal(again.listSharedCommentInbox().counts.unread, 0);
    s.changeSharedComment({
      pageId: p.id,
      requestId: randomUUID(),
      action: 'delete',
      threadId: t.id,
      expectedVersion: t.version,
    });
    assert.equal(again.listSharedCommentInbox().counts.all, 0);
    t = guest(s, p);
    assert.equal(again.listSharedCommentInbox().counts.unread, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM shared_comment_reads').get().n, 0);
  }));

test('legacy shared messages are indexed exactly once during initial inbox migration', () =>
  fixture((s, inbox, db) => {
    db.exec(
      `DROP TRIGGER shared_comment_inbox_thread;DROP TRIGGER shared_comment_inbox_message;DROP TRIGGER shared_comment_inbox_delete;DROP TABLE shared_comment_reads;DROP TABLE shared_comment_inbox;DROP TABLE shared_comment_guest_events;DROP TABLE shared_comment_inbox_meta;`,
    );
    const p = s.createPage();
    let t = guest(s, p);
    t = reply(s, p, t);
    const migrated = createSharedCommentInboxStore(db, () => s);
    assert.equal(
      migrated.listSharedCommentInbox().items[0].lastGuestMessageId,
      t.comments.at(-1).id,
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM shared_comment_guest_events').get().n, 2);
    migrated.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: t.comments.at(-1).id });
    createSharedCommentInboxStore(db, () => s);
    assert.equal(db.prepare('SELECT count(*) AS n FROM shared_comment_guest_events').get().n, 2);
    assert.equal(migrated.listSharedCommentInbox().counts.unread, 0);
  }));

test('read receipts and later guest sequence persist after closing and reopening the actual store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-inbox-restart-'));
  let s = openStore(dir);
  try {
    const p = s.createPage();
    let t = guest(s, p);
    s.markSharedCommentRead({ threadId: t.id, lastGuestMessageId: t.comments[0].id });
    s.close();
    s = openStore(dir);
    assert.equal(s.listSharedCommentInbox().counts.unread, 0);
    t = reply(s, p, t);
    assert.equal(s.listSharedCommentInbox().counts.unread, 1);
    s.close();
    s = openStore(dir);
    assert.equal(s.listSharedCommentInbox().items[0].lastGuestMessageId, t.comments.at(-1).id);
    assert.equal(s.listSharedCommentInbox().counts.unread, 1);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
