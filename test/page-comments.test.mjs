import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

test('owner comments persist with replies, resolve and idempotent mutations; lost blocks retain excerpts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-comments-'));
  let s = openStore(dir);
  try {
    let page = s.createPage({ title: 'Comment' });
    page = s.updatePage({
      id: page.id,
      title: page.title,
      expectedVersion: page.version,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'anchor',
            type: 'paragraph',
            props: {},
            children: [],
            content: [{ type: 'text', text: '인용할 내용', styles: {} }],
          },
        ],
      },
    });
    const requestId = randomUUID(),
      input = { pageId: page.id, blockId: 'anchor', requestId, text: '첫 댓글' };
    const first = s.changePageComment(input);
    assert.equal(first.items[0].excerpt, '인용할 내용');
    assert.equal(s.changePageComment(input).items.length, 1);
    assert.throws(() => s.changePageComment({ ...input, text: 'changed' }), /다른|충돌/);
    let t = first.items[0];
    s.changePageComment({
      pageId: page.id,
      threadId: t.id,
      requestId: randomUUID(),
      expectedVersion: t.version,
      action: 'reply',
      text: '답글',
    });
    assert.throws(
      () =>
        s.changePageComment({
          pageId: page.id,
          threadId: t.id,
          requestId: randomUUID(),
          expectedVersion: t.version,
          action: 'resolve',
          resolved: true,
        }),
      /변경/,
    );
    t = s.listPageComments(page.id)[0];
    s.changePageComment({
      pageId: page.id,
      threadId: t.id,
      requestId: randomUUID(),
      expectedVersion: t.version,
      action: 'resolve',
      resolved: true,
    });
    s.updatePage({
      id: page.id,
      title: page.title,
      document: {
        schemaVersion: 1,
        blocks: [{ id: 'another', type: 'paragraph', props: {}, children: [], content: [] }],
      },
      expectedVersion: page.version,
    });
    s.close();
    s = openStore(dir);
    t = s.listPageComments(page.id)[0];
    assert.equal(t.orphaned, true);
    assert.equal(t.excerpt, '인용할 내용');
    assert.equal(t.resolved, true);
    assert.equal(t.comments.length, 2);
    s.changePageComment({
      pageId: page.id,
      threadId: t.id,
      requestId: randomUUID(),
      expectedVersion: t.version,
      action: 'delete',
    });
    assert.equal(s.listPageComments(page.id).length, 0);
    assert.throws(
      () => s.changePageComment({ ...input, requestId: randomUUID(), blockId: 'missing' }),
      /블록/,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('private comments reject cross-page thread IDs and hidden owners, but survive trash restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-comment-boundary-'));
  const s = openStore(dir);
  try {
    const a = s.createPage({ title: 'A' }),
      b = s.createPage({ title: 'B' });
    const t = s.changePageComment({
      pageId: a.id,
      blockId: a.document.blocks[0].id,
      text: 'private',
      requestId: randomUUID(),
    }).items[0];
    assert.throws(
      () =>
        s.changePageComment({
          pageId: b.id,
          threadId: t.id,
          action: 'reply',
          text: 'no',
          expectedVersion: 1,
          requestId: randomUUID(),
        }),
      /대화/,
    );
    assert.throws(
      () =>
        s.changePageComment({
          pageId: a.id,
          blockId: a.document.blocks[0].id,
          text: 'x'.repeat(2001),
          requestId: randomUUID(),
        }),
      /2,000/,
    );
    s.trashRecord({
      kind: 'page',
      id: a.id,
      expectedVersion: a.version,
      operationId: randomUUID(),
    });
    assert.throws(() => s.listPageComments(a.id), /페이지/);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('long comment conversations have a bounded reply policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-comments-cap-'));
  const s = openStore(dir);
  try {
    const page = s.createPage(),
      t = s.changePageComment({
        pageId: page.id,
        blockId: page.document.blocks[0].id,
        text: 'start',
        requestId: randomUUID(),
      }).items[0];
    for (let i = 1; i < 100; i++) {
      const latest = s.listPageComments(page.id)[0];
      s.changePageComment({
        pageId: page.id,
        threadId: t.id,
        action: 'reply',
        text: 'reply ' + i,
        expectedVersion: latest.version,
        requestId: randomUUID(),
      });
    }
    const latest = s.listPageComments(page.id)[0];
    assert.throws(
      () =>
        s.changePageComment({
          pageId: page.id,
          threadId: t.id,
          action: 'reply',
          text: '101',
          expectedVersion: latest.version,
          requestId: randomUUID(),
        }),
      /100/,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('comment summaries expose actual counts and state without message text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-comment-summary-')),
    s = openStore(dir);
  try {
    const page = s.createPage(),
      t = s.changePageComment({
        pageId: page.id,
        blockId: page.document.blocks[0].id,
        text: 'private text',
        requestId: randomUUID(),
      }).items[0];
    s.changePageComment({
      pageId: page.id,
      threadId: t.id,
      action: 'reply',
      text: 'private reply',
      expectedVersion: t.version,
      requestId: randomUUID(),
    });
    let summary = s.listPageCommentSummary(page.id);
    assert.deepEqual(summary, [{ blockId: t.blockId, count: 2, resolved: false }]);
    assert.ok(!JSON.stringify(summary).includes('private'));
    const latest = s.listPageComments(page.id)[0];
    s.changePageComment({
      pageId: page.id,
      threadId: t.id,
      action: 'resolve',
      resolved: true,
      expectedVersion: latest.version,
      requestId: randomUUID(),
    });
    assert.equal(s.listPageCommentSummary(page.id)[0].resolved, true);
    s.trashRecord({
      kind: 'page',
      id: page.id,
      expectedVersion: page.version,
      operationId: randomUUID(),
    });
    assert.throws(() => s.listPageCommentSummary(page.id), /페이지/);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
