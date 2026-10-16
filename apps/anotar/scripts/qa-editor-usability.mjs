import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { selectAppTheme } from './qa-compact-pages.mjs';

const dir = await mkdtemp(join(tmpdir(), 'leneu-editor-usability-'));
const evidence = '.omo/evidence/editor-share-usability';
await mkdir(evidence, { recursive: true });
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    PORT: String(port),
    AI_RUNNER_KIND: 'disabled',
    AI_RUNNER_URL: '',
  },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const response = await fetch(base + '/api/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '편집기 입력 검증' }),
  });
  assert.ok(response.ok);
  const { item } = await response.json();
  const saved = async () => (await (await fetch(base + '/api/pages/' + item.id)).json()).item;
  const waitSaved = async (predicate) => {
    for (let i = 0; i < 120; i++) {
      const result = await saved();
      if (predicate(result)) return result;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('Editor content did not persist');
  };
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/pages/' + item.id, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '페이지 제목', exact: true }).press('Enter');
  await page.keyboard.type('# 직접 작성한 제목');
  await page.keyboard.press('Enter');
  const paragraphs = Array.from(
    { length: 120 },
    (_, i) =>
      `긴 본문 ${i + 1}. 여행의 이동 시간과 쉬는 시간을 정리하고, 자료를 복사해도 내용을 그대로 보존합니다.`,
  );
  const markdown = [
    '## 붙여넣은 계획',
    '**강조**와 *기울임*, ~~취소선~~, `코드`, [장소 링크](https://example.com/plan)',
    '> 본문과 구분되는 인용문',
    '- 준비물 확인\n- 예약 번호 확인',
    '1. 출발\n2. 도착',
    '- [ ] 준비하기\n- [x] 예약 완료',
    '| 항목 | 시간 |\n| --- | --- |\n| 산책 | 09:00 |\n| 식사 | 12:00 |',
    '```mermaid\ngraph TD\nA[출발] --> B[도착]\n```',
    ...paragraphs,
  ].join('\n\n');
  await page.evaluate((text) => navigator.clipboard.writeText(text), markdown);
  const started = Date.now();
  await page.keyboard.press('ControlOrMeta+V');
  const pasted = await waitSaved(
    (p) =>
      p.document.blocks.some((b) => b.type === 'table') &&
      JSON.stringify(p.document).includes('긴 본문 120.'),
  );
  const pasteAndSaveMs = Date.now() - started;
  for (const type of [
    'heading',
    'quote',
    'bulletListItem',
    'numberedListItem',
    'checkListItem',
    'table',
    'diagram',
  ])
    assert.ok(
      pasted.document.blocks.some((b) => b.type === type),
      type,
    );
  assert.equal(
    pasted.document.blocks.filter(
      (b) => b.type === 'paragraph' && JSON.stringify(b.content).includes('긴 본문 '),
    ).length,
    120,
  );
  assert.equal(pasted.document.blocks.find((b) => b.type === 'table').content.rows.length, 3);
  const table = page.locator('.bn-editor table');
  const cell = table.locator('td').first();
  await cell.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
  await page.keyboard.type('수정: ');
  await waitSaved((p) =>
    JSON.stringify(p.document.blocks.find((b) => b.type === 'table')).includes('수정: '),
  );
  await page.keyboard.press('ControlOrMeta+Z');
  await waitSaved(
    (p) => !JSON.stringify(p.document.blocks.find((b) => b.type === 'table')).includes('수정: '),
  );
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await waitSaved((p) =>
    JSON.stringify(p.document.blocks.find((b) => b.type === 'table')).includes('수정: '),
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok((await page.locator('.bn-editor table').innerText()).includes('수정: '));
  const tail = page.locator('.bn-editor p').filter({ hasText: '긴 본문 120.' }).last();
  await tail.click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(50); // Let native contenteditable selection reach ProseMirror.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.waitForTimeout(50);
  await page.keyboard.press('Enter');
  await page.keyboard.type('모바일 이어 쓰기');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 420 });
    const mobile = page.locator('.bn-editor p').filter({ hasText: '모바일 이어 쓰기' }).last();
    await mobile.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(50);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await page.waitForTimeout(50);
    await page.keyboard.type(` ${width}px`);
    await waitSaved((p) => JSON.stringify(p.document).includes(`${width}px`));
    assert.ok(await page.evaluate(() => document.activeElement?.isContentEditable));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok((await page.locator('.bn-editor').innerText()).includes(`${width}px`));
  }
  assert.ok(
    JSON.stringify((await saved()).document).includes(paragraphs.at(-1)),
    'Original last paragraph survives mobile typing',
  );
  for (const [width, theme] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
    await selectAppTheme(page, theme);
    await page.locator('.bn-editor table').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${evidence}/editor-${width}-${theme}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${evidence}/editor.json`,
    JSON.stringify(
      {
        markdownBytes: Buffer.byteLength(markdown),
        paragraphs: 120,
        pasteAndSaveMs,
        typedHeading: true,
        structuredTable: true,
        tableEditUndoRedoReload: true,
        mobile320And390: true,
        reducedViewportInput: true,
        noPageErrors: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: long mixed Markdown paste, 120 paragraphs, headings/lists/quote/checklist/Mermaid, table edit/undo/redo/reload, 320/390 input with reduced viewport, light/dark; temporary data only. Timing is a local observation, not an N100 benchmark.',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
  await rm(dir, { recursive: true, force: true });
}
