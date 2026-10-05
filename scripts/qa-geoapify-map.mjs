import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createGeoapifyMapService } from '../server/geoapifyMaps.mjs';

const root = await mkdtemp(join(tmpdir(), 'leneu-geo-ui-'));
const dataDir = join(root, 'data'),
  evidence = resolve(process.env.QA_MAP_EVIDENCE_DIR || '.omo/evidence/geoapify-map');
await mkdir(evidence, { recursive: true });
const children = [];
let browser,
  store,
  log = '';
async function port() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}
function child(file, env = {}) {
  const proc = spawn(process.execPath, [file], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      BACKUP_DIR: join(root, 'backups'),
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      GOOGLE_MAPS_DEMO_KEY: '',
      GEOAPIFY_API_KEY: 'fixture-only-private-key',
      ...env,
    },
    stdio: 'pipe',
  });
  proc.stdout.on('data', (data) => {
    log += data;
  });
  proc.stderr.on('data', (data) => {
    log += data;
  });
  children.push(proc);
  return proc;
}
async function wait(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Temporary server unavailable: ' + log);
}
try {
  const seed = child('scripts/seed-activity-plan.mjs');
  assert.equal((await once(seed, 'exit'))[0], 0);
  children.pop();
  const base = 'http://127.0.0.1:' + (await port()),
    publicBase = 'http://127.0.0.1:' + (await port());
  child('server/index.mjs', { PORT: new URL(base).port, PUBLIC_SHARE_ORIGIN: publicBase });
  child('server/public.mjs', { PUBLIC_PORT: new URL(publicBase).port });
  await wait(base + '/api/health');
  await wait(publicBase + '/health');
  const pages = await (await fetch(base + '/api/pages')).json();
  const id = pages.items[0].id;
  store = openStore(dataDir);
  const original = store.getPage(id),
    block = original.document.blocks.find((b) => b.type === 'itinerary');
  // This is a local HTTP boundary fixture. Rendering/persistence are real; no provider requests.
  const png = await readFile(process.env.QA_MAP_IMAGE || 'examples/kyoto-note.png');
  let generationCalls = 0;
  const service = createGeoapifyMapService({
    store,
    blobDir: join(dataDir, 'blobs'),
    apiKey: 'fixture-only-private-key',
    fetchImpl: async () => {
      generationCalls++;
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(),
    errors = [],
    privateRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => privateRequests.push(request.url()));
  let failResponse = true,
    lastRequest;
  await page.route('**/api/pages/*/map-images', async (route) => {
    const request = route.request().postDataJSON();
    if (failResponse) {
      lastRequest = request;
      failResponse = false;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: '지도 서비스에 연결하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
        }),
      });
      return;
    }
    assert.deepEqual(request, lastRequest, 'retry preserves the request UUID and original version');
    const result = await service.generate({ ...request, pageId: id });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
  await page.goto(base + '/pages/' + id);
  const generate = page.getByRole('button', { name: '지도 이미지 만들기', exact: true });
  await generate.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.itinerary-map-image-controls button')?.disabled,
  );
  assert.equal(await page.getByLabel('지도 이미지 스타일').inputValue(), 'klokantech-basic');
  assert.equal(generationCalls, 0, 'opening a page does not generate images');
  const scroll = await page.evaluate(async () => {
    const visual = document.querySelector('.itinerary-visual');
    let container = visual.parentElement;
    while (
      container &&
      !(
        /auto|scroll/.test(getComputedStyle(container).overflowY) &&
        container.scrollHeight > container.clientHeight
      )
    )
      container = container.parentElement;
    container ||= document.scrollingElement;
    const values = [];
    for (const top of [300, 450, 600]) {
      container.scrollTop = top;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      values.push({ scroll: container.scrollTop, mapTop: visual.getBoundingClientRect().top });
    }
    const result = { position: getComputedStyle(visual).position, values };
    container.scrollTop = 0;
    return result;
  });
  assert.equal(scroll.position, 'static');
  assert.ok(
    Math.abs(
      scroll.values[2].mapTop -
        scroll.values[1].mapTop +
        scroll.values[2].scroll -
        scroll.values[1].scroll,
    ) < 2,
    'map moves with the document instead of sticking',
  );
  await generate.click();
  await page
    .getByText('지도 서비스에 연결하지 못했어요. 같은 요청으로 다시 확인해 주세요.', {
      exact: true,
    })
    .waitFor();
  assert.equal(store.getPage(id).version, original.version);
  await page.getByRole('button', { name: '같은 작업 다시 확인', exact: true }).click();
  await page.locator('.itinerary-map-credit').waitFor();
  // Saved maps fold their secondary settings; the summary must reopen them.
  if (!(await page.getByRole('button', { name: '지도 이미지 갱신', exact: true }).isVisible()))
    await page.locator('.itinerary-map-image-controls summary').click();
  await page.getByRole('button', { name: '지도 이미지 갱신', exact: true }).waitFor();
  await page.locator('.itinerary-map-credit').waitFor();
  const saved = store.getPage(id);
  assert.equal(saved.version, original.version + 1);
  assert.equal(saved.document.blocks.find((b) => b.id === block.id).props.imageSource, 'geoapify');
  assert.equal(generationCalls, 1);
  await page.reload();
  await page.locator('.itinerary-map-credit').waitFor();
  assert.equal(generationCalls, 1);
  const shareResponse = await fetch(base + '/api/pages/' + id + '/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresInDays: 1 }),
  });
  assert.ok(shareResponse.ok);
  const share = await shareResponse.json();
  const publicPage = await context.newPage(),
    publicRequests = [];
  publicPage.on('request', (request) => publicRequests.push(request.url()));
  publicPage.on('pageerror', (error) => errors.push(error.message));
  await publicPage.goto(publicBase + '/s/' + share.token);
  await publicPage.locator('.itinerary-map-credit').waitFor();
  assert.equal(await publicPage.locator('.itinerary-map-image-controls,iframe').count(), 0);
  assert.ok(!publicRequests.some((url) => /maps\.geoapify|maps\.googleapis|\/api\//.test(url)));
  assert.equal((await fetch(publicBase + '/api/maps/config')).status, 404);
  assert.equal(
    (await fetch(publicBase + '/api/pages/' + id + '/map-images', { method: 'POST' })).status,
    404,
  );
  assert.doesNotMatch(await publicPage.content(), /fixture-only-private-key/);
  const measurements = [];
  for (const [surface, name, width, theme] of [
    [page, 'private', 1440, 'light'],
    [page, 'private', 1440, 'dark'],
    [page, 'private', 390, 'light'],
    [page, 'private', 320, 'dark'],
    [publicPage, 'public', 1440, 'light'],
    [publicPage, 'public', 390, 'dark'],
  ]) {
    await surface.setViewportSize({ width, height: 1050 });
    await surface.emulateMedia({ colorScheme: theme });
    if (name === 'public')
      await surface.getByRole('combobox', { name: '화면 모드' }).selectOption(theme);
    await surface.evaluate(() => document.fonts.ready);
    await surface.evaluate(() => window.scrollTo(0, 0));
    await surface
      .locator('.itinerary-preview img')
      .first()
      .evaluate((img) => img.decode());
    const sizes = await surface.evaluate(() => {
      const image = document.querySelector('.itinerary-preview img').getBoundingClientRect();
      const visual = (
        document.querySelector('.itinerary-visual') || document.querySelector('.itinerary-preview')
      ).getBoundingClientRect();
      const timeline = document.querySelector('.itinerary-timeline').getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        visualBottom: visual.bottom,
        timelineTop: timeline.top,
        visualWidth: visual.width,
        imageWidth: image.width,
      };
    });
    assert.ok(sizes.scrollWidth <= width + 1, `${name} ${width} overflow`);
    assert.ok(
      sizes.timelineTop >= sizes.visualBottom - 1,
      `${name} ${width}: map precedes the timetable in one column`,
    );
    assert.ok(
      sizes.imageWidth >= sizes.visualWidth - 2,
      `${name} ${width}: image fills the document column`,
    );
    assert.equal(await surface.getByRole('list', { name: '지도 방문 장소' }).count(), 1);
    if (name === 'private') {
      await surface.locator('.itinerary-heading').first().hover();
      await surface.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const gutter = await surface.evaluate(() => {
        const block = document.querySelector('.itinerary-block');
        const id = block.closest('.bn-block-outer').dataset.id;
        const button = document
          .querySelector(`[data-comment-block="${id}"]`)
          .getBoundingClientRect();
        return {
          left: button.left,
          right: button.right,
          top: button.top,
          blockRight: block.getBoundingClientRect().right,
          blockTop: block.getBoundingClientRect().top,
          editorRight: document.querySelector('.page-block-editor').getBoundingClientRect().right,
        };
      });
      assert.ok(
        gutter.left >= gutter.blockRight + 8,
        'comment button has a separate reserved lane',
      );
      assert.ok(
        gutter.right <= gutter.editorRight + 1,
        'comment button remains inside document bounds',
      );
      assert.ok(
        gutter.top >= gutter.blockTop,
        'comment button aligns with the block rather than its outer margin',
      );
      if (width === 1440 && theme === 'light') {
        const before = await surface.locator('.itinerary-block').boundingBox();
        await surface.locator(`[data-comment-block="${block.id}"]`).click();
        await surface.locator('.page-comment-panel').waitFor();
        const after = await surface.locator('.itinerary-block').boundingBox();
        assert.ok(
          Math.abs(before.x - after.x) <= 2 && Math.abs(before.width - after.width) <= 2,
          'opening comments preserves document position and width',
        );
        await surface.getByRole('button', { name: '댓글 패널 닫기', exact: true }).click();
      }
    }
    if (width < 760 && name === 'private')
      assert.ok((await surface.getByLabel('지도 이미지 스타일').boundingBox()).height >= 44);
    measurements.push({ name, theme, ...sizes });
    await surface.screenshot({
      path: join(evidence, `${name}-${width}-${theme}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.itinerary-row-menu > summary').first().click();
  await page.locator('.itinerary-coordinate-options > summary').first().click();
  await page.getByLabel('위도', { exact: true }).first().fill('37.58');
  await page.getByRole('button', { name: '좌표 적용', exact: true }).first().click();
  await page
    .getByText('장소나 방문 순서가 바뀌었어요. 지도 이미지를 갱신해 주세요.', { exact: true })
    .waitFor();
  await page.getByText('서버 반영됨', { exact: true }).waitFor();
  await publicPage.reload();
  await publicPage
    .getByText('일정이 변경되어 지도에는 이전 방문 위치·순서가 표시돼요.', { exact: false })
    .waitFor();
  assert.equal(generationCalls, 1, 'editing and sharing never silently spend API credits');
  assert.ok(!privateRequests.some((url) => /maps\.geoapify|maps\.googleapis/.test(url)));
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'ui.json'),
    JSON.stringify({ scroll, generationCalls, measurements, errors }, null, 2),
  );
  console.log(
    'PASS: static image generation/retry/reload, key isolation, public/offline image use, stale-map notice, scroll alignment, 1440/390/320 light/dark. Provider calls mocked at the network boundary.',
  );
} finally {
  await browser?.close();
  store?.close();
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(
    children.map((child) => (child.exitCode === null ? once(child, 'exit').catch(() => {}) : null)),
  );
  await rm(root, { recursive: true, force: true });
}
