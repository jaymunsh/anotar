import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runTrashQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  const post = async (path, body) => {
    const response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const memo = async (text) => {
    const body = new FormData();
    body.set('kind', 'note');
    body.set('text', text);
    return (await (await fetch(baseUrl + '/api/captures', { method: 'POST', body })).json()).item;
  };
  try {
    const item = await memo('휴지통에서 다시 꺼낼 여행 메모');
    const parent = (await post('/api/pages', { title: '복원할 여행 계획' })).item;
    const child = (await post('/api/pages', { title: '예약 확인', parentId: parent.id })).item;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl + '/memo', { waitUntil: 'networkidle' });
    await page.locator('.capture-card').filter({ hasText: item.text }).click();
    const requests = [];
    let lost = false;
    await page.route(`**/api/captures/${item.id}/trash`, async (route) => {
      requests.push(route.request().postDataJSON().operationId);
      if (lost) return route.continue();
      lost = true;
      await route.fetch();
      await route.abort('failed');
    });
    await page
      .getByRole('button', { name: '휴지통으로 이동', exact: true })
      .click({ timeout: 3000 });
    await page.locator('.trash-action-error').waitFor();
    await page.getByRole('button', { name: '같은 요청 다시 확인', exact: true }).click();
    await page.locator('.trash-notice').waitFor();
    assert.equal(new Set(requests).size, 1);
    assert.equal((await fetch(baseUrl + '/api/captures/' + item.id)).status, 404);
    await page
      .locator('.trash-notice')
      .getByRole('button', { name: '되돌리기', exact: true })
      .click();
    await page.locator('.capture-card').filter({ hasText: item.text }).waitFor();
    const restoredMemo = (await (await fetch(baseUrl + '/api/captures/' + item.id)).json()).item;
    assert.equal(restoredMemo.createdAt, item.createdAt);
    assert.equal(restoredMemo.version, item.version + 2);
    await page.locator('.capture-card').filter({ hasText: item.text }).click();
    await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
    await page.locator('.trash-notice').waitFor();

    const old = await context.newPage();
    await old.goto(baseUrl + '/pages/' + parent.id, { waitUntil: 'networkidle' });
    await old.locator('.bn-editor').waitFor();
    await page.goto(baseUrl + '/pages/' + parent.id, { waitUntil: 'networkidle' });
    await page.locator('.page-info > summary').click();
    await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
    await page.getByText('하위 페이지 1개도 함께 이동해요.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '확인하고 이동', exact: true }).click();
    await page.waitForURL('**/memo');
    assert.equal((await fetch(baseUrl + '/api/pages/' + child.id)).status, 404);
    await old.getByRole('textbox', { name: '페이지 제목' }).fill('삭제된 뒤에도 남길 초안');
    await old
      .getByText('서버에 저장하지 못했어요. 초안은 이 기기에 남아 있습니다.', { exact: true })
      .waitFor();
    assert.ok(
      await old.evaluate((id) => localStorage.getItem('leneu:page-draft:' + id), parent.id),
    );
    await page.getByRole('link', { name: '휴지통', exact: true }).click();
    await page.locator('.trash-row').filter({ hasText: parent.title }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    const pageRow = page.locator('.trash-row').filter({ hasText: parent.title });
    const restoreRequests = [];
    lost = false;
    await page.route('**/api/trash/*/restore', async (route) => {
      restoreRequests.push(route.request().postDataJSON().operationId);
      if (lost) return route.continue();
      lost = true;
      await route.fetch();
      await route.abort('failed');
    });
    let releaseList;
    let listCaptured;
    const heldList = new Promise((resolve) => {
      releaseList = resolve;
    });
    const captured = new Promise((resolve) => {
      listCaptured = resolve;
    });
    await page.route('**/api/trash?*', async (route) => {
      const response = await route.fetch();
      listCaptured();
      await heldList;
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await captured;
    await pageRow.getByRole('button', { name: '복원', exact: true }).click();
    await pageRow.locator('.trash-restore-error').waitFor();
    await pageRow.getByRole('button', { name: '같은 요청 다시 확인', exact: true }).click();
    await pageRow.waitFor({ state: 'detached' });
    const delayedResponse = page.waitForResponse((response) =>
      response.url().includes('/api/trash?'),
    );
    releaseList();
    await (await delayedResponse).finished();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await pageRow.count(), 0, 'A pre-restore GET must not reinsert the restored row.');
    assert.equal(await page.locator('.trash-tabs [aria-selected="true"] span').textContent(), '1');
    await page.locator('.trash-loading').waitFor({ state: 'hidden' });
    await page.unroute('**/api/trash?*');
    assert.equal(new Set(restoreRequests).size, 1);
    assert.equal(
      (await (await fetch(baseUrl + '/api/pages/' + child.id)).json()).item.parentId,
      parent.id,
    );
    await old.getByRole('button', { name: '다시 저장' }).click();
    await old.getByText('저장 충돌', { exact: true }).waitFor();
    assert.equal(
      await old.getByRole('textbox', { name: '페이지 제목' }).inputValue(),
      '삭제된 뒤에도 남길 초안',
    );
    await old.close();
    // The stale editor's draft has been verified. Clear this fixture before visual confirmation QA.
    await page.evaluate((id) => localStorage.removeItem('leneu:page-draft:' + id), parent.id);
    await page.unroute('**/api/trash/*/restore');
    await page
      .locator('.trash-row')
      .filter({ hasText: item.text })
      .getByRole('button', { name: '복원', exact: true })
      .click();
    await page.getByText('휴지통이 비어 있어요.', { exact: true }).waitFor();

    await page.route('**/api/trash?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html>temporary failure</html>',
      }),
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByText('휴지통을 불러오지 못했어요. 다시 시도해 주세요.', { exact: true })
      .waitFor();
    await page.unroute('**/api/trash?*');
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await page.getByText('휴지통이 비어 있어요.', { exact: true }).waitFor();

    const longMemo = await memo('여행에서 챙길 것들을 적어둔 메모. '.repeat(20));
    await post(`/api/captures/${longMemo.id}/trash`, {
      operationId: crypto.randomUUID(),
      expectedVersion: longMemo.version,
    });
    const visualParent = (
      await post('/api/pages', { title: '여행 기록 — 이동과 예약을 천천히 정리하는 페이지' })
    ).item;
    await post('/api/pages', { title: '교통', parentId: visualParent.id });
    await post(`/api/pages/${visualParent.id}/trash`, {
      operationId: crypto.randomUUID(),
      expectedVersion: visualParent.version,
    });
    const tabMemo = await memo('복원 도중 탭을 바꿀 메모');
    const tabTrash = (
      await post(`/api/captures/${tabMemo.id}/trash`, {
        operationId: crypto.randomUUID(),
        expectedVersion: tabMemo.version,
      })
    ).item;
    await page.goto(baseUrl + '/trash', { waitUntil: 'networkidle' });
    let releaseRestore;
    let restoreCaptured;
    let releaseTabList;
    let tabListCaptured;
    const heldRestore = new Promise((resolve) => {
      releaseRestore = resolve;
    });
    const capturedRestore = new Promise((resolve) => {
      restoreCaptured = resolve;
    });
    const heldTabList = new Promise((resolve) => {
      releaseTabList = resolve;
    });
    const capturedTabList = new Promise((resolve) => {
      tabListCaptured = resolve;
    });
    await page.route(`**/api/trash/${tabTrash.id}/restore`, async (route) => {
      const response = await route.fetch();
      restoreCaptured();
      await heldRestore;
      await route.fulfill({ response });
    });
    await page
      .locator('.trash-row')
      .filter({ hasText: tabMemo.text })
      .getByRole('button', { name: '복원', exact: true })
      .click();
    await capturedRestore;
    await page.route('**/api/trash?*', async (route) => {
      const response = await route.fetch();
      tabListCaptured();
      await heldTabList;
      await route.fulfill({ response });
    });
    await page.getByRole('tab', { name: /페이지/ }).click();
    await capturedTabList;
    releaseRestore();
    await page.getByText('복원했어요.', { exact: false }).waitFor();
    const releasedTabResponse = page.waitForResponse((response) =>
      response.url().includes('/api/trash?'),
    );
    releaseTabList();
    await (await releasedTabResponse).finished();
    await page
      .locator('.trash-row')
      .filter({ hasText: visualParent.title })
      .waitFor({ timeout: 2000 });
    assert.equal(await page.locator('.trash-tabs [aria-selected="true"] span').textContent(), '1');
    await page.unroute(`**/api/trash/${tabTrash.id}/restore`);
    await page.unroute('**/api/trash?*');
    if (process.env.QA_TRASH_SCREENSHOTS !== '0') {
      await mkdir('.impeccable/review/trash', { recursive: true });
      for (const width of [1327, 390, 320])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl + '/trash', { waitUntil: 'networkidle' });
          await page.locator('.trash-row').first().waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const firstButton = page.locator('.trash-row button').first();
          assert.ok((await firstButton.boundingBox()).height >= 44);
          await page.screenshot({ path: `.impeccable/review/trash/trash-${width}-${theme}.png` });
          await page.goto(baseUrl + '/pages/' + parent.id, { waitUntil: 'networkidle' });
          await page.locator('.page-info > summary').click();
          await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
          await page.getByRole('button', { name: '확인하고 이동', exact: true }).waitFor();
          await page.screenshot({ path: `.impeccable/review/trash/confirm-${width}-${theme}.png` });
        }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Trash QA passed: memo undo, immutable lost-response retry, page subtree, reload/restore, stale draft, friendly error retry and responsive themes.',
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-trash-qa-'));
  const port = 8794;
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: directory, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runTrashQa(browser, `http://127.0.0.1:${port}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
    await once(server, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
}
