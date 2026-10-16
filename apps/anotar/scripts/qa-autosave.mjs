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
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
try {
  const context = await app.browser.newContext(),
    page = await context.newPage(),
    requests = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/sync/operations')) requests.push(r.postDataJSON());
  });
  await page.goto(app.base + '/journal');
  await page.locator('#brain').waitFor();
  await pause(500);
  const field = page.locator('#brain'),
    text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX';
  const start = requests.length;
  for (let i = 1; i <= text.length; i++) {
    await field.fill(text.slice(0, i));
    await pause(35);
  }
  assert.equal(requests.length - start, 0, 'text is not sent on every input');
  await pause(1200);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  await pause(300);
  const typed = requests.slice(start).filter((r) => r.kind.startsWith('journal.'));
  assert.equal(typed.length, 1);
  assert.equal(typed[0].payload.day.brain, text);
  report.measurements.rapidJournalTyping = { inputEvents: 50, serverOperations: typed.length };
  report.checks.push('real journal UI: 50 text inputs combine into one latest server operation');
  const continuousStart = requests.length,
    time = Date.now();
  for (let i = 1; i <= 30; i++) {
    await field.fill('continuous ' + i);
    await pause(200);
  }
  assert.ok(requests.length > continuousStart, 'max wait dispatches before typing stops');
  const first = requests[continuousStart];
  assert.notEqual(first.payload.day.brain, 'continuous 30');
  await pause(1200);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  await pause(300);
  assert.equal(requests.at(-1).payload.day.brain, 'continuous 30');
  report.measurements.continuousTyping = {
    durationMs: Date.now() - time,
    serverOperations: requests.length - continuousStart,
  };
  report.checks.push(
    'real journal UI: continuous typing dispatches at max wait and preserves final value',
  );
  await page.locator('.priority-text').first().click();
  await page.locator('.priority-row textarea').first().fill('immediate checkbox');
  const checkStart = requests.length;
  await page.locator('.priority-row input[type=checkbox]').first().click();
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  await until(() => requests.slice(checkStart).some((r) => r.payload.day?.priorities[0]?.done));
  const checked = requests.slice(checkStart).find((r) => r.payload.day?.priorities[0]?.done);
  assert.ok(checked);
  assert.equal(checked.payload.day.priorities[0].text, 'immediate checkbox');
  report.checks.push('checkbox flush includes the latest text');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await field.fill('offline durable text');
  await pause(250);
  await page.reload();
  await field.waitFor();
  await until(async () => (await field.inputValue()) === 'offline durable text');
  assert.equal(await field.inputValue(), 'offline durable text');
  await context.setOffline(false);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  assert.equal(requests.at(-1).payload.day.brain, 'offline durable text');
  report.checks.push('offline edit survives reload and reconnect');
  await field.fill('navigation flush');
  await page.locator('a[href="/tasks"]').first().click();
  await pause(350);
  await page.locator('a[href="/journal"]').first().click();
  await field.waitFor();
  await until(async () => (await field.inputValue()) === 'navigation flush');
  assert.equal(await field.inputValue(), 'navigation flush');
  report.checks.push('navigation retains the latest journal value');
  const { item } = await app.request('/api/pages', { title: 'autosave page fixture' });
  await page.goto(app.base + '/pages/' + item.id);
  const title = page.getByLabel('페이지 제목', { exact: true });
  await title.waitFor();
  await pause(500);
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  const pageStart = requests.length;
  await title.fill('');
  await title.pressSequentially(text, { delay: 35 });
  try {
    await until(() => requests.slice(pageStart).some((r) => r.kind === 'page.update'));
  } catch (error) {
    console.log(
      'page autosave state',
      await page.evaluate(() => ({
        status: document.querySelector('.sync-status')?.textContent,
        text: document.querySelector('main')?.textContent?.slice(0, 1200),
      })),
    );
    throw error;
  }
  await waitForAsync(page, () =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  const pageOperations = requests.slice(pageStart).filter((r) => r.kind === 'page.update');
  assert.equal(pageOperations.length, 1);
  assert.equal(pageOperations[0].payload.title, text);
  report.measurements.rapidPageTyping = {
    inputEvents: 51,
    serverOperations: pageOperations.length,
  };
  report.checks.push('real page UI: rapid title typing combines into one server operation');
  await context.close();
  // Exercise queue races directly in an isolated browser, never user data.
  const bundle = await build({
    stdin: {
      contents:
        "import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import {journalId,normalizeJournalDay} from './shared/journal.mjs';window.fixture={...runtime,...repo,journalId,normalizeJournalDay};",
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
    const date = '2026-10-12',
      id = f.journalId(r.workspaceId, date),
      day = f.normalizeJournalDay(
        { priorities: [], brain: 'initial', idea: '', feedback: '', plan: [], actual: [] },
        date,
      );
    const save = async (brain) =>
      f.queueValue(
        'journal',
        id,
        { id, date, day: { ...day, brain }, version: 1 },
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
    const item = { id, date, day: latest.operation.payload.day, version: 1 };
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
      entity = await f.readLocalEntity({ workspaceId: r.workspaceId, kind: 'journal', id });
    await r.repository.releaseLease(lease);
    return { old, latest, staleClaim, freshClaim, sending, retry, follow, entity };
  });
  assert.equal(safety.old.operation.operationId, safety.latest.operation.operationId);
  assert.equal(safety.latest.operation.payload.day.brain, 'latest unsent');
  assert.equal(safety.staleClaim, false);
  assert.equal(safety.freshClaim, true);
  assert.deepEqual(safety.sending.operation, safety.latest.operation);
  assert.deepEqual(safety.retry.operation, safety.latest.operation);
  assert.equal(safety.retry.attempt, 1);
  assert.notEqual(safety.follow.operation.operationId, safety.retry.operation.operationId);
  assert.equal(safety.follow.operation.baseVersion, 1);
  assert.equal(safety.follow.operation.payload.day.brain, 'new while retrying');
  assert.equal(safety.entity.current.day.brain, 'new while retrying');
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
