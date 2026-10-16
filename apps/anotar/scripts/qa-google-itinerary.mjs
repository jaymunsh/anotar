import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'leneu-google-map-'));
const dataDir = join(root, 'data');
const evidence = resolve('.impeccable/review/google-itinerary');
await mkdir(evidence, { recursive: true });
const children = [];
let browser;
let serverLog = '';
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const value = s.address().port;
  await new Promise((r) => s.close(r));
  return value;
}
function child(file, env = {}) {
  const p = spawn(process.execPath, [file], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dataDir,
      BACKUP_DIR: join(root, 'backups'),
      GOOGLE_MAPS_DEMO_KEY: '',
      ...env,
    },
    stdio: 'pipe',
  });
  p.stdout.on('data', (b) => (serverLog += b));
  p.stderr.on('data', (b) => (serverLog += b));
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
  throw Error('Server unavailable: ' + serverLog);
}
async function json(base, path, body, method = 'GET') {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
try {
  const seed = child('scripts/seed-google-itinerary.mjs');
  assert.equal((await once(seed, 'exit'))[0], 0);
  children.pop();
  const secondSeed = child('scripts/seed-google-itinerary.mjs');
  assert.equal((await once(secondSeed, 'exit'))[0], 0);
  children.pop();
  const base = 'http://127.0.0.1:' + (await port());
  const publicBase = 'http://127.0.0.1:' + (await port());
  child('server/index.mjs', { PORT: new URL(base).port, PUBLIC_SHARE_ORIGIN: publicBase });
  const demoKey = 'AIza_qa-boundary-fixture-not-a-real-key';
  child('server/public.mjs', {
    PUBLIC_PORT: new URL(publicBase).port,
    GOOGLE_MAPS_DEMO_KEY: demoKey,
  });
  await wait(base + '/api/health');
  assert.equal((await json(base, '/api/maps/config')).googleMapsKey, '');
  const pages = (await json(base, '/api/pages')).items;
  assert.equal(pages.length, 1, 'Sample seed is idempotent');
  const saved = await json(base, '/api/pages/' + pages[0].id);
  const original = JSON.stringify(saved.item.document);
  const share = await json(
    base,
    '/api/pages/' + pages[0].id + '/shares',
    { expiresInDays: 1 },
    'POST',
  );
  const sharedUrl = publicBase + '/s/' + share.token;
  await wait(sharedUrl);
  const publicResponse = await fetch(sharedUrl);
  assert.doesNotMatch(
    publicResponse.headers.get('content-security-policy'),
    /google|openstreetmap/,
  );
  assert.equal(publicResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(publicBase + '/api/maps/config')).status, 404);
  assert.equal((await fetch(publicBase + '/share-assets/google-itinerary.mjs')).status, 404);
  assert.equal((await fetch(publicBase + '/share-assets/leaflet.js')).status, 404);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let sdkRequests = 0;
  const sdk = await readFile('test/fixtures/google-maps-sdk.js', 'utf8');
  await context.route('https://maps.googleapis.com/maps/api/js?**', async (route) => {
    sdkRequests++;
    if (sdkRequests === 1) return route.abort('failed');
    await route.fulfill({ contentType: 'text/javascript', body: sdk });
  });
  await page.goto(base + '/pages/' + pages[0].id + '?map=google');
  await page.locator('.itinerary-key-form').waitFor();
  assert.equal(sdkRequests, 0, 'No Google requests before entering a key');
  assert.equal(await page.locator('.itinerary-timeline li').count(), 3);
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, 'desktop-key.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(evidence, 'mobile-key.png'), fullPage: true });
  const visual = await page.evaluate(() => {
    const form = document.querySelector('.itinerary-key-form');
    const rect = (element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    });
    return {
      panel: getComputedStyle(form).backgroundColor,
      helper: getComputedStyle(form.querySelector('p')).color,
      small: getComputedStyle(form.querySelector('small')).color,
      buttons: [
        ...document.querySelectorAll(
          '.itinerary-provider-controls button, .itinerary-key-form button, .itinerary-key-form a',
        ),
      ].map(rect),
    };
  });
  assert.ok(visual.buttons.every((button) => button.height >= 44 && button.width >= 44));

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(evidence, 'mobile-dark-key.png'), fullPage: true });
  visual.darkPlaceholder = await page.locator('.itinerary-key-form input').evaluate((input) => ({
    color: getComputedStyle(input, '::placeholder').color,
    opacity: getComputedStyle(input, '::placeholder').opacity,
    background: getComputedStyle(input).backgroundColor,
  }));
  await writeFile(join(evidence, 'visual-measurements.json'), JSON.stringify(visual, null, 2));

  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: '지도 연결', exact: true }).click();
  await page.getByText('발급받은 Google Maps 데모 키를 입력해 주세요.', { exact: true }).waitFor();
  assert.equal(sdkRequests, 0);
  await page.getByLabel('Google Maps 데모 키', { exact: true }).fill(demoKey);
  await page.getByRole('button', { name: '지도 연결', exact: true }).click();
  await page.locator('.itinerary-google-error').waitFor();
  await page.getByRole('button', { name: '다시 연결', exact: true }).click();
  await page.locator('.itinerary-google-pin').nth(2).waitFor();
  assert.equal(sdkRequests, 2);
  const state = await page.evaluate(() => ({
    maps: window.__googleMapQA.maps,
    fits: window.__googleMapQA.fits,
    bounds: window.__googleMapQA.bounds,
    arrows: window.__googleMapQA.paths.filter((p) => p.icons).map((p) => p.icons),
  }));
  assert.equal(state.maps, 1);
  assert.ok(
    await page.evaluate(() => window.__googleMapQA.markers.every((m) => m.gmpClickable)),
    'Google markers opt into keyboard access',
  );
  await page.evaluate(() => window.__googleMapQA.markers[2].dispatchEvent(new Event('gmp-click')));
  await page.waitForFunction(
    () =>
      document
        .querySelector('.itinerary-google-pin[aria-pressed="true"]')
        ?.getAttribute('aria-label') === '3. 북촌 한옥마을',
  );
  assert.equal(state.fits, 1);
  assert.equal(state.bounds.length, 3);
  assert.equal(state.arrows.length, 2);
  assert.ok(
    state.arrows.every(
      (icons) => icons.some((i) => i.repeat) && icons.some((i) => i.offset === '75%'),
    ),
  );
  await page.locator('.itinerary-stop').nth(1).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.itinerary-google-pin.is-selected').length === 1,
  );
  assert.equal(
    await page.locator('.itinerary-google-pin[aria-pressed="true"]').getAttribute('aria-label'),
    '2. 국립현대미술관 서울',
  );
  await page.locator('.itinerary-google-pin').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-entry-id="seoul-bukchon"] button')
        .getAttribute('aria-pressed') === 'true',
  );
  assert.equal(
    await page.locator('.itinerary-block').count(),
    1,
    'Keyboard keeps itinerary intact',
  );
  assert.equal(await page.evaluate(() => window.__googleMapQA.maps), 1, 'Selection preserves map');
  assert.equal(await page.evaluate(() => window.__googleMapQA.fits), 1, 'Selection preserves zoom');
  await page.getByRole('button', { name: '전체 일정 보기', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__googleMapQA.fits), 2);
  await page.setViewportSize({ width: 320, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.evaluate(() => window.gm_authFailure());
  await page.locator('.itinerary-google-error').waitFor();
  assert.equal(
    await page.getByRole('button', { name: '전체 일정 보기', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole('button', { name: 'OpenStreetMap', exact: true }).count(), 0);
  const shared = await context.newPage();
  const sharedErrors = [];
  shared.on('pageerror', (error) => sharedErrors.push(error.message));
  let privateRequests = 0;
  shared.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) privateRequests++;
  });
  await shared.goto(sharedUrl);
  assert.equal(await shared.locator('.itinerary-google-pin').count(), 0);
  const before = sdkRequests;
  await shared.locator('.itinerary-preview img').waitFor();
  assert.equal(await shared.locator('iframe').count(), 0);
  assert.equal(await shared.locator('.itinerary-map').count(), 0);
  assert.equal(
    await shared.getByRole('link', { name: 'Google Maps에서 열기', exact: true }).count(),
    3,
  );
  assert.equal(sdkRequests, before, 'Public preview makes no SDK request');
  assert.equal(privateRequests, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(sharedErrors, []);
  assert.equal(
    JSON.stringify((await json(base, '/api/pages/' + pages[0].id)).item.document),
    original,
    'Map use never mutates page content',
  );
  console.log(
    'PASS: 3-stop sample, key/no-key, SDK load failure/retry, repeated arrows, fit bounds, linked click/keyboard selection, stable map/zoom, late auth error, 320px overflow, static public images without SDKs. Google SDK boundary fixture only; this check does not make real Google SDK requests.',
  );
} finally {
  await browser?.close();
  for (const p of children) {
    if (p.exitCode === null) {
      p.kill('SIGTERM');
      await once(p, 'exit');
    }
  }
  await rm(root, { recursive: true, force: true });
}
