import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const bundle = await build({
  stdin: {
    contents:
      "import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import * as migration from './src/journal/migration.ts';import * as exporter from './src/offline/exportPending.ts';window.fixture={...runtime,...repo,...migration,...exporter};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const app = await offlineApp();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const source = (feedback) =>
  JSON.stringify({
    theme: 'light',
    days: {
      [today]: {
        priorities: [{ text: '옛 기기 핵심', done: true }],
        brain: '옛 기기 생각',
        idea: '',
        feedback,
        plan: [],
        actual: [],
      },
    },
  });
const wait = async (fn) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('migration fixture timed out');
};
async function hooks(page) {
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => fixture.getWorkspaceRuntime());
}
async function data(page) {
  return page.evaluate(async () => {
    const r = await fixture.getWorkspaceRuntime();
    return {
      workspaceId: r.workspaceId,
      entities: await fixture.listRecords('entities', r.workspaceId, 100),
      outbox: await fixture.listRecords('outbox', r.workspaceId, 100),
      copies: await fixture.listJournalMigrationCollisions(r.workspaceId),
      manifest: (await fixture.exportPendingWorkspace(r.workspaceId)).manifest,
    };
  });
}
try {
  const context = await app.browser.newContext(),
    page = await context.newPage();
  await page.goto(app.base + '/journal');
  await page.locator('#daySheet .day-hour').last().waitFor();
  await prepareShell(page);
  await hooks(page);
  await context.setOffline(true);
  await page.locator('#brain').fill('현재 기기에서 아직 보내지 않은 원문');
  await wait(async () =>
    (await data(page)).entities.some(
      (e) => e.kind === 'journal' && e.current.day.brain === '현재 기기에서 아직 보내지 않은 원문',
    ),
  );
  const initial = await data(page),
    id = initial.entities.find((e) => e.kind === 'journal').id,
    operationId = initial.outbox[0].operation.operationId;
  const first = source('처음 가져온 옛 회고');
  await page.evaluate((raw) => localStorage.setItem('anotar:journal:v1', raw), first);
  await page.reload();
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  assert.equal(
    (await data(page)).entities.find((e) => e.id === id).current.day.brain,
    '현재 기기에서 아직 보내지 않은 원문',
  );
  assert.equal((await data(page)).outbox[0].operation.operationId, operationId);
  await page.getByText(today + ' 일지 사본 비교', { exact: true }).click();
  assert.ok(await page.getByText('현재 기기 일지', { exact: true }).isVisible());
  assert.equal(await page.getByText('서버 내용 사용', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '현재 기기 내용 유지', exact: true }).click();
  await wait(async () => (await data(page)).copies.length === 0);
  assert.equal((await data(page)).outbox[0].operation.operationId, operationId);
  const second = source('직접 고른 옛 회고');
  await page.evaluate((raw) => localStorage.setItem('anotar:journal:v1', raw), second);
  await page.reload();
  await page.locator('#daySheet .day-hour').last().waitFor();
  await hooks(page);
  await page.getByText(today + ' 일지 사본 비교', { exact: true }).click();
  await page.getByRole('button', { name: '이전 일지로 사용', exact: true }).click();
  await wait(
    async () =>
      (await data(page)).entities.find((e) => e.id === id).current.day.feedback ===
      '직접 고른 옛 회고',
  );
  assert.equal((await data(page)).outbox[0].operation.operationId, operationId);
  assert.equal(await page.evaluate(() => localStorage.getItem('anotar:journal:v1')), second);
  const exported = (await data(page)).manifest;
  assert.ok(exported.meta.some((m) => m.raw === first));
  assert.ok(exported.meta.some((m) => m.raw === second));
  assert.ok(exported.meta.some((m) => m.legacyDay && m.choice === 'legacy'));
  await context.setOffline(false);
  await page.evaluate(() => fixture.requestWorkspaceSync());
  await wait(async () => {
    const item = (await (await fetch(app.base + '/api/sync/entities/journal/' + id)).json()).item;
    return item?.day.feedback === '직접 고른 옛 회고';
  });
  const final = (await (await fetch(app.base + '/api/sync/entities/journal/' + id)).json()).item;
  assert.equal(final.id, id);
  assert.ok(final.version >= 2);
  const lateContext = await app.browser.newContext(),
    late = await lateContext.newPage();
  await late.goto(app.base + '/journal');
  await late.locator('#daySheet .day-hour').last().waitFor();
  await hooks(late);
  const owner = await late.evaluate(async (raw) => {
    const original = await fixture.getWorkspaceRuntime();
    localStorage.setItem('anotar:journal:v1', raw);
    const response = await fetch('/api/sync/session'),
      session = await response.json(),
      foreign = crypto.randomUUID();
    await fixture.resetRuntimeBinding({
      ...session,
      workspaceId: foreign,
      epoch: crypto.randomUUID(),
    });
    const result = await fixture.migrateJournal(foreign, original.deviceId),
      queue = await fixture.listRecords('outbox', foreign, 100);
    return {
      result,
      queue,
      raw: localStorage.getItem('anotar:journal:v1'),
      owner: await fixture.readRecord(
        'meta',
        '@device',
        'legacyJournalSource',
        'anotar:journal:v1',
      ),
      originalWorkspace: original.workspaceId,
    };
  }, source('PRIVATE_A_LEGACY'));
  assert.deepEqual(owner.result, { imported: 0, conflicts: 0, foreign: true });
  assert.deepEqual(owner.queue, []);
  assert.equal(owner.owner.sourceWorkspaceId, owner.originalWorkspace);
  assert.match(owner.raw, /PRIVATE_A_LEGACY/);
  await mkdir('.omo/evidence/journal-sync', { recursive: true });
  await writeFile(
    '.omo/evidence/journal-sync/migration.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks: [
          'dirty local collision keeps immutable existing outbox and current day until choice',
          'existing local copy can be kept without pretending it is server data',
          'explicit legacy selection keeps original queued create and follows with chosen day update',
          'both exact source JSONs and resolved local choices remain in recovery export',
          'source created after runtime init is claimed for old workspace before binding switch; foreign import stays blocked',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS journal migration: explicit local copy choices, stable original queue, exact archive export and late-source workspace isolation',
  );
} finally {
  await app.close();
}
