import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clickPageTool } from './qa-page-tools.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'leneu-plan-tools-')));
const dataDir = join(root, 'data'),
  backupDir = join(root, 'backups');
const evidence = resolve('.impeccable/review/plan-page-preservation');
await mkdir(evidence, { recursive: true });
const children = [];
let browser;
const errors = [];
let serverLog = '';
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
function child(script, env) {
  const proc = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dataDir,
      BACKUP_DIR: backupDir,
      ...env,
    },
    stdio: 'pipe',
  });
  proc.stdout.on('data', (b) => (serverLog += b));
  proc.stderr.on('data', (b) => (serverLog += b));
  children.push(proc);
  return proc;
}
async function wait(url) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Server unavailable: ' + url + '\n' + serverLog);
}
async function screenshot(page, options) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot(options);
}
try {
  const seed = child('scripts/seed-connected-itinerary.mjs', {});
  assert.equal((await once(seed, 'exit'))[0], 0);
  children.pop();
  const port = await freePort(),
    publicPort = await freePort(),
    base = `http://127.0.0.1:${port}`,
    publicBase = `http://127.0.0.1:${publicPort}`;
  child('server/index.mjs', {
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_SHARE_ORIGIN: publicBase,
    GOOGLE_MAPS_DEMO_KEY: 'AIza_qa-boundary-fixture-not-a-real-key',
  });
  child('server/public.mjs', { PUBLIC_PORT: String(publicPort), PUBLIC_HOST: '127.0.0.1' });
  await wait(base + '/api/health');
  async function json(path, body, method = 'POST') {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    assert.ok(res.ok, JSON.stringify(value));
    return value;
  }
  const seeded = (await json('/api/pages', undefined, 'GET')).items.find(
    (p) => p.title === '서울, 천천히 걷는 토요일',
  );
  assert.ok(seeded);
  const source = (await json('/api/pages', { title: '회의 기록' })).item;
  const destination = (await json('/api/pages', { title: '다음 주 준비' })).item;
  await json(
    '/api/pages/' + source.id,
    {
      title: source.title,
      expectedVersion: 1,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'meeting-one',
            type: 'paragraph',
            props: {},
            content: [{ type: 'text', text: '월요일 회의 자료 정리하기', styles: {} }],
            children: [],
          },
          {
            id: 'meeting-two',
            type: 'paragraph',
            props: {},
            content: [{ type: 'text', text: '발표 내용을 미리 공유하기', styles: {} }],
            children: [],
          },
        ],
      },
    },
    'PUT',
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const sdk = await readFile('test/fixtures/google-maps-sdk.js', 'utf8');
  await page.route('https://maps.googleapis.com/maps/api/js?**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: sdk }),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(base + '/pages/' + seeded.id);
  await page.locator('.itinerary-block').waitFor();
  assert.ok(!requests.some((r) => /ItineraryMap-|maps.googleapis.com/.test(r)));
  await page.locator('.itinerary-stop').nth(1).click();
  await page.getByRole('button', { name: '장소 4개 지도 보기' }).click();
  await page.locator('.itinerary-google-pin').first().waitFor();
  assert.equal(await page.locator('.itinerary-google-pin').count(), 4);
  assert.equal(await page.locator('.itinerary-google-pin.is-selected').count(), 1);
  await page.locator('.itinerary-stop').first().click();
  await page.locator('.itinerary-google-pin').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('.itinerary-timeline li.is-selected')?.dataset.entryId === 'walk-3',
  );
  assert.equal(
    await page.evaluate(() => window.__googleMapQA.maps),
    1,
    'Selection keeps map mounted',
  );
  await page.locator('.itinerary-inline-field[data-field="title"] [role="button"]').first().click();
  await page.getByLabel('일정 내용', { exact: true }).first().fill('경복궁역에서 만나 커피 마시기');
  assert.equal(
    await page.getByRole('button', { name: '페이지 AI 요청', exact: true }).isDisabled(),
    true,
  );
  await page.reload();
  await page.locator('.itinerary-inline-field[data-field="title"] [role="button"]').first().click();
  assert.equal(
    await page.getByLabel('일정 내용', { exact: true }).first().inputValue(),
    '경복궁역에서 만나 커피 마시기',
  );
  await page.getByRole('button', { name: '복구한 초안 적용', exact: true }).click();
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  await page.getByRole('button', { name: '장소 4개 지도 보기', exact: true }).click();
  await page.locator('.itinerary-google-pin').first().waitFor();
  await screenshot(page, { path: join(evidence, 'plan-desktop.png'), fullPage: true });
  await clickPageTool(page, 'Markdown 보기');
  assert.match(
    await page.getByRole('textbox', { name: 'Markdown 원문' }).inputValue(),
    /경복궁역에서 만나 커피 마시기/,
  );
  await clickPageTool(page, '편집기로 돌아가기');
  await clickPageTool(page, '템플릿');
  await page.getByRole('textbox', { name: '템플릿 이름' }).fill('함께 걷는 하루');
  await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
  await page.getByText('현재 페이지를 템플릿으로 저장했어요.', { exact: true }).waitFor();
  await screenshot(page, { path: join(evidence, 'templates-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '페이지 템플릿 닫기' }).click();
  await page.goto(base + '/pages/' + source.id);
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  let lostClone = false;
  await page.route('**/api/pages/*/duplicate', async (route) => {
    if (!lostClone) {
      lostClone = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await clickPageTool(page, '페이지 복제');
  await page.getByRole('button', { name: '같은 작업 다시 확인', exact: true }).waitFor();
  await page.getByRole('button', { name: '같은 작업 다시 확인', exact: true }).click();
  await page.waitForURL(
    (url) => /\/pages\//.test(url.pathname) && url.pathname !== `/pages/${source.id}`,
  );
  const cloneId = new URL(page.url()).pathname.split('/').at(-1);
  assert.equal(
    (await json('/api/pages', undefined, 'GET')).items.filter((p) => p.title === '회의 기록 (복사)')
      .length,
    1,
  );
  const file = join(root, '참고 자료.md');
  await writeFile(file, '# 월요일 회의\n확인할 자료를 함께 공유해요.');
  let lostUpload = false;
  await page.route('**/api/pages/*/assets', async (route) => {
    if (!lostUpload) {
      lostUpload = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('페이지 첨부 파일', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '같은 작업 다시 확인', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '같은 파일 다시 선택', exact: true }).waitFor();
  await page.getByLabel('페이지 첨부 파일', { exact: true }).setInputFiles(file);
  await page.getByText('참고 자료.md', { exact: true }).first().waitFor();
  const attached = (await json('/api/pages/' + cloneId, undefined, 'GET')).item;
  assert.equal(attached.document.blocks.filter((b) => b.type === 'asset').length, 1);
  const assetId = attached.document.blocks.find((b) => b.type === 'asset').props.assetId;
  const share = await json('/api/pages/' + cloneId + '/shares', { expiresInDays: 30 });
  const shareUrl = publicBase + '/s/' + share.token;
  await wait(shareUrl);
  assert.equal((await fetch(shareUrl + '/assets/' + assetId)).status, 200);
  assert.equal((await fetch(publicBase + '/api/backups')).status, 404);
  await page.goto(base + '/pages/' + source.id);
  await page.locator('[data-id="meeting-one"] .bn-inline-content').click();
  await clickPageTool(page, '선택 블록 이동');
  await page
    .getByRole('combobox', { name: '이동할 페이지', exact: true })
    .selectOption(destination.id);
  await page.getByRole('button', { name: '선택 블록 이동', exact: true }).click();
  await page.getByText('선택한 블록을 이동했어요.', { exact: true }).waitFor();
  assert.equal(
    (await json('/api/pages/' + source.id, undefined, 'GET')).item.document.blocks.length,
    1,
  );
  assert.match(
    JSON.stringify((await json('/api/pages/' + destination.id, undefined, 'GET')).item.document),
    /월요일 회의/,
  );
  await page.getByRole('button', { name: '선택 블록 이동 닫기' }).click();
  await clickPageTool(page, '수정 이력');
  await page.getByRole('combobox', { name: '수정본', exact: true }).selectOption('2');
  await page.getByRole('button', { name: '이 수정본 복원', exact: true }).click();
  await page.getByRole('button', { name: '확인하고 복원', exact: true }).click();
  await page.getByText('수정본을 새 버전으로 복원했어요.', { exact: true }).waitFor();
  assert.equal(
    (await json('/api/pages/' + source.id, undefined, 'GET')).item.document.blocks.length,
    2,
  );
  await screenshot(page, { path: join(evidence, 'history-desktop.png'), fullPage: true });
  await page.goto(base + '/backups');
  await page.getByRole('heading', { name: '백업', exact: true }).waitFor();
  await page.getByRole('button', { name: '지금 백업', exact: true }).click();
  await page.waitForFunction(async () => {
    const state = await (await fetch('/api/backups')).json();
    return state.lastGood?.status === 'succeeded';
  });
  await screenshot(page, { path: join(evidence, 'backup-desktop.png'), fullPage: true });
  const status = await json('/api/backups', undefined, 'GET');
  assert.equal(status.lastGood?.status, 'succeeded');
  assert.equal(status.settings.enabled, false);
  await page.getByRole('checkbox', { name: '매일 자동으로 백업' }).check();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await page.getByText('설정을 저장했어요.', { exact: true }).waitFor();
  assert.equal((await json('/api/backups', undefined, 'GET')).settings.enabled, true);
  const planShare = await json('/api/pages/' + seeded.id + '/shares', { expiresInDays: 30 });
  const shared = await browser.newPage({ viewport: { width: 390, height: 844 } });
  shared.on('pageerror', (e) => errors.push(e.message));
  const sharedRequests = [];
  shared.on('request', (r) => sharedRequests.push(r.url()));
  await shared.goto(publicBase + '/s/' + planShare.token);
  await shared.locator('.itinerary-preview img').waitFor();
  await shared.waitForFunction(
    () => document.querySelector('.itinerary-preview img').naturalWidth > 0,
  );
  assert.equal(await shared.locator('.itinerary-timeline li').count(), 4);
  assert.equal(
    await shared.getByRole('link', { name: 'Google Maps에서 열기', exact: true }).count(),
    4,
  );
  assert.equal(await shared.locator('iframe,.itinerary-map').count(), 0);
  assert.ok(!sharedRequests.some((url) => /maps\.googleapis|openstreetmap|\/api\//.test(url)));
  await screenshot(shared, { path: join(evidence, 'shared-mobile.png'), fullPage: true });
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
      });
      const p = await context.newPage();
      await p.addInitScript((theme) => localStorage.setItem('leneu:theme', theme), theme);
      for (const [name, path] of [
        ['plan', '/pages/' + seeded.id],
        ['backup', '/backups'],
      ]) {
        await p.goto(base + path);
        await p.locator(name === 'plan' ? '.itinerary-block' : '.backup-workspace').waitFor();
        assert.equal(
          await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${name} ${width} ${theme} overflow`,
        );
        await screenshot(p, {
          path: join(evidence, `${name}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
      await p.goto(base + '/pages/' + source.id);
      await p.getByRole('textbox', { name: '페이지 제목' }).waitFor();
      await clickPageTool(p, '수정 이력');
      await p.locator('.page-tools-panel').waitFor();
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await screenshot(p, {
        path: join(evidence, `history-${width}-${theme}.png`),
        fullPage: true,
      });
      await context.close();
    }
  assert.deepEqual(errors, []);
  console.log(
    'Plan/page/preservation QA passed: private linked Google map/keyboard focus, edit/export, templates, clone/upload lost-response replay+reload, shared static image/links/direct assets, selected move, revision restore, backup run/settings, 320/390/1440 light/dark.',
  );
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const p of context.pages()) {
        console.error(
          'QA page:',
          p.url(),
          (
            await p
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(-4000),
        );
        await screenshot(p, { path: join(evidence, 'failure.png'), fullPage: true }).catch(
          () => {},
        );
      }
  console.error(serverLog.slice(-5000));
  throw error;
} finally {
  if (browser) await browser.close();
  for (const proc of children) {
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
      await once(proc, 'exit').catch(() => {});
    }
  }
  await rm(root, { recursive: true, force: true });
}
