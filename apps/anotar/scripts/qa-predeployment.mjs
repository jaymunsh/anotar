import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../server/store.mjs';
import { runCommentPreviewQa } from './qa-page-comment-preview.mjs';
const root = await mkdtemp(join(tmpdir(), 'leneu-predeploy-')),
  dataDir = join(root, 'data'),
  evidence = resolve('.impeccable/review/predeployment');
await mkdir(evidence, { recursive: true });
let browser, owner, publicServer;
const errors = [];
let serverLog = '';
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const gateway = createServer(async (req, res) => {
  const chunks = [];
  for await (const b of req) chunks.push(b);
  const p = JSON.parse(Buffer.concat(chunks));
  assert.equal(p.policy.tools, false);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ text: '예약 확인: 10월 3일 오후 2시' }));
});
await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
try {
  const s = openStore(dataDir);
  let hiddenTask = s.createTask({ title: '검색으로 찾는 완료된 할 일' });
  hiddenTask = s.updateTask({
    id: hiddenTask.id,
    expectedVersion: hiddenTask.version,
    status: 'done',
  });
  for (let i = 0; i < 55; i++) {
    const t = s.createTask({ title: '새로운 완료 항목 ' + i });
    s.updateTask({ id: t.id, expectedVersion: t.version, status: 'done' });
  }
  await mkdir(join(dataDir, 'blobs'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(join(dataDir, 'blobs', 'image'), png);
  const image = s.createCapture({
    kind: 'image',
    text: '예약 안내 이미지',
    files: [{ key: 'image', name: '안내.png', mime: 'image/png', size: png.length }],
  });
  const c = s.createCapture({
    kind: 'note',
    text: '여행 준비',
    aiRequest: { template: null, additional: '준비할 일' },
  });
  const j = s.claimAiJob();
  s.completeAiJob(j.id, j.runToken, {
    markdown: '## 준비\n- [ ] 숙소 예약 확인\n- [ ] 교통편 확인',
    sources: [],
    usage: null,
  });
  const prompt = s.listPromptTemplates().items[0],
    oldBody = prompt.body;
  s.updatePromptTemplate({
    ...prompt,
    body: '새 요청문 {{content}}',
    expectedVersion: prompt.version,
    expectedRevisionId: prompt.revisionId,
  });
  let doc = s.createPage({ title: '오프라인 첨부 문서' });
  doc = s.updatePage({
    id: doc.id,
    title: doc.title,
    expectedVersion: doc.version,
    document: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'img',
          type: 'asset',
          props: { assetId: image.files[0].id, display: 'image' },
          children: [],
          content: [],
        },
      ],
    },
  });
  s.close();
  owner = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      BACKUP_DIR: join(root, 'backups'),
      PORT: String(port),
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      OCR_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
      OCR_RUNNER_TOKEN: '',
      GOOGLE_MAPS_DEMO_KEY: '',
    },
    stdio: 'pipe',
  });
  owner.stderr.on('data', (b) => (serverLog += b));
  owner.stdout.on('data', (b) => (serverLog += b));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok((await fetch(base + '/api/health')).ok, serverLog);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  await runCommentPreviewQa(browser, base);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/captures/${c.id}?aiJob=${j.id}`);
  await page.locator('.ai-task-adoption summary').click();
  await page.getByRole('checkbox', { name: '할 일 1 선택', exact: true }).check();
  await page.getByRole('textbox', { name: '할 일 1 내용', exact: true }).fill('숙소 예약번호 확인');
  await page.getByRole('button', { name: '선택한 할 일 등록' }).click();
  await page.getByText('1개 할 일을 등록했어요.').waitFor();
  assert.equal((await (await fetch(base + '/api/tasks')).json()).counts.open, 1);
  await page.goto(`${base}/captures/${image.id}`);
  await page.locator('.asset-ocr summary').click();
  await page.getByRole('button', { name: '글자 인식 요청', exact: true }).click();
  await page.getByText('인식 완료', { exact: true }).waitFor();
  await page.getByText('예약 확인: 10월 3일 오후 2시', { exact: true }).waitFor();
  await page.reload();
  await page.locator('.asset-ocr summary').click();
  await page.getByText('예약 확인: 10월 3일 오후 2시', { exact: true }).waitFor();
  const firstOcr = (await (await fetch(base + `/api/assets/${image.files[0].id}/ocr`)).json())
    .items[0];
  await page.getByRole('button', { name: '다시 인식 요청', exact: true }).click();
  await page.getByText('인식 완료', { exact: true }).waitFor();
  for (let i = 0; i < 100; i++) {
    const jobs = (await (await fetch(base + `/api/assets/${image.files[0].id}/ocr`)).json()).items;
    if (jobs.filter((j) => j.status === 'result_ready').length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const ocrSearch = (
    await (
      await fetch(base + '/api/search?q=' + encodeURIComponent('예약 확인') + '&type=ocr')
    ).json()
  ).items.find((i) => i.id === firstOcr.id);
  assert.match(ocrSearch.href, new RegExp('ocrJob=' + firstOcr.id));
  await page.goto(base + ocrSearch.href);
  await page.getByText('예약 확인: 10월 3일 오후 2시', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: '이미지 인식 이력' }).inputValue(),
    firstOcr.id,
  );
  // Select an older OCR result through the palette while the same capture is already open.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '통합 검색어' }).fill('예약 확인');
  await page.getByRole('tab', { name: 'OCR', exact: true }).click();
  await page.locator('.page-search-result').nth(1).waitFor();
  await page.locator('.page-search-result').nth(1).click();
  await page.getByRole('combobox', { name: '이미지 인식 이력' }).waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: '이미지 인식 이력' }).inputValue(),
    firstOcr.id,
  );
  const taskLink = (
    await (
      await fetch(base + '/api/search?q=' + encodeURIComponent('검색으로 찾는') + '&type=task')
    ).json()
  ).items[0].href;
  await page.goto(base + taskLink);
  await page.locator(`[data-task-id="${hiddenTask.id}"]`).waitFor();
  assert.match(
    await page.locator(`[data-task-id="${hiddenTask.id}"]`).textContent(),
    /검색한 할 일/,
  );
  assert.equal(
    await page.getByRole('button', { name: /^완료 / }).getAttribute('aria-pressed'),
    'true',
  );
  await page.goto(`${base}/prompts/${prompt.id}`);
  await page.getByRole('button', { name: '수정 이력', exact: true }).click();
  await page.getByRole('combobox', { name: '프롬프트 수정본' }).selectOption(prompt.revisionId);
  await page.getByRole('button', { name: '이 수정본을 초안으로 불러오기' }).click();
  assert.equal(await page.getByRole('textbox', { name: '프롬프트 본문' }).inputValue(), oldBody);
  // Export through the real route, unzip with standard tooling, and read with the browser fully offline.
  const archive = await fetch(`${base}/api/pages/${doc.id}/export?version=${doc.version}`);
  assert.equal(archive.status, 200);
  const zip = join(root, 'page.zip');
  await writeFile(zip, Buffer.from(await archive.arrayBuffer()));
  execFileSync('unzip', ['-t', zip], { stdio: 'pipe' });
  const extracted = join(root, 'offline');
  execFileSync('unzip', ['-q', zip, '-d', extracted]);
  const offlineCtx = await browser.newContext({
      offline: true,
      viewport: { width: 390, height: 844 },
    }),
    offline = await offlineCtx.newPage();
  await offline.goto('file://' + join(extracted, 'index.html'));
  await offline.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
  assert.match(await offline.title(), /오프라인 첨부/);
  const offlineMode = offline.getByRole('combobox', { name: '화면 모드' });
  await offlineMode.waitFor();
  await offlineMode.selectOption('dark');
  assert.equal(
    await offline.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'dark',
  );
  await offlineMode.selectOption('light');
  assert.equal(
    await offline.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  await offline.screenshot({ path: join(evidence, 'offline-390.png'), fullPage: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/');
    await page.keyboard.press('Control+k');
    await page.locator('.search-filters').waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: join(evidence, `search-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log(
    'Predeployment QA passed: durable comments/replies/resolve/reload; reviewed AI task adoption; fixture OCR and reload/search; prompt history to draft; real ZIP unzip and offline image; 1440/390/320 search.',
  );
} finally {
  await browser?.close();
  owner?.kill('SIGTERM');
  publicServer?.kill('SIGTERM');
  await new Promise((r) => gateway.close(r));
  await rm(root, { recursive: true, force: true });
}
