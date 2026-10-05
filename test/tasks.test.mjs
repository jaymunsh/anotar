import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-tasks-'));
  let store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openStore(dir);
    },
  };
}

test('tasks persist through edit, completion, reopening and undoing completion', async (t) => {
  const f = await fixture(t);
  const task = f.store.createTask({ title: '  항공권 확인  ' });
  assert.equal(task.title, '항공권 확인');
  assert.equal(task.version, 1);
  assert.equal(task.status, 'open');
  assert.equal(task.dueDate, null);
  assert.equal(task.completedAt, null);
  const edited = f.store.updateTask({
    id: task.id,
    title: '항공권 날짜 확인',
    dueDate: '2028-02-29',
    expectedVersion: 1,
  });
  assert.equal(edited.version, 2);
  assert.equal(edited.createdAt, task.createdAt);
  const done = f.store.updateTask({ id: task.id, status: 'done', expectedVersion: 2 });
  assert.ok(done.completedAt);
  f.reopen();
  assert.equal(f.store.getTask(task.id).status, 'done');
  assert.equal(f.store.getTask(task.id).dueDate, '2028-02-29');
  const reopened = f.store.updateTask({ id: task.id, status: 'open', expectedVersion: 3 });
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.version, 4);
  assert.equal(f.store.updateTask({ id: task.id, status: 'open', expectedVersion: 4 }).version, 4);
});

test('stale changes and invalid titles, dates, statuses are rejected without changing a task', async (t) => {
  const { store } = await fixture(t);
  const task = store.createTask({ title: '계획 확인' });
  store.updateTask({ id: task.id, title: '수정한 계획', expectedVersion: 1 });
  assert.throws(
    () => store.updateTask({ id: task.id, title: '늦은 계획', expectedVersion: 1 }),
    /먼저 수정/,
  );
  for (const title of ['', ' '.repeat(2), '가'.repeat(501), 42])
    assert.throws(() => store.createTask({ title }));
  for (const dueDate of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-28', '0000-01-01', 12])
    assert.throws(() => store.updateTask({ id: task.id, dueDate, expectedVersion: 2 }));
  assert.throws(() => store.updateTask({ id: task.id, status: 'running', expectedVersion: 2 }));
  assert.throws(() => store.updateTask({ id: task.id, status: 'done' }));
  assert.equal(store.getTask(task.id).title, '수정한 계획');
  assert.equal(store.getTask(task.id).version, 2);
  assert.equal(store.updateTask({ id: randomUUID(), status: 'done', expectedVersion: 1 }), null);
});

test('home prioritizes due tasks while cursor pagination exposes every task and exact counts', async (t) => {
  const { store } = await fixture(t);
  const noDate = store.createTask({ title: '기한 없음' });
  const future = store.createTask({ title: '나중에', dueDate: '2026-10-01' });
  const overdue = store.createTask({ title: '지난 기한', dueDate: '2026-09-27' });
  const today = store.createTask({ title: '오늘', dueDate: '2026-09-28' });
  const first = store.listTasks({ status: 'open', limit: 2, today: '2026-09-28' });
  assert.deepEqual(
    first.items.map((x) => x.id),
    [overdue.id, today.id],
  );
  assert.deepEqual(first.counts, { open: 4, done: 0 });
  const second = store.listTasks({
    status: 'open',
    limit: 2,
    cursor: first.nextCursor,
    today: '2026-09-28',
  });
  assert.deepEqual(
    second.items.map((x) => x.id),
    [noDate.id, future.id],
  );
  assert.equal(second.nextCursor, null);
  store.updateTask({ id: today.id, status: 'done', expectedVersion: 1 });
  assert.deepEqual(store.listTasks({ status: 'done' }).counts, { open: 3, done: 1 });
  assert.equal(store.listTasks({ status: 'done' }).items[0].id, today.id);
  assert.throws(() => store.listTasks({ status: 'bad' }));
  assert.throws(() => store.listTasks({ cursor: 'bad' }));
});

test('retrying the same create request does not duplicate a task, independent identical titles do', async (t) => {
  const { store } = await fixture(t);
  const requestId = randomUUID();
  const first = store.createTask({ title: '확인하기', requestId });
  assert.equal(store.createTask({ title: '확인하기', requestId }).id, first.id);
  assert.throws(() => store.createTask({ title: '다른 요청', requestId }), /같은 요청/);
  assert.notEqual(store.createTask({ title: '확인하기' }).id, first.id);
  assert.equal(store.listTasks({}).counts.open, 2);
});

test('pagination restarts safely after concurrent completion, due-date reordering and Korea midnight', async (t) => {
  const { store } = await fixture(t);
  const tasks = Array.from({ length: 51 }, (_, index) =>
    store.createTask({ title: `할 일 ${index + 1}` }),
  );
  const first = store.listTasks({ limit: 50, today: '2026-09-28' });
  store.updateTask({ id: tasks[0].id, status: 'done', expectedVersion: 1 });
  const afterCompletion = store.listTasks({
    limit: 50,
    cursor: first.nextCursor,
    today: '2026-09-28',
  });
  assert.equal(afterCompletion.reset, true);
  assert.equal(afterCompletion.items.length, 50);
  assert.ok(afterCompletion.items.some((item) => item.id === tasks[50].id));
  assert.ok(!afterCompletion.items.some((item) => item.id === tasks[0].id));
  assert.equal(afterCompletion.nextCursor, null);

  const extra = store.createTask({ title: '마지막에 등록한 긴급 작업' });
  const beforeReorder = store.listTasks({ limit: 50, today: '2026-09-28' });
  store.updateTask({ id: extra.id, dueDate: '2026-09-28', expectedVersion: 1 });
  const afterReorder = store.listTasks({
    limit: 50,
    cursor: beforeReorder.nextCursor,
    today: '2026-09-28',
  });
  assert.equal(afterReorder.reset, true);
  assert.equal(afterReorder.items[0].id, extra.id);
  const last = store.listTasks({ limit: 50, cursor: afterReorder.nextCursor, today: '2026-09-28' });
  const allIds = [...afterReorder.items, ...last.items].map((item) => item.id);
  assert.equal(new Set(allIds).size, 51);
  assert.ok(allIds.includes(tasks[50].id));

  const afterMidnight = store.listTasks({
    limit: 50,
    cursor: afterReorder.nextCursor,
    today: '2026-09-29',
  });
  assert.equal(afterMidnight.reset, true);
  assert.equal(afterMidnight.items.length, 50);
});
