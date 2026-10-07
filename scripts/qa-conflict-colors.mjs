import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';
const evidence = '.omo/evidence/conflict-colors';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const bundle = await build({
  stdin: {
    contents: "import * as repo from './src/sync/repository.ts';window.diffFixture=repo;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const p = (id, text, styles = {}) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles }],
  children: [],
});
try {
  const doc = {
    schemaVersion: 1,
    blocks: [
      p('change', '변경하지 않는 줄\n회의 시작 10:00\n같은 마지막 줄'),
      p('remove', '삭제할 내용'),
      p('style', '서식만 변경'),
      p('parent', '부모'),
      p('move', '위치만 변경'),
    ],
  };
  const { item: created } = await app.request('/api/pages', { title: '차이 표시 예시' });
  const { item: server } = await app.request(
    '/api/pages/' + created.id,
    { title: created.title, document: doc, expectedVersion: created.version },
    'PUT',
  );
  const local = {
    ...server,
    title: '차이 표시 예시 · 수정',
    document: {
      schemaVersion: 1,
      blocks: [
        p('change', '변경하지 않는 줄\n회의 시작 11:00\n같은 마지막 줄'),
        p('style', '서식만 변경', { bold: true }),
        { ...p('parent', '부모'), children: [p('move', '위치만 변경')] },
        p('add', '새로 추가한 내용\n<script>안전한 원문</script>'),
      ],
    },
  };
  const session = await (await fetch(app.base + '/api/sync/session')).json(),
    operationId = crypto.randomUUID();
  const operation = {
    protocolVersion: 1,
    workspaceId: session.workspaceId,
    epoch: session.epoch,
    operationId,
    deviceId: crypto.randomUUID(),
    kind: 'page.update',
    entityId: server.id,
    baseVersion: server.version,
    payload: local,
  };
  const page = await app.browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.base + '/pages/' + server.id);
  await page.getByLabel('페이지 제목', { exact: true }).waitFor();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(
    async ({ server, local, operation }) => {
      const f = diffFixture,
        workspaceId = operation.workspaceId;
      await f.saveLocalEntity({
        workspaceId,
        kind: 'page',
        id: server.id,
        value: local,
        pending: { operation, dependencies: [], state: 'conflict', attempt: 1, nextAttemptAt: 0 },
      });
      await f.writeRecord('conflicts', workspaceId, [operation.operationId], {
        operationId: operation.operationId,
        entityKind: 'page',
        entityId: server.id,
        base: server,
        server,
        local,
        tombstone: false,
      });
    },
    { server, local, operation },
  );
  await page.goto(app.base + '/pages/' + server.id + '?syncConflict=' + operationId);
  const panel = page.getByRole('region', { name: '변경 충돌 확인', exact: true });
  await panel.getByRole('radio', { name: /^새 페이지로 보관/ }).waitFor();
  assert.ok(await panel.locator('.sync-diff-added').count());
  assert.ok(await panel.locator('.sync-diff-removed').count());
  const changes = panel.locator('.sync-conflict-changes article');
  const style = changes.filter({ hasText: '서식만 변경' }),
    move = changes.filter({ hasText: '위치만 변경' });
  assert.equal(await style.count(), 1);
  assert.equal(await move.count(), 1);
  assert.equal(
    await style.locator('.sync-diff-added,.sync-diff-removed').count(),
    0,
    'style-only changes are neutral',
  );
  assert.equal(
    await move.locator('.sync-diff-added,.sync-diff-removed').count(),
    0,
    'moves do not imply text deletion',
  );
  assert.equal(await panel.locator('script').count(), 0);
  assert.ok((await panel.innerText()).includes('<script>안전한 원문</script>'));
  const captures = [];
  for (const [width, mode] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((mode) => {
      document.documentElement.dataset.theme = mode;
    }, mode);
    if (width < 700)
      await page.waitForFunction(
        () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
      );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const file = evidence + `/diff-${width}-${mode}.png`;
    await page.screenshot({ path: file });
    captures.push(file);
    const color = await panel
      .locator('.sync-diff-added')
      .first()
      .evaluate((node) => ({
        ink: getComputedStyle(node).color,
        surface: getComputedStyle(node).backgroundColor,
      }));
    assert.notEqual(color.ink, color.surface);
  }
  await panel.getByRole('radio', { name: /^새 페이지로 보관/ }).check();
  await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).click();
  await page.waitForURL(new RegExp('/pages/(?!' + server.id + ')[a-f0-9-]+$'));
  await page.getByLabel('페이지 제목', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('페이지 제목', { exact: true }).inputValue(),
    local.title + ' (기기 사본)',
  );
  assert.deepEqual(
    (await (await fetch(app.base + '/api/pages/' + server.id)).json()).item.document,
    server.document,
  );
  assert.deepEqual(errors, []);
  const result = {
    status: 'PASS',
    checks: [
      'added and removed lines use separate theme colors and +/− signs',
      'unchanged context, style-only changes and moves remain neutral',
      'literal HTML remains escaped',
      'light/dark 1440 and 390/320 mobile fit without horizontal overflow',
      'comparison remains read-only and fork preserves server document',
    ],
    captures,
  };
  await writeFile(evidence + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
