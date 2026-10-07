import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { offlineApp } from './fixtures/offline-app.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';

const evidence = '.omo/evidence/document-alignment';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const publicServer = spawn(process.execPath, ['server/public.mjs'], {
  env: { ...process.env, DATA_DIR: app.dir, PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: String(port) },
  stdio: 'ignore',
});
const text = (value) => [{ type: 'text', text: value, styles: {} }];
const block = (id, type, value = '', children = []) => ({
  id,
  type,
  props: {},
  content: text(value),
  children,
});
const nested = block('root', 'bulletListItem', '상위 항목', [
  block('child', 'bulletListItem', '첫 번째 하위 항목', [
    block('grandchild', 'bulletListItem', '두 번째 단계'),
  ]),
  block('child-two', 'bulletListItem', '다음 하위 항목'),
]);
const doc = {
  schemaVersion: 1,
  blocks: [
    { id: 'toc', type: 'tableOfContents', props: {}, children: [] },
    { ...block('heading', 'heading', '1. 설명'), props: { level: 1 } },
    block('intro', 'paragraph', '문서 제목과 목차, 본문의 오른쪽 끝이 같아야 합니다.'),
    nested,
    block('quote', 'quote', '인용문은 점선 들여쓰기와 별도로 표시합니다.'),
    {
      id: 'table',
      type: 'table',
      props: {},
      content: {
        type: 'tableContent',
        columnWidths: [400, 400],
        rows: [{ cells: [text('항목'), text('설명')] }],
      },
      children: [],
    },
  ],
};
const checks = [],
  errors = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const created = (await app.request('/api/pages', { title: '문서 폭과 들여쓰기' })).item;
  const pageItem = (
    await app.request(
      '/api/pages/' + created.id,
      { expectedVersion: created.version, title: created.title, document: doc },
      'PUT',
    )
  ).item;
  const shared = await app.request('/api/pages/' + pageItem.id + '/shares', { expiresInDays: 1 });
  const page = await app.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [1440, 390, 320])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(app.base + '/pages/' + pageItem.id);
      await page.locator('.bn-editor').waitFor();
      await selectAppTheme(page, theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      const geometry = await page.evaluate(() => {
        const rect = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width };
        };
        return {
          title: rect('.page-title-input'),
          editor: rect('.bn-editor'),
          toc: rect('.page-toc'),
          table: rect('[data-content-type="table"] table'),
          guide: getComputedStyle(
            document.querySelector('.bn-block-group .bn-block-group'),
            '::before',
          ).borderInlineStartStyle,
        };
      });
      assert.ok(
        Math.abs(geometry.title.right - geometry.editor.right) < 1,
        JSON.stringify(geometry),
      );
      assert.ok(Math.abs(geometry.title.right - geometry.toc.right) < 1, JSON.stringify(geometry));
      assert.equal(geometry.guide, 'dotted');
      const editor = page.locator('.bn-editor');
      await editor.hover();
      const comment = page.locator('.page-comment-gutter-button.is-visible').first();
      await comment.waitFor();
      const buttonBox = await comment.boundingBox(),
        editorBox = await editor.boundingBox();
      assert.ok(
        buttonBox.x >= editorBox.x + editorBox.width,
        'Comment button overlaps the document',
      );
      assert.ok(buttonBox.x + buttonBox.width <= width, 'Comment button leaves viewport');
      if (width === 1440 && theme === 'light') {
        await comment.click();
        await page.getByRole('heading', { name: '블록 대화' }).waitFor();
        await page.getByRole('textbox', { name: '댓글 입력' }).fill('바깥 여백에서 댓글 작성 확인');
        await page.getByRole('button', { name: '댓글 남기기', exact: true }).click();
        await page.getByText('바깥 여백에서 댓글 작성 확인', { exact: true }).waitFor();
        await page.getByRole('button', { name: '댓글 패널 닫기', exact: true }).click();
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${evidence}/editor-${width}-${theme}.png` });
      await page.goto(`http://127.0.0.1:${port}/s/${shared.token}`);
      await page.getByRole('combobox', { name: '화면 모드', exact: true }).selectOption(theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      const publicGeometry = await page.evaluate(() => {
        const rect = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width };
        };
        return {
          title: rect('main > h1'),
          toc: rect('.page-toc'),
          table: rect('.table-scroll'),
          guides: [...document.querySelectorAll('.block-children')].map(
            (e) => getComputedStyle(e, '::before').borderInlineStartStyle,
          ),
          quote: getComputedStyle(document.querySelector('blockquote')).borderLeftStyle,
        };
      });
      assert.ok(Math.abs(publicGeometry.title.right - publicGeometry.toc.right) < 1);
      assert.ok(Math.abs(publicGeometry.title.right - publicGeometry.table.right) < 1);
      assert.deepEqual(publicGeometry.guides, ['dotted', 'dotted']);
      assert.equal(publicGeometry.quote, 'solid');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${evidence}/shared-${width}-${theme}.png` });
      checks.push({ width, theme, geometry, publicGeometry });
    }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(
    'PASS document alignment: aligned edges, dotted nesting, unobstructed comments, both themes at 1440/390/320px',
  );
} finally {
  publicServer.kill();
  await new Promise((r) => (publicServer.exitCode !== null ? r() : publicServer.once('exit', r)));
  await app.close();
}
