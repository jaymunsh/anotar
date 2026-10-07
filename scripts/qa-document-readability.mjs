import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from './seed-architecture.mjs';

const evidence = process.env.GUIDE_EVIDENCE || '.omo/evidence/explanatory-guide';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const errors = [], checks = [];
let publicServer;
try {
  const store = openStore(app.dir);
  const document = await ensureArchitecturePage(store);
  const { token } = store.createPageShare(document.id);
  store.close();
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const publicBase = `http://127.0.0.1:${port}`;
  publicServer = spawn(process.execPath, ['server/public.mjs'], {
    env: { ...process.env, DATA_DIR: app.dir, PUBLIC_PORT: String(port), PUBLIC_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(publicBase + '/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  for (const [name, width, theme] of [
    ['desktop', 1440, 'light'], ['desktop-dark', 1440, 'dark'],
    ['mobile', 390, 'light'], ['mobile-small-dark', 320, 'dark'],
  ]) {
    const context = await app.browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    await context.addInitScript(theme => {
      localStorage.setItem('leneu:theme', theme);
      localStorage.setItem('leneu:share-theme:v1', theme);
    }, theme);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.base + '/pages/' + document.id);
    await page.locator('.bn-editor .page-toc').waitFor();
    const toc = page.getByRole('navigation', { name: '목차', exact: true });
    assert.equal(await toc.count(), 1, name + ' uses one authored native TOC');
    assert.equal(await page.locator('[data-content-type="tableOfContents"]').count(), 1);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await page.waitForFunction(() => document.querySelectorAll('.diagram-editor .diagram-preview svg').length === 6);
    assert.equal(await page.locator('.diagram-error').count(), 0);
    assert.equal(await page.locator('.page-outline-toggle').count(), 0);
    assert.equal(await page.getByRole('navigation', { name: '페이지 목차', exact: true }).count(), 0);
    assert.equal(await toc.getByRole('button').count(), 9);
    for (const chapter of ['1. Anotar 한눈에 보기', '6. 코드 진입점과 파일 지도', '9. 업데이트와 확장 범위']) {
      assert.equal(await toc.getByText(chapter, { exact: true }).count(), 1);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${evidence}/${name}-private.png` });
    if (width === 1440 && theme === 'light') {
      for (const title of ['2. 전체 구조', '3. 저장과 동기화', '4. AI 요청 처리']) {
        const heading = page.locator('[data-content-type="heading"]').filter({ hasText: title });
        await heading.evaluate(element => window.scrollBy({ top: element.getBoundingClientRect().top - 72, behavior: 'instant' }));
        await page.screenshot({ path: `${evidence}/section-${title[0]}-private.png` });
      }
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await toc.getByText('9. 업데이트와 확장 범위', { exact: true }).click();
    await page.waitForFunction(() => {
      const heading = [...document.querySelectorAll('[data-content-type="heading"]')].find(element => element.textContent === '9. 업데이트와 확장 범위');
      const rect = heading?.getBoundingClientRect();
      return rect && rect.top >= 0 && rect.bottom < innerHeight;
    });
    await page.goto(publicBase + '/s/' + token);
    const sharedToc = page.getByRole('navigation', { name: '목차', exact: true });
    await sharedToc.waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(await sharedToc.count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('figure[data-diagram-state="ready"]').length === 6);
    assert.equal(await page.locator('figure[data-diagram-state="error"]').count(), 0);
    assert.equal(await sharedToc.getByRole('link').count(), 9);
    assert.equal(await page.locator('[data-reading-outline],.shared-outline').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${evidence}/${name}-share.png` });
    await sharedToc.getByText('9. 업데이트와 확장 범위', { exact: true }).click();
    await page.waitForFunction(() => {
      const heading = [...document.querySelectorAll('main h2')].find(element => element.textContent === '9. 업데이트와 확장 범위');
      const rect = heading?.getBoundingClientRect();
      return rect && rect.top >= 0 && rect.top < innerHeight;
    });
    assert.ok((await page.locator('main').textContent()).includes('server/index.mjs'));
    checks.push({ name, width, theme, privateToc: 1, sharedToc: 1, representativeChapters: 9, privateDiagrams: 6, sharedDiagrams: 6, headingNavigation: true, horizontalOverflow: false });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/RESULT.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log('PASS nine numbered chapters, native TOC reused once, six private/shared diagrams, navigation, desktop/390/320 light/dark');
} finally {
  if (publicServer) {
    publicServer.kill();
    if (publicServer.exitCode === null) await new Promise(resolve => publicServer.once('exit', resolve));
  }
  await app.close();
}
