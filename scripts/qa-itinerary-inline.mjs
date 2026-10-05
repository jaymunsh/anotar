import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'leneu-inline-'));
const evidence = resolve('.omo/evidence/itinerary-inline');
await mkdir(evidence, { recursive: true });
const socket = createServer();
await new Promise((r) => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: join(root, 'data'),
    BACKUP_DIR: join(root, 'backups'),
    PORT: String(port),
    HOST: '127.0.0.1',
    AI_RUNNER_KIND: 'disabled',
    GOOGLE_MAPS_DEMO_KEY: '',
    GEOAPIFY_API_KEY: '',
  },
  stdio: 'pipe',
});
let browser,
  log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
async function json(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  return v;
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const { item: created } = await json('/api/pages', { title: '시간표 직접 편집 QA' });
  const entries = [
    {
      id: 'stop-a',
      date: '2026-10-05',
      start: '09:00',
      end: '10:00',
      title: '아침 산책',
      place: '공원',
      category: 'sightseeing',
      note: '09:00–09:30 첫 단계\n09:30–10:00 두 번째 단계',
      latitude: 34.7,
      longitude: 135.5,
    },
    {
      id: 'move-b',
      date: '2026-10-05',
      start: '10:00',
      end: '10:30',
      title: '다음 장소로 이동',
      category: 'travel',
    },
    {
      id: 'stop-c',
      date: '2026-10-05',
      start: '11:00',
      end: '12:00',
      title: '점심',
      category: 'meal',
      note: '메뉴 확인',
    },
  ];
  const { item: seeded } = await json(
    '/api/pages/' + created.id,
    {
      title: created.title,
      expectedVersion: created.version,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'inline-plan',
            type: 'itinerary',
            props: {
              data: JSON.stringify({
                version: 1,
                title: '하루 계획',
                timezone: 'Asia/Seoul',
                entries,
              }),
            },
            children: [],
          },
        ],
      },
    },
    'PUT',
  );
  const get = async () => (await json('/api/pages/' + seeded.id)).item;
  const stored = async () =>
    JSON.parse((await get()).document.blocks.find((b) => b.id === 'inline-plan').props.data);
  const saved = async (p, predicate) => {
    for (let i = 0; i < 450; i++) {
      const data = await stored();
      if (predicate(data)) return data;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail('Auto-save did not persist expected plan');
  };
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.setDefaultTimeout(10000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/pages/' + seeded.id, { waitUntil: 'networkidle' });
  assert.equal(
    await p.locator('.itinerary-inline-field[data-field="title"]').count(),
    3,
    'Timeline titles must be editable in place',
  );
  assert.equal(await p.getByRole('button', { name: '일정 수정', exact: true }).count(), 0);
  assert.equal(await p.locator('.itinerary-edit').count(), 0);
  const first = p.locator('[data-entry-id="stop-a"]');
  await first.locator('[data-field="title"] [role="button"]').click();
  await first.getByRole('textbox', { name: '일정 내용' }).fill('공원에서 아침 산책');
  await first.getByRole('textbox', { name: '일정 내용' }).press('Enter');
  await saved(p, (d) => d.entries[0].title === '공원에서 아침 산책');
  // Editing a property with Tab commits it and opens the next visible property.
  await first.locator('[data-field="title"] [role="button"]').click();
  await first.getByRole('textbox', { name: '일정 내용' }).press('Tab');
  await first.getByRole('combobox', { name: '활동 유형' }).waitFor({ state: 'visible' });
  await first.getByRole('combobox', { name: '활동 유형' }).press('Shift+Tab');
  await first.getByRole('textbox', { name: '일정 내용' }).waitFor({ state: 'visible' });
  await first.getByRole('textbox', { name: '일정 내용' }).press('Escape');
  assert.equal(await p.locator('.itinerary-preview').count(), 1, 'Map stays visible while editing');
  await first.locator('[data-field="note"] [role="button"]').click();
  const note = first.getByRole('textbox', { name: '일정 설명' });
  await note.fill('09:00–09:30 첫 단계\n09:30–10:00 수정한 두 번째 단계');
  await note.press('Enter');
  assert.ok((await note.inputValue()).includes('\n'));
  await note.press('Escape');
  assert.equal((await stored()).entries[0].note, entries[0].note);
  await first.locator('[data-field="note"] [role="button"]').click();
  await first
    .getByRole('textbox', { name: '일정 설명' })
    .fill('출발 전에 물 챙기기\n공원 입구에서 만나기');
  await p.locator('.page-title-input').click();
  await saved(p, (d) => d.entries[0].note === '출발 전에 물 챙기기\n공원 입구에서 만나기');
  await first.locator('[data-field="start"] [role="button"]').click();
  await first.getByLabel('시작 시간', { exact: true }).fill('12:30');
  await first.getByLabel('시작 시간', { exact: true }).press('Enter');
  assert.ok(await first.locator('[role="alert"]').count());
  assert.equal((await stored()).entries[0].start, '09:00');
  await first.getByLabel('시작 시간', { exact: true }).press('Tab');
  assert.ok(await first.getByLabel('시작 시간', { exact: true }).evaluate(e => e === document.activeElement));
  await first.getByLabel('시작 시간', { exact: true }).press('Escape');
  await first.locator('[data-field="title"] [role="button"]').click();
  const title = first.getByRole('textbox', { name: '일정 내용' });
  await title.fill('조합 중 제목');
  await title.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal((await stored()).entries[0].title, '공원에서 아침 산책');
  await title.press('Escape');
  await p.getByRole('button', { name: '일정 추가', exact: true }).click();
  const newRow = p.locator('.itinerary-timeline > li').last();
  await newRow.getByRole('textbox', { name: '일정 내용' }).fill('카페에서 휴식');
  await newRow.getByRole('textbox', { name: '일정 내용' }).press('Enter');
  await saved(p, (d) => d.entries.length === 4 && d.entries[3].title === '카페에서 휴식');
  // Recover drafts without silently applying the previous editor session.
  await first.locator('[data-field="title"] [role="button"]').click();
  await first.getByRole('textbox', { name: '일정 내용' }).fill('복구한 아침 일정');
  await p.reload({ waitUntil: 'networkidle' });
  assert.ok((await first.innerText()).includes('복구한 아침 일정'));
  assert.equal((await stored()).entries[0].title, '공원에서 아침 산책');
  await p.getByRole('button', { name: '복구한 초안 적용', exact: true }).click();
  await saved(p, (d) => d.entries[0].title === '복구한 아침 일정');
  const originalIds = (await stored()).entries.map((e) => e.id);
  await first.locator('.itinerary-row-menu > summary').click();
  let rejected = false;
  await p.route('**/api/sync/operations', async (route) => {
    if (route.request().method() === 'POST' && !rejected) {
      rejected = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'QA 저장 실패' }),
      });
    } else await route.continue();
  });
  await first.locator('[data-field="title"] [role="button"]').click();
  await first.getByRole('textbox', { name: '일정 내용' }).fill('재시도 후 저장한 아침 일정');
  await first.getByRole('textbox', { name: '일정 내용' }).press('Enter');
  await p.waitForFunction(()=>document.querySelector('.sync-status')?.textContent.includes('대기'));
  await p.getByRole('button',{name:'동기화 상태',exact:true}).click();
  await p.getByRole('button',{name:'지금 동기화',exact:true}).click();
  await p.getByRole('button',{name:'동기화 상태 닫기'}).click();
  await saved(p, (d) => d.entries[0].title === '재시도 후 저장한 아침 일정');
  await p.unroute('**/api/sync/operations');
  await first.locator('.itinerary-coordinate-options > summary').click();
  await first.getByLabel('위도', { exact: true }).fill('34.71');
  await first.getByRole('button', { name: '좌표 적용', exact: true }).click();
  await saved(p, (d) => d.entries[0].latitude === 34.71 && d.entries[0].longitude === 135.5);
  await first.getByLabel('위도', { exact: true }).fill('95');
  await first.getByRole('button', { name: '좌표 적용', exact: true }).click();
  assert.ok(await first.locator('.itinerary-coordinate-options [role="alert"]').count());
  assert.equal((await stored()).entries[0].latitude, 34.71);
  await first.getByRole('button', { name: '좌표 취소', exact: true }).click();
  assert.equal(await first.getByLabel('위도', { exact: true }).inputValue(), '34.71');
  assert.equal(
    await p.evaluate(() => localStorage.getItem('leneu:itinerary-draft:v1:inline-plan')),
    null,
  );
  await first.getByRole('button', { name: '아래로 이동', exact: true }).click();
  await saved(p, (d) => d.entries[1].id === 'stop-a');
  await first.getByRole('button', { name: '위로 이동', exact: true }).click();
  await saved(p, (d) => d.entries[0].id === 'stop-a');
  assert.deepEqual(
    (await stored()).entries.map((e) => e.id),
    originalIds,
  );
  await first.locator('.itinerary-row-menu > summary').click();
  await p.locator('.page-title-input').click();
  await first.evaluate((e) => {
    e.scrollIntoView({ behavior: 'instant', block: 'start' });
    window.scrollBy(0, -70);
  });
  await p.screenshot({ path: join(evidence, 'desktop.png') });
  await p.setViewportSize({ width: 390, height: 1000 });
  await p.reload({ waitUntil: 'networkidle' });
  assert.equal(await p.locator('.itinerary-inline-field[data-field="title"]').count(), 4);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await first.evaluate((e) => {
    e.scrollIntoView({ behavior: 'instant', block: 'start' });
    window.scrollBy(0, -70);
  });
  await first.locator('[data-field="start"] [role="button"]').click();
  const mobileField = await first.getByLabel('시작 시간', { exact: true }).evaluate((e) => ({
    height: e.getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(e).fontSize),
  }));
  assert.ok(mobileField.height >= 44 && mobileField.font >= 16);
  await first.getByLabel('시작 시간', { exact: true }).press('Escape');
  await p.screenshot({ path: join(evidence, 'mobile.png') });
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'verification.json'),
    JSON.stringify(
      {
        private: true,
        temporaryDatabase: true,
        checks: [
          'direct title save',
          'map stays visible',
          'multiline Escape',
          'blur save',
          'invalid time preserved',
          'IME Enter ignored',
          'add row',
          'reload draft recovery',
          'coordinates preserve longitude',
          'invalid coordinates rejected and cancel clears pending draft',
          'reorder preserves entry IDs',
          'backend failure keeps page draft and retry',
          'mobile editing size',
          'mobile overflow',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Inline itinerary QA passed on temporary data');
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  await writeFile(join(evidence, 'server.log'), log);
  await rm(root, { recursive: true, force: true });
}
