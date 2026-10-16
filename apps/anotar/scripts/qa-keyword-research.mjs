// Entirely temporary data; HTTP fixture cannot browse or call a paid provider.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';

const root = await mkdtemp(join(tmpdir(), 'leneu-keyword-qa-'));
const store = openStore(root);
const template = store.getPromptTemplate('research-keyword');
const sample = store.createCapture({
  kind: 'note',
  text: 'SQLite FTS5 참고 자료 정리',
  aiRequest: { template, additional: '' },
});
const seeded = store.claimAiJob({ label: '임시 QA fixture', mode: 'test' });
store.completeAiJob(seeded.id, seeded.runToken, {
  markdown:
    '> 수집 안내: 검색 후보 3개 중 본문을 확인한 1개 출처만 사용했어요.\n\n## 핵심 요약\n\n- 문서를 대상으로 전문 검색을 제공해요.\n- MATCH로 질의해요.\n- 쓰기와 색인을 함께 갱신해요.',
  sources: [
    {
      url: 'https://sqlite.org/fts5.html',
      title: 'SQLite FTS5',
      verified: true,
      fetchedAt: '2026-09-29T00:00:00Z',
    },
  ],
  usage: null,
});
store.close();
let gatewayCalls = 0;
const gateway = createServer((_req, res) => {
  gatewayCalls++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ markdown: 'fixture' }));
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const holder = createServer();
await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
const port = holder.address().port;
await new Promise((resolve) => holder.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: root,
    AI_RUNNER_KIND: 'http',
    AI_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
    AI_RUNNER_TOKEN: '',
    AI_RUNNER_MODE: 'test',
  },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1327, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(
    requests.some((url) => /PageEditor-|PromptWorkspace-|AiJobPanel-/.test(url)),
    false,
    'quick input remains lazy',
  );
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('N100에서 SQLite FTS5를 사용할 때의 장단점');
  await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
  await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('research-keyword');
  await page
    .getByText(
      '적은 주제·키워드로 관련 자료를 찾아 출처와 함께 정리해요. 웹 검색을 지원하는 실행기가 필요해요.',
      { exact: true },
    )
    .waitFor();
  await page.locator('.capture-ai-preview summary').click();
  assert.match(
    await page.locator('.capture-ai .prompt-result').innerText(),
    /N100에서 SQLite FTS5/,
  );
  assert.equal(await page.locator('.capture-ai .prompt-input-hint').count(), 0);
  await page.locator('.capture-ai-preview summary').click();
  const shots = '.impeccable/review/keyword-research';
  await mkdir(shots, { recursive: true });
  for (const width of [1327, 390, 320])
    for (const theme of ['light', 'dark']) {
      if (await page.locator('.composer.mobile-open').isVisible())
        await page.getByRole('button', { name: '입력 닫기', exact: true }).click();
      await page.setViewportSize({ width, height: 1000 });
      await selectAppTheme(page, theme);
      if (width < 760) await page.getByRole('button', { name: '전체 화면으로 쓰기' }).click();
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const path = `${shots}/keyword-${width}-${theme}.png`;
      const reuse =
        process.env.QA_KEYWORD_REUSE_CAPTURES === '1' &&
        (await access(path).then(
          () => true,
          () => false,
        ));
      if (!reuse) await page.screenshot({ path });
    }
  await page.getByRole('button', { name: '입력 닫기', exact: true }).click();
  await page.setViewportSize({ width: 1327, height: 1000 });
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('URL이 있으면 https://sqlite.org/fts5.html 글을 먼저 읽기');
  await page.getByText('입력한 URL의 본문을 읽고 출처와 함께 정리해요.', { exact: true }).waitFor();
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('N100에서 SQLite FTS5를 사용할 때의 장단점');
  await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
  await page.getByText('메모를 보관하고 AI 요청을 등록했어요.', { exact: true }).waitFor();
  const saved = (await (await fetch(base + '/api/captures?scope=ai')).json()).items.find((item) =>
    item.text.startsWith('N100에서'),
  );
  assert.ok(saved);
  await page.goto(base + '/captures/' + saved.id, { waitUntil: 'networkidle' });
  await page
    .getByText(
      '현재 실행기는 키워드 검색을 지원하지 않아요. URL을 입력하거나 검색 가능한 Devin 실행기를 연결해 주세요.',
      { exact: true },
    )
    .waitFor();
  assert.equal(gatewayCalls, 0);
  assert.equal(
    (await (await fetch(base + '/api/captures/' + saved.id)).json()).item.text,
    'N100에서 SQLite FTS5를 사용할 때의 장단점',
  );
  await page.goto(base + '/captures/' + sample.id, { waitUntil: 'networkidle' });
  await page.getByText('테스트 응답', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '확인한 출처' }).waitFor();
  assert.match(
    await page.locator('.ai-result-text').innerText(),
    /검색 후보 3개 중 본문을 확인한 1개/,
  );
  assert.equal(await page.locator('.ai-result-sources a').count(), 1);
  assert.equal(
    await page.locator('.ai-result-sources a').getAttribute('href'),
    'https://sqlite.org/fts5.html',
  );
  await page.goto(base + '/prompts?id=research-keyword', { waitUntil: 'networkidle' });
  await page.locator('.prompt-template-item').filter({ hasText: '키워드 리서치' }).click();
  assert.equal(await page.getByRole('combobox', { name: '템플릿 종류' }).inputValue(), 'research');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      screenshots: 6,
      gatewayCalls,
      realDataUsed: false,
      scenarios: [
        'lazy input',
        'keyword template and preview',
        'URL precedence hint',
        '3 widths/2 themes',
        'save-first and unsupported search',
        'verified source/result fixture',
        'template manager',
      ],
    }),
  );
} finally {
  await browser?.close();
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  await new Promise((resolve) => gateway.close(resolve));
  await rm(root, { recursive: true, force: true });
}
