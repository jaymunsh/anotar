import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const dataDir = await mkdtemp(join(tmpdir(), 'leneu-share-qa-'));
async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

const privatePort = await availablePort();
let publicPort = await availablePort();
while (publicPort === privatePort) publicPort = await availablePort();
const privateUrl = `http://127.0.0.1:${privatePort}`;
const publicUrl = `http://127.0.0.1:${publicPort}`;
const children = [];
let browser;

async function waitFor(url, expectedStatus, requiredHeader) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus && response.headers.has(requiredHeader)) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`서버가 시작되지 않았습니다: ${url}`);
}

try {
  await run(process.execPath, ['scripts/seed-itinerary-sample.mjs'], {
    env: { ...process.env, DATA_DIR: dataDir },
  });
  const baseEnv = {
    ...process.env,
    DATA_DIR: dataDir,
    PUBLIC_PORT: String(publicPort),
    PUBLIC_SHARE_ORIGIN: publicUrl,
  };
  children.push(
    spawn(process.execPath, ['server/index.mjs'], {
      env: { ...baseEnv, PORT: String(privatePort), HOST: '127.0.0.1', AI_RUNNER_KIND: 'disabled' },
      stdio: 'pipe',
    }),
  );
  await waitFor(privateUrl + '/api/health', 200, 'content-type');
  children.push(
    spawn(process.execPath, ['server/public.mjs'], {
      env: { ...baseEnv, PUBLIC_HOST: '127.0.0.1' },
      stdio: 'pipe',
    }),
  );
  await waitFor(publicUrl + '/no-private-route', 404, 'content-security-policy');
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const { items } = await (await fetch(privateUrl + '/api/pages')).json();
  assert.equal(items.length, 1);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(privateUrl + '/pages/' + items[0].id, { waitUntil: 'networkidle' });
  await page.getByText('시간표 · 2일차').waitFor();
  assert.equal(await page.locator('.page-map-block iframe').count(), 0);
  assert.equal(await page.locator('.page-map-block .itinerary-preview img').count(), 2);
  await page.getByRole('button', { name: '페이지 공유' }).click();
  await page.getByRole('button', { name: '공유 링크 만들기' }).click();
  const shareUrl = await page.getByRole('textbox', { name: '공유 링크' }).inputValue();
  assert.match(shareUrl, new RegExp('^' + publicUrl.replaceAll('.', '\\.') + '/s/'));
  await page.getByText('공유 범위').waitFor();
  await page.screenshot({ path: '/tmp/leneu-itinerary-share-panel-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '/tmp/leneu-itinerary-share-panel-mobile.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.getByRole('button', { name: '공유 설정 닫기' }).isVisible(), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const shared = await browser.newPage({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
  });
  await shared.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  await shared.getByRole('heading', { name: /교토 3일 여행 계획/ }).waitFor();
  assert.equal(await shared.locator('table').count(), 2);
  assert.ok((await shared.locator('table th[scope="col"]').count()) > 0);
  assert.equal(await shared.locator('.map-card').count(), 2);
  assert.equal(
    await shared.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await shared.screenshot({ path: '/tmp/leneu-itinerary-public-mobile.png', fullPage: true });
  const sharedDark = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  await sharedDark.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  assert.equal(
    await sharedDark.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await sharedDark.screenshot({
    path: '/tmp/leneu-itinerary-public-desktop-dark.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '공유 설정 닫기' }).click();
  await page.getByRole('button', { name: '위치 수정', exact: true }).first().click();
  const label = page.getByRole('textbox', { name: '지도 장소 이름' }).first();
  await label.fill('철학의 길 · 만남 장소');
  await label.press('Tab');
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  const refreshed = await (await fetch(shareUrl)).text();
  assert.match(refreshed, /철학의 길 · 만남 장소/);
  await page.getByRole('button', { name: '페이지 공유' }).click();
  await page.getByRole('button', { name: '링크 끊기' }).click();
  assert.equal((await fetch(shareUrl)).status, 404);
  assert.equal((await fetch(publicUrl + '/api/pages')).status, 404);
  console.log(
    'Share/itinerary QA passed: maps, timetable, share URL, live edit, revoke, isolated public routes',
  );
} finally {
  if (browser) await browser.close();
  for (const child of children) {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
  }
  await rm(dataDir, { recursive: true, force: true });
}
