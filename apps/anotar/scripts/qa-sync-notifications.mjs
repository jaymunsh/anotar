import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp, prepareShell, settleSync } from './fixtures/offline-app.mjs';
const app = await offlineApp();
const evidence = '.omo/evidence/sync-notifications';
await mkdir(evidence, { recursive: true });
try {
  const { item } = await app.request('/api/pages', { title: '비교할 문서' });
  const a = await app.browser.newContext(),
    b = await app.browser.newContext();
  const pa = await a.newPage(),
    pb = await b.newPage();
  const errors = [];
  pb.on('pageerror', (error) => errors.push(error.message));
  for (const page of [pa, pb]) {
    await page.goto(app.base + '/pages/' + item.id);
    await page.getByLabel('페이지 제목', { exact: true }).waitFor();
    await prepareShell(page);
  }
  await a.setOffline(true);
  await b.setOffline(true);
  await pa.getByLabel('페이지 제목', { exact: true }).fill('서버에 반영한 제목');
  await pb.getByLabel('페이지 제목', { exact: true }).fill('이 기기에서 수정한 제목');
  for (const page of [pa, pb]) await page.getByText('기기에 저장됨', { exact: true }).waitFor();
  await a.setOffline(false);
  await settleSync(pa);
  await b.setOffline(false);
  await pb.getByRole('button', { name: '동기화 상태', exact: true }).click();
  await pb.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await pb.getByRole('button', { name: '동기화 상태 닫기' }).click();
  await pb.getByText('서버본과 기기본이 달라요', { exact: true }).waitFor();
  await pb.goto(app.base + '/memo');
  await pb.getByRole('button', { name: '동기화 상태', exact: true }).click();
  const dialog = pb.getByRole('dialog', { name: '기기 저장과 동기화', exact: true });
  const go = dialog.getByRole('button', { name: '해당 페이지에서 확인', exact: true });
  await go.waitFor({ timeout: 5000 });
  assert.equal(
    await dialog.locator('.sync-conflict').count(),
    0,
    'notification contains no comparison editor',
  );
  assert.equal(
    await dialog.getByRole('radio').count(),
    0,
    'notification contains no overwrite choices',
  );
  assert.equal(
    await dialog.getByRole('button', { name: '양쪽 내용 확인', exact: true }).count(),
    0,
  );
  await pb.screenshot({ path: evidence + '/notification-light.png' });
  await go.click();
  await pb.waitForURL(new RegExp('/pages/' + item.id + '\\?syncConflict='));
  await dialog.waitFor({ state: 'detached' });
  const panel = pb.getByRole('region', { name: '변경 충돌 확인', exact: true });
  await panel.waitFor();
  await panel.getByRole('radio', { name: /^서버 내용 사용/ }).waitFor();
  assert.equal(
    await panel.evaluate(
      (node) => node.contains(document.activeElement) || node === document.activeElement,
    ),
    true,
  );
  assert.equal(
    await pb.getByLabel('페이지 제목', { exact: true }).inputValue(),
    '이 기기에서 수정한 제목',
  );
  await pb.screenshot({ path: evidence + '/page-comparison-light.png' });
  await pb.setViewportSize({ width: 390, height: 844 });
  await pb.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  );
  await pb.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await pb.screenshot({ path: evidence + '/page-comparison-mobile-dark.png' });
  assert.equal(await pb.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await panel.getByRole('radio', { name: /^새 페이지로 보관/ }).check();
  await panel.getByRole('button', { name: '선택한 내용 적용', exact: true }).click();
  await pb.getByLabel('페이지 제목', { exact: true }).waitFor();
  await pb.setViewportSize({ width: 1440, height: 900 });
  await settleSync(pb);
  const pages = (await (await fetch(app.base + '/api/pages')).json()).items;
  assert.equal(pages.length, 2);
  assert.ok(pages.some((page) => page.title.includes('이 기기에서 수정한 제목')));
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + item.id)).json()).item.title,
    '서버에 반영한 제목',
  );
  assert.deepEqual(errors, []);
  const result = {
    status: 'PASS',
    checks: [
      'footer contains summary and destination only',
      'cross-screen navigation closes dialog and focuses expanded page comparison',
      'mobile comparison fits viewport',
      'resolving at the page preserves server original and forks the device copy',
    ],
  };
  await writeFile(evidence + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
