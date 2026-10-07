import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';
const app = await offlineApp(),
  evidence = '.omo/evidence/sidebar-notices',
  checks = [],
  captures = [];
await mkdir(evidence, { recursive: true });
try {
  const { item } = await app.request('/api/pages', { title: '알림 확인용 문서' });
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 900 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.base + '/pages/' + item.id);
  await page.getByLabel('페이지 제목', { exact: true }).waitFor();
  const trigger = page.getByRole('button', { name: '동기화 상태', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '기기 저장과 동기화', exact: true });
  await dialog.waitFor({ timeout: 5000 });
  assert.equal(await dialog.evaluate((node) => node.matches(':modal')), true);
  const close = page.getByRole('button', { name: '동기화 상태 닫기' });
  assert.equal(await close.evaluate((node) => document.activeElement === node), true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true);
  checks.push(
    'native modal: focus starts inside, Tab stays inside, Escape closes, trigger regains focus',
  );
  let blocked = true, longNotice = false;
  await page.route('**/api/pages/' + item.id + '/workspace', async (route) => {
    if (blocked && route.request().postDataJSON()?.favorite !== undefined)
      await route.fulfill({
        status: 412,
        json: {
          error: longNotice ? '서버 응답을 확인하지 못했어요. 이전 기록은 유지하고 있어요. '.repeat(60) : '기기의 변경이 서버에 반영된 뒤 사용할 수 있어요.',
          code: 'online_action_blocked',
        },
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '페이지 즐겨찾기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status-trigger')?.textContent.includes('안내 확인'),
  );
  assert.equal(
    await page.locator('.workspace-preference-error,.workspace-continue-error').count(),
    0,
  );
  assert.equal(
    await page
      .locator('.sidebar-pages')
      .getByText('기기의 변경이 서버에 반영된 뒤 사용할 수 있어요.')
      .count(),
    0,
  );
  assert.equal(await dialog.count(), 0, 'notices never interrupt automatically');
  assert.ok(await trigger.evaluate((node) => node.closest('.sidebar-footer')));
  const footerCapture = `${evidence}/footer-desktop.png`;
  await page.screenshot({ path: footerCapture });
  captures.push(footerCapture);
  await trigger.click();
  await dialog.waitFor();
  const notice = dialog.getByRole('region', { name: '즐겨찾기 저장 확인' });
  await notice.waitFor();
  assert.match(await notice.innerText(), /문서의 서버 반영.*보류/);
  checks.push(
    'preference failure is removed from sidebar lists; footer alert opens scoped explanation without automatically opening',
  );
  for (const [width, mode] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((mode) => {
      document.documentElement.dataset.theme = mode;
    }, mode);
    await page.waitForTimeout(100);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'modal fits viewport');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const file = `${evidence}/dialog-${width}-${mode}.png`;
    await page.screenshot({ path: file });
    captures.push(file);
  }
  checks.push('desktop light/dark and 390/320 mobile modal stays inside viewport without overflow');
  blocked = false;
  await notice.getByRole('button', { name: '다시 시도', exact: true }).click();
  await notice.waitFor({ state: 'detached' });
  assert.ok(
    (await (await fetch(app.base + '/api/workspace/pages')).json()).favoriteIds.includes(item.id),
  );
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + item.id)).json()).item.title,
    item.title,
  );
  checks.push('retry stores favorite, clears footer notice, preserves document title/body');
  await close.click();
  await dialog.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await trigger.click();
  await dialog.waitFor();
  await page.mouse.click(2, 2);
  await dialog.waitFor({ state: 'detached' });
  checks.push('backdrop click closes and resets expanded state');
  blocked = true; longNotice = true;
  await page.getByRole('button', { name: '페이지 즐겨찾기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sync-status-trigger')?.textContent.includes('안내 확인'));
  await page.setViewportSize({width:320,height:700});
  await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().left >= -1);
  const footerBounds = await trigger.boundingBox();
  assert.ok(footerBounds.x >= 0 && footerBounds.y + footerBounds.height <= 700, 'mobile footer remains visible');
  const mobileFooter=`${evidence}/footer-mobile.png`;await page.screenshot({path:mobileFooter});captures.push(mobileFooter);
  await trigger.click();await dialog.waitFor();
  assert.equal(await dialog.evaluate(node=>node.scrollHeight>node.clientHeight),true);
  await dialog.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  const sticky=await dialog.evaluate(node=>({top:node.getBoundingClientRect().top,header:node.querySelector('header').getBoundingClientRect().top}));
  assert.ok(Math.abs(sticky.top-sticky.header)<2,'close header stays visible while scrolling');
  const overflow=`${evidence}/overflow-mobile.png`;await page.screenshot({path:overflow});captures.push(overflow);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);
  checks.push('mobile sidebar footer opens modal; long notice scrolls internally with sticky close header; focus restores to footer');
  assert.deepEqual(errors, []);
  await writeFile(
    evidence + '/result.json',
    JSON.stringify({ status: 'PASS', checks, captures }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', checks, captures }, null, 2));
} finally {
  await app.close();
}
