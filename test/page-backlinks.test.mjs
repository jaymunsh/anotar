import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPageBacklinks } from '../server/pageBacklinks.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE pages(id TEXT PRIMARY KEY,title TEXT,icon TEXT,
    updated_at TEXT,document TEXT,deleted_at TEXT)`);
  const insert = (id, blocks = []) =>
    db
      .prepare('INSERT INTO pages VALUES (?,?,?,?,?,NULL)')
      .run(id, `Page ${id}`, '', '2026-10-05', JSON.stringify({ schemaVersion: 1, blocks }));
  return { db, insert };
}
const pageBlock = (id) => ({
  type: 'page',
  props: { pageId: id, title: 'Old title' },
  children: [],
});
const link = (href) => ({
  type: 'link',
  href,
  content: [{ type: 'text', text: 'link', styles: {} }],
});

test('backfill and triggers recognize nested page blocks and inline links, deduplicate and exclude external/text lookalikes', (t) => {
  const { db, insert } = fixture(t);
  insert('aa');
  insert('bb', [
    {
      type: 'paragraph',
      content: [
        link('/pages/aa'),
        link('https://example.com/pages/aa'),
        { type: 'text', text: '/pages/cc', styles: {} },
      ],
      children: [pageBlock('aa')],
    },
  ]);
  const store = createPageBacklinks(db);
  assert.deepEqual(
    store.listPageBacklinks('aa').items.map((item) => item.id),
    ['bb'],
  );
  assert.equal(store.listPageBacklinks('cc').items.length, 0);
  insert('cc', [pageBlock('aa')]);
  assert.deepEqual(
    store.listPageBacklinks('aa').items.map((item) => item.id),
    ['bb', 'cc'],
  );
  insert('dd', [{ type: 'table', content: { rows: [{ cells: [[link('/pages/aa')]] }] } }]);
  insert('ee', [{ type: 'paragraph', content: [link('/pages/aa?aiJob=private#section')] }]);
  assert.equal(store.listPageBacklinks('aa').items.length, 4);
  assert.equal('document' in store.listPageBacklinks('aa').items[0], false);
  db.prepare('UPDATE pages SET document=? WHERE id=?').run(JSON.stringify({ blocks: [] }), 'bb');
  assert.deepEqual(
    store.listPageBacklinks('aa').items.map((item) => item.id),
    ['cc', 'dd', 'ee'],
  );
});

test('trash/restore, hard deletion, self links and transaction rollback preserve active backlinks', (t) => {
  const { db, insert } = fixture(t);
  const store = createPageBacklinks(db);
  insert('aa', [pageBlock('aa')]);
  insert('bb', [pageBlock('aa')]);
  assert.equal(store.listPageBacklinks('aa').items.length, 1);
  db.exec("UPDATE pages SET deleted_at='today' WHERE id='bb'");
  assert.equal(store.listPageBacklinks('aa').items.length, 0);
  db.exec("UPDATE pages SET deleted_at=NULL WHERE id='bb'");
  assert.equal(store.listPageBacklinks('aa').items.length, 1);
  db.exec("UPDATE pages SET deleted_at='today' WHERE id='aa'");
  assert.equal(store.listPageBacklinks('aa').items.length, 0);
  db.exec(
    "UPDATE pages SET deleted_at=NULL WHERE id='aa'; BEGIN; UPDATE pages SET document='{\"blocks\":[]}' WHERE id='bb'; ROLLBACK;",
  );
  assert.equal(store.listPageBacklinks('aa').items.length, 1);
  db.exec("DELETE FROM pages WHERE id='bb'");
  assert.equal(store.listPageBacklinks('aa').items.length, 0);
});

test('bounded deterministic pagination and restarting index initialization preserve results', (t) => {
  const { db, insert } = fixture(t);
  let store = createPageBacklinks(db);
  insert('aa');
  for (const id of ['bb', 'cc', 'dd']) insert(id, [pageBlock('aa')]);
  assert.equal(store.listPageBacklinks('aa', { limit: 2 }).nextOffset, 2);
  assert.deepEqual(
    store.listPageBacklinks('aa', { limit: 2, offset: 2 }).items.map((item) => item.id),
    ['dd'],
  );
  assert.equal(store.listPageBacklinks('aa', { limit: 2, offset: 2 }).nextOffset, null);
  store = createPageBacklinks(db);
  assert.equal(store.listPageBacklinks('aa').items.length, 3);
  const plan = db
    .prepare('EXPLAIN QUERY PLAN SELECT source_id FROM page_backlinks WHERE target_id=?')
    .all('aa');
  assert.ok(plan.some((row) => /SEARCH.*INDEX/.test(row.detail)));
});
