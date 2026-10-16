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
  const request = {
    pageId: saved.id,
    requestId: randomUUID(),
    action: 'create-task',
    blockId,
    entryId,
    expectedPageVersion: saved.version,
    title: '응답 유실 뒤에도 남길 준비',
  };
  const initial = await json(
    base + '/api/pages/' + saved.id + '/plan-connections',
    request,
    'POST',
  );
  const prep = initial.items[0];
  await json(
    base + '/api/pages/' + saved.id + '/plan-connections',
    {
      pageId: saved.id,
      requestId: randomUUID(),
      action: 'link',
      blockId,
      entryId,
      expectedPageVersion: saved.version,
      kind: 'task',
      targetId: existing.id,
    },
    'POST',
  );
  const noPlan = {
    schemaVersion: 1,
    blocks: [
      {
        id: randomUUID(),
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: '일정 블록을 제거한 페이지입니다.', styles: {} }],
        children: [],
      },
    ],
  };
  const updated = (
    await json(
      base + '/api/pages/' + saved.id,
      { title: saved.title, document: noPlan, expectedVersion: saved.version },
      'PUT',
    )
  ).item;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(
    ({ pageId, request }) => {
      if (!localStorage.getItem('qa:orphan-pending-seeded')) {
        sessionStorage.setItem(
          'leneu:plan-connections-pending:v1:' + pageId,
          JSON.stringify(request),
        );
        localStorage.setItem('qa:orphan-pending-seeded', '1');
      }
    },
    { pageId: saved.id, request },
  );
  const page = await context.newPage(),
    gets = [],
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().endsWith('/plan-connections')) gets.push(r.url());
  });
  await page.goto(base + '/pages/' + saved.id, { waitUntil: 'networkidle' });
  assert.equal(gets.length, 0, 'last itinerary removed must preserve initial noGET');
  await page.getByLabel('페이지 정보', { exact: true }).click();
  await page.getByRole('button', { name: '일정 연결 관리', exact: true }).click();
  const manager = page.getByRole('region', { name: '일정 연결 관리', exact: true });
  await manager.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).waitFor();
  const replay = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/plan-connections') && r.ok(),
  );
  await manager.getByRole('button', { name: '같은 요청 다시 시도', exact: true }).click();
  assert.equal((await (await replay).json()).replayed, true);
  await manager
    .getByRole('button', { name: '응답 유실 뒤에도 남길 준비 연결 해제', exact: true })
    .waitFor();
  assert.equal(
    (await json(base + '/api/tasks?status=open')).items.filter(
      (t) => t.title === '응답 유실 뒤에도 남길 준비',
    ).length,
    1,
  );
  assert.equal(
    (await json(base + '/api/pages/' + saved.id + '/plan-connections')).items.every(
      (row) => row.sourceMissing,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, 'plan-orphan-1440-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await selectAppTheme(page, 'dark');
  await manager.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'plan-orphan-390-dark.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await manager
    .getByRole('button', { name: '응답 유실 뒤에도 남길 준비 연결 해제', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.plan-orphan-list')
        ?.textContent.includes('응답 유실 뒤에도 남길 준비'),
  );
  assert.equal(
    (await json(base + '/api/tasks?status=open')).items.find((t) => t.id === prep.targetId).title,
    '응답 유실 뒤에도 남길 준비',
  );
  assert.equal((await json(base + '/api/pages/' + saved.id)).item.version, updated.version);
  await page.getByRole('button', { name: '일정 연결 관리 닫기', exact: true }).click();
  await page.goto(base + '/pages/' + related.id, { waitUntil: 'networkidle' });
  const before = gets.filter((url) => url.includes(related.id)).length;
  assert.equal(before, 0);
  await page.getByLabel('페이지 정보', { exact: true }).click();
  await page.getByRole('button', { name: '일정 연결 관리', exact: true }).click();
  await page
    .getByText('정리할 연결이 없어요. 사용 중인 연결은 각 일정 항목에서 관리할 수 있어요.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    gets.filter((url) => url.includes(related.id)).length,
    1,
    'explicit manager open is allowed to force a singleGET',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'plan-orphan-browser.log'),
    JSON.stringify(
      {
        passed: true,
        lastBlockRemovedManagerAccessible: true,
        pendingReplayAfterSourceDeletion: true,
        noDuplicateTask: true,
        unlinkKeepsTask: true,
        documentVersionUnchanged: true,
        ordinaryPageInitialGETs: 0,
        explicitManagerGETs: 1,
        mobileBounds: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS orphan manager: last block removed/pending replay/unlink keepsTask/no initial GET/explicit manager GET/mobile',
  );
} finally {
  await browser?.close();
  for (const p of children) p.kill('SIGTERM');
  await Promise.all(
    children.map((p) => new Promise((r) => (p.exitCode !== null ? r() : p.once('exit', r)))),
  );
  await rm(root, { recursive: true, force: true });
}
