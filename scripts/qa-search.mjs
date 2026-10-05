import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function runSearchQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  const json = async (path, method, value) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const memo = async (text, ai = false, file = false) => {
    const body = new FormData();
    body.set('kind', file ? 'file' : 'note');
    body.set('text', text);
    if (ai)
      body.set('aiRequest', JSON.stringify({ template: null, additional: '교토 일정 리서치' }));
    if (file)
      body.append(
        'files',
        new Blob(['예약 번호 1234'], { type: 'text/plain' }),
        '교토 예약 확인서.md',
      );
    const response = await fetch(baseUrl + '/api/captures', { method: 'POST', body });
    assert.ok(response.ok, await response.clone().text());
    return (await response.json()).item;
  };
  try {
    const savedMemo = await memo('교토 골목에서 쉬고 싶은 카페를 기록해 두기', false, true);
    await memo('교토 숙소와 이동 경로 조사', true);
    let document = (await json('/api/pages', 'POST', { title: '느긋한 주말 계획', icon: '🧭' }))
      .item;
    document = (
      await json('/api/pages/' + document.id, 'PUT', {
        ...document,
        expectedVersion: 1,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: randomUUID(),
              type: 'paragraph',
              props: {},
              content: [
                {
                  type: 'text',
                  text: '교토에서 오래 머무르기. 점심 뒤에는 가마쿠라의 산책 자료도 읽어 본다.',
                  styles: {},
                },
              ],
              children: [],
            },
          ],
        },
      })
    ).item;
    for (let i = 0; i < 26; i++) await memo('더보기검색 같은 문구 ' + i);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const draft = page.locator('textarea').first();
    await draft.fill('검색을 열어도 남아야 하는 작성 중 메모');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '통합 검색', exact: true });
    await dialog.waitFor({ timeout: 3000 });
    const input = dialog.getByRole('combobox');
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    await input.fill('가마쿠라');
    await dialog.getByRole('option').filter({ hasText: '느긋한 주말 계획' }).waitFor();
    await input.press('ArrowDown');
    await input.press('Enter');
    await page.waitForURL('**/pages/' + document.id);
    await page.locator('.bn-editor').waitFor();
    await page.keyboard.press('Control+k');
    await dialog.waitFor();
    await input.fill('교토');
    await dialog.getByRole('option').filter({ hasText: savedMemo.text }).waitFor();
    assert.ok(
      (await dialog.getByRole('option').allTextContents()).some((value) =>
        value.includes('AI 요청'),
      ),
    );
    await input.press('Escape');
    assert.equal(await dialog.count(), 0);
    await page.locator('.nav-item').filter({ hasText: '입력함' }).click();
    assert.equal(
      await page.locator('textarea').first().inputValue(),
      '검색을 열어도 남아야 하는 작성 중 메모',
    );

    await page.keyboard.press('Control+k');
    await dialog.waitFor();
    await input.fill('가마쿠라');
    await dialog.getByRole('option').first().waitFor();
    const calls = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/search') calls.push(request.url());
    });
    await input.evaluate((el) =>
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    );
    await input.fill('교');
    await input.fill('교토');
    await input.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
      ),
    );
    await page.waitForTimeout(260);
    assert.equal(calls.length, 0);
    assert.equal(await dialog.count(), 1);
    await input.evaluate((el) =>
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    );
    await dialog.getByRole('option').filter({ hasText: savedMemo.text }).waitFor();
    assert.equal(calls.length, 1);
    await input.fill('여');
    await dialog.getByText('두 글자 이상 입력해 주세요.', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 0);

    let release;
    let received;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const captured = new Promise((resolve) => {
      received = resolve;
    });
    await page.route('**/api/search?*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('q') !== '교토' || url.searchParams.get('type') !== 'all')
        return route.continue();
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await input.fill('교토');
    await captured;
    await input.fill('가마쿠라');
    await dialog.getByRole('option').filter({ hasText: '느긋한 주말 계획' }).waitFor();
    release();
    await page.waitForTimeout(80);
    assert.equal(await dialog.getByRole('option').filter({ hasText: savedMemo.text }).count(), 0);
    await page.unroute('**/api/search?*');

    await page.route('**/api/search?*', (route) =>
      route.fulfill({ status: 502, body: '', contentType: 'text/html' }),
    );
    await input.fill('조회실패');
    await dialog.getByText('검색을 불러오지 못했어요.', { exact: true }).waitFor();
    assert.equal((await dialog.innerText()).includes('JSON'), false);
    await page.unroute('**/api/search?*');
    await dialog.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await dialog.getByText('일치하는 기록이 없어요.', { exact: true }).waitFor();

    await input.fill('더보기검색');
    await dialog.getByRole('option').nth(19).waitFor();
    await dialog.getByRole('button', { name: '더 보기', exact: true }).click();
    await dialog.getByRole('option').nth(25).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 26);
    // A held next-page response cannot repopulate a different filter.
    await input.fill('교토');
    await dialog.getByRole('option').filter({ hasText: savedMemo.text }).waitFor();
    await input.fill('더보기검색');
    await dialog.getByRole('option').nth(19).waitFor();
    let releaseFilteredMore, filteredMoreReceived;
    const filteredMoreHeld = new Promise((resolve) => {
      releaseFilteredMore = resolve;
    });
    const filteredMoreCaptured = new Promise((resolve) => {
      filteredMoreReceived = resolve;
    });
    await page.route('**/api/search?*', async (route) => {
      if (!new URL(route.request().url()).searchParams.has('cursor')) return route.continue();
      const response = await route.fetch();
      filteredMoreReceived();
      await filteredMoreHeld;
      await route.fulfill({ response }).catch(() => {});
    });
    await dialog.getByRole('button', { name: '더 보기', exact: true }).click();
    await filteredMoreCaptured;
    await dialog.getByRole('tab', { name: '페이지', exact: true }).click();
    await dialog.getByText('일치하는 기록이 없어요.', { exact: true }).waitFor();
    releaseFilteredMore();
    await page.waitForTimeout(80);
    assert.equal(await dialog.getByRole('option').count(), 0);
    await page.unroute('**/api/search?*');
    await dialog.getByRole('tab', { name: '전체', exact: true }).click();
    await dialog.getByRole('option').nth(19).waitFor();
    // Closing while the next page is held must abort that request too.
    await input.fill('교토');
    await dialog.getByRole('option').filter({ hasText: savedMemo.text }).waitFor();
    await input.fill('더보기검색');
    await dialog.getByRole('option').nth(19).waitFor();
    let releaseMore, moreReceived;
    const moreHeld = new Promise((resolve) => {
      releaseMore = resolve;
    });
    const moreCaptured = new Promise((resolve) => {
      moreReceived = resolve;
    });
    let moreAborted = false;
    const onFailure = (request) => {
      if (new URL(request.url()).searchParams.has('cursor')) moreAborted = true;
    };
    page.on('requestfailed', onFailure);
    await page.route('**/api/search?*', async (route) => {
      if (!new URL(route.request().url()).searchParams.has('cursor')) return route.continue();
      const response = await route.fetch();
      moreReceived();
      await moreHeld;
      await route.fulfill({ response }).catch(() => {});
    });
    await dialog.getByRole('button', { name: '더 보기', exact: true }).click();
    await moreCaptured;
    await dialog.getByRole('button', { name: '검색 닫기', exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(moreAborted, true, 'Closing search must abort the outstanding next-page request.');
    releaseMore();
    await page.unroute('**/api/search?*');
    page.off('requestfailed', onFailure);
    await page.keyboard.press('Control+k');
    await dialog.waitFor();
    await input.fill('더보기검색');
    await dialog.getByRole('option').nth(19).waitFor();
    await memo('더보기검색 새로 추가한 기록');
    await dialog.getByRole('button', { name: '더 보기', exact: true }).click();
    await dialog.getByText('기록이 바뀌어 처음부터 불러왔어요.', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 20);
    await dialog.getByRole('button', { name: '더 보기', exact: true }).click();
    await dialog.getByRole('option').nth(26).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 27);
    await dialog.getByRole('tab', { name: '페이지', exact: true }).click();
    await dialog.getByText('일치하는 기록이 없어요.', { exact: true }).waitFor();
    await input.fill('느긋한 주말 계획');
    await dialog.getByRole('option').filter({ hasText: '느긋한 주말 계획' }).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 1);
    await dialog.getByRole('tab', { name: '파일', exact: true }).click();
    await input.fill('교토 예약 확인서.md');
    await dialog.getByRole('option').filter({ hasText: '교토 예약 확인서.md' }).waitFor();
    await input.press('Enter');
    await page.waitForURL('**/captures/' + savedMemo.id);
    await page.locator('.detail-panel').waitFor();
    await page.getByRole('button', { name: '항목 수정', exact: true }).click();
    const editing = page.getByRole('textbox', { name: '보관한 내용', exact: true });
    await editing.fill('검색 중 유지할 수정 초안');
    await page.keyboard.press('Control+k');
    await dialog.waitFor();
    await input.press('Escape');
    assert.equal(await editing.inputValue(), '검색 중 유지할 수정 초안');
    assert.equal(await editing.evaluate((el) => el === document.activeElement), true);
    await page.getByRole('button', { name: '수정 취소', exact: true }).click();
    await page.getByRole('button', { name: '닫기', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const menu = page.getByRole('button', { name: '메뉴 열기', exact: true });
    await menu.click();
    await page.locator('.nav-search').click();
    await dialog.waitFor();
    await input.press('Escape');
    assert.equal(
      await menu.evaluate((el) => el === document.activeElement),
      true,
      'Mobile search must return focus to the visible menu control after its sidebar closes.',
    );

    if (process.env.QA_SEARCH_SCREENSHOTS !== '0') {
      await mkdir('.impeccable/review/search', { recursive: true });
      for (const width of [1327, 390, 320])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl, { waitUntil: 'networkidle' });
          if (width < 760)
            await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
          await page.locator('.nav-search').click();
          await dialog.waitFor();
          if (width < 760) assert.equal(await page.locator('.mobile-scrim').count(), 0);
          await input.fill('교토');
          await dialog.getByRole('option').filter({ hasText: savedMemo.text }).waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          assert.ok((await dialog.getByRole('option').first().boundingBox()).height >= 44);
          for (const button of await dialog.locator('button').all()) {
            const bounds = await button.boundingBox();
            if (bounds) assert.ok(bounds.height >= 44, 'Search control is below 44px');
          }
          await input.press('Tab');
          assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
          await page.screenshot({ path: `.impeccable/review/search/search-${width}-${theme}.png` });
          await input.press('Escape');
        }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Unified search QA passed: body/file/request search, keyboard, draft/IME, stale initial/next-page responses, filters, cursor reset, friendly retry and focus return.' +
        (process.env.QA_SEARCH_SCREENSHOTS !== '0' ? ' Six responsive theme captures saved.' : ''),
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-search-qa-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: directory,
      PORT: String(port),
      HOST: '127.0.0.1',
    },
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
    await runSearchQa(browser, `http://127.0.0.1:${port}`);
  } finally {
    if (browser) await browser.close();
    const exited = once(server, 'exit');
    server.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
}
