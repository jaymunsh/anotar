import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';
const normalization = process.argv.includes('--normalization');
const evidence = normalization
  ? '.omo/evidence/conflict-clarity'
  : '.omo/evidence/conflict-compact';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const bundle = await build({
  stdin: {
    contents: "import * as repo from './src/sync/repository.ts';window.compactFixture=repo;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const paragraph = {
  id: 'parent',
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: '관련 자료', styles: {} }],
  children: [],
};
const table = (i) => ({
  id: 'table-' + i,
  type: 'table',
  props: {},
  children: [],
  content: {
    type: 'tableContent',
    columnWidths: [180, 280],
    rows: Array.from({ length: 12 }, (_, row) => ({
      cells: [
        [{ type: 'text', text: `GET /api/example/${i}/${row}`, styles: {} }],
        [{ type: 'text', text: '같은 표의 내용과 설명', styles: {} }],
      ],
    })),
  },
});
try {
  const doc = {
    schemaVersion: 1,
    blocks: [paragraph, ...Array.from({ length: 16 }, (_, i) => table(i))],
  };
  const { item: created } = await app.request('/api/pages', { title: '서식과 위치 변경 예시' });
  const { item: server } = await app.request(
    '/api/pages/' + created.id,
    { title: created.title, document: doc, expectedVersion: created.version },
    'PUT',
  );
  const local = structuredClone(server);
  if (!normalization)
    for (const block of local.document.blocks.slice(1)) block.content.columnWidths[0] = 220;
  local.document.blocks[0].children = [local.document.blocks.pop()];
  const session = await (await fetch(app.base + '/api/sync/session')).json();
  const operation = {
    protocolVersion: 1,
    workspaceId: session.workspaceId,
    epoch: session.epoch,
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    kind: 'page.update',
    entityId: server.id,
    baseVersion: server.version,
    payload: local,
  };
  const page = await app.browser.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.base + '/pages/' + server.id);
  await page.getByLabel('페이지 제목', { exact: true }).waitFor();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(
    async ({ server, local, operation, normalization }) => {
      const repo = compactFixture,
        workspaceId = operation.workspaceId;
      if (normalization) {
        for (const block of [
          ...local.document.blocks.slice(1),
          ...local.document.blocks[0].children,
        ]) {
          block.content.headerRows = undefined;
          block.content.headerCols = undefined;
        }
      }
      await repo.saveLocalEntity({
        workspaceId,
        kind: 'page',
        id: server.id,
        value: local,
        pending: { operation, dependencies: [], state: 'conflict', attempt: 1, nextAttemptAt: 0 },
      });
      await repo.writeRecord('conflicts', workspaceId, [operation.operationId], {
        operationId: operation.operationId,
        entityKind: 'page',
        entityId: server.id,
        base: server,
        server,
        local,
        tombstone: false,
      });
    },
    { server, local, operation, normalization },
  );
  await page.goto(app.base + '/pages/' + server.id + '?syncConflict=' + operation.operationId);
  const panel = page.getByRole('region', { name: '변경 충돌 확인', exact: true });
  await panel.getByRole('radio', { name: /^서버 내용 사용/ }).waitFor();
  assert.match(
    await panel.locator('.sync-conflict-review > .sync-conflict-summary').innerText(),
    normalization ? /^위치 1$/ : /서식·설정만 16 · 위치 1/,
  );
  assert.ok((await panel.innerText()).includes('글자는 같'));
  if (normalization) {
    assert.equal(await panel.locator('.sync-conflict-metadata article').count(), 1);
    assert.equal(await panel.locator('.sync-conflict-metadata').getAttribute('open'), '');
    assert.equal(await panel.locator('.sync-settings-diff').count(), 0);
    assert.match(
      await panel.locator('.sync-position-diff').innerText(),
      /서버에서의 위치[\s\S]*이 기기에서의 위치[\s\S]*관련 자료/,
    );
  }
  assert.equal(await panel.locator('.sync-conflict-comparison:visible').count(), 0);
  assert.equal(await panel.locator('input:checked').count(), 0, 'resolution is never preselected');
  const apply = panel.getByRole('button', { name: '선택한 내용 적용', exact: true });
  assert.equal(await apply.isDisabled(), true);
  await panel.getByRole('radio', { name: /^서버 내용 사용/ }).check();
  const captures = [],
    measurements = [];
  for (const [width, mode] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((mode) => {
      document.documentElement.dataset.theme = mode;
    }, mode);
    if (width < 700)
      await page.waitForFunction(
        () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
      );
    await panel.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    const measure = await panel.evaluate((node) => {
      const rect = node.getBoundingClientRect(),
        button = node.querySelector('.sync-conflict-apply button');
      const style = getComputedStyle(button),
        options = [...node.querySelectorAll('.sync-conflict-choice')].map((n) =>
          n.getBoundingClientRect(),
        );
      return {
        height: rect.height,
        bottom: rect.bottom,
        viewport: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        ink: style.color,
        surface: style.backgroundColor,
        sameRow: options.every((n) => Math.abs(n.top - options[0].top) < 1),
      };
    });
    assert.equal(measure.overflow, false);
    if (!normalization || width > 700)
      assert.ok(
        measure.bottom <= measure.viewport,
        'compact overview and apply fit in the viewport',
      );
    if (width > 700) assert.equal(measure.sameRow, true);
    const luminance = (rgb) => {
      const values = rgb
        .match(/\d+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      return values.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    };
    const a = luminance(measure.ink),
      b = luminance(measure.surface),
      contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(contrast >= 4.5, `apply button contrast ${contrast}`);
    measurements.push({ width, mode, ...measure, contrast });
    const file = `${evidence}/overview-${width}-${mode}.png`;
    await page.screenshot({ path: file });
    captures.push(file);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  if (!normalization) await panel.locator('.sync-conflict-metadata > summary').click();
  assert.equal(await panel.locator('.sync-settings-diff').count(), normalization ? 0 : 16);
  assert.equal(await panel.locator('.sync-diff-added,.sync-diff-removed').count(), 0);
  const first = panel.locator('.sync-conflict-metadata article').first();
  if (!normalization)
    assert.match(await first.locator('.sync-settings-diff').innerText(), /1열 너비.*180.*→.*220/s);
  assert.equal(await first.locator('pre:visible').count(), 0);
  await first.locator('.sync-unchanged-text > summary').click();
  assert.equal(
    await first.locator('pre:visible').count(),
    1,
    'unchanged body is shown once on demand',
  );
  assert.deepEqual(
    (await (await fetch(app.base + '/api/pages/' + server.id)).json()).item.document,
    server.document,
    'preview and radio selection do not write server content',
  );
  assert.deepEqual(errors, []);
  if (!normalization) {
    await panel.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    const file = `${evidence}/settings-expanded.png`;
    await page.screenshot({ path: file });
    captures.push(file);
  }
  const result = {
    status: 'PASS',
    checks: [
      normalization
        ? '16 editor-only undefined table fields are excluded; only the real move remains and is expanded'
        : '16 long equal-text tables plus one move fit a compact overview',
      'all setting changes and unchanged bodies remain accessible',
      'explicit unselected resolution and read-only previews preserved',
      'light/dark enabled apply contrast >= 4.5',
      'desktop choices share a row, mobile fits without horizontal overflow',
    ],
    measurements,
    captures,
  };
  await writeFile(evidence + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
