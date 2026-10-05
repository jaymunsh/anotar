import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createTaskStore, TaskConflictError } from '../server/tasks.mjs';
import { createPlanConnectionStore, publicPlanTaskProjection } from '../server/planConnections.mjs';
import { PageConflictError, PageValidationError } from '../server/pages.mjs';
import { renderSharedPage } from '../server/publicPage.mjs';
const plan = () => ({
  version: 1,
  title: '하루 일정',
  timezone: 'Asia/Seoul',
  entries: [{ id: 'visit-a', date: '2026-10-03', start: '09:00', end: '10:00', title: '경복궁' }],
});
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'PRAGMA foreign_keys=ON;CREATE TABLE pages(id TEXT PRIMARY KEY,title TEXT,deleted_at TEXT);CREATE TABLE captures(id TEXT PRIMARY KEY,text TEXT,url TEXT,deleted_at TEXT)',
  );
  const id = randomUUID(),
    blockId = randomUUID();
  db.prepare('INSERT INTO pages(id,title) VALUES(?,?)').run(id, '준비 계획');
  const page = {
    id,
    title: '준비 계획',
    updatedAt: new Date().toISOString(),
    version: 2,
    document: {
      schemaVersion: 1,
      blocks: [
        {
          id: blockId,
          type: 'itinerary',
          props: { data: JSON.stringify(plan()), assetId: '' },
          content: [],
          children: [],
        },
      ],
    },
  };
  const map = new Map();
  const memos = {
    get: (id) => map.get(id),
    set: (id, value) => {
      map.set(id, value);
      db.prepare('INSERT OR REPLACE INTO captures(id,text,url) VALUES(?,?,?)').run(
        id,
        value.text || '',
        value.url || null,
      );
    },
    delete: (id) => {
      map.delete(id);
      db.prepare('UPDATE captures SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
    },
  };
  const tasks = createTaskStore(db);
  const owner = {
    ...tasks,
    getPage: (target) => (target === id ? page : null),
    getCapture: (id) => memos.get(id) || null,
  };
  const store = createPlanConnectionStore(db, () => owner);
  const input = (extra = {}) => ({
    requestId: randomUUID(),
    pageId: id,
    blockId,
    entryId: 'visit-a',
    expectedPageVersion: page.version,
    ...extra,
  });
  return { db, page, memos, tasks, store, input, blockId };
}
test('normalized preparation creates once, Task status single source, no page mutations', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    const before = JSON.stringify(page),
      request = input({ action: 'create-task', title: '운영 시간 확인' });
    const first = store.changePlanConnection(request);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].shared, false);
    assert.equal(store.changePlanConnection(request).replayed, true);
    assert.equal(tasks.listTasks().items.length, 1);
    const row = first.items[0];
    store.changePlanConnection(
      input({
        action: 'toggle-task',
        relationId: row.id,
        expectedVersion: row.version,
        expectedTaskVersion: row.task.version,
        status: 'done',
      }),
    );
    assert.equal(tasks.getTask(row.targetId).status, 'done');
    assert.equal(store.listPlanConnections(page.id).items[0].task.status, 'done');
    assert.equal(JSON.stringify(page), before);
  } finally {
    db.close();
  }
});
test('link duplicate no extra row, optimistic relation/task/page guards and UUID payload guard', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    const task = tasks.createTask({ title: '予約確認' }),
      request = input({ action: 'link', kind: 'task', targetId: task.id });
    const row = store.changePlanConnection(request).items[0];
    assert.equal(
      store.changePlanConnection({ ...request, requestId: randomUUID() }).items.length,
      1,
    );
    assert.throws(
      () => store.changePlanConnection({ ...request, targetId: randomUUID() }),
      PageConflictError,
    );
    const shared = store.changePlanConnection(
      input({ action: 'share', relationId: row.id, expectedVersion: row.version, shared: true }),
    ).items[0];
    assert.throws(
      () =>
        store.changePlanConnection(
          input({
            action: 'share',
            relationId: row.id,
            expectedVersion: row.version,
            shared: false,
          }),
        ),
      PageConflictError,
    );
    tasks.updateTask({ id: task.id, expectedVersion: task.version, title: '予約確認済' });
    assert.throws(
      () =>
        store.changePlanConnection(
          input({
            action: 'toggle-task',
            relationId: row.id,
            expectedVersion: shared.version,
            expectedTaskVersion: task.version,
            status: 'done',
          }),
        ),
      TaskConflictError,
    );
    page.version++;
    assert.throws(
      () =>
        store.changePlanConnection({
          ...input({ action: 'link', kind: 'task', targetId: task.id }),
          expectedPageVersion: 2,
        }),
      PageConflictError,
    );
    assert.equal(store.changePlanConnection(request).replayed, true);
  } finally {
    db.close();
  }
});
test('public projection only explicit title/status, hides private links/deleted tasks/missing entries', () => {
  const { db, page, memos, tasks, store, input } = setup();
  try {
    const memoId = randomUUID();
    memos.set(memoId, { id: memoId, text: '엄격한 비공개 메모 내용' });
    const task = tasks.createTask({ title: '입장권 <script> 확인' });
    let row = store.changePlanConnection(input({ action: 'link', kind: 'task', targetId: task.id }))
      .items[0];
    store.changePlanConnection(input({ action: 'link', kind: 'memo', targetId: memoId }));
    assert.deepEqual(publicPlanTaskProjection(db, page), []);
    assert.throws(() => {
      const memo = store.listPlanConnections(page.id).items.find((r) => r.kind === 'memo');
      store.changePlanConnection(
        input({
          action: 'share',
          relationId: memo.id,
          expectedVersion: memo.version,
          shared: true,
        }),
      );
    }, PageValidationError);
    store.changePlanConnection(
      input({ action: 'share', relationId: row.id, expectedVersion: row.version, shared: true }),
    );
    const projection = publicPlanTaskProjection(db, page);
    assert.deepEqual(projection[0].tasks, [{ title: task.title, status: 'open' }]);
    const html = renderSharedPage(page, 'public', new Map(), { planTasks: projection });
    assert.match(html, /입장권 &lt;script&gt; 확인/);
    assert.doesNotMatch(html, new RegExp(task.id + '|' + memoId + '|엄격한 비공개'));
    memos.delete(memoId);
    assert.equal(
      store.listPlanConnections(page.id).items.find((r) => r.kind === 'memo').unavailable,
      true,
    );
    db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
    assert.deepEqual(publicPlanTaskProjection(db, page), []);
    assert.equal(
      store.listPlanConnections(page.id).items.find((r) => r.kind === 'task').unavailable,
      true,
    );
    page.document.blocks = [];
    assert.equal(store.listPlanConnections(page.id).items[0].sourceMissing, true);
    assert.throws(
      () => store.changePlanConnection(input({ action: 'create-task', title: '새 준비' })),
      PageValidationError,
    );
  } finally {
    db.close();
  }
});
test('public projection excludes task relations nested under private page placeholders', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    const task = tasks.createTask({ title: '숨겨진 준비' }),
      row = store.changePlanConnection(input({ action: 'link', kind: 'task', targetId: task.id }))
        .items[0];
    store.changePlanConnection(
      input({ action: 'share', relationId: row.id, expectedVersion: row.version, shared: true }),
    );
    page.document.blocks = [
      { id: randomUUID(), type: 'page', props: {}, content: [], children: page.document.blocks },
    ];
    assert.deepEqual(publicPlanTaskProjection(db, page), []);
  } finally {
    db.close();
  }
});

test('bounded relation/options lists and duplicate attach at capacity', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    let first;
    for (let i = 0; i < 20; i++) {
      const task = tasks.createTask({ title: `준비 ${i}` });
      const row = store
        .changePlanConnection(input({ action: 'link', kind: 'task', targetId: task.id }))
        .items.find((r) => r.targetId === task.id);
      if (!first) first = row;
    }
    assert.equal(
      store.changePlanConnection(input({ action: 'link', kind: 'task', targetId: first.targetId }))
        .items.length,
      20,
    );
    assert.throws(
      () => store.changePlanConnection(input({ action: 'create-task', title: '넘치는 준비' })),
      PageValidationError,
    );
    assert.equal(
      tasks.listTasks().items.length,
      20,
      'rejected relation does not create an orphan Task',
    );
    for (let i = 20; i < 45; i++) tasks.createTask({ title: `준비 ${i}` });
    assert.equal(
      store.listPlanConnectionOptions(page.id, { kind: 'task', q: '' }).items.length,
      30,
    );
    assert.equal(
      store.listPlanConnectionOptions(page.id, { kind: 'task', q: "' OR 1=1 --" }).items.length,
      0,
    );
    assert.throws(
      () => store.listPlanConnectionOptions(page.id, { q: 'x'.repeat(161) }),
      PageValidationError,
    );
    assert.throws(
      () => store.changePlanConnection(input({ action: 'unlink' })),
      PageValidationError,
    );
  } finally {
    db.close();
  }
});

test('unlink a removed entry or block relation without deleting the Task', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    const task = tasks.createTask({ title: '남겨둘 준비' }),
      row = store.changePlanConnection(input({ action: 'link', kind: 'task', targetId: task.id }))
        .items[0];
    page.document.blocks = [];
    page.version++;
    assert.equal(store.listPlanConnections(page.id).items[0].sourceMissing, true);
    const result = store.changePlanConnection(
      input({ action: 'unlink', relationId: row.id, expectedVersion: row.version }),
    );
    assert.equal(result.items.length, 0);
    assert.equal(tasks.getTask(task.id).title, '남겨둘 준비');
  } finally {
    db.close();
  }
});
test('successful receipt replay survives later entry deletion and rejects changed payload', () => {
  const { db, page, tasks, store, input } = setup();
  try {
    const request = input({ action: 'create-task', title: '응답 유실된 준비' });
    store.changePlanConnection(request);
    page.document.blocks = [];
    page.version++;
    assert.equal(store.changePlanConnection(request).replayed, true);
    assert.equal(tasks.listTasks().items.filter((t) => t.title === '응답 유실된 준비').length, 1);
    assert.throws(
      () => store.changePlanConnection({ ...request, title: '다른 내용' }),
      PageConflictError,
    );
    assert.throws(
      () =>
        store.changePlanConnection(
          input({ action: 'create-task', title: '삭제된 일정의 새 준비' }),
        ),
      PageValidationError,
    );
  } finally {
    db.close();
  }
});
