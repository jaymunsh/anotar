import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspacePageStore } from '../server/workspacePages.mjs';

function fixture(t, path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(
    `PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY,title TEXT,icon TEXT,parent_id TEXT,position REAL,document TEXT,version INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT);`,
  );
  t.after(() => db.close());
  const store = createWorkspacePageStore(db, () => ({
    getPage() {
      throw new Error('Metadata must not read Page JSON');
    },
  }));
  function page(title = '원본 페이지') {
    const id = randomUUID();
    db.prepare('INSERT INTO pages VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(
      id,
      title,
      '',
      null,
      0,
      '{"schemaVersion":1,"blocks":[]}',
      7,
      '2020-01-01T00:00:00.000Z',
      '2020-01-02T00:00:00.000Z',
    );
    return id;
  }
  return { db, store, page };
}

test('workspace preferences preserve full Page bytes, version and update time; listing is metadata only', (t) => {
  const { db, store, page } = fixture(t);
  const id = page();
  const before = db.prepare('SELECT * FROM pages WHERE id=?').get(id);
  store.setPageWorkspace({ pageId: id, favorite: true, visited: true });
  const result = store.listWorkspacePages();
  assert.deepEqual(db.prepare('SELECT * FROM pages WHERE id=?').get(id), before);
  assert.equal(result.favorites[0].id, id);
  assert.equal(result.recentVisited[0].id, id);
  assert.equal(result.favorites[0].favorite, true);
  assert.equal(typeof result.favorites[0].lastVisitedAt, 'string');
  assert.equal(Object.hasOwn(result.favorites[0], 'document'), false);
  assert.deepEqual(result.favoriteIds, [id]);
});

test('favorites are bounded to 100 stored preferences and lists to eight, with stable visit ordering', (t) => {
  const { store, page } = fixture(t);
  const ids = Array.from({ length: 101 }, () => page());
  for (const id of ids.slice(0, 100))
    store.setPageWorkspace({ pageId: id, favorite: true, visited: true });
  assert.throws(() => store.setPageWorkspace({ pageId: ids[100], favorite: true }), /100/);
  assert.throws(
    () => store.setPageWorkspace({ pageId: ids[100], favorite: true, visited: true }),
    /100/,
  );
  assert.equal(
    store.listWorkspacePages().recentVisited.some((item) => item.id === ids[100]),
    false,
    'Rejected favorite and visit are atomic',
  );
  assert.equal(store.listWorkspacePages().favoriteIds.length, 100);
  assert.equal(store.listWorkspacePages().favorites.length, 8);
  assert.equal(store.listWorkspacePages().recentVisited.length, 8);
  assert.equal(store.listWorkspacePages().recentVisited[0].id, ids[99]);
  const prior = store.listWorkspacePages().recentVisited[0].lastVisitedAt;
  store.setPageWorkspace({ pageId: ids[0], visited: true });
  assert.equal(store.listWorkspacePages().recentVisited[0].id, ids[0]);
  assert.ok(store.listWorkspacePages().recentVisited[0].lastVisitedAt > prior);
  store.setPageWorkspace({ pageId: ids[0], favorite: false });
  store.setPageWorkspace({ pageId: ids[100], favorite: true });
  assert.equal(store.listWorkspacePages().favoriteIds.length, 100);
});

test('metadata updates use the latest active title without a document read and permanent deletion cascades', (t) => {
  const { db, store, page } = fixture(t);
  const id = page();
  store.setPageWorkspace({ pageId: id, favorite: true, visited: true });
  db.prepare('UPDATE pages SET title=?,icon=? WHERE id=?').run('변경한 제목', '📄', id);
  const result = store.listWorkspacePages();
  assert.equal(result.favorites[0].title, '변경한 제목');
  assert.equal(result.recentVisited[0].icon, '📄');
  db.prepare('DELETE FROM pages WHERE id=?').run(id);
  assert.equal(db.prepare('SELECT count(*) AS count FROM page_workspace').get().count, 0);
  assert.deepEqual(store.listWorkspacePages(), {
    favorites: [],
    recentVisited: [],
    favoriteIds: [],
  });
});

test('trash is excluded and cannot gain preferences; restoring retains earlier personal preference', (t) => {
  const { db, store, page } = fixture(t);
  const id = page();
  store.setPageWorkspace({ pageId: id, favorite: true, visited: true });
  db.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-09-30', id);
  assert.deepEqual(store.listWorkspacePages(), {
    favorites: [],
    recentVisited: [],
    favoriteIds: [],
  });
  assert.throws(() => store.setPageWorkspace({ pageId: id, visited: true }), /찾을/);
  db.prepare('UPDATE pages SET deleted_at=NULL WHERE id=?').run(id);
  assert.deepEqual(store.listWorkspacePages().favoriteIds, [id]);
});

test('preference API rejects implicit booleans and no action; visited false never changes visit time', (t) => {
  const { store, page } = fixture(t);
  const id = page();
  for (const args of [
    {},
    { pageId: id },
    { pageId: id, favorite: 1 },
    { pageId: id, visited: 'true' },
    { pageId: id, favorite: true, other: true },
  ])
    assert.throws(() => store.setPageWorkspace(args));
  assert.throws(() => store.setPageWorkspace({ pageId: randomUUID(), visited: true }), /찾을/);
  store.setPageWorkspace({ pageId: id, visited: true });
  const first = store.listWorkspacePages().recentVisited[0].lastVisitedAt;
  store.setPageWorkspace({ pageId: id, favorite: true, visited: false });
  assert.equal(store.listWorkspacePages().recentVisited[0].lastVisitedAt, first);
});

test('preferences persist across independent SQLite sessions and query plans use navigation indexes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-workspace-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'workspace.sqlite');
  const first = fixture(t, path);
  const id = first.page();
  first.store.setPageWorkspace({ pageId: id, favorite: true, visited: true });
  const second = fixture(t, path);
  assert.deepEqual(second.store.listWorkspacePages().favoriteIds, [id]);
  assert.equal(second.store.listWorkspacePages().recentVisited[0].id, id);
  const plans = second.db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT page_id FROM page_workspace WHERE last_visited_at IS NOT NULL ORDER BY last_visited_at DESC,page_id LIMIT 8',
    )
    .all();
  assert.ok(plans.some((row) => row.detail.includes('page_workspace_visits')));
});
