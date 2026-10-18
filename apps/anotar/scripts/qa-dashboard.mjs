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
  // 홈에는 인라인 작성 입력이 없다(2026-10-17). 작성은 작성 메뉴 → 빠른 메모로 연다.
  const create = page.getByRole('button', { name: '작성 메뉴 열기', exact: true });
  await create.waitFor();
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
  // 예전 /api/sync/bootstrap는 제거됐다. 사이드바·최근 페이지는 하나의 /api/pages 요약을 공유한다.
  // 할 일 패널이 페이지 기반 할 일을 위해 같은 요약을 한 번 더 받을 수 있어 요약 요청은 최대 2건이다.
  const summaryRequests = pageRequests.filter(
    (url) => new URL(url).pathname === '/api/pages',
  );
  assert.ok(
    summaryRequests.length >= 1 && summaryRequests.length <= 2,
    `home recent pages share the sidebar metadata summary (got ${summaryRequests.length})`,
  );
  assert.equal(
    pageRequests.filter((url) => /\/api\/pages\/[^/]/.test(new URL(url).pathname)).length,
    0,
    'dashboard must not fetch complete page documents',
  );

  const boxes = await Promise.all([
    page.getByRole('region', { name: '최근 보관한 항목' }).boundingBox(),
    page.getByRole('heading', { name: '할 일' }).boundingBox(),
  ]);
  assert.ok(boxes.every(Boolean));
  assert.ok(
    boxes[1].x > boxes[0].x + boxes[0].width,
    'desktop tasks should occupy the dashboard side column',
  );
  assert.ok(boxes[0].y < 900, 'desktop recent memo heading should appear in the initial viewport');

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
  await create.waitFor({ state: 'visible' });
  assert.equal(
    await page.getByRole('textbox', { name: '메모 내용', exact: true }).isVisible().catch(() => false),
    false,
    'home no longer shows an inline capture input; writing opens from the create menu',
  );
  assert.equal(
    await page.locator('.mobile-capture-dock').isVisible().catch(() => false),
    false,
    'home has no duplicate bottom capture dock',
  );
  const ordered = await page.evaluate(() => {
    const selectors = [
      '.dashboard-ai',
      '.tasks-panel-host',
      '.dashboard-memos',
      '.dashboard-pages',
    ];
    return selectors.map(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().top,
    );
  });
  // 홈 인라인 입력이 사라지며(2026-10-17) 모바일은 메모·페이지를 먼저 쌓고 상태 패널이 이어진다.
  assert.ok(
    ordered.every((value) => Number.isFinite(value)),
    `all dashboard panels must render on mobile: ${ordered}`,
  );
  assert.equal(new Set(ordered).size, ordered.length, 'panels must not stack at the same offset');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'mobile dashboard must fit the viewport',
  );

  const openMemo = async () => {
    await create.click();
    await page.getByRole('dialog', { name: '새로 작성' }).getByRole('button', { name: '빠른 메모', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '빠른 기록', exact: true });
    await dialog.waitFor();
    return dialog;
  };
  let dialog = await openMemo();
  let memo = dialog.getByRole('textbox', { name: '메모 내용', exact: true });
  await memo.fill('모바일에서 바로 적은 메모');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('보관함에 저장했어요', { exact: true }).waitFor();
  await page.waitForFunction(async () => {
    const response = await fetch('/api/captures');
    return response.ok && (await response.json()).items[0]?.text === '모바일에서 바로 적은 메모';
  }, undefined, { timeout: 30000 });
  assert.equal(
    (await (await context.request.get(base + '/api/captures')).json()).items[0].text,
    '모바일에서 바로 적은 메모',
  );

  // 작성 메뉴를 다시 열어 이어 쓸 초안을 유지하는지 확인한다.
  dialog = await openMemo();
  memo = dialog.getByRole('textbox', { name: '메모 내용', exact: true });
  await memo.fill('이어서 쓰는 초안');
  await dialog.getByRole('button', { name: '입력 닫기', exact: true }).click();
  await page.locator('.mobile-create-draft').waitFor();
  await create.click();
  assert.match(await page.locator('.mobile-create-sheet').textContent(), /메모 이어쓰기/);
  await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '빠른 기록', exact: true });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
    '이어서 쓰는 초안',
    'reopening the quick memo keeps the draft',
  );
  await dialog.getByRole('button', { name: '입력 닫기', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await create.waitFor();
  await create.click();
  await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '빠른 기록', exact: true });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
    '이어서 쓰는 초안',
    'reload must restore the shared draft',
  );
  await dialog.getByRole('button', { name: '입력 닫기', exact: true }).click();
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
    'Dashboard QA passed: shared metadata, responsive panels, quick-memo capture, draft, page navigation',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
