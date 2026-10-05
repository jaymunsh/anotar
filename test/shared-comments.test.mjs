import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { registerSearchFunctions } from '../server/searchText.mjs';
import { lookupSharedPage } from '../server/shares.mjs';

const block = (id, type = 'paragraph', text = id, children = []) => ({
  id,
  type,
  props:
    type === 'captureRef'
      ? { captureId: randomUUID() }
      : type === 'page'
        ? { pageId: randomUUID(), title: 'secret' }
        : {},
  content: [{ type: 'text', text, styles: {} }],
  children,
});
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-shared-comments-'));
  let store = openStore(dir);
  try {
    fn(store, dir, () => {
      store.close();
      store = openStore(dir);
      return store;
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const input = (extra = {}) => ({
  requestId: randomUUID(),
  action: 'create',
  blockId: 'visible',
  name: '친구',
  text: '시간을 확인해 주세요.',
  ...extra,
});

test('shared link comment policy defaults off, migrates safely and can be changed without rotating token', () =>
  fixture((s, dir) => {
    const p = s.createPage();
    const link = s.createPageShare(p.id);
    assert.equal(link.item.commentsEnabled, false);
    assert.equal(s.listPageShares(p.id)[0].commentsEnabled, false);
    assert.equal(
      s.updatePageShare(p.id, link.item.id, { commentsEnabled: true }).commentsEnabled,
      true,
    );
    const db = new DatabaseSync(join(dir, 'storage.sqlite'), { readOnly: true });
    try {
      assert.equal(lookupSharedPage(db, link.token).commentsEnabled, true);
    } finally {
      db.close();
    }
    assert.throws(() => s.updatePageShare(p.id, link.item.id, { commentsEnabled: 'yes' }), /댓글/);
    assert.equal(s.updatePageShare(p.id, randomUUID(), { commentsEnabled: true }), null);
    s.revokePageShare(p.id, link.item.id);
    assert.equal(s.updatePageShare(p.id, link.item.id, { commentsEnabled: true }), null);
  }));

test('guest names, owner identity, idempotence, thread versions and document preservation', () =>
  fixture((s, dir, reopen) => {
    let p = s.createPage({ title: 'Plan' });
    p = s.updatePage({
      id: p.id,
      title: p.title,
      expectedVersion: p.version,
      document: { schemaVersion: 1, blocks: [block('visible')] },
    });
    const before = JSON.stringify(p),
      link = s.createPageShare(p.id, { commentsEnabled: true });
    s.changePageComment({
      pageId: p.id,
      requestId: randomUUID(),
      blockId: 'visible',
      text: 'private secret',
    });
    const req = input({ name: '  민수  ', text: '  확인해 주세요  ' });
    let t = s.changePublicSharedComment(link.token, req).items[0];
    assert.equal(t.comments[0].name, '민수');
    assert.equal(t.comments[0].isOwner, false);
    assert.equal(t.comments[0].text, '확인해 주세요');
    assert.equal(s.changePublicSharedComment(link.token, req).replayed, true);
    assert.throws(
      () => s.changePublicSharedComment(link.token, { ...req, name: '다른 이름' }),
      /다른/,
    );
    assert.ok(!JSON.stringify(s.listPublicSharedComments(link.token)).includes('private secret'));
    t = s.changeSharedComment({
      pageId: p.id,
      requestId: randomUUID(),
      action: 'reply',
      threadId: t.id,
      expectedVersion: t.version,
      text: '알겠습니다',
      name: 'forged',
      isOwner: false,
    }).items[0];
    assert.equal(t.comments[1].name, '나');
    assert.equal(t.comments[1].isOwner, true);
    assert.deepEqual(s.listSharedCommentSummary(p.id), [
      { blockId: 'visible', count: 2, resolved: false },
    ]);
    assert.throws(
      () =>
        s.changePublicSharedComment(
          link.token,
          input({ action: 'reply', threadId: t.id, expectedVersion: 1 }),
        ),
      /변경/,
    );
    assert.throws(
      () =>
        s.changePublicSharedComment(
          link.token,
          input({ action: 'resolve', threadId: t.id, expectedVersion: t.version, resolved: true }),
        ),
      /동작/,
    );
    t = s.changeSharedComment({
      pageId: p.id,
      requestId: randomUUID(),
      action: 'resolve',
      threadId: t.id,
      expectedVersion: t.version,
      resolved: true,
    }).items[0];
    assert.throws(
      () =>
        s.changePublicSharedComment(
          link.token,
          input({ action: 'reply', threadId: t.id, expectedVersion: t.version }),
        ),
      /다시/,
    );
    s = reopen();
    assert.equal(s.listSharedComments(p.id)[0].comments.length, 2);
    assert.equal(JSON.stringify(s.getPage(p.id)), before);
  }));

test('public comments recheck token, policy, page state and visible block ancestry', () =>
  fixture((s, dir) => {
    let p = s.createPage();
    const capture = s.createCapture({ kind: 'memo', text: 'private', files: [] });
    const privatePage = s.createPage();
    const hidden = block('hidden', 'captureRef', 'secret', [block('nested-secret')]);
    hidden.props.captureId = capture.id;
    const childPage = block('private-page', 'page', 'secret', [block('child')]);
    childPage.props.pageId = privatePage.id;
    p = s.updatePage({
      id: p.id,
      title: p.title,
      expectedVersion: p.version,
      document: {
        schemaVersion: 1,
        blocks: [block('visible'), hidden, childPage, block('toc', 'tableOfContents')],
      },
    });
    let link = s.createPageShare(p.id, { commentsEnabled: true });
    for (const id of ['hidden', 'nested-secret', 'private-page', 'child', 'toc', 'missing'])
      assert.throws(() => s.changePublicSharedComment(link.token, input({ blockId: id })), /블록/);
    for (const name of ['', ' ', 'x'.repeat(31), 42])
      assert.throws(() => s.changePublicSharedComment(link.token, input({ name })), /이름/);
    assert.throws(
      () => s.changePublicSharedComment(link.token, input({ text: 'x'.repeat(2001) })),
      /2,000/,
    );
    let t = s.changePublicSharedComment(link.token, input()).items[0];
    s.updatePageShare(p.id, link.item.id, { commentsEnabled: false });
    assert.throws(() => s.listPublicSharedComments(link.token), /댓글/);
    assert.throws(() => s.changePublicSharedComment(link.token, input()), /댓글/);
    s.updatePageShare(p.id, link.item.id, { commentsEnabled: true });
    p = s.updatePage({
      id: p.id,
      title: p.title,
      expectedVersion: p.version,
      document: { schemaVersion: 1, blocks: [block('other')] },
    });
    assert.equal(s.listPublicSharedComments(link.token).length, 0);
    assert.equal(s.listSharedComments(p.id)[0].orphaned, true);
    assert.throws(
      () =>
        s.changePublicSharedComment(
          link.token,
          input({ action: 'reply', threadId: t.id, expectedVersion: t.version }),
        ),
      /블록/,
    );
    const old = link;
    link = s.createPageShare(p.id, { commentsEnabled: true });
    assert.throws(() => s.listPublicSharedComments(old.token), /공유/);
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    db.prepare('UPDATE page_shares SET expires_at=? WHERE id=?').run('2000-01-01', link.item.id);
    db.close();
    assert.throws(() => s.listPublicSharedComments(link.token), /공유/);
    link = s.createPageShare(p.id, { commentsEnabled: true });
    s.trashRecord({
      kind: 'page',
      id: p.id,
      expectedVersion: p.version,
      operationId: randomUUID(),
    });
    assert.throws(() => s.listPublicSharedComments(link.token), /공유/);
  }));

test('shared reply cap rolls back version and receipt; foreign page threads are rejected', () =>
  fixture((s) => {
    const p = s.createPage(),
      other = s.createPage(),
      link = s.createPageShare(p.id, { commentsEnabled: true });
    let t = s.changePublicSharedComment(link.token, input({ blockId: p.document.blocks[0].id }))
      .items[0];
    assert.throws(
      () =>
        s.changeSharedComment({
          pageId: other.id,
          requestId: randomUUID(),
          action: 'reply',
          threadId: t.id,
          expectedVersion: t.version,
          text: 'foreign',
        }),
      /대화/,
    );
    for (let i = 1; i < 100; i++)
      t = s.changePublicSharedComment(
        link.token,
        input({ action: 'reply', threadId: t.id, expectedVersion: t.version, text: String(i) }),
      ).items[0];
    const req = input({ action: 'reply', threadId: t.id, expectedVersion: t.version });
    assert.throws(() => s.changePublicSharedComment(link.token, req), /100/);
    assert.equal(s.listSharedComments(p.id)[0].version, t.version);
    assert.equal(s.listSharedComments(p.id)[0].comments.length, 100);
  }));

test('legacy share migration keeps prior token and adds disabled policy on restart', () =>
  fixture((s, dir, reopen) => {
    const p = s.createPage(),
      link = s.createPageShare(p.id, { commentsEnabled: true });
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    db.exec('ALTER TABLE page_shares DROP COLUMN comments_enabled');
    db.close();
    s = reopen();
    assert.equal(s.listPageShares(p.id)[0].commentsEnabled, false);
    const read = new DatabaseSync(join(dir, 'storage.sqlite'), { readOnly: true });
    try {
      assert.equal(lookupSharedPage(read, link.token).id, p.id);
    } finally {
      read.close();
    }
    assert.throws(() => s.listPublicSharedComments(link.token), /댓글/);
  }));

test('shared owner creation rejects hidden anchors and page/thread caps rollback atomically', () =>
  fixture((s, dir) => {
    let p = s.createPage();
    const hidden = block('hidden', 'tableOfContents');
    p = s.updatePage({
      id: p.id,
      title: p.title,
      expectedVersion: p.version,
      document: { schemaVersion: 1, blocks: [block('visible'), block('extra'), hidden] },
    });
    assert.throws(
      () => s.changeSharedComment({ ...input({ blockId: 'hidden' }), pageId: p.id }),
      /블록/,
    );
    const t = s.changeSharedComment({ ...input(), pageId: p.id }).items[0];
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    try {
      const insert = db.prepare(
        'INSERT INTO shared_comments(id,thread_id,name,is_owner,text,created_at) VALUES(?,?,?,?,?,?)',
      );
      for (let i = 1; i < 1000; i++) insert.run(randomUUID(), t.id, '친구', 0, 'seed', i);
      assert.throws(
        () =>
          s.changeSharedComment({
            pageId: p.id,
            requestId: randomUUID(),
            blockId: 'extra',
            action: 'create',
            text: 'over',
          }),
        /1,000/,
      );
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM shared_comment_threads WHERE page_id=?').get(p.id).n,
        1,
      );
      db.prepare('DELETE FROM shared_comments WHERE thread_id=?').run(t.id);
      const thread = db.prepare(
        'INSERT INTO shared_comment_threads(id,page_id,block_id,excerpt,created_at) VALUES(?,?,?,?,?)',
      );
      for (let i = 1; i < 500; i++) thread.run(randomUUID(), p.id, 'seed' + i, 'seed', i);
      assert.throws(
        () =>
          s.changeSharedComment({
            pageId: p.id,
            requestId: randomUUID(),
            blockId: 'extra',
            action: 'create',
            text: 'over',
          }),
        /500/,
      );
    } finally {
      db.close();
    }
  }));

test('missing assets and malformed legacy map/itinerary blocks are not public comment anchors', () =>
  fixture((s, dir) => {
    const p = s.createPage(),
      link = s.createPageShare(p.id, { commentsEnabled: true });
    const doc = {
      schemaVersion: 1,
      blocks: [
        block('visible'),
        { ...block('missing-asset', 'asset'), props: { assetId: randomUUID(), display: 'file' } },
        {
          ...block('invalid-map', 'map'),
          props: { latitude: null, longitude: 0, label: 'hidden' },
        },
        { ...block('invalid-plan', 'itinerary'), props: { data: 'not json' } },
      ],
    };
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    try {
      // Simulate malformed legacy docs directly; API validation rejects these today.
      registerSearchFunctions(db);
      db.prepare('UPDATE pages SET document=? WHERE id=?').run(JSON.stringify(doc), p.id);
      for (const id of ['missing-asset', 'invalid-map', 'invalid-plan']) {
        assert.throws(
          () => s.changePublicSharedComment(link.token, input({ blockId: id })),
          /블록/,
        );
        assert.throws(
          () => s.changeSharedComment({ ...input({ blockId: id }), pageId: p.id }),
          /블록/,
        );
      }
    } finally {
      db.close();
    }
  }));
