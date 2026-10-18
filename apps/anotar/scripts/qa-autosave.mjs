import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp, waitForAsync } from './fixtures/offline-app.mjs';
const app = await offlineApp(),
  evidence = '.omo/evidence/autosave',
  report = { checks: [], measurements: {} };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(30);
  }
  throw Error('operation not observed');
}
try {
  const context = await app.browser.newContext(),
    page = await context.newPage(),
    requests = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/sync/operations')) requests.push(r.postDataJSON());
  });
  const { item: fixturePage } = await app.request('/api/pages', { title: 'autosave fixture' });
  await page.goto(app.base + '/pages/' + fixturePage.id);
  const title = page.getByLabel('페이지 제목', { exact: true });
  await title.waitFor();
  await pause(500);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX';
  const start = requests.length;
  await title.fill('');
  await title.pressSequentially(text, { delay: 35 });
  assert.equal(
    requests.slice(start).filter((r) => r.kind === 'page.update').length,
    0,
    'text is not sent on every input',
  );
  await pause(1200);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  await pause(300);
  const typed = requests.slice(start).filter((r) => r.kind === 'page.update');
  assert.equal(typed.length, 1);
  assert.equal(typed.at(-1).payload.title, text);
  report.measurements.rapidPageTyping = { inputEvents: text.length, serverOperations: typed.length };
  report.checks.push('real page UI: rapid title typing combines into one latest server operation');

  const continuousStart = requests.length,
    time = Date.now();
  for (let i = 1; i <= 30; i++) {
    await title.fill('continuous ' + i);
    await pause(200);
  }
  assert.ok(requests.length > continuousStart, 'max wait dispatches before typing stops');
  const firstOp = requests.slice(continuousStart).find((r) => r.kind === 'page.update');
  assert.ok(firstOp && firstOp.payload.title !== 'continuous 30');
  await pause(1200);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  await pause(300);
  assert.equal(
    requests.filter((r) => r.kind === 'page.update').at(-1).payload.title,
    'continuous 30',
  );
  report.measurements.continuousTyping = {
    durationMs: Date.now() - time,
    serverOperations: requests.slice(continuousStart).filter((r) => r.kind === 'page.update').length,
  };
  report.checks.push(
    'real page UI: continuous typing dispatches at max wait and preserves final value',
  );

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await title.fill('offline durable title');
  await pause(250);
  await page.reload();
  await title.waitFor();
  await until(async () => (await title.inputValue()) === 'offline durable title');
  assert.equal(await title.inputValue(), 'offline durable title');
  await context.setOffline(false);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  assert.equal(
    requests.filter((r) => r.kind === 'page.update').at(-1).payload.title,
    'offline durable title',
  );
  report.checks.push('offline edit survives reload and reconnect');

  await title.fill('navigation flush');
  await page.locator('a[href="/tasks"]').first().click();
  await pause(350);
  await page.goto(app.base + '/pages/' + fixturePage.id);
  await title.waitFor();
  await until(async () => (await title.inputValue()) === 'navigation flush');
  assert.equal(await title.inputValue(), 'navigation flush');
  report.checks.push('navigation retains the latest page value');
  await context.close();

  // Exercise queue races directly in an isolated browser, never user data.
  const bundle = await build({
    stdin: {
      contents:
        "import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';window.fixture={...runtime,...repo};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const isolated = await app.browser.newContext(),
    q = await isolated.newPage();
  await q.route(app.base + '/autosave-fixture', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><body>queue fixture</body>' }),
  );
  await q.goto(app.base + '/autosave-fixture');
  await q.addScriptTag({ content: bundle.outputFiles[0].text });
  const safety = await q.evaluate(async () => {
    const f = fixture,
      r = await f.getWorkspaceRuntime();
    await r.engine.requestSync();
    r.engine.stop();
    let lease;
    for (let attempt = 0; attempt < 100 && !lease; attempt++) {
      lease = await r.repository.acquireLease('autosave-test', Date.now());
      if (!lease) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!lease) throw Error('test lease was not released');
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      base = {
        id,
        title: 'queue race',
        icon: '',
        parentId: null,
        position: Date.now(),
        version: 1,
        createdAt: now,
        updatedAt: now,
        document: {
          schemaVersion: 1,
          blocks: [
            { id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] },
          ],
        },
      };
    const save = async (title) =>
      f.queueValue(
        'page',
        id,
        { ...base, title },
        crypto.randomUUID(),
        [],
        [],
        true,
        0,
        undefined,
        undefined,
        true,
      );
    const head = async () =>
      (await f.listRecords('outbox', r.workspaceId)).find((p) => p.operation.entityId === id);
    await save('first');
    const old = await head();
    await save('latest unsent');
    const latest = await head();
    const staleClaim = await r.repository.markSending(old, lease);
    const freshClaim = await r.repository.markSending(latest, lease);
    await save('new while sending');
    const sending = await head();
    await r.repository.reject(sending, 'queued', Error('response lost'), 0, lease);
    await save('new while retrying');
    const retry = await head();
    await r.repository.markSending(retry, lease);
    const item = { ...base, title: latest.operation.payload.title };
    await r.repository.acknowledge(
      retry,
      {
        status: 'applied',
        operationId: retry.operation.operationId,
        item,
        version: 1,
        replayed: true,
      },
      lease,
    );
    const follow = await head(),
      entity = await f.readLocalEntity({ workspaceId: r.workspaceId, kind: 'page', id });
    await r.repository.releaseLease(lease);
    return { old, latest, staleClaim, freshClaim, sending, retry, follow, entity };
  });
  assert.equal(safety.old.operation.operationId, safety.latest.operation.operationId);
  assert.equal(safety.latest.operation.payload.title, 'latest unsent');
  assert.equal(safety.staleClaim, false);
  assert.equal(safety.freshClaim, true);
  assert.deepEqual(safety.sending.operation, safety.latest.operation);
  assert.deepEqual(safety.retry.operation, safety.latest.operation);
  assert.equal(safety.retry.attempt, 1);
  assert.notEqual(safety.follow.operation.operationId, safety.retry.operation.operationId);
  assert.equal(safety.follow.operation.baseVersion, 1);
  assert.equal(safety.follow.operation.payload.title, 'new while retrying');
  assert.equal(safety.entity.current.title, 'new while retrying');
  assert.equal(safety.entity.dirty, true);
  report.checks.push(
    'only unsent snapshots coalesce; stale atomic claim rejected; sending/retry UUID and payload immutable; late ACK emits latest correctly versioned follow-up',
  );
  await isolated.close();
  await mkdir(evidence, { recursive: true });
  await writeFile(
    evidence + '/result.json',
    JSON.stringify({ status: 'PASS', ...report }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', ...report }, null, 2));
} finally {
  await app.close();
}
