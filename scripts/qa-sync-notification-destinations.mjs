import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { build } from 'esbuild';
import { offlineApp } from './fixtures/offline-app.mjs';
import { journalId, normalizeJournalDay } from '../shared/journal.mjs';
const app = await offlineApp(),
  checks = [];
const bundle = await build({
  stdin: {
    contents: "import * as repo from './src/sync/repository.ts';window.noticeFixture=repo;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
try {
  const session = await (await fetch(app.base + '/api/sync/session')).json();
  for (const [kind, label, route] of [
    ['task', '할 일에서 확인', 'tasks'],
    ['capture', '해당 메모에서 확인', 'captures'],
    ['journal', '일지에서 확인', 'journal'],
  ]) {
    const date = '2026-10-05',
      id = kind === 'journal' ? journalId(session.workspaceId, date) : randomUUID();
    const payload =
      kind === 'task'
        ? { title: '할 일 서버본', status: 'open', dueDate: null, pageId: null }
        : kind === 'capture'
          ? { kind: 'note', text: '메모 서버본', url: null, uploadIds: [], aiRequest: null }
          : {
              date,
              day: normalizeJournalDay(
                {
                  priorities: [],
                  brain: '일지 서버본',
                  idea: '',
                  feedback: '',
                  plan: [],
                  actual: [],
                },
                date,
              ),
            };
    const operation = {
      protocolVersion: 1,
      workspaceId: session.workspaceId,
      epoch: session.epoch,
      operationId: randomUUID(),
      deviceId: randomUUID(),
      kind: kind + '.create',
      entityId: id,
      baseVersion: null,
      payload,
    };
    const { item: server } = await app.request('/api/sync/operations', operation);
    const context = await app.browser.newContext(),
      page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(app.base + '/memo');
    await page.waitForFunction(() =>
      document.querySelector('.sync-status-trigger')?.textContent.includes('동기화 완료'),
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const local = {
      ...server,
      ...(kind === 'task'
        ? { title: '할 일 기기본' }
        : kind === 'capture'
          ? { text: '메모 기기본' }
          : { day: { ...server.day, brain: '일지 기기본' } }),
    };
    const pendingOperation = {
      ...operation,
      operationId: randomUUID(),
      kind: kind + '.update',
      baseVersion: server.version,
      payload: kind === 'journal' ? { date, day: local.day } : local,
    };
    await page.evaluate(
      async ({ kind, id, local, server, operation }) => {
        const f = noticeFixture,
          workspaceId = operation.workspaceId;
        await f.saveLocalEntity({
          workspaceId,
          kind,
          id,
          value: local,
          pending: { operation, dependencies: [], state: 'conflict', attempt: 1, nextAttemptAt: 0 },
        });
        await f.writeRecord('conflicts', workspaceId, [operation.operationId], {
          operationId: operation.operationId,
          entityKind: kind,
          entityId: id,
          base: server,
          server,
          local,
          tombstone: false,
        });
      },
      { kind, id, local, server, operation: pendingOperation },
    );
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.sync-status-trigger')?.textContent.includes('변경 확인 필요'),
    );
    await page.getByRole('button', { name: '동기화 상태', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '기기 저장과 동기화', exact: true });
    assert.equal(await dialog.locator('.sync-conflict').count(), 0);
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await page.waitForURL(
      new RegExp('/' + route + (kind === 'capture' ? '/' + id : '') + '\\?syncConflict='),
    );
    await dialog.waitFor({ state: 'detached' });
    const panel = page.getByRole('region', { name: '변경 충돌 확인', exact: true });
    await panel.getByRole('radio', { name: /^서버 내용 사용/ }).waitFor();
    assert.equal(
      await panel.evaluate(
        (node) => node === document.activeElement || node.contains(document.activeElement),
      ),
      true,
    );
    await panel.getByRole('radio', { name: /^서버 내용 사용/ }).check();
    await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(
      (await (await fetch(app.base + '/api/sync/entities/' + kind + '/' + id)).json()).item,
      server,
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const archived = await page.evaluate(
      async ({ workspaceId, id }) => {
        const rows = await noticeFixture.listRecords('conflicts', workspaceId, 100);
        return rows.find((row) => row.entityId === id && row.resolvedAt);
      },
      { workspaceId: session.workspaceId, id },
    );
    assert.ok(archived);
    assert.deepEqual(archived.local, local);
    assert.deepEqual(errors, []);
    if (kind === 'journal')
      await page.screenshot({ path: '.omo/evidence/sync-notifications/journal-resolved.png' });
    checks.push(
      kind +
        ': alert navigates to own workspace; expanded comparison resolves and archives device copy',
    );
    await context.close();
  }
  const context = await app.browser.newContext(),
    page = await context.newPage();
  await page.goto(app.base + '/memo');
  await page.waitForFunction(() =>
    document.querySelector('.sync-status-trigger')?.textContent.includes('동기화 완료'),
  );
  const db = new DatabaseSync(join(app.dir, 'storage.sqlite'));
  db.prepare('UPDATE sync_meta SET epoch=?').run(randomUUID());
  db.close();
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status-trigger')?.textContent.includes('변경 확인 필요'),
  );
  await page.getByRole('button', { name: '동기화 상태', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '기기 저장과 동기화', exact: true });
  assert.equal(await dialog.locator('.offline-recovery').count(), 0);
  await dialog.getByRole('button', { name: '기기 저장소에서 확인', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '기기 사본 ZIP 내려받기', exact: true }).waitFor();
  await page.screenshot({ path: '.omo/evidence/sync-notifications/recovery-settings.png' });
  checks.push(
    'recovery: notification opens device storage settings; recovery controls remain accessible outside alert',
  );
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
} finally {
  await app.close();
}
