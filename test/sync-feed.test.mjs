import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixtures/sync.mjs';
import { syncDatabase } from '../server/sync/store.mjs';
import { readSyncChanges, readSyncEntity, bootstrapSync } from '../server/sync/feed.mjs';
test('legacy mutations, soft trash, restore and physical deletion invalidate every entity', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store);
  const c = store.createCapture({ kind: 'note', text: 'memo' }),
    p = store.createPage({ title: 'page' }),
    task = store.createTask({ title: 'task' });
  const before = readSyncEntity(store, 'capture', c.id);
  store.updateCapture({ id: c.id, text: 'edit', expectedVersion: 1 });
  store.updatePage({ id: p.id, title: 'edit', document: p.document, expectedVersion: 1 });
  store.updateTask({ id: task.id, stage: 'doing', expectedVersion: 1 });
  const trash = store.trashRecord({
    kind: 'capture',
    id: c.id,
    expectedVersion: 2,
    operationId: randomUUID(),
  });
  const dead = readSyncEntity(store, 'capture', c.id);
  assert.equal(dead.tombstone, true);
  assert.ok(dead.readSeq > before.readSeq);
  store.restoreTrash({ id: trash.item.id, operationId: randomUUID() });
  assert.equal(readSyncEntity(store, 'capture', c.id).tombstone, false);
  db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
  const changes = readSyncChanges(db, { after: 0, limit: 100 }).changes;
  for (const [kind, id] of [
    ['capture', c.id],
    ['page', p.id],
    ['task', task.id],
  ])
    assert.ok(changes.some((x) => x.entityKind === kind && x.entityId === id));
  assert.ok(changes.some((x) => x.entityId === task.id && x.action === 'tombstone'));
  assert.equal(readSyncEntity(store, 'capture', randomUUID()).missing, true);
});
test('asset metadata and AI state invalidate owner without changing document version', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store),
    c = store.createCapture({ kind: 'note', text: 'memo' }),
    p = store.createPage({ title: 'p' });
  let cursor = store.syncSession().headSeq;
  db.prepare(
    'INSERT INTO assets(id,capture_id,storage_key,name,mime,size) VALUES(?,?,?,?,?,?)',
  ).run(randomUUID(), c.id, 'key', 'p.png', 'image/png', 1);
  assert.ok(readSyncChanges(db, { after: cursor }).changes.some((x) => x.entityId === c.id));
  cursor = store.syncSession().headSeq;
  db.prepare(
    "INSERT INTO ai_jobs(id,request_id,fingerprint,page_id,source_version,request_json,status,created_at,updated_at) VALUES(?,?,?,?,1,'{}','queued',?,?)",
  ).run(
    randomUUID(),
    randomUUID(),
    'hash',
    p.id,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  assert.ok(readSyncChanges(db, { after: cursor }).changes.some((x) => x.entityId === p.id));
  cursor = store.syncSession().headSeq;
  db.exec("UPDATE ai_jobs SET status='running'");
  assert.ok(readSyncChanges(db, { after: cursor }).changes.some((x) => x.entityId === p.id));
  assert.equal(store.getPage(p.id).version, 1);
});
test('keyset bootstrap and ordered bounded change feed preserve concurrent mutation', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store);
  for (let i = 0; i < 104; i++) store.createTask({ title: `t${i}` });
  const first = bootstrapSync(store, { kind: 'task', limit: 2 });
  assert.equal(first.items.length, 2);
  const added = store.createTask({ title: 'new' });
  store.updateTask({ id: added.id, expectedVersion: 1, stage: 'done' });
  const rest = bootstrapSync(store, { kind: 'task', afterId: first.nextAfterId, limit: 100 });
  assert.ok(rest.items.every((x) => x.id > first.nextAfterId));
  const batch = readSyncChanges(db, { after: 0, limit: 1000 });
  assert.equal(batch.changes.length, 100);
  assert.deepEqual(
    batch.changes.map((x) => x.seq),
    batch.changes.map((x) => x.seq).sort((a, b) => a - b),
  );
  assert.ok(readSyncChanges(db, { after: batch.nextAfter }).changes.length > 0);
  const p = store.createPage({ title: 'metadata' });
  assert.equal(
    bootstrapSync(store, { kind: 'page' }).items.find((x) => x.id === p.id).document,
    undefined,
  );
});
test('page metadata bootstrap and feed never parse a document body', async t => {
 const store=await fixture(t);const page=store.createPage({title:'metadata body'});
 const original=store.getPage;store.getPage=()=>{throw Error('document body must not load');};
 try {
  const item=readSyncEntity(store,'page',page.id,{metadata:true});
  assert.equal(item.item.title,'metadata body');assert.equal(item.item.document,undefined);
  assert.equal(bootstrapSync(store,{kind:'page'}).items[0].id,page.id);
 } finally {store.getPage=original;}
});
test('canonical and bootstrap reads carry the same transaction workspace epoch',async t=>{
  const store = await fixture(t);
  const page = store.createPage({title:'identity'});
  const identity = store.syncSession();
  for(const response of [readSyncEntity(store,'page',page.id),readSyncEntity(store,'page',page.id,{metadata:true}),bootstrapSync(store,{kind:'page'})]) {
    assert.equal(response.workspaceId,identity.workspaceId);
    assert.equal(response.epoch,identity.epoch);
  }
});
