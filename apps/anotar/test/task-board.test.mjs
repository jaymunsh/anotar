import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTaskStore } from '../server/tasks.mjs';

async function fixture(t, legacy = false) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-board-test-'));
  let db = new DatabaseSync(join(dir, 'tasks.sqlite'));
  if (legacy)
    db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),due_date TEXT,position INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,version INTEGER NOT NULL DEFAULT 1,create_request_id TEXT UNIQUE,create_payload TEXT);
    INSERT INTO tasks VALUES('old-open','기존 대기','open',NULL,0,'2026-09-01','2026-09-01',NULL,3,NULL,NULL);
    INSERT INTO tasks VALUES('old-done','기존 완료','done',NULL,1,'2026-09-01','2026-09-02','2026-09-02',4,NULL,NULL);`);
  let store = createTaskStore(db);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    reopen() {
      db.close();
      db = new DatabaseSync(join(dir, 'tasks.sqlite'));
      store = createTaskStore(db);
    },
  };
}

test('board stage migrates existing tasks additively without changing original versions or dates', async (t) => {
  const f = await fixture(t, true);
  assert.equal(f.store.getTask('old-open').stage, 'todo');
  assert.equal(f.store.getTask('old-done').stage, 'done');
  assert.equal(f.store.getTask('old-open').version, 3);
  assert.equal(f.store.getTask('old-done').completedAt, '2026-09-02');
  f.reopen();
  assert.equal(f.store.getTask('old-open').updatedAt, '2026-09-01');
});

test('board transitions persist, preserve legacy outstanding counts, and reject stale or contradictory moves', async (t) => {
  const f = await fixture(t);
  const a = f.store.createTask({ title: '진행할 일' });
  assert.equal(a.stage, 'todo');
  const doing = f.store.updateTask({ id: a.id, expectedVersion: 1, stage: 'doing' });
  assert.equal(doing.stage, 'doing');
  assert.equal(doing.status, 'open');
  assert.equal(doing.completedAt, null);
  assert.equal(doing.createdAt, a.createdAt);
  assert.throws(
    () => f.store.updateTask({ id: a.id, expectedVersion: 1, stage: 'done' }),
    /먼저 수정/,
  );
  assert.throws(() => f.store.updateTask({ id: a.id, expectedVersion: 2, stage: 'invalid' }));
  assert.throws(() =>
    f.store.updateTask({ id: a.id, expectedVersion: 2, status: 'done', stage: 'doing' }),
  );
  assert.equal(f.store.getTask(a.id).version, 2);
  f.reopen();
  assert.equal(f.store.getTask(a.id).stage, 'doing');
  const list = f.store.listTasks({ status: 'open' });
  assert.equal(list.items[0].id, a.id);
  assert.deepEqual(list.counts, { open: 1, done: 0 });
  assert.deepEqual(list.stageCounts, { todo: 0, doing: 1, done: 0 });
  const same = f.store.updateTask({ id: a.id, expectedVersion: 2, stage: 'doing' });
  assert.equal(same.version, 2);
  const edit = f.store.updateTask({ id: a.id, expectedVersion: 2, title: '진행 중 수정' });
  assert.equal(edit.stage, 'doing');
  const done = f.store.updateTask({ id: a.id, expectedVersion: 3, status: 'done' });
  assert.equal(done.stage, 'done');
  assert.ok(done.completedAt);
  const reopened = f.store.updateTask({ id: a.id, expectedVersion: 4, stage: 'doing' });
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.completedAt, null);
  const reset = f.store.updateTask({ id: a.id, expectedVersion: 5, status: 'open' });
  assert.equal(reset.stage, 'todo');
});

test('stage pagination isolates columns, retains exact totals and resets on moves', async (t) => {
  const f = await fixture(t);
  const tasks = Array.from({ length: 24 }, (_, i) => f.store.createTask({ title: `할 일 ${i}` }));
  f.store.updateTask({ id: tasks[0].id, expectedVersion: 1, stage: 'doing' });
  f.store.updateTask({ id: tasks[1].id, expectedVersion: 1, stage: 'done' });
  const first = f.store.listTasks({ stage: 'todo', limit: 10 });
  assert.equal(first.items.length, 10);
  assert.ok(first.items.every((x) => x.stage === 'todo'));
  assert.deepEqual(first.stageCounts, { todo: 22, doing: 1, done: 1 });
  assert.throws(() => f.store.listTasks({ stage: 'doing', cursor: first.nextCursor }));
  const second = f.store.listTasks({ stage: 'todo', limit: 10, cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 20);
  f.store.updateTask({ id: tasks[2].id, expectedVersion: 1, stage: 'doing' });
  const reset = f.store.listTasks({ stage: 'todo', limit: 10, cursor: first.nextCursor });
  assert.equal(reset.reset, true);
  assert.ok(!reset.items.some((x) => x.id === tasks[2].id));
  assert.equal(f.store.listTasks({ stage: 'doing' }).items.length, 2);
  assert.equal(f.store.listTasks({ stage: 'done' }).items.length, 1);
  assert.throws(() => f.store.listTasks({ stage: 'invalid' }));
});
