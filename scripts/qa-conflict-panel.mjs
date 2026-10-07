import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { offlineApp, settleSync } from './fixtures/offline-app.mjs';

const evidence = resolve('.omo/evidence/conflict-panel');
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    contents: "import * as api from './src/sync/runtime.ts';window.conflictFixture=api;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const app = await offlineApp(),
  checks = [],
  errors = [];
const paragraph = (id, text, children = []) => ({
  id,
  type: 'paragraph',
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
  content: [{ type: 'text', text, styles: {} }],
  children,
});
try {
  const parent = paragraph('parent', '상위 문단', [paragraph('moved', '위치만 바뀐 문단')]);
  const { item: created } = await app.request('/api/pages', { title: '문단 위치 충돌 확인' });
  const { item: seeded } = await app.request(
    '/api/pages/' + created.id,
    {
      title: created.title,
      expectedVersion: created.version,
      document: { schemaVersion: 1, blocks: [parent, paragraph('last', '')] },
    },
    'PUT',
  );
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app.base + '/pages/' + seeded.id);
  await page.locator('.bn-editor').waitFor();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  console.log('Fixture editor ready');
  await page.evaluate(() => conflictFixture.getWorkspaceRuntime());
  await context.setOffline(true);
  await page.evaluate(async (seed) => {
    const p = structuredClone(seed.document.blocks[0]),
      child = p.children.pop();
    const result = await conflictFixture.workspaceFetch('/api/pages/' + seed.id, {
      method: 'PUT',
      body: JSON.stringify({
        expectedVersion: seed.version,
        title: seed.title,
        icon: '',
        document: { schemaVersion: 1, blocks: [p, child, seed.document.blocks[1]] },
      }),
    });
    if (!result.ok) throw Error(await result.text());
  }, seeded);
  await app.request(
    '/api/pages/' + seeded.id,
    { title: seeded.title, expectedVersion: seeded.version, document: seeded.document },
    'PUT',
  );
  await context.setOffline(false);
  await page.evaluate(() => conflictFixture.requestWorkspaceSync());
  const panel = page.locator('.sync-conflict');
  await panel.waitFor();
  assert.equal(
    await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).count(),
    0,
  );
  await page.screenshot({ path: join(evidence, 'desktop-collapsed.png') });
  await panel.getByRole('button', { name: '변경 내용 비교', exact: true }).click();
  assert.match(await panel.locator('.sync-conflict-summary').innerText(), /내용·서식 0 · 위치 1/);
  assert.match(await panel.innerText(), /위치 변경/);
  assert.equal(
    await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await panel.getByRole('radio', { checked: true }).count(), 0);
  await page.screenshot({ path: join(evidence, 'desktop-expanded.png') });
  const download = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: '사본 내려받기', exact: true }).click(),
  ]).then(([file]) => file);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const copies = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(copies.server.document.blocks[0].children[0].id, 'moved');
  assert.equal(copies.local.document.blocks[1].id, 'moved');
  checks.push(
    'Compact notice expands into a movement-only comparison; no default resolution; exact snapshots download',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole('button', { name: '메뉴 닫기', exact: true }).isVisible())
    await page.getByRole('button', { name: '메뉴 닫기', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  );
  assert.equal(await page.locator('.mobile-create-button').isVisible(), false);
  await panel.scrollIntoViewIfNeeded();
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: join(evidence, 'mobile-dark-expanded.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth));
  checks.push('390/320px dark comparison and resolution choices fit without horizontal overflow');
  await panel.getByRole('radio', { name: /^내 변경으로 반영/ }).check();
  await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settleSync(page);
  const current = (await (await fetch(app.base + '/api/pages/' + seeded.id)).json()).item;
  assert.equal(current.document.blocks[0].children.length, 0);
  assert.equal(current.document.blocks[1].id, 'moved');
  assert.equal(current.title, seeded.title);
  checks.push(
    'Explicit local resolution syncs the moved paragraph, retains its ID and clears the notice',
  );
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await app.close();
}
