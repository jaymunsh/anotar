import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';

const evidence = resolve('.omo/evidence/architecture-callout');
await mkdir(evidence, { recursive: true });
const app = await offlineApp(), result = { checks: [], consoleErrors: [] };
let publicServer, page;
const check = name => { result.checks.push(name); console.log(name); };
const get = async id => (await (await fetch(app.base + '/api/pages/' + id)).json()).item;
async function saved(id, predicate) {
  for (let i = 0; i < 300; i++) { const item = await get(id); if (predicate(item)) return item; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Temporary fixture did not reach expected saved state');
}
const text = value => [{ type: 'text', text: value, styles: {} }];
const paragraph = (id, value) => ({ id, type: 'paragraph', props: {}, content: text(value), children: [] });
const callout = (id, value, props = {}, children = []) => ({ id, type: 'callout', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', icon: 'lightbulb', border: true, ...props }, content: text(value), children });
const watch = p => p.on('pageerror', error => result.consoleErrors.push(error.message));
const noOverflow = async p => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unexpected document horizontal overflow');
try {
  const { item: created } = await app.request('/api/pages', { title: '콜아웃 — 여행 준비' });
  const { item: seeded } = await app.request('/api/pages/' + created.id, { title: created.title, expectedVersion: created.version, document: { schemaVersion: 1, blocks: [
    callout('outline-box', '출발 전에 한 번 확인해요.\n여권과 예약 내역은 기기에 보관하세요.'),
    callout('colored-box', '비가 오면 실내 일정으로 바꿔요.', { backgroundColor: 'green', icon: 'info' }, [paragraph('nested-note', '비상 연락처와 대체 장소를 적어두세요.')]),
    callout('quiet-box', '숙소 체크인은 15시부터예요.', { backgroundColor: 'yellow', icon: 'none', border: false }),
    paragraph('last-line', ''),
  ] } }, 'PUT');
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  page = await context.newPage(); watch(page); page.setDefaultTimeout(12000);
  await page.goto(app.base + '/pages/' + seeded.id);
  await page.locator('.bn-editor').waitFor();
  const outline = page.locator('.bn-block-outer[data-id="outline-box"]');
  await outline.locator('.callout-content').waitFor();
  await page.screenshot({ path: join(evidence, 'callout-desktop.png') });
  const surface = outline.locator('.bn-block').first();
  assert.equal(await surface.evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
  assert.equal(await surface.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.notEqual(await page.locator('.bn-block-outer[data-id="colored-box"] .bn-block').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  await noOverflow(page); check('Desktop callout boxes and nested text render within the document');

  await outline.getByRole('button', { name: '콜아웃 모양', exact: true }).click();
  const menu = outline.locator('.callout-appearance');
  await menu.getByRole('button', { name: '파랑', exact: true }).click();
  await menu.getByRole('button', { name: '주의', exact: true }).click();
  await menu.getByRole('checkbox', { name: '테두리 표시' }).uncheck();
  await page.screenshot({ path: join(evidence, 'callout-appearance.png') });
  await menu.getByRole('checkbox', { name: '테두리 표시' }).press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await outline.getByRole('button', { name: '콜아웃 모양', exact: true }).evaluate(el => el === document.activeElement), true);
  const changed = await saved(seeded.id, item => item.document.blocks[0].props.backgroundColor === 'blue' && item.document.blocks[0].props.icon === 'warning' && item.document.blocks[0].props.border === false);
  assert.equal(changed.document.blocks[0].id, 'outline-box');
  check('Appearance stays open while changing color/icon/border, Escape restores focus, original ID persists');

  await outline.locator('.callout-content').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('기차 예약 번호도 적어두세요.');
  await saved(seeded.id, item => JSON.stringify(item.document.blocks[0].content).includes('기차 예약 번호'));
  const finalLine = page.locator('.bn-block-outer[data-id="last-line"] .bn-inline-content').first();
  await finalLine.click(); await page.keyboard.type('/callout');
  await page.getByRole('option', { name: /콜아웃/ }).click();
  await page.keyboard.type('새로운 콜아웃을 바로 작성해요.');
  await saved(seeded.id, item => item.document.blocks.some(b => b.type === 'callout' && JSON.stringify(b.content).includes('새로운 콜아웃')));
  await page.reload(); await page.locator('.bn-editor').waitFor();
  await page.getByText('새로운 콜아웃을 바로 작성해요.', { exact: true }).waitFor();
  check('Slash insertion, inline typing, line break and reload preserve callout JSON');

  await prepareShell(page);
  await context.setOffline(true);
  await page.locator('.bn-block-outer[data-id="outline-box"] .callout-content').click();
  await page.keyboard.press('End'); await page.keyboard.type(' 오프라인에서 보완했어요.');
  await page.getByText('기기에 저장됨', { exact: true }).waitFor();
  await page.reload(); await page.getByText(/오프라인에서 보완했어요/).waitFor();
  await context.setOffline(false);
  const online = await saved(seeded.id, item => JSON.stringify(item.document.blocks).includes('오프라인에서 보완했어요'));
  check('Offline editing survives reload and syncs after reconnecting');

  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  await page.getByRole('button', { name: '서비스 정보', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'settings-about-desktop.png') });
  const link = page.getByRole('link', { name: /기술 아키텍처/ });
  assert.equal(await link.getAttribute('href'), '/architecture.html');
  const popup = await Promise.all([context.waitForEvent('page'), link.click()]).then(([p]) => p); watch(popup);
  await popup.waitForLoadState(); await popup.locator('#current .node').first().waitFor();
  assert.equal(new URL(popup.url()).pathname, '/architecture.html');
  await noOverflow(popup); await popup.screenshot({ path: join(evidence, 'architecture-desktop.png') });
  assert.ok((await popup.locator('.file-group tbody tr').count()) >= 138);
  const source = await readFile('docs/architecture-overview.html', 'utf8');
  assert.equal(await (await fetch(app.base + '/architecture.html')).text(), source);
  for (const f of await popup.locator('[data-source]').evaluateAll(els => [...new Set(els.map(el => el.dataset.source))])) await readFile(f);
  await popup.locator('#current [data-node="api"]').click();
  assert.match(await popup.locator('[data-inspect="current"]').innerText(), /비밀번호·TOTP/);
  await popup.locator('[data-inspect="current"] [data-file-jump="server/auth/routes.mjs"]').click();
  assert.equal(await popup.locator('#file-query').inputValue(), 'server/auth/routes.mjs');
  assert.equal(await popup.locator('.file-group:not([hidden]) tbody tr:not([hidden])').count(), 1);
  await popup.locator('#file-query').fill('not-a-real-file'); await popup.locator('#empty-files').waitFor();
  await popup.locator('#file-query').fill('callout');
  assert.ok((await popup.locator('.file-group:not([hidden]) tbody tr:not([hidden])').count()) >= 4);
  await popup.locator('#file-query').fill('');
  await popup.locator('#tab-current').focus(); await popup.keyboard.press('ArrowRight');
  assert.equal(await popup.locator('#tab-deploy').getAttribute('aria-selected'), 'true');
  await popup.locator('#tab-offline').click(); assert.equal(await popup.locator('#offline').isVisible(), true);
  await popup.locator('#tab-current').click();
  await popup.locator('#files').scrollIntoViewIfNeeded(); await popup.screenshot({ path: join(evidence, 'architecture-files.png') });
  await popup.evaluate(() => dispatchEvent(new Event('beforeprint'))); await popup.emulateMedia({ media: 'print' });
  assert.equal(await popup.locator('.panel:visible').count(), 3);
  assert.equal(await popup.locator('.file-group:not([open])').count(), 0);
  await popup.pdf({ path: join(evidence, 'architecture-print.pdf'), format: 'A4', printBackground: true });
  await popup.emulateMedia({ media: 'screen' }); await popup.evaluate(() => dispatchEvent(new Event('afterprint')));
  check('Settings opens canonical HTML; source paths exist, file search/node jumps/tabs/print work');
  await context.setOffline(true); await popup.reload();
  await popup.locator('#current .node').first().waitFor();
  assert.match(await popup.title(), /아키텍처/);
  await context.setOffline(false); check('Architecture HTML is served from the prepared offline shell');

  const localFile = await context.newPage(); watch(localFile);
  await localFile.goto(pathToFileURL(resolve('docs/architecture-overview.html')).href);
  await localFile.locator('#current .node').first().waitFor();
  await noOverflow(localFile); check('Canonical standalone HTML opens from a local file');

  const mobile = await app.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const mp = await mobile.newPage(); watch(mp);
  await mp.goto(app.base + '/pages/' + seeded.id); await mp.locator('.bn-editor').waitFor();
  await noOverflow(mp);
  await mp.locator('.bn-block-outer[data-id="outline-box"]').getByRole('button', { name: '콜아웃 모양', exact: true }).click();
  await mp.locator('.callout-appearance:popover-open').waitFor();
  const menuBounds = await mp.locator('.callout-appearance:popover-open').boundingBox();
  assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390);
  await mp.screenshot({ path: join(evidence, 'callout-mobile-dark.png') });
  const targets = await mp.locator('.callout-appearance:popover-open button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }));
  assert.ok(targets.every(([w, h]) => w >= 44 && h >= 44));
  await mp.setViewportSize({ width: 320, height: 740 }); await noOverflow(mp);
  await mp.waitForFunction(() => { const r = document.querySelector('.callout-appearance:popover-open')?.getBoundingClientRect(); return r && r.x >= 0 && r.right <= innerWidth; });
  const narrowMenu = await mp.locator('.callout-appearance:popover-open').boundingBox();
  assert.ok(narrowMenu.x >= 0 && narrowMenu.x + narrowMenu.width <= 320);
  await mp.getByLabel('페이지 제목', { exact: true }).click();
  await mp.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await mp.getByRole('button', { name: '설정 열기', exact: true }).click();
  await mp.getByRole('button', { name: '서비스 정보', exact: true }).click();
  await noOverflow(mp); await mp.screenshot({ path: join(evidence, 'settings-about-mobile.png') });
  await mp.goto(app.base + '/architecture.html'); await mp.locator('#current .node').first().waitFor();
  await noOverflow(mp); await mp.screenshot({ path: join(evidence, 'architecture-mobile-dark.png') });
  await mp.setViewportSize({ width: 320, height: 740 }); await noOverflow(mp);
  await mp.locator('#theme').click(); assert.equal(await mp.locator('html').getAttribute('data-theme'), 'light');
  await mp.screenshot({ path: join(evidence, 'architecture-mobile-320.png') });
  check('Mobile dark/light views and popover stay within 390/320px viewport');

  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const publicPort = socket.address().port; await new Promise(r => socket.close(r));
  publicServer = spawn(process.execPath, ['server/public.mjs'], { env: { ...process.env, DATA_DIR: app.dir, PUBLIC_PORT: String(publicPort), PUBLIC_HOST: '127.0.0.1' }, stdio: 'ignore' });
  const publicBase = 'http://127.0.0.1:' + publicPort;
  for (let i = 0; i < 100; i++) { try { await fetch(publicBase + '/'); break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const share = await app.request('/api/pages/' + seeded.id + '/shares', { expiresInDays: 1, commentsEnabled: true });
  const shared = await context.newPage(); watch(shared);
  await shared.goto(publicBase + '/s/' + share.token); await shared.locator('.callout-box').first().waitFor();
  assert.equal(await shared.locator('.callout-box').count(), 4);
  assert.equal(await shared.locator('[data-comment-block-id="outline-box"] .callout-box').getAttribute('data-background-color'), 'blue');
  await noOverflow(shared); await shared.screenshot({ path: join(evidence, 'callout-share.png') });
  await mp.goto(publicBase + '/s/' + share.token); await mp.locator('.callout-box').first().waitFor();
  await noOverflow(mp); await mp.screenshot({ path: join(evidence, 'callout-share-mobile-dark.png') });
  assert.equal((await fetch(publicBase + '/share-assets/callout.css')).status, 200);
  assert.equal((await fetch(publicBase + '/architecture.html')).status, 404);
  assert.equal((await fetch(publicBase + '/api/pages')).status, 404);
  check('Read-only share contains callouts/comments; public CSS is allowed and private architecture/API stay excluded');

  const zip = await fetch(app.base + '/api/pages/' + seeded.id + '/export?version=' + online.version);
  assert.equal(zip.status, 200);
  const zipPath = join(app.dir, 'callout.zip'), exportPath = join(app.dir, 'offline-export');
  await writeFile(zipPath, Buffer.from(await zip.arrayBuffer())); await mkdir(exportPath);
  execFileSync('unzip', ['-q', zipPath, '-d', exportPath]);
  assert.ok((await readFile(join(exportPath, 'assets/callout.css'), 'utf8')).includes('.callout-box'));
  const offline = await context.newPage(); watch(offline);
  await context.setOffline(true); await offline.goto(pathToFileURL(join(exportPath, 'index.html')).href);
  await offline.locator('.callout-box').first().waitFor();
  assert.equal(await offline.locator('.callout-box').count(), 4);
  assert.equal(await offline.locator('.callout-children').count(), 1);
  assert.equal(await offline.locator('.comment-trigger').count(), 0);
  await noOverflow(offline); await offline.screenshot({ path: join(evidence, 'callout-offline-export.png') });
  check('ZIP contains shared callout CSS; extracted local HTML renders boxes/children without comments or network');
  assert.deepEqual(result.consoleErrors, []);
  result.success = true;
} catch (error) {
  result.success = false; result.error = error.stack;
  if (page && !page.isClosed()) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(evidence, 'verification.json'), JSON.stringify(result, null, 2));
  if (publicServer) { publicServer.kill(); await new Promise(r => publicServer.exitCode !== null ? r() : publicServer.once('exit', r)); }
  await app.close();
}
