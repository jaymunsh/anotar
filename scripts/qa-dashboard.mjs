import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { openStore } from '../server/store.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dir = await mkdtemp(join(tmpdir(), 'leneu-dashboard-qa-'));
const store = openStore(dir);
store.createCapture({ kind: 'note', text: '교토 동선은 여유롭게 잡기' });
store.createCapture({ kind: 'link', url: 'https://example.org/guide', text: '여행 전 읽기' });
store.createCapture({
  kind: 'note',
  text: '교토 교통편을 찾아보고 정리하기',
  aiRequest: { template: null, additional: '' },
});
const completed = store.claimAiJob({ label: '검증 실행기', mode: 'test' });
store.completeAiJob(completed.id, completed.runToken, {
  markdown: '# 교통편 정리',
  sources: [],
  usage: null,
});
store.createCapture({
  kind: 'note',
  text: '비 오는 날의 실내 일정 조사하기',
  aiRequest: { template: null, additional: '' },
});
const failed = store.claimAiJob({ label: '검증 실행기', mode: 'test' });
store.failAiJob(failed.id, failed.runToken, 'timeout');
store.createTask({ title: '숙소 예약 확인하기' });
const firstPage = store.createPage({ title: '교토 여행 계획' });
const secondPage = store.createPage({ title: '여행 체크리스트' });
store.close();

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    PORT: String(port),
    AI_RUNNER_KIND: 'disabled',
  },
  stdio: 'pipe',
});
let browser;
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await pause(50);
  }
  assert.ok(healthy, 'temporary API must start');
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1327, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/pages') ||
      (url.pathname === '/api/sync/bootstrap' && url.searchParams.get('kind') === 'page'))
      pageRequests.push(request.url());
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const capture = page.getByRole('region', { name: '새 항목 저장' });
  await capture.getByRole('textbox', { name: '메모 내용' }).waitFor();
  await page
    .getByRole('region', { name: '최근 보관한 항목' })
    .getByText('교토 동선은 여유롭게 잡기')
    .waitFor();
  await page.getByRole('heading', { name: '할 일' }).waitFor();
  await page.getByRole('region', { name: 'AI 요청 현황' }).waitFor({ state: 'attached' });
  const recentPages = page.getByRole('region', { name: '최근 페이지' });
  await recentPages.getByRole('link', { name: /여행 체크리스트/ }).waitFor();
  const firstLink = recentPages.getByRole('link', { name: /교토 여행 계획/ });
  assert.equal(await firstLink.getAttribute('href'), `/pages/${firstPage.id}`);
  assert.equal(await recentPages.getByRole('link').count(), 2);
  assert.equal(
    pageRequests.filter((url) => {
      const path = new URL(url).pathname;
      return path === '/api/pages' || path === '/api/sync/bootstrap';
    }).length,
    1,
    'home recent pages must share the sidebar metadata request',
  );
  assert.equal(
    pageRequests.filter((url) => /\/api\/pages\//.test(new URL(url).pathname)).length,
    0,
    'dashboard must not fetch complete page documents',
  );

  const boxes = await Promise.all([
    capture.boundingBox(),
    page.getByRole('heading', { name: '할 일' }).boundingBox(),
    page.getByRole('region', { name: '최근 보관한 항목' }).boundingBox(),
  ]);
  assert.ok(boxes.every(Boolean));
  assert.ok(
    boxes[1].x > boxes[0].x + boxes[0].width,
    'desktop tasks should occupy the dashboard side column',
  );
  assert.ok(boxes[2].y < 900, 'desktop recent memo heading should appear in the initial viewport');

  if (process.env.QA_DASHBOARD_SCREENSHOTS === '1') {
    const output = '.impeccable/review/home-dashboard';
    await mkdir(output, { recursive: true });
    for (const width of [1920, 1327, 390, 320]) {
      await page.setViewportSize({ width, height: width >= 1327 ? 900 : 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const activity = page.getByRole('region', { name: 'AI 요청 현황' });
        await activity.scrollIntoViewIfNeeded();
        await activity.locator('.activity-list').waitFor();
        await page
          .getByRole('region', { name: '최근 페이지' })
          .getByRole('link', { name: /여행 체크리스트/ })
          .waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          `${width}px ${theme} dashboard must not overflow`,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${output}/home-${width}-${theme}.png`, fullPage: true });
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await capture.getByRole('textbox', { name: '메모 내용' }).waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('.mobile-capture-dock').isVisible(),
    false,
    'home inline capture removes the duplicate bottom capture dock',
  );
  const ordered = await page.evaluate(() => {
    const selectors = [
      '.composer',
      '.dashboard-ai',
      '.tasks-panel-host',
      '.dashboard-memos',
      '.dashboard-pages',
    ];
    return selectors.map(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().top,
    );
  });
  assert.ok(ordered.every((value) => Number.isFinite(value)));
  assert.ok(
    ordered.every((value, index) => !index || value > ordered[index - 1]),
    `mobile content order should favor input and statuses: ${ordered}`,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'mobile dashboard must fit the viewport',
  );

  const memo = capture.getByRole('textbox', { name: '메모 내용' });
  await memo.fill('모바일에서 바로 적은 메모');
  await capture.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
  await page.waitForFunction(async () => {
    const response = await fetch('/api/captures');
    return response.ok && (await response.json()).items[0]?.text === '모바일에서 바로 적은 메모';
  }, undefined, { timeout: 30000 });
  assert.equal(
    (await (await context.request.get(base + '/api/captures')).json()).items[0].text,
    '모바일에서 바로 적은 메모',
  );

  await memo.fill('이어서 쓰는 초안');
  await capture.getByRole('button', { name: '전체 화면으로 쓰기' }).click();
  const sheet = page.getByRole('dialog', { name: '빠른 기록' });
  await sheet.waitFor();
  assert.equal(
    await sheet.getByRole('textbox', { name: '메모 내용' }).inputValue(),
    '이어서 쓰는 초안',
  );
  await sheet.getByRole('button', { name: '입력 닫기' }).click();
  assert.equal(await memo.inputValue(), '이어서 쓰는 초안');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await memo.inputValue(), '이어서 쓰는 초안', 'reload must restore the shared draft');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1327, height: 900 });
  await page
    .getByRole('region', { name: '최근 페이지' })
    .getByRole('link', { name: /교토 여행 계획/ })
    .click();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/pages/${firstPage.id}`);
  assert.equal(secondPage.title, '여행 체크리스트');
  console.log(
    'Dashboard QA passed: shared metadata, responsive panels, inline capture, draft, page navigation',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
