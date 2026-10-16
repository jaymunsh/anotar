import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const bundle = await build({
  stdin: {
    contents:
      "import * as repo from './src/sync/repository.ts'; import {workspaceRepository} from './src/sync/workspaceRepository.ts'; window.repo=repo;window.testNow=1000;window.adapter=workspaceRepository('w','d',()=>window.testNow);",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const context = await browser.newContext(),
    first = await context.newPage(),
    second = await context.newPage(),
    base = `http://127.0.0.1:${server.address().port}`;
  await first.goto(base);
  await second.goto(base);
  const initial = await first.evaluate(async () => {
    await repo.writeRecord('meta', 'w', ['sync'], { workspaceId: 'w', epoch: 'e', cursor: 0 });
    const operation = {
      protocolVersion: 1,
      workspaceId: 'w',
      epoch: 'e',
      operationId: 'fixed-op',
      deviceId: 'd',
      kind: 'task.create',
      entityId: 'task',
      baseVersion: null,
      payload: { title: 'old', dueDate: null },
    };
    await repo.saveLocalEntity({
      workspaceId: 'w',
      kind: 'task',
      id: 'task',
      value: { title: 'old', stage: 'todo' },
      pending: { operation, dependencies: [], state: 'queued', attempt: 0, nextAttemptAt: 0 },
    });
    window.oldLease = await adapter.acquireLease('first', testNow);
    return oldLease;
  });
  assert.equal(initial.fence, 1);
  assert.equal(await second.evaluate(() => adapter.acquireLease('second', testNow)), null);
  await first.evaluate(async () => {
    await repo.saveLocalEntity({
      workspaceId: 'w',
      kind: 'task',
      id: 'task',
      value: { title: 'new while sending', stage: 'todo' },
    });
    testNow = 40000;
  });
  const next = await second.evaluate(async () => {
    testNow = 40000;
    window.newLease = await adapter.acquireLease('second', testNow);
    return newLease;
  });
  assert.equal(next.fence, 2);
  const stale = await first.evaluate(async () => {
    const pending = (await repo.listRecords('outbox', 'w'))[0];
    return adapter.acknowledge(
      pending,
      {
        status: 'applied',
        item: { id: 'task', title: 'old', stage: 'todo', version: 1 },
        version: 1,
      },
      oldLease,
    );
  });
  assert.equal(stale, false);
  const result = await second.evaluate(async () => {
    const pending = (await repo.listRecords('outbox', 'w'))[0];
    await adapter.acknowledge(
      pending,
      {
        status: 'applied',
        item: { id: 'task', title: 'old', stage: 'todo', version: 1 },
        version: 1,
      },
      newLease,
    );
    return {
      entity: await repo.readLocalEntity({ workspaceId: 'w', kind: 'task', id: 'task' }),
      queue: await repo.listRecords('outbox', 'w'),
    };
  });
  assert.equal(result.entity.current.title, 'new while sending');
  assert.equal(result.entity.dirty, true);
  assert.equal(result.queue.length, 1);
  assert.equal(result.queue[0].operation.baseVersion, 1);
  assert.equal(result.queue[0].operation.payload.title, 'new while sending');
  assert.notEqual(result.queue[0].operation.operationId, 'fixed-op');
  const ordered = await second.evaluate(async () => {
    const base = { entityKind: 'capture', entityId: 'late', version: 1, missing: false };
    await repo.applyRemoteEntity('w', { ...base, readSeq: 2, tombstone: true, item: null });
    await repo.applyRemoteEntity('w', {
      ...base,
      readSeq: 1,
      tombstone: false,
      item: { id: 'late', text: 'stale', version: 1 },
    });
    return repo.readLocalEntity({ workspaceId: 'w', kind: 'capture', id: 'late' });
  });
  assert.equal(ordered.current, null);
  const repeatedReads = await second.evaluate(async () => {
    const incoming = { workspaceId: 'w', epoch: 'e', entityKind: 'capture', entityId: 'stable-read', version: 1, readSeq: 5, tombstone: false, missing: false, item: { id: 'stable-read', text: 'unchanged', version: 1 } };
    let notifications = 0;
    const off = repo.subscribeLocalChanges(() => notifications++);
    try {
      await repo.applyRemoteEntity('w', incoming);
      const first = notifications;
      for (let i = 0; i < 10; i++) await repo.applyRemoteEntity('w', incoming);
      await repo.applyRemoteEntity('w', { ...incoming, readSeq: 4, item: { ...incoming.item, text: 'stale' } });
      return { first, notifications, entity: await repo.readLocalEntity({ workspaceId: 'w', kind: 'capture', id: incoming.entityId }) };
    } finally { off(); }
  });
  assert.equal(repeatedReads.first, 1);
  assert.equal(repeatedReads.notifications, 1, 'unchanged and stale reads must not announce new changes');
  assert.equal(repeatedReads.entity.current.text, 'unchanged');
  assert.equal(repeatedReads.entity.lastRemoteReadSeq, 5);
  await first.reload();
  assert.equal(
    await first.evaluate(
      async () => (await repo.listRecords('outbox', 'w'))[0].operation.operationId,
    ),
    result.queue[0].operation.operationId,
  );
  const deletedAck = await second.evaluate(async () => {
    const operation={protocolVersion:1,workspaceId:'w',epoch:'e',deviceId:'d',operationId:'delete-ack',entityId:'delete-ack',kind:'task.create',baseVersion:null,payload:{title:'original',dueDate:null}};
    await repo.saveLocalEntity({workspaceId:'w',kind:'task',id:'delete-ack',value:{id:'delete-ack',title:'original',version:1},pending:{operation,dependencies:[],state:'sending',attempt:0,nextAttemptAt:0}});
    await repo.applyRemoteEntity('w',{entityKind:'task',entityId:'delete-ack',version:1,readSeq:99,tombstone:true,missing:false,item:null});
    const pending=(await repo.listRecords('outbox','w')).find(p=>p.operation.operationId==='delete-ack');
    await adapter.acknowledge(pending,{status:'applied',operationId:'delete-ack',replayed:true,item:{id:'delete-ack',title:'original',version:1},version:1},newLease);
    return (await repo.readLocalEntity({workspaceId:'w',kind:'task',id:'delete-ack'})).current;
  });
  assert.equal(deletedAck,null,'late successful acknowledgement cannot revive a newer tombstone');
  console.log(
    'PASS engine browser: two tabs, lease expiry/fencing, newer revision preservation, follow-up version, late tombstone protection, reload stable payload',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
