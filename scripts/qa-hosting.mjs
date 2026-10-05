import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHostingStore } from '../server/hosting/store.mjs';
import { createHostingRoutes } from '../server/hosting/routes.mjs';
import { serveHostedSite } from '../server/hosting/http.mjs';
const evidence = process.env.HOSTING_QA_EVIDENCE || '.omo/evidence/static-hosting';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const temporary = await mkdtemp(join(tmpdir(), 'anotar-hosting-qa-'));
let server;
try {
  await page.goto('http://127.0.0.1:5173/hosting');
  await page.getByRole('list', { name: '등록된 사이트' }).waitFor();
  await page.getByRole('heading', { name: 'AI 논문을 위한 최소한의 수학', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.screenshot({ path: `${evidence}/list-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${evidence}/list-mobile.png`, fullPage: true });
  await page.goto('http://127.0.0.1:8792/mathematics/');
  await page.locator('.cover h1').waitFor();
  assert.ok(await page.locator('.cover h1').innerText());
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('a[href="chapters/ch01.html"]').first().click();
  await page.waitForURL('**/mathematics/chapters/ch01.html');
  await page.locator('h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  const localAssets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[href],script[src]'))
      .map((e) => e.href || e.src)
      .filter((u) => u.startsWith(location.origin)),
  );
  for (const url of localAssets) {
    const res = await page.request.get(url);
    assert.equal(res.status(), 200, url);
    assert.ok(!res.headers()['content-type'].includes('text/html'), url);
  }
  await page.screenshot({ path: `${evidence}/sample-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${evidence}/sample-chapter.png` });
  const source = join(temporary, 'example');
  await mkdir(join(source, 'assets'), { recursive: true });
  await writeFile(
    join(source, 'index.html'),
    '<link rel="stylesheet" href="assets/style.css"><h1>Sample</h1><script src="assets/app.js"></script>',
  );
  await writeFile(join(source, 'assets/style.css'), 'h1 {color: rgb(255,0,0)}');
  await writeFile(join(source, 'assets/app.js'), 'document.body.dataset.loaded="yes"');
  await writeFile(join(source, 'excluded.pdf'), 'not uploaded');
  const directory = join(temporary, 'sites'),
    store = createHostingStore(directory);
  let handle;
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/hosting')) void handle(req, res, url);
    else void serveHostedSite(req, res, store);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handle = createHostingRoutes({ directory, origin });
  await page.addInitScript(
    ({ origin }) => {
      const original = window.fetch;
      window.fetch = (input, options) =>
        original(
          typeof input === 'string' && input.startsWith('/api/hosting') ? origin + input : input,
          options,
        );
    },
    { origin },
  );
  await page.goto('http://127.0.0.1:5173/hosting');
  await page.getByRole('heading', { name: '등록된 사이트가 없어요.' }).waitFor();
  await page.getByRole('button', { name: '폴더 등록', exact: true }).first().click();
  await page.locator('.hosting-import input[type="file"]').setInputFiles(source);
  await page.getByLabel('이름', { exact: true }).fill('폴더 등록 검증');
  await page.getByLabel('주소 경로').fill('example');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await page.getByRole('heading', { name: '폴더 등록 검증' }).waitFor();
  assert.equal(store.list().items[0].fileCount, 3);
  await page.getByRole('button', { name: '폴더 등록 검증 이름 수정' }).click();
  await page.getByLabel('사이트 이름', { exact: true }).fill('이름 변경 검증');
  await page.locator('.hosting-rename').getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('heading', { name: '이름 변경 검증' }).waitFor();
  assert.equal(store.list().items[0].name, '이름 변경 검증');
  assert.equal(store.list().items[0].slug, 'example');

  assert.equal((await fetch(origin + '/example/')).status, 404);
  await page.getByRole('button', { name: '공개', exact: true }).click();
  await page.getByRole('button', { name: '공개 중지' }).waitFor();
  const sitePage = await browser.newPage();
  await sitePage.goto(origin + '/example/');
  assert.equal(await sitePage.locator('body').getAttribute('data-loaded'), 'yes');
  assert.equal(
    await sitePage.locator('h1').evaluate((e) => getComputedStyle(e).color),
    'rgb(255, 0, 0)',
  );
  await sitePage.close();
  await page.getByRole('button', { name: '공개 중지' }).click();
  await page.getByRole('button', { name: '공개', exact: true }).waitFor();
  assert.equal((await fetch(origin + '/example/')).status, 404);
  await page.getByRole('button', { name: '폴더 등록', exact: true }).first().click();
  await page.locator('.hosting-import input[type="file"]').setInputFiles(source);
  await page.getByLabel('이름', { exact: true }).fill('duplicate');
  await page.getByLabel('주소 경로').fill('example');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /같은 주소/);
  assert.equal(store.list().items.length, 1);
  await page.screenshot({ path: `${evidence}/upload-duplicate.png` });

  // Mutations target only the temporary fixture store, never the real sample.
  await page.getByLabel('이름', { exact: true }).fill('자동 주소 검증');
  await page.getByLabel('주소 경로').fill('');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await page.getByRole('heading', { name: '자동 주소 검증', exact: true }).waitFor();
  const automaticSite = store.list().items.find((site) => site.name === '자동 주소 검증');
  assert.ok(automaticSite);
  assert.match(automaticSite.slug, /^site-[a-f0-9]{12}$/);
  assert.equal(automaticSite.enabled, false);
  assert.equal(store.list().items.length, 2);
  const automaticRow = page.locator('.hosting-list li').filter({
    has: page.locator('.hosting-url', { hasText: `${origin}/${automaticSite.slug}/` }),
  });
  assert.ok((await automaticRow.innerText()).includes(`${origin}/${automaticSite.slug}/`));
  assert.equal((await fetch(`${origin}/${automaticSite.slug}/`)).status, 404);
  await automaticRow.getByRole('button', { name: '공개', exact: true }).click();
  await automaticRow.getByRole('button', { name: '공개 중지' }).waitFor();
  assert.equal((await fetch(`${origin}/${automaticSite.slug}/`)).status, 200);
  await automaticRow.getByRole('button', { name: '자동 주소 검증 이름 수정' }).click();
  await automaticRow.getByLabel('사이트 이름', { exact: true }).fill('자동 주소 이름 변경');
  await automaticRow.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('heading', { name: '자동 주소 이름 변경', exact: true }).waitFor();
  assert.equal(
    store.list().items.find((site) => site.id === automaticSite.id).slug,
    automaticSite.slug,
  );
  await page.screenshot({ path: `${evidence}/automatic-route.png` });
  assert.deepEqual(errors, []);
  await writeFile(
    `${evidence}/verification.json`,
    JSON.stringify(
      {
        errors,
        checks: [
          'real sample HTML/CSS/JS loads',
          'chapter navigation',
          'theme JS persists across pages',
          'management light/dark/mobile',
          'folder upload excludes PDF and keeps asset paths',
          'draft404/publish200/stop404',
          'CSS and JavaScript execute',
          'duplicate import preserves original',
          'manual name edit preserves route',
          'blank address with Korean name creates a stopped site',
          'automatically generated route opens after publish and survives name edit',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Hosting browser QA passed');
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(temporary, { recursive: true, force: true });
}
