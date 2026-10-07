import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

const output = '.omo/evidence/ai-result-refinements';
await mkdir(output, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'anotar-memo-organize-'));
const store = openStore(dir);
const original = '조사할 주제만 적은 원본 메모';
const pageTitle = original + ' · AI 요청 결과';
const markdown =
  '> 수집 안내: 확인한 자료를 기준으로 정리했습니다.\n\n# 제품 출시 안내\n\n결과 전체가 페이지 본문에 들어가야 합니다.\n\n## 실행 순서\n\n- 초안 작성\n- 일정 확인\n\n| 항목 | 담당 |\n| --- | --- |\n| 안내 | 운영 |\n\n```js\nconst ready = true;\n```';
const capture = store.createCapture({
  kind: 'note',
  text: original,
  aiRequest: {
    template: null,
    additional: '조사',
    execution: { profileId: 'hive', model: 'qa-model' },
  },
});
const claimed = store.claimAiJob({ label: '임시 검증 실행기', mode: 'test' });
store.completeAiJob(claimed.id, claimed.runToken, {
  markdown,
  sources: [{ title: '공식 안내', url: 'https://example.com/guide', verified: true }],
  usage: null,
});
const parent = store.createPage({ title: '상위 안내 문서' });
for (let i = 0; i < 7; i++) store.createPage({ title: '참고 자료 ' + i });
store.close();
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    PATH: process.env.PATH,
    LANG: 'en_US.UTF-8',
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    PORT: String(port),
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'disabled',
    BACKGROUND_WORKERS_ENABLED: 'false',
    COMMENT_SOCKET_PATH: join(dir, 'comments.sock'),
  },
  stdio: 'ignore',
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check) {
  for (let i = 0; i < 120; i++) {
    try {
      const v = await check();
      if (v) return v;
    } catch {}
    await pause(100);
  }
  throw Error('Fixture condition timed out');
}
const read = async (path) => await (await fetch(base + path)).json();
let browser;
const errors = [];
try {
  await waitFor(async () => (await fetch(base + '/api/health')).ok);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(12000);
  const open = async () => {
    await page.goto(`${base}/captures/${capture.id}?aiJob=${claimed.id}`);
    await page.getByRole('article', { name: 'AI 결과 본문' }).waitFor();
  };
  await open();
  const heading = page.locator('.ai-job-heading h2');
  const status = page.locator('.ai-job-heading .ai-job-state');
  const headingBox = await heading.boundingBox();
  const statusBox = await status.boundingBox();
  assert.ok(statusBox.x - (headingBox.x + headingBox.width) <= 12, 'State sits beside heading');
  const promptSummary = page.locator('.ai-saved-prompt summary');
  assert.equal(await promptSummary.locator('svg').count(), 0, 'No trailing prompt chevron');
  assert.equal(await promptSummary.evaluate(el => getComputedStyle(el).listStyleType), 'disclosure-closed');
  await promptSummary.focus();
  assert.equal(await promptSummary.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await page.keyboard.press('Enter');
  await page.locator('.ai-saved-prompt').getByText(original, { exact: true }).waitFor();
  assert.equal(await promptSummary.evaluate(el => getComputedStyle(el).listStyleType), 'disclosure-open');
  await page.keyboard.press('Enter');
  await page.screenshot({ path: `${output}/detail-before-import.png`, fullPage: true });
  assert.equal(
    await page.getByRole('button', { name: '내 페이지에 정리', exact: true }).count(),
    0,
    'AI result detail must not offer an ambiguous action that copies only the short original',
  );
  assert.equal(
    await page.getByRole('region', { name: '연결된 페이지', exact: true }).count(),
    0,
    'No empty tracking section',
  );
  await page.getByRole('button', { name: '결과를 페이지로 정리', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '새 페이지 제목' }).inputValue(),
    pageTitle,
  );
  const titleInput = page.getByRole('textbox', { name: '새 페이지 제목' });
  await titleInput.fill('직접 바꾼 제목');
  assert.equal(await titleInput.inputValue(), '직접 바꾼 제목');
  await titleInput.fill(pageTitle);
  const search = page.locator('.capture-import-search input');
  await search.focus();
  assert.equal(await search.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  assert.equal(await page.locator('.capture-import-search').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await page.screenshot({ path: `${output}/import-search-focused.png` });
  const existingMode = page.getByRole('button', { name: '기존 페이지', exact: true });
  await existingMode.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await existingMode.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  assert.ok(await existingMode.evaluate(el => getComputedStyle(el).textDecorationLine.includes('underline')), 'Keyboard focus remains visible without a ring');
  await page.locator('.capture-import-preview summary').click();
  await page
    .locator('.capture-import-preview')
    .getByText('결과 전체가 페이지 본문에 들어가야 합니다.', { exact: true })
    .waitFor();
  assert.ok((await page.locator('.capture-import-result').count()) <= 6);
  await page.getByRole('button', { name: '페이지 더 보기', exact: true }).waitFor();
  await page.getByRole('button', { name: '상위 안내 문서 내 페이지', exact: true }).click();
  for (const [width, theme] of [
    [1440, 'light'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((v) => (document.documentElement.dataset.theme = v), theme);
    await page.locator('.capture-page-import').waitFor();
    assert.ok(
      await page.locator('.detail-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'No panel horizontal overflow',
    );
    assert.ok(
      await page
        .locator('.capture-import-results')
        .evaluate((el) => getComputedStyle(el).overflowY !== 'auto'),
      'Destination picker shares the panel scroll',
    );
    if ((await page.locator('.capture-import-preview').getAttribute('open')) !== null)
      await page.locator('.capture-import-preview summary').click();
    await page.screenshot({ path: `${output}/import-${width}-${theme}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.capture-import-submit').click();
  await page.waitForURL('**/pages/**?import=*');
  const created = await waitFor(async () =>
    ((await read('/api/pages')).items || []).find((p) => p.title === pageTitle),
  );
  const result = (await read('/api/pages/' + created.id)).item;
  assert.equal(result.parentId, parent.id);
  const text = JSON.stringify(result.document);
  for (const expected of [
    '결과 전체가 페이지 본문에 들어가야 합니다.',
    '제품 출시 안내',
    '초안 작성',
    'ready = true',
    'https://example.com/guide',
  ])
    assert.ok(text.includes(expected), expected);
  assert.ok(result.document.blocks.some((b) => b.type === 'table'));
  assert.ok(result.document.blocks.some((b) => b.type === 'codeBlock'));
  assert.ok(!text.includes(original), 'AI import does not silently copy just the original');
  await page.goto(base + '/pages/' + parent.id);
  await page.locator(`.page-link-block[href="/pages/${created.id}"]`).waitFor();
  await page.reload();
  await page.locator(`.page-link-block[href="/pages/${created.id}"]`).waitFor();
  await open();
  await page.getByRole('button', { name: '결과를 페이지로 정리', exact: true }).click();
  await page.getByRole('button', { name: '기존 페이지', exact: true }).click();
  await page.getByRole('button', { name: '상위 안내 문서 내 페이지', exact: true }).click();
  await page.locator('.capture-import-submit').click();
  try {
    await page.waitForURL(`**/pages/${parent.id}?import=*`, { timeout: 45000 });
  } catch (error) {
    console.log('stuck', page.url(), await page.locator('.detail-panel').innerText());
    console.log(
      'outbox',
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const req = indexedDB.open('leneu-offline-v1');
            req.onsuccess = () => {
              const r = req.result.transaction('outbox').objectStore('outbox').getAll();
              r.onsuccess = () =>
                resolve(
                  r.result.map((p) => ({
                    kind: p.operation.kind,
                    state: p.state,
                    error: p.error,
                    dependencies: p.dependencies,
                    entityId: p.operation.entityId,
                    operationId: p.operation.operationId,
                  })),
                );
            };
          }),
      ),
    );
    await page.screenshot({ path: output + '/stuck.png' });
    throw error;
  }
  assert.ok(
    JSON.stringify((await read('/api/pages/' + parent.id)).item.document).includes(
      '결과 전체가 페이지 본문에 들어가야 합니다.',
    ),
  );
  assert.equal((await read('/api/captures/' + capture.id)).item.text, original);
  assert.equal((await read('/api/ai-jobs/' + claimed.id)).item.result.markdown, markdown);
  await open();
  await page.locator('.ai-saved-prompt summary').click();
  await page.locator('.ai-saved-prompt').getByText(original, { exact: true }).waitFor();
  await page.locator('.ai-saved-prompt summary').click();
  await page.screenshot({ path: `${output}/detail-desktop.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/RESULT.json`,
    JSON.stringify(
      {
        passed: true,
        newChild: true,
        existingAppend: true,
        nativeTableAndCode: true,
        sourcesPreserved: true,
        originalAndResultPreserved: true,
        topicTitleWithSuffix: true,
        leftPromptDisclosure: true,
        adjacentResultState: true,
        noDoubleFocusOutline: true,
        keyboardFocusVisible: true,
        widths: [1440, 390, 320],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Memo organize QA passed: full AI body, sources, native blocks, child page, existing append, originals preserved, no ambiguous original action, no nested picker/horizontal scroll.',
  );
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await rm(dir, { recursive: true, force: true });
}
