import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const selection = { template: null, additional: '' };
const document = () => ({
  schemaVersion: 1,
  blocks: [
    {
      id: randomUUID(),
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: '주말 여행 동선 정리', styles: {} }],
      children: [],
    },
  ],
});
const dir = await mkdtemp(join(tmpdir(), 'leneu-activity-qa-'));
const store = openStore(dir);
const finish = (markdown) => {
  const job = store.claimAiJob({ label: '검증 실행기', mode: 'test' });
  store.completeAiJob(job.id, job.runToken, { markdown, sources: [], usage: null });
  return job;
};
const capture = store.createCapture({
  kind: 'note',
  text: '교토에서 오래 머물 장소 정리하기',
  aiRequest: selection,
});
const old = finish('# 처음 정리한 결과\n\n처음 요청의 결과입니다.');
store.enqueueAiJob({
  captureId: capture.id,
  requestId: randomUUID(),
  expectedVersion: capture.version,
});
finish('# 다시 정리한 결과\n\n새로운 요청의 결과입니다.');
store.createCapture({ kind: 'note', text: '지난 요청의 연결 실패 확인', aiRequest: selection });
const failure = store.claimAiJob();
store.failAiJob(failure.id, failure.runToken, 'timeout');
const organized = store.createCapture({
  kind: 'note',
  text: '페이지로 정리한 메모의 결과도 찾기',
  aiRequest: selection,
});
finish('# 정리한 결과\n\n페이지로 옮겼습니다.');
let target = store.createPage({ title: '여유로운 교토 여행 일정' });
target = store.updatePage({ ...target, expectedVersion: target.version, document: document() });
store.importCaptureIntoPage({
  pageId: target.id,
  captureId: organized.id,
  operationId: randomUUID(),
  disposition: 'organize',
  copyContent: true,
  assetIds: [],
});
target = store.getPage(target.id);
const pageJob = store.enqueuePageAiJob({
  pageId: target.id,
  expectedVersion: target.version,
  requestId: randomUUID(),
  aiRequest: selection,
});
finish('# 페이지 요청의 결과\n\n페이지 전체를 기준으로 정리했습니다.');
store.close();

let release,
  released = false;
const gate = new Promise((resolve) => {
  release = resolve;
});
const gateway = createServer(async (req, res) => {
  for await (const chunk of req) {
    /* consume the fixture request */
  }
  await gate;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ markdown: '# 실행 결과\n\n요청 처리가 완료됐습니다.' }));
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
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
    AI_RUNNER_KIND: 'http',
    AI_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
    AI_RUNNER_TOKEN: '',
    AI_RUNNER_MODE: 'test',
    AI_RUNNER_LABEL: '검증 실행기',
  },
  stdio: 'pipe',
});
let browser;
const errors = [];
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await pause(50);
  }
  const form = new FormData();
  form.set('kind', 'note');
  form.set('text', '지금 작성한 메모의 처리 상태 확인');
  form.set('aiRequest', JSON.stringify(selection));
  const running = (
    await (await fetch(base + '/api/captures', { method: 'POST', body: form })).json()
  ).aiJob;
  const queued = (
    await (
      await fetch(base + `/api/pages/${target.id}/ai-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: target.version,
          requestId: randomUUID(),
          aiRequest: selection,
        }),
      })
    ).json()
  ).item;
  const api = await (await fetch(base + '/api/ai/activity')).json();
  assert.equal(api.items.length, 7);
  assert.equal((await fetch(base + '/api/ai/activity?status=bad')).status, 400);
  assert.equal(
    (await (await fetch(base + '/api/ai-jobs?ids=' + running.id)).json()).items.length,
    1,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  // Native intersection visibility: mounting below the fold must not fetch activity.
  const offscreenContext = await browser.newContext({ viewport: { width: 1327, height: 200 } });
  const offscreenPage = await offscreenContext.newPage();
  offscreenPage.setDefaultTimeout(10000);
  let offscreenRequests = 0;
  offscreenPage.on('request', (request) => {
    if (request.url().includes('/api/ai/activity?')) offscreenRequests++;
  });
  await offscreenPage.goto(base, { waitUntil: 'domcontentloaded' });
  const offscreenSummary = offscreenPage.getByRole('region', {
    name: 'AI 요청 현황',
    exact: true,
  });
  await offscreenSummary.waitFor({ state: 'attached' });
  assert.equal(
    await offscreenSummary.evaluate(
      (element) => element.getBoundingClientRect().top >= innerHeight,
    ),
    true,
  );
  await pause(400);
  const requestsBeforeScroll = offscreenRequests;
  const visibleRequest = offscreenPage.waitForRequest((request) =>
    request.url().includes('/api/ai/activity?'),
  );
  await offscreenSummary.scrollIntoViewIfNeeded();
  await visibleRequest;
  await offscreenSummary.locator(`[data-ai-job-id="${running.id}"]`).waitFor();
  assert.ok(
    offscreenRequests > requestsBeforeScroll,
    'Scrolling into view must start the activity fetch',
  );
  await offscreenContext.close();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
  await mobilePage
    .getByRole('region', { name: 'AI 요청 모니터', exact: true })
    .locator('.activity-list')
    .waitFor();
  const monitorDockVisible = await mobilePage.locator('.mobile-capture-dock').isVisible();
  await mobileContext.close();
  assert.deepEqual(
    { requestsBeforeScroll, monitorDockVisible },
    { requestsBeforeScroll: 0, monitorDockVisible: false },
    'Initial offscreen activity must stay idle and the mobile monitor must remain unobscured',
  );
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const home = page.getByRole('region', { name: 'AI 요청 현황', exact: true });
  await home.locator(`[data-ai-job-id="${running.id}"]`).waitFor();
  await home.locator(`[data-ai-job-id="${queued.id}"]`).waitFor();
  assert.match(await home.locator(`[data-ai-job-id="${running.id}"]`).textContent(), /처리 중/);
  assert.match(await home.locator(`[data-ai-job-id="${queued.id}"]`).textContent(), /대기 중/);
  const input = page.getByRole('textbox', { name: '메모 내용', exact: true });
  await input.fill('모니터를 확인하는 동안 작성 중인 메모');
  await home.getByRole('link', { name: '모두 보기', exact: true }).click();
  const monitor = page.getByRole('region', { name: 'AI 요청 모니터', exact: true });
  await monitor.locator(`[data-ai-job-id="${pageJob.id}"]`).waitFor();
  assert.equal(new URL(page.url()).pathname, '/ai');
  await monitor.getByRole('tab', { name: /^진행 중/ }).click();
  await monitor.locator(`[data-ai-job-id="${queued.id}"]`).waitFor();
  assert.equal(await monitor.locator('.activity-row').count(), 2);
  await monitor.getByRole('tab', { name: /^실패/ }).click();
  await monitor.locator(`[data-ai-job-id="${failure.id}"]`).waitFor();
  assert.equal(await monitor.locator('.activity-row').count(), 1);
  await monitor.getByRole('tab', { name: /^결과 준비/ }).click();
  await monitor.locator(`[data-ai-job-id="${old.id}"]`).waitFor();
  await monitor.locator(`[data-ai-job-id="${old.id}"]`).click();
  await page.locator('.ai-result-text').filter({ hasText: '처음 요청의 결과입니다.' }).waitFor();
  assert.equal(
    await page.locator('.ai-result-text').filter({ hasText: '새로운 요청의 결과입니다.' }).count(),
    0,
  );
  await page
    .getByRole('region', { name: '보관한 항목', exact: true })
    .getByRole('button', { name: '닫기', exact: true })
    .click();
  await monitor.locator(`[data-ai-job-id="${old.id}"]`).waitFor();
  assert.equal(new URL(page.url()).pathname, '/ai');
  await page.goto(base + `/pages/${target.id}?aiJob=${pageJob.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('region', { name: '페이지 AI', exact: true }).waitFor();
  await page
    .locator('.ai-result-text')
    .filter({ hasText: '페이지 전체를 기준으로 정리했습니다.' })
    .waitFor();
  // An in-flight job finishes on the real local worker; the monitor must update without reload.
  await page.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
  await monitor.locator(`[data-ai-job-id="${running.id}"]`).waitFor();
  released = true;
  release();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-ai-job-id="${id}"] .activity-state`)
        ?.textContent.includes('결과 준비됨'),
    queued.id,
  );
  await page.route('**/api/ai/activity?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html>fixture unavailable</html>',
    }),
  );
  await page.locator('.workspace-topbar').getByRole('button', { name: 'AI 상태 새로고침' }).click();
  await monitor.getByRole('alert').waitFor();
  assert.match(await monitor.getByRole('alert').textContent(), /마지막 확인 기준/);
  assert.doesNotMatch(await monitor.getByRole('alert').textContent(), /JSON|Unexpected|Response/);
  await page.unroute('**/api/ai/activity?*');
  await monitor.getByRole('button', { name: '다시 불러오기' }).click();
  await page.waitForFunction(() => !document.querySelector('.activity-error'));
  // Synthetic visibility event verifies cleanup; no hidden polling requests should follow.
  let polls = 0;
  const listener = (request) => {
    if (request.url().includes('/api/ai/activity?')) polls++;
  };
  page.on('request', listener);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const prior = polls;
  await pause(2200);
  assert.equal(polls, prior);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('.activity-list'));
  page.off('request', listener);
  await page
    .locator('.workspace-topbar')
    .getByRole('button', { name: '새 AI 요청', exact: true })
    .click();
  assert.equal(await input.inputValue(), '모니터를 확인하는 동안 작성 중인 메모');
  assert.equal(
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).isChecked(),
    true,
  );
  await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).uncheck();
  const output = '.impeccable/review/ai-activity';
  await mkdir(output, { recursive: true });
  if (process.env.QA_AI_ACTIVITY_SCREENSHOTS !== '0') {
    for (const width of [1327, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1327 ? 1000 : 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
        for (const path of ['/ai', '/']) {
          await page.goto(base + path, { waitUntil: 'domcontentloaded' });
          const region = page.getByRole('region', {
            name: path === '/ai' ? 'AI 요청 모니터' : 'AI 요청 현황',
            exact: true,
          });
          if (path === '/') await region.scrollIntoViewIfNeeded();
          await region.locator('.activity-list').waitFor();
          if (width < 600)
            assert.equal(await page.locator('.mobile-capture-dock').isVisible(), false);
          if (path === '/ai')
            assert.equal(
              await region
                .locator('.activity-organized')
                .filter({ hasText: '정리 완료' })
                .isVisible(),
              true,
            );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `${path} ${width} ${theme} overflow`,
          );
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `${output}/${path === '/ai' ? 'monitor' : 'home'}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'AI activity QA PASS: initially offscreen summary makes no request until scrolled into view, mobile monitor has no obscuring dock, home visibility, unified memo/Page monitoring, real queued/running/completion, status filters, exact result links, Page auto-open, organized history, API validation, HTML response recovery, draft preservation, synthetic hidden polling stop, 1327/390/320px light/dark no overflow. Local temporary fixtures only.',
  );
  await context.close();
} finally {
  if (!released) release();
  await browser?.close();
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await new Promise((resolve) => gateway.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
