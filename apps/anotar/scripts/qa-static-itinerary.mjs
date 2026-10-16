import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { itineraryPreviewDataUrl } from '../shared/itineraryPreview.ts';

const root = await mkdtemp(join(tmpdir(), 'leneu-static-plan-'));
const dataDir = join(root, 'data');
const evidence = resolve('.impeccable/review/static-itinerary');
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
      GOOGLE_MAPS_DEMO_KEY: '',
      DATA_DIR: dataDir,
      BACKUP_DIR: join(root, 'backups'),
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
  for (let i = 0; i < 2; i++) {
    const seed = child('scripts/seed-activity-plan.mjs');
    assert.equal((await once(seed, 'exit'))[0], 0);
    children.pop();
  }
  const base = 'http://127.0.0.1:' + (await port());
  const publicBase = 'http://127.0.0.1:' + (await port());
  child('server/index.mjs', { PORT: new URL(base).port, PUBLIC_SHARE_ORIGIN: publicBase });
  child('server/public.mjs', {
    PUBLIC_PORT: new URL(publicBase).port,
    GOOGLE_MAPS_DEMO_KEY: 'AIza_ignored-public-config',
  });
  await wait(base + '/api/health');
  const pages = (await json(base, '/api/pages')).items;
  assert.equal(pages.length, 1);
  const id = pages[0].id;
  const resource = async () => (await json(base, '/api/pages/' + id)).item;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(base + '/pages/' + id);
  await page.locator('.itinerary-block').waitFor();
  assert.equal(await page.locator('.itinerary-timeline li').count(), 7);
  assert.equal(await page.locator('.itinerary-travel').count(), 4);
  assert.equal(
    await page
      .locator('.itinerary-number')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent).filter(Boolean))
      .then((v) => v.join(',')),
    '1,2,3',
  );
  assert.ok(!requests.some((r) => /maps\.googleapis|openstreetmap|leaflet/.test(r)));
  await page
    .locator('.itinerary-inline-field[data-field="category"] [role="button"]')
    .first()
    .click();
  await page.getByLabel('활동 유형', { exact: true }).first().selectOption('rest');
  await page.getByLabel('활동 유형', { exact: true }).first().press('Enter');
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  await page.locator('.itinerary-inline-field[data-field="end"] [role="button"]').first().click();
  await page.getByLabel('끝 시간', { exact: true }).first().fill('12:00');
  await page.reload();
  await page
    .locator('.itinerary-inline-field[data-field="category"] [role="button"]')
    .first()
    .click();
  await page.getByLabel('활동 유형', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('활동 유형', { exact: true }).first().inputValue(), 'rest');
  await page.getByLabel('활동 유형', { exact: true }).first().press('Enter');
  await page.locator('.itinerary-inline-field[data-field="end"] [role="button"]').first().click();
  assert.equal(await page.getByLabel('끝 시간', { exact: true }).first().inputValue(), '12:00');
  await page.getByRole('button', { name: '복구한 초안 적용', exact: true }).click();
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  await page.reload();
  await page.locator('.itinerary-overlap').first().waitFor();
  assert.equal(
    JSON.parse((await resource()).document.blocks.find((b) => b.type === 'itinerary').props.data)
      .entries[0].category,
    'rest',
  );
  await page
    .locator('.itinerary-inline-field[data-field="category"] [role="button"]')
    .first()
    .click();
  await page.getByLabel('활동 유형', { exact: true }).first().selectOption('sightseeing');
  await page.getByLabel('활동 유형', { exact: true }).first().press('Enter');
  await page.locator('.itinerary-inline-field[data-field="end"] [role="button"]').first().click();
  await page.getByLabel('끝 시간', { exact: true }).first().fill('11:20');
  await page.getByLabel('끝 시간', { exact: true }).first().press('Enter');
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  const share = await json(base, '/api/pages/' + id + '/shares', { expiresInDays: 1 }, 'POST');
  const sharedUrl = publicBase + '/s/' + share.token;
  const shared = await context.newPage();
  shared.on('pageerror', (e) => errors.push(e.message));
  const publicRequests = [];
  shared.on('request', (r) => publicRequests.push(r.url()));
  await shared.goto(sharedUrl);
  await shared.locator('.itinerary-preview img').waitFor();
  await shared.waitForFunction(
    () => document.querySelector('.itinerary-preview img')?.naturalWidth > 0,
  );
  assert.equal(await shared.locator('iframe,.itinerary-map').count(), 0);
  const privateRoutes = await page
    .locator('.itinerary-route-links a')
    .evaluateAll((nodes) => nodes.map((n) => n.href));
  const publicRoutes = await shared
    .locator('.itinerary-route-links a')
    .evaluateAll((nodes) => nodes.map((n) => n.href));
  assert.ok(privateRoutes.length > 0);
  assert.deepEqual(publicRoutes, privateRoutes);
  for (const href of publicRoutes) {
    const url = new URL(href);
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.searchParams.has('key'), false);
    assert.ok(href.length <= 2048);
  }
  assert.ok(!publicRequests.some((r) => /\/api\/|maps\.googleapis|openstreetmap|leaflet/.test(r)));
  assert.equal(await shared.getByRole('link', { name: /Google Maps에서 열기$/ }).count(), 3);
  assert.equal((await fetch(publicBase + '/share-assets/google-itinerary.mjs')).status, 404);
  assert.equal((await fetch(publicBase + '/share-assets/leaflet.js')).status, 404);
  assert.doesNotMatch(
    (await fetch(sharedUrl)).headers.get('content-security-policy'),
    /google|openstreetmap/,
  );
  const measurements = [];
  for (const width of [1440, 390, 320]) {
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1050 });
      await page.emulateMedia({ colorScheme });
      await shared.setViewportSize({ width, height: 1050 });
      await shared.emulateMedia({ colorScheme });
      await shared.getByRole('combobox', { name: '화면 모드' }).selectOption(colorScheme);
      assert.equal(await shared.locator('html').getAttribute('data-theme'), colorScheme);
      for (const [name, surface] of [
        ['private', page],
        ['public', shared],
      ]) {
        await surface.evaluate(() => document.fonts.ready);
        await surface.evaluate(() => window.scrollTo(0, 0));
        if (name === 'private' && width <= 760)
          await surface.waitForFunction(
            () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
          );
        const result = await surface.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          labelColor: getComputedStyle(document.querySelector('.itinerary-category')).color,
          canvas: getComputedStyle(document.querySelector('.itinerary-block')).backgroundColor,
        }));
        assert.ok(result.scrollWidth <= width + 1, name + ' overflow at ' + width);
        measurements.push({ name, colorScheme, ...result });
        if (width !== 320 && process.env.QA_STATIC_SCREENSHOTS !== '0')
          await surface.screenshot({
            path: join(evidence, `${name}-${width}-${colorScheme}.png`),
            fullPage: true,
          });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.itinerary-inline-field[data-field="title"] [role="button"]').first().click();
  const fieldSizes = await page
    .locator(
      '.itinerary-inline-field input:visible,.itinerary-inline-field textarea:visible,.itinerary-inline-field select:visible',
    )
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        height: n.getBoundingClientRect().height,
        font: parseFloat(getComputedStyle(n).fontSize),
        tag: n.tagName,
      })),
    );
  assert.ok(fieldSizes.every((s) => s.height >= 44));
  assert.ok(fieldSizes.filter((s) => s.tag !== 'BUTTON').every((s) => s.font >= 16));
  await page.getByLabel('일정 내용', { exact: true }).first().press('Escape');
  // Make a real PNG from our own SVG diagram, then attach it through the production API.
  const saved = await resource();
  const entries = JSON.parse(
    saved.document.blocks.find((b) => b.type === 'itinerary').props.data,
  ).entries;
  const canvas = await context.newPage();
  await canvas.setContent(`<img src="${itineraryPreviewDataUrl(entries)}" style="width:720px">`);
  await canvas.waitForFunction(() => document.querySelector('img').naturalWidth > 0);
  const png = await canvas.locator('img').screenshot();
  await canvas.close();
  const upload = new FormData();
  upload.set('operationId', randomUUID());
  upload.set('expectedVersion', String(saved.version));
  upload.append('files', new Blob([png], { type: 'image/png' }), '방문위치.png');
  const response = await fetch(base + '/api/pages/' + id + '/assets', {
    method: 'POST',
    body: upload,
  });
  assert.equal(response.status, 200);
  const attached = (await response.json()).item;
  const imageId = attached.document.blocks.find((b) => b.type === 'asset').props.assetId;
  await page.reload();
  await page.locator('.itinerary-plan-menu > summary').click();
  await page
    .getByLabel('공유용 지도 이미지')
    .locator('option', { hasText: '방문위치.png' })
    .waitFor({ state: 'attached' });
  await page.getByLabel('공유용 지도 이미지').selectOption(imageId);
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  let withImage = await resource();
  assert.equal(
    withImage.document.blocks.find((b) => b.type === 'itinerary').props.assetId,
    imageId,
  );
  // Remove the extra attachment block: the plan reference alone must preserve scope/access.
  withImage = (
    await json(
      base,
      '/api/pages/' + id,
      {
        ...withImage,
        expectedVersion: withImage.version,
        document: {
          ...withImage.document,
          blocks: withImage.document.blocks.filter((b) => b.type !== 'asset'),
        },
      },
      'PUT',
    )
  ).item;
  await shared.reload();
  await shared.waitForFunction(
    () => document.querySelector('.itinerary-preview img')?.naturalWidth > 0,
  );
  assert.match(
    await shared.locator('.itinerary-preview img').getAttribute('src'),
    new RegExp(imageId),
  );
  assert.equal((await fetch(publicBase + '/s/' + share.token + '/assets/' + imageId)).status, 200);
  await shared.route('**/s/*/assets/*', (route) => route.abort());
  await shared.reload();
  await shared.locator('.itinerary-image-error').waitFor({ state: 'visible' });
  assert.equal(await shared.locator('.itinerary-timeline li').count(), 7);
  assert.equal(
    await shared.getByRole('link', { name: /Google Maps에서 열기$/ }).count(),
    3,
  );
  assert.equal(await shared.locator('.itinerary-route-links a').count(), publicRoutes.length);
  await shared.unroute('**/s/*/assets/*');
  await json(base, '/api/pages/' + id + '/shares/' + share.item.id, undefined, 'DELETE');
  assert.equal((await fetch(sharedUrl)).status, 404);
  assert.equal((await fetch(publicBase + '/s/' + share.token + '/assets/' + imageId)).status, 404);
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2));
  console.log(
    'PASS: categories, duration/overlap, reload draft, save, travel numbering, image attachment/select/reference, private/public route parity, public image failure preserves route links, revoke, 1440/390/320 light/dark, public has no private/API/map requests. AI disabled; temporary data only.',
  );
} finally {
  await browser?.close();
  for (const child of children)
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  await rm(root, { recursive: true, force: true });
}
