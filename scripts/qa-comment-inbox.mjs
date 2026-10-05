import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { openStore } from '../server/store.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const dir = await mkdtemp(join(tmpdir(), 'leneu-inbox-qa-'));
const ownerPort = await freePort(),
  publicPort = await freePort(),
  owner = 'http://127.0.0.1:' + ownerPort,
  shared = 'http://127.0.0.1:' + publicPort;
const evidence = join(process.cwd(), '.omo/evidence/migration-ready/comments');
await mkdir(evidence, { recursive: true });
const s = openStore(dir);
let plan = s.createPage({ title: '하루 계획 검토' });
const blocks = [
  {
    id: randomUUID(),
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text: '출발 전 운영 시간을 확인해 주세요.', styles: {} }],
    children: [],
  },
  {
    id: randomUUID(),
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text: '오후에는 산책하고 카페에서 쉬어요.', styles: {} }],
    children: [],
  },
];
plan = s.updatePage({
  id: plan.id,
  title: plan.title,
  expectedVersion: plan.version,
  document: { schemaVersion: 1, blocks },
});
const link = s.createPageShare(plan.id, { commentsEnabled: true });
function create(p, token, id, text = '일정을 확인해 주세요.') {
  return s
    .changePublicSharedComment(token, {
      requestId: randomUUID(),
      action: 'create',
      blockId: id,
      name: '민수',
      text,
    })
    .items.find((t) => t.blockId === id);
}
let a = create(plan, link.token, blocks[0].id, '첫 번째 블록 질문'),
  b = create(plan, link.token, blocks[1].id, '두 번째 블록 질문');
s.changePageComment({
  pageId: plan.id,
  requestId: randomUUID(),
  blockId: blocks[0].id,
  text: '개인 메모 secret',
});
for (let i = 0; i < 22; i++) {
  const p = s.createPage({ title: '일정 검토 ' + String(i + 1).padStart(2, '0') });
  const l = s.createPageShare(p.id, { commentsEnabled: true });
  create(p, l.token, p.document.blocks[0].id, '방문자 검토 ' + i);
}
const own = s.createPage({ title: '작성자 대화' });
s.changeSharedComment({
  pageId: own.id,
  requestId: randomUUID(),
  blockId: own.document.blocks[0].id,
  text: '작성자만 기록',
});
a = s
  .changePublicSharedComment(link.token, {
    requestId: randomUUID(),
    action: 'reply',
    threadId: a.id,
    expectedVersion: a.version,
    name: '민수',
    text: '출발 시간도 확인 부탁드려요.',
  })
  .items.find((t) => t.id === a.id);
s.close();
let output = '',
  browser;
const children = [];
const env = {
  ...process.env,
  DATA_DIR: dir,
  HOST: '127.0.0.1',
  PORT: String(ownerPort),
  PUBLIC_HOST: '127.0.0.1',
  PUBLIC_PORT: String(publicPort),
  PUBLIC_SHARE_ORIGIN: shared,
  COMMENT_SOCKET_PATH: join(dir, 'comments.sock'),
  AI_RUNNER_KIND: 'disabled',
  GOOGLE_MAPS_DEMO_KEY: '',
  BACKUP_DIR: dir + '-backups',
};
function start(file) {
  const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  children.push(child);
}
async function health(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(output);
}
const get = async () => {
  const r = await fetch(owner + '/api/shared-comments?view=all&limit=50');
  assert.equal(r.status, 200);
  return r.json();
};
const path = (t) => `/pages/${plan.id}?commentThread=${t.id}&commentBlock=${t.blockId}`;
try {
  start('server/index.mjs');
  await health(owner + '/api/health');
  start('server/public.mjs');
  await health(shared + '/health');
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let inboxRequests = 0,
    fullPageReads = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/shared-comments?')) inboxRequests++;
    if (new RegExp('/api/pages/[a-f0-9-]{36}$').test(request.url())) fullPageReads++;
  });
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) =>
      original(callback, delay === 30000 ? 250 : delay, ...args);
  });
  await page.goto(owner + '/');
  const attention = page.getByRole('region', { name: '공유 댓글 현황' });
  await attention.scrollIntoViewIfNeeded();
  await attention.getByText('출발 시간도 확인 부탁드려요.', { exact: true }).waitFor();
  assert.equal(fullPageReads, 0);
  await page.waitForTimeout(600);
  const polled = inboxRequests;
  assert.ok(polled >= 2, 'visible card polls');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(650);
  assert.equal(inboxRequests, polled, 'hidden page stops polling');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  assert.ok(inboxRequests > polled);
  await page.evaluate(() => (document.querySelector('.comments-attention').style.display = 'none'));
  await page.waitForTimeout(300);
  const offscreen = inboxRequests;
  await page.waitForTimeout(550);
  assert.equal(inboxRequests, offscreen, 'hidden card stops polling');
  await page.goto(owner + '/comments');
  await page.getByRole('heading', { name: '공유 댓글', exact: true }).waitFor();
  await page.locator('.comments-list li').last().waitFor();
  assert.equal(await page.locator('.comments-list li').count(), 20);
  assert.ok(!(await page.locator('.comments-inbox').innerText()).includes('secret'));
  await page.getByRole('button', { name: '댓글 더 보기', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.comments-list li').length === 24);
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(1100, 30);
  await page.screenshot({ path: join(evidence, 'inbox-1440-light.png') });
  let fail = true;
  const fullPattern = '**/api/pages/' + plan.id + '/shared-comments';
  await page.route(fullPattern, (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' })
      : route.continue(),
  );
  await page.goto(owner + path(a));
  await page.getByText('댓글을 불러오지 못했어요. 다시 불러와 주세요.').waitFor();
  assert.equal(
    (await get()).items.find((item) => item.threadId === a.id).unread,
    true,
    'failed fullthread load is not read',
  );
  fail = false;
  let injected = false;
  await page.route('**/api/shared-comments/' + a.id + '/read', async (route) => {
    if (!injected) {
      injected = true;
      const r = await fetch(shared + '/s/' + link.token + '/comments', {
        method: 'POST',
        headers: { Origin: shared, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: randomUUID(),
          action: 'reply',
          threadId: a.id,
          expectedVersion: a.version,
          name: '지수',
          text: '읽는 중 새로 도착한 댓글',
        }),
      });
      assert.equal(r.status, 200);
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.getByText('출발 시간도 확인 부탁드려요.', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  assert.ok(injected);
  assert.equal(
    (await get()).items.find((item) => item.threadId === a.id).unread,
    true,
    'newer concurrent guest remains unread',
  );
  await page.getByRole('button', { name: '댓글 새로고침', exact: true }).click();
  await page.getByText('읽는 중 새로 도착한 댓글', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.equal((await get()).items.find((item) => item.threadId === a.id).unread, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  let failReceipt = true;
  await page.route('**/api/shared-comments/' + b.id + '/read', (route) =>
    failReceipt
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' })
      : route.continue(),
  );
  await page.evaluate((href) => {
    history.pushState(null, '', href);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path(b));
  await page.getByText('두 번째 블록 질문', { exact: true }).waitFor();
  await page.getByText('댓글은 열었지만 읽음 상태를 저장하지 못했어요.').waitFor();
  await page.waitForTimeout(400);
  const readAlert = page.getByRole('alert');
  const readBox = await readAlert.boundingBox();
  assert.ok(readBox && readBox.y >= 0 && readBox.y + readBox.height <= 844);
  assert.ok(await page.locator('.page-comment-panel').getByRole('alert').isVisible());
  const composeBox = await page.locator('.page-comment-compose').boundingBox();
  assert.ok(
    composeBox && composeBox.y + composeBox.height <= 844 + 1,
    'mobilecomposer withinviewport evenreaderror',
  );
  await page.screenshot({ path: join(evidence, 'thread-390-read-error-light.png') });
  assert.equal((await get()).items.find((item) => item.threadId === b.id).unread, true);
  failReceipt = false;
  await page.getByRole('button', { name: '읽음 상태 다시 저장', exact: true }).click();
  await page
    .getByText('댓글은 열었지만 읽음 상태를 저장하지 못했어요.')
    .waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  assert.equal(
    (await get()).items.find((item) => item.threadId === b.id).unread,
    false,
    'same page deep link selects next thread',
  );
  assert.equal(
    (await (await fetch(owner + '/api/pages/' + plan.id)).json()).item.version,
    plan.version,
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '해결', exact: true }).click();
  await page.getByRole('button', { name: '다시 열기', exact: true }).waitFor();
  const counts = (await get()).counts;
  assert.equal(counts.resolved, 1);
  assert.equal(counts.unread, 22);
  await page.goto(owner + '/comments?view=resolved');
  await page.locator('.comments-list li').last().waitFor();
  assert.equal(await page.locator('.comments-list li').count(), 1);
  await page.route('**/api/shared-comments?**', (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture' }),
  );
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page
    .getByRole('alert')
    .getByText('공유 댓글을 갱신하지 못했어요. 다시 불러와 주세요.')
    .waitFor();
  assert.equal(
    await page.locator('.comments-list li').count(),
    1,
    'error preserves last checked list',
  );
  await page.unroute('**/api/shared-comments?**');
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /전체/ }).click();
  await page.locator('.comments-list li').last().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.comments-list li').length === 20);
  await selectAppTheme(page, 'light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(1100, 30);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(evidence, 'inbox-390-light.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForTimeout(350);
  await selectAppTheme(page, 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: join(evidence, 'inbox-1440-dark.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(evidence, `inbox-${width}-dark.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(owner + path(a));
  await page.getByText('읽는 중 새로 도착한 댓글', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'thread-390-dark.png') });
  await page.reload();
  await page.getByText('읽는 중 새로 도착한 댓글', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  await writeFile(
    join(evidence, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        counts,
        polled,
        checks: [
          'home lightweight/visibility polling',
          'bounded20+pagination',
          'private exclusion',
          'fullthread error does not markread',
          'concurrent guest during receipt staysunread',
          'same-page thread deeplink',
          'failedreadmarker keepsunread and explicitretry succeeds',
          'resolve independent unread',
          'Page version unchanged',
          'reload/errors/retry',
          '1440light/dark390/320dark',
        ],
        dataDir: dir,
      },
      null,
      2,
    ),
  );
  console.log('Comment inbox browser QA passed: ' + dir);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}
