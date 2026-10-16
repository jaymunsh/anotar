import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { selectAppTheme } from './qa-compact-pages.mjs';

export async function runWorkspaceNavigationQa(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const other = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const api = async (path, body, method = 'POST') => {
    const response = await context.request.fetch(base + path, { method, data: body });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const read = async (id) => (await api('/api/pages/' + id, undefined, 'GET')).item;
  try {
    const title = '다음에 이어서 작업할 페이지 · 긴 제목으로 탐색의 전체 이름 확인';
    const item = (await api('/api/pages', { title })).item;
    const parent = (await api('/api/pages', { title: '옮길 목적지' })).item;
    const child = (await api('/api/pages', { title: '자손 선택 금지', parentId: item.id })).item;
    const otherPage = (await api('/api/pages', { title: '읽기 실패 확인 문서' })).item;
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const visits = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/workspace') &&
        request.postDataJSON()?.visited
      )
        visits.push(request.url());
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(visits.length, 0, 'Home is metadata only and never records a visit');
    assert.equal(await page.locator('.workspace-continue').count(), 1);
    await page.goto(base + '/pages/' + item.id, { waitUntil: 'networkidle' });
    const input = page.getByRole('textbox', { name: '페이지 제목', exact: true });
    await input.waitFor();
    await page.waitForFunction(
      async (id) =>
        (await (await fetch('/api/workspace/pages')).json()).recentVisited[0]?.id === id,
      item.id,
    );
    assert.equal(visits.length, 1, 'Successful opening records one visit');
    const favorite = page.getByRole('button', { name: title + ' 즐겨찾기 추가', exact: true });
    await favorite.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: title + ' 즐겨찾기 해제', exact: true }).waitFor();
    assert.deepEqual(await read(item.id), item, 'Navigation leaves full Page intact');
    assert.equal(visits.length, 1, 'Favorite rerender never repeats visit');
    const longLink = page.locator('.sidebar-page-item').filter({ hasText: title }).first();
    await longLink.focus();
    assert.equal(
      await longLink.locator('.workspace-title-tip').isVisible(),
      true,
      'Full title is visible to keyboard focus',
    );
    assert.equal(await longLink.getAttribute('title'), title);

    // Independent browser storage reads the same server preferences.
    const second = await other.newPage();
    await second.goto(base, { waitUntil: 'networkidle' });
    await second
      .getByRole('navigation', { name: '즐겨찾기 페이지', exact: true })
      .getByRole('link', { name: title, exact: true })
      .waitFor();
    assert.equal(await second.locator('.workspace-continue-group').count(), 2);
    assert.deepEqual(await read(item.id), item);

    let failPreference = true;
    await page.route('**/api/workspace/pages', async (route) => {
      if (failPreference) {
        await route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
      } else await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const preferenceError = page.locator('.workspace-preference-error');
    await preferenceError.waitFor();
    assert.equal(
      await page
        .getByRole('navigation', { name: '즐겨찾기 페이지', exact: true })
        .getByRole('link')
        .count(),
      1,
      'Read failure keeps prior snapshot',
    );
    failPreference = false;
    await preferenceError.getByRole('button', { name: '다시 시도' }).click();
    await preferenceError.waitFor({ state: 'detached' });
    await page.unroute('**/api/workspace/pages');

    let failFavorite = true;
    await page.route('**/api/pages/' + item.id + '/workspace', async (route) => {
      if (failFavorite && route.request().postDataJSON()?.favorite === false)
        await route.fulfill({ status: 503, json: { error: 'fixture favorite write failure' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: title + ' 즐겨찾기 해제', exact: true }).click();
    await preferenceError.waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: title + ' 즐겨찾기 해제', exact: true })
        .getAttribute('aria-pressed'),
      'true',
      'Failed write retains favorite snapshot',
    );
    assert.deepEqual(await read(item.id), item);
    failFavorite = false;
    await preferenceError.getByRole('button', { name: '다시 시도' }).click();
    await page.getByRole('button', { name: title + ' 즐겨찾기 추가', exact: true }).waitFor();
    await preferenceError.waitFor({ state: 'detached' });
    await page.unroute('**/api/pages/' + item.id + '/workspace');
    await page.getByRole('button', { name: title + ' 즐겨찾기 추가', exact: true }).click();
    await page.getByRole('button', { name: title + ' 즐겨찾기 해제', exact: true }).waitFor();
    assert.equal(visits.length, 1);

    // Deliberately failed document save lets us check that tree operations preserve an editor draft.
    await page.route('**/api/pages/' + item.id, async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({ status: 503, json: { error: 'fixture draft preservation' } });
      else await route.continue();
    });
    const failedSave = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url().endsWith('/api/pages/' + item.id),
    );
    await input.fill('유지해야 하는 미저장 제목');
    await failedSave;
    let failedMove = true;
    await page.route('**/api/pages/' + item.id, async (route) => {
      if (route.request().method() === 'PATCH' && failedMove) {
        failedMove = false;
        await route.fulfill({ status: 503, json: { error: 'fixture move failure' } });
      } else await route.fallback();
    });
    const move = page.getByRole('button', { name: title + ' 페이지 이동', exact: true });
    await move.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '페이지 이동', exact: true });
    await dialog.waitFor();
    const select = dialog.getByLabel('목적지', { exact: true });
    assert.equal(await select.inputValue(), '');
    assert.equal(
      await select.evaluate((node) => document.activeElement === node),
      true,
      'Move picker starts keyboard focus at destination',
    );
    assert.equal(await select.locator(`option[value="${item.id}"]`).count(), 0);
    assert.equal(await select.locator(`option[value="${child.id}"]`).count(), 0);
    await select.selectOption(parent.id);
    await dialog.getByRole('button', { name: '여기로 이동', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.getByRole('alert').waitFor();
    assert.equal(await select.inputValue(), parent.id, 'Failure keeps selected destination');
    assert.equal((await read(item.id)).parentId, null, 'Failure never changes tree');
    assert.equal(await input.inputValue(), '유지해야 하는 미저장 제목');
    await dialog.getByRole('button', { name: '다시 이동', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await read(item.id)).parentId, parent.id);
    assert.equal(
      await input.inputValue(),
      '유지해야 하는 미저장 제목',
      'Successful move keeps draft',
    );
    const moved = await read(item.id);
    assert.deepEqual(moved.document, item.document);
    assert.equal(moved.updatedAt, item.updatedAt);
    assert.equal(moved.version, item.version);
    await page.unroute('**/api/pages/' + item.id);

    // A failed Page GET must not create a recent visit.
    // Keep the intentionally unsaved editor intact; use the independent clean session for the remaining routes.
    page = second;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/pages/' + otherPage.id, (route) =>
      route.fulfill({ status: 503, json: { error: 'fixture read failure' } }),
    );
    await page.goto(base + '/pages/' + otherPage.id, { waitUntil: 'domcontentloaded' });
    await page.locator('.pages-error').waitFor();
    const snapshot = await api('/api/workspace/pages', undefined, 'GET');
    assert.equal(
      snapshot.recentVisited.some((entry) => entry.id === otherPage.id),
      false,
    );
    await page.unroute('**/api/pages/' + otherPage.id);
    await page.goto(base, { waitUntil: 'networkidle' });
    await mkdir('.omo/evidence/productivity-ui/navigation', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${width} ${theme} home overflow`,
        );
        await page.screenshot({
          path: `.omo/evidence/productivity-ui/navigation/home-${width}-${theme}.png`,
        });
        if (width < 760) await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
        const moveButton = page.getByRole('button', {
          name: '옮길 목적지 페이지 이동',
          exact: true,
        });
        await moveButton.scrollIntoViewIfNeeded();
        if (width < 760) assert.ok((await moveButton.boundingBox()).height >= 44);
        await moveButton.click();
        const picker = page.getByRole('dialog', { name: '페이지 이동', exact: true });
        await picker.waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({
          path: `.omo/evidence/productivity-ui/navigation/move-${width}-${theme}.png`,
        });
        await page.keyboard.press('Escape');
        await picker.waitFor({ state: 'detached' });
        if (width < 760)
          await page
            .getByRole('button', { name: '메뉴 닫기', exact: true })
            .click({ position: { x: width - 10, y: 100 } });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Workspace navigation QA passed: metadata/no visits on home, one successful visit, cross session favorites, recoverable preference read, keyboard/full titles, move failure+retry+draft preservation, failed reads, 1440/390/320 light+dark',
    );
  } finally {
    await context.close();
    await other.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-navigation-qa-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: String(port),
      AI_RUNNER_KIND: 'disabled',
    },
    stdio: 'pipe',
  });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runWorkspaceNavigationQa(browser, base);
  } finally {
    await browser?.close();
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
}
