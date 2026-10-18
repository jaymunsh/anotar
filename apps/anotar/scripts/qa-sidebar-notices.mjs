import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { qaApp } from './fixtures/qa-app.mjs';

// 온라인 전용 사이드바 안내(2026-10-19 로컬 우선 동기화 제거 후).
// 화면이 맡긴 안내(즐겨찾기 저장 실패 등)는 사이드바 하단에서 '안내 확인 · N건' 버튼으로 모이고,
// 눌러야 '확인할 안내' 모달이 열려 안내별 '다시 시도'를 제공한다. 자동으로 열리지 않는다.
// 예전 '기기 저장과 동기화' 다이얼로그·'지금 동기화'는 더 이상 없다.
const app = await qaApp(),
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

  let blocked = true,
    longNotice = false;
  await page.route('**/api/pages/' + item.id + '/workspace', async (route) => {
    if (blocked && route.request().postDataJSON()?.favorite !== undefined)
      await route.fulfill({
        status: 412,
        json: {
          error: longNotice
            ? '서버 응답을 확인하지 못했어요. 이전 기록은 유지하고 있어요. '.repeat(60)
            : '기기의 변경이 서버에 반영된 뒤 사용할 수 있어요.',
          code: 'online_action_blocked',
        },
      });
    else await route.continue();
  });

  // 즐겨찾기 저장 실패가 사이드바 목록을 깨지 않고, 하단 '안내 확인' 버튼으로만 모인다.
  await page.getByRole('button', { name: '페이지 즐겨찾기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status-trigger')?.textContent.includes('안내 확인'),
  );
  const trigger = page.getByRole('button', { name: '안내 확인', exact: true });
  assert.equal(await trigger.count(), 1, 'the footer surfaces a single 안내 확인 alert');
  assert.match(await trigger.evaluate((node) => node.textContent), /안내 확인 · 1건/);
  assert.ok(await trigger.evaluate((node) => node.closest('.sidebar-footer')), 'the alert lives in the sidebar footer');
  assert.equal(
    await page.locator('.workspace-preference-error,.workspace-continue-error').count(),
    0,
    'the failure is not shown inline in the sidebar lists',
  );
  assert.equal(
    await page
      .locator('.sidebar-pages')
      .getByText('기기의 변경이 서버에 반영된 뒤 사용할 수 있어요.')
      .count(),
    0,
  );
  assert.equal(await page.getByRole('dialog', { name: '확인할 안내' }).count(), 0, 'notices never open automatically');
  const footerCapture = `${evidence}/footer-desktop.png`;
  await page.screenshot({ path: footerCapture });
  captures.push(footerCapture);
  checks.push('preference failure is removed from sidebar lists and surfaced only as a footer alert that does not auto-open');

  // 눌러서 모달 열기: 포커스는 닫기 버튼에서 시작하고 안쪽에 갇히며, Escape로 닫으면 트리거로 복귀한다.
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '확인할 안내' });
  await dialog.waitFor();
  assert.equal(await dialog.evaluate((node) => node.matches(':modal')), true);
  const close = page.getByRole('button', { name: '안내 닫기' });
  assert.equal(await close.evaluate((node) => document.activeElement === node), true, 'focus starts on the close button');
  const notice = dialog.getByRole('region', { name: '즐겨찾기 저장 확인' });
  await notice.waitFor();
  assert.match(await notice.innerText(), /기기의 변경이 서버에 반영된 뒤 사용할 수 있어요\./);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    // 네이티브 모달 다이얼로그는 배경 조작을 막는다. 포커스가 다이얼로그 밖 조작 요소로 새지 않는지 본다
    // (헤드리스 Chrome은 순환 중 잠시 body로 보낼 수 있으나 배경 버튼/입력은 받지 못한다).
    const leaked = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector('.sync-status-panel');
      if (!active || active === document.body || panel?.contains(active)) return false;
      return active.matches('button, a, input, select, textarea, [tabindex]');
    });
    assert.equal(leaked, false, 'focus never reaches a background control while the modal is open');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true, 'Escape returns focus to the footer trigger');
  checks.push('native modal: scoped notice, focus starts on close, Tab stays inside, Escape closes and restores footer focus');

  // 반응형: 데스크톱/모바일, 라이트/다크 모두 뷰포트 안에 들어온다.
  await trigger.click();
  await dialog.waitFor();
  for (const [width, mode] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, mode);
    await page.waitForTimeout(100);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'modal fits viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const file = `${evidence}/dialog-${width}-${mode}.png`;
    await page.screenshot({ path: file });
    captures.push(file);
  }
  checks.push('desktop light/dark and 390/320 mobile modal stays inside the viewport without overflow');

  // 안내별 '다시 시도'가 성공하면 즐겨찾기를 저장하고 안내를 지우며 문서 본문은 그대로다.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  blocked = false;
  await notice.getByRole('button', { name: '다시 시도', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.ok(
    (await (await fetch(app.base + '/api/workspace/pages')).json()).favoriteIds.includes(item.id),
    'retry stores the favorite',
  );
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + item.id)).json()).item.title,
    item.title,
    'retry preserves the document title/body',
  );
  assert.equal(await page.getByRole('button', { name: '안내 확인', exact: true }).count(), 0, 'retry clears the footer alert');
  checks.push('retry stores the favorite, clears the footer alert, and preserves the document');

  // 긴 안내는 모달 안에서 내부 스크롤되고 닫기 헤더가 고정된다(모바일 320px).
  blocked = true;
  longNotice = true;
  // 즐겨찾기를 끄는 토글이 다시 412로 막혀 긴 안내를 만든다.
  await page.getByRole('button', { name: '페이지 즐겨찾기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status-trigger')?.textContent.includes('안내 확인'),
  );
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().left >= -1);
  const longTrigger = page.getByRole('button', { name: '안내 확인', exact: true });
  const footerBounds = await longTrigger.boundingBox();
  assert.ok(footerBounds.x >= 0 && footerBounds.y + footerBounds.height <= 700, 'mobile footer alert stays visible');
  const mobileFooter = `${evidence}/footer-mobile.png`;
  await page.screenshot({ path: mobileFooter });
  captures.push(mobileFooter);
  await longTrigger.click();
  await dialog.waitFor();
  assert.equal(await dialog.evaluate((node) => node.scrollHeight > node.clientHeight), true, 'long notice scrolls internally');
  await dialog.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const sticky = await dialog.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    header: node.querySelector('header').getBoundingClientRect().top,
  }));
  assert.ok(Math.abs(sticky.top - sticky.header) < 2, 'the close header stays pinned while scrolling');
  const overflow = `${evidence}/overflow-mobile.png`;
  await page.screenshot({ path: overflow });
  captures.push(overflow);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  checks.push('mobile sidebar footer opens the modal; a long notice scrolls internally with a sticky close header');

  assert.deepEqual(errors, []);
  await writeFile(evidence + '/result.json', JSON.stringify({ status: 'PASS', checks, captures }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks, captures }, null, 2));
} finally {
  await app.close();
}
