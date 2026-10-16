import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';
const root = await mkdtemp(join(tmpdir(), 'leneu-plan-relations-')),
  evidence = resolve('.omo/evidence/migration-ready');
await mkdir(evidence, { recursive: true });
const children = [];
let browser,
  log = '';
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const value = s.address().port;
  await new Promise((r) => s.close(r));
  return value;
}
function child(file, env) {
  const p = spawn(process.execPath, [file], {
    env: {
      ...process.env,
      DATA_DIR: root,
      HOST: '127.0.0.1',
      PUBLIC_HOST: '127.0.0.1',
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      GOOGLE_MAPS_DEMO_KEY: '',
      ...env,
    },
    stdio: 'pipe',
  });
  p.stdout.on('data', (b) => (log += b));
  p.stderr.on('data', (b) => (log += b));
  children.push(p);
  return p;
}
async function wait(url) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('server start ' + log);
}
async function json(url, body, method = 'GET') {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  assert.ok(r.ok, JSON.stringify(value));
  return value;
}
try {
  const store = openStore(root);
  const created = store.createPage({ title: '서울 하루 계획 · 준비와 참고' }),
    blockId = randomUUID(),
    entryId = randomUUID();
  const plan = {
    version: 1,
    title: '궁과 미술관 하루 일정',
    timezone: 'Asia/Seoul',
    entries: [
      {
        id: entryId,
        date: '2026-10-03',
        start: '09:00',
        end: '10:00',
        title: '경복궁 산책',
        place: '경복궁',
        category: 'sightseeing',
        latitude: 37.5796,
        longitude: 126.977,
      },
    ],
  };
  const doc = {
    schemaVersion: 1,
    blocks: [
      {
        id: blockId,
        type: 'itinerary',
        props: { data: JSON.stringify(plan), assetId: '' },
        content: [],
        children: [],
      },
    ],
  };
  const saved = store.updatePage({
    id: created.id,
    title: created.title,
    document: doc,
    expectedVersion: created.version,
  });
  const memo = store.createCapture({
    kind: 'note',
    text: '비공개 예약 번호와 준비 사항',
    url: null,
    files: [],
  });
  const related = store.createPage({ title: '비공개 이동 안내' });
  const existing = store.createTask({ title: '편한 운동화 챙기기' });
  const share = store.createPageShare(saved.id, { commentsEnabled: false });
  store.close();
  const base = 'http://127.0.0.1:' + (await port()),
    publicBase = 'http://127.0.0.1:' + (await port());
  child('server/index.mjs', {
    PORT: new URL(base).port,
    PUBLIC_SHARE_ORIGIN: publicBase,
    COMMENTS_BROKER_SOCKET: join(root, 'comments.sock'),
  });
  child('server/public.mjs', {
    PUBLIC_PORT: new URL(publicBase).port,
    COMMENTS_BROKER_SOCKET: join(root, 'comments.sock'),
  });
  await wait(base + '/api/health');
  await wait(publicBase + '/health');
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/pages/' + saved.id, { waitUntil: 'networkidle' });
  assert.equal(
    await page.locator('.plan-connections').filter({ visible: true }).count(),
    0,
    'Empty preparation controls must not interrupt reading',
  );
  await page.locator('.itinerary-row-menu > summary').click();
  await page.getByRole('button', { name: '준비·참고 관리', exact: true }).click();
  const panel = page.getByRole('region', { name: '일정 준비와 관련 항목' });
  await panel
    .getByRole('textbox', { name: '새 준비 할 일', exact: true })
    .fill('입장 가능 시간 확인');
  await panel.getByRole('button', { name: '준비 할 일 추가', exact: true }).click();
  await panel.getByRole('link', { name: '입장 가능 시간 확인', exact: true }).waitFor();
  await panel.getByRole('button', { name: '편한 운동화 챙기기', exact: true }).click();
  await panel.getByRole('checkbox', { name: '편한 운동화 챙기기 완료', exact: true }).check();
  await panel.getByRole('checkbox', { name: '편한 운동화 챙기기 완료', exact: true }).waitFor();
  await panel.getByRole('combobox', { name: '연결 종류', exact: true }).selectOption('memo');
  await panel.getByRole('button', { name: '비공개 예약 번호와 준비 사항', exact: true }).click();
  await panel.getByRole('link', { name: '비공개 예약 번호와 준비 사항', exact: true }).waitFor();
  await panel.getByRole('combobox', { name: '연결 종류', exact: true }).selectOption('page');
  await panel.getByRole('button', { name: '비공개 이동 안내', exact: true }).click();
  await panel.getByRole('link', { name: '비공개 이동 안내', exact: true }).waitFor();
  let batch = await json(base + `/api/pages/${saved.id}/plan-connections`);
  assert.equal(batch.items.length, 4);
  await page.locator('.itinerary-row-menu > summary').click();
  await page
    .locator('.plan-connections-summary')
    .getByRole('link', { name: '입장 가능 시간 확인', exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(await page.locator('.plan-connections-summary').getByRole('checkbox').count(), 2);
  await page.locator('.itinerary-row-menu > summary').click();

  assert.equal(
    (await json(base + '/api/tasks?status=done')).items.find((t) => t.id === existing.id).status,
    'done',
  );
  let refusedToggle = false;
  const rollbackRoute = async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON()?.action === 'toggle-task' &&
      !refusedToggle
    ) {
      refusedToggle = true;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  };
  await page.route('**/plan-connections', rollbackRoute);
  const taskCheck = panel.getByRole('checkbox', { name: '편한 운동화 챙기기 완료', exact: true });
  await taskCheck.click();
  await panel.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('.plan-connections-retry button')?.disabled === false,
  );
  assert.equal(await taskCheck.isChecked(), true, 'failed optimistic status must roll back');
  const retryDone = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/plan-connections') &&
      response.ok(),
  );
  await panel.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).click();
  await retryDone;
  assert.equal(
    (await json(base + '/api/tasks?status=open')).items.find((t) => t.id === existing.id).status,
    'open',
  );
  const markedDone = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/plan-connections') &&
      response.ok(),
  );
  await taskCheck.check();
  await markedDone;
  await page.unroute('**/plan-connections', rollbackRoute);
  const publicCheck = panel
    .locator('.plan-connections-items>li')
    .filter({ has: page.getByRole('link', { name: '입장 가능 시간 확인', exact: true }) })
    .getByRole('checkbox', { name: '공유에 제목·상태 표시', exact: true });
  const sharedSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/plan-connections') &&
      response.request().postDataJSON()?.action === 'share' &&
      response.ok(),
  );
  await publicCheck.check();
  await sharedSaved;
  let publicHtml = await (await fetch(publicBase + '/s/' + share.token)).text();
  assert.match(publicHtml, /입장 가능 시간 확인/);
  assert.doesNotMatch(publicHtml, /편한 운동화 챙기기|비공개 예약 번호|비공개 이동 안내/);
  for (const relation of batch.items)
    assert.ok(!publicHtml.includes(relation.targetId), 'private relation target ID leaked');
  let fail = true,
    failedSnapshot = null,
    retrySnapshot = null;
  await page.route('**/plan-connections', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if (body.action === 'create-task' && body.title === '여벌 우산 챙기기') {
      if (fail) {
        fail = false;
        failedSnapshot = body;
        await route.fetch();
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      }
      retrySnapshot = body;
    }
    return route.continue();
  });
  await panel.getByRole('textbox', { name: '새 준비 할 일', exact: true }).fill('여벌 우산 챙기기');
  await panel.getByRole('button', { name: '준비 할 일 추가', exact: true }).click();
  await panel.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('.plan-connections-retry button')?.disabled === false,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.itinerary-row-menu > summary').click();
  await page.getByRole('button', { name: /준비·참고 관리/ }).click();
  const restored = page.getByRole('region', { name: '일정 준비와 관련 항목' });
  await restored.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).click();
  await restored.getByRole('link', { name: '여벌 우산 챙기기', exact: true }).waitFor();
  assert.equal(failedSnapshot.requestId, retrySnapshot.requestId);
  assert.equal(
    (await json(base + '/api/tasks?status=open')).items.filter(
      (t) => t.title === '여벌 우산 챙기기',
    ).length,
    1,
  );
  const after = (await json(base + '/api/pages/' + saved.id)).item;
  assert.equal(after.version, saved.version);
  assert.deepEqual(after.document, saved.document);
  assert.equal(after.updatedAt, saved.updatedAt);
  const zip = await fetch(base + `/api/pages/${saved.id}/export?version=${saved.version}`);
  assert.equal(zip.status, 200);
  const zipPath = join(root, 'page.zip'),
    out = join(root, 'export');
  await writeFile(zipPath, Buffer.from(await zip.arrayBuffer()));
  await mkdir(out);
  await new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-q', zipPath, '-d', out]);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(Error('unzip'))));
  });
  const offline = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(offline, /입장 가능 시간 확인/);
  assert.doesNotMatch(offline, /비공개 예약 번호|비공개 이동 안내|share-comments/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
    for (const theme of ['light', 'dark']) {
      await selectAppTheme(page, theme);
      await restored.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, `plan-${width}-${theme}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
  const publicPage = await context.newPage();
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.goto(publicBase + '/s/' + share.token);
  await publicPage.getByText('입장 가능 시간 확인', { exact: true }).waitFor();
  assert.equal(
    await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await publicPage.screenshot({ path: join(evidence, 'plan-public-390.png') });
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'plan-connections-qa.log'),
    JSON.stringify(
      {
        passed: true,
        relations: 5,
        sourceVersionPreserved: true,
        taskSingleSource: true,
        selectivePublicProjection: true,
        offlineProjection: true,
        responseLossUUIDRetry: true,
        optimisticStatusRollback: true,
        viewports: [1440, 390, 320],
        themes: ['light', 'dark'],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS plan connections: create/link/update/private refs/public opt-in/offline/UUIDretry/reload/6 responsive views',
  );
} finally {
  await browser?.close();
  for (const p of children) p.kill('SIGTERM');
  await Promise.all(
    children.map((p) => new Promise((r) => (p.exitCode !== null ? r() : p.once('exit', r)))),
  );
  await rm(root, { recursive: true, force: true });
}
