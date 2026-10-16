import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { runSearchQa } from './qa-search.mjs';
import { runPageConnectionQa } from './qa-page-connections.mjs';

const dir = await mkdtemp(join(tmpdir(), 'leneu-productivity-qa-'));
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
    AI_RUNNER_URL: '',
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
  const api = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const capture = async (text, file = false) => {
    const data = new FormData();
    data.set('kind', file ? 'file' : 'note');
    data.set('text', text);
    if (file)
      data.append(
        'files',
        new Blob(['보존할 원본 바이트'], { type: 'text/plain' }),
        '예약확인.txt',
      );
    const response = await fetch(base + '/api/captures', { method: 'POST', body: data });
    assert.ok(response.ok);
    return (await response.json()).item;
  };
  const a = await capture('오늘 확인할 숙소 예약과 체크인 시간');
  const b = await capture('점심 식사 후 산책할 장소를 정해두기', true);
  const c = await capture('이번주 회의에서 질문할 항목 정리');
  const parent = (await api('/api/pages', { title: '여행 준비' })).item;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/memo', { waitUntil: 'networkidle' });
  await page.locator(`[data-capture-id="${b.id}"]`).click();
  assert.equal(await page.getByRole('region', { name: '보관한 항목' }).count(), 1);
  assert.equal(await page.locator('.detail-backdrop').count(), 0);
  await page.getByRole('button', { name: '항목 수정', exact: true }).click();
  await page
    .getByRole('textbox', { name: '보관한 내용', exact: true })
    .fill('저장 전에도 보호할 메모 수정');
  assert.equal(await page.getByRole('button', { name: '이전', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '기록하기', exact: true }).click();
  assert.ok(page.url().endsWith('/memo'));
  assert.equal(
    await page.getByRole('textbox', { name: '보관한 내용', exact: true }).inputValue(),
    '저장 전에도 보호할 메모 수정',
  );
  await page.getByRole('button', { name: '수정 취소', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  assert.equal(await page.locator('.detail-text').textContent(), a.text);
  await mkdir('.omo/evidence/productivity-ui/screens', { recursive: true });
  for (const [width, theme] of [
    [1440, 'light'],
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate((theme) => {
      localStorage.setItem('leneu:theme', theme);
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: `.omo/evidence/productivity-ui/screens/memo-${width}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No horizontal overflow in memo/detail',
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole('region', { name: '보관한 항목' })
    .getByRole('button', { name: '닫기', exact: true })
    .click();
  await page.getByRole('button', { name: '메모 선택', exact: true }).click();
  await page.getByRole('checkbox', { name: a.text + ' 선택', exact: true }).check();
  await page.getByRole('checkbox', { name: b.text + ' 선택', exact: true }).check();
  await page.getByRole('button', { name: '한 페이지에 정리', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '메모 함께 정리' });
  await dialog.getByRole('button', { name: '새 페이지', exact: true }).click();
  await dialog.getByRole('textbox', { name: '새 페이지 제목' }).fill('여행 메모 모음');
  await dialog.getByRole('button', { name: '여행 준비', exact: false }).click();
  let committed = false;
  await page.route('**/api/capture-batches/organize', async (route) => {
    if (!committed) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      committed = true;
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: '2개 메모 정리', exact: true }).click();
  await dialog.getByText('정리 여부를 확인하지 못했어요.', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: '함께 정리 닫기' }).click();
  await page.getByRole('button', { name: '같은 요청 확인', exact: true }).click();
  await page
    .getByRole('dialog', { name: '메모 함께 정리' })
    .getByRole('button', { name: '같은 요청 다시 확인', exact: true })
    .click();
  await page.getByRole('textbox', { name: '페이지 제목', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: '페이지 제목', exact: true }).inputValue(),
    '여행 메모 모음',
  );
  const pages = (await api('/api/pages', undefined, 'GET')).items;
  const combined = pages.filter((item) => item.title === '여행 메모 모음');
  assert.equal(combined.length, 1);
  const result = (await api('/api/pages/' + combined[0].id, undefined, 'GET')).item;
  assert.equal(result.parentId, parent.id);
  assert.equal(result.document.blocks.filter((block) => block.type === 'asset').length, 1);
  for (const original of [a, b]) {
    const now = (await api('/api/captures/' + original.id, undefined, 'GET')).item;
    assert.equal(now.text, original.text);
    assert.equal(now.version, original.version);
    assert.equal(now.organizedPageId, result.id);
  }
  assert.equal(
    await (await fetch(base + '/api/assets/' + b.files[0].id)).text(),
    '보존할 원본 바이트',
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('leneu:capture-batch-pending')),
    null,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({
      path: `.omo/evidence/productivity-ui/screens/page-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No horizontal overflow in Page header',
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  let longPage = (await api('/api/pages', { title: '긴 문서에서 블록 도구 확인' })).item;
  longPage = (
    await api(
      '/api/pages/' + longPage.id,
      {
        ...longPage,
        expectedVersion: longPage.version,
        document: {
          schemaVersion: 1,
          blocks: Array.from({ length: 42 }, (_, i) => ({
            id: crypto.randomUUID(),
            type: 'paragraph',
            props: {},
            content: [
              {
                type: 'text',
                text: `긴 문서의 단락 ${i + 1}. 선택한 블록을 정리하는 도구가 스크롤 중에도 보이는지 확인합니다.`,
                styles: {},
              },
            ],
            children: [],
          })),
        },
      },
      'PUT',
    )
  ).item;
  await page.goto(base + '/pages/' + longPage.id, { waitUntil: 'networkidle' });
  await page.getByText('긴 문서의 단락 20.', { exact: false }).click();
  await page.keyboard.press('Meta+a');
  const selectionTools = page.getByLabel('선택 블록 작업', { exact: true });
  await selectionTools.waitFor({ timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 850));
  const toolbarBounds = await selectionTools.boundingBox();
  assert.ok(
    toolbarBounds.y >= 0 && toolbarBounds.y < 100,
    'Selected block tools stay near the viewport',
  );
  await selectionTools.getByRole('button', { name: '다른 페이지로 이동', exact: true }).click();
  await page.getByRole('complementary', { name: '선택 블록 이동', exact: true }).waitFor();
  await page.getByRole('button', { name: '선택 블록 이동 닫기', exact: true }).click();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '통합 검색', exact: true });
  await search.getByRole('button', { name: '빠른 작업', exact: true }).click();
  await search.getByRole('combobox').fill('목차');
  await page.keyboard.press('Enter');
  await page.locator('.page-outline').waitFor();
  await page.keyboard.press('Control+k');
  await search.getByRole('button', { name: '빠른 작업', exact: true }).click();
  await search.getByRole('combobox').fill('새 메모');
  await search.getByRole('combobox').evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
  });
  assert.equal(await search.count(), 1);
  await search
    .getByRole('combobox')
    .evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await page.keyboard.press('Enter');
  await page.waitForURL(base + '/');
  assert.equal(
    await page.locator('.composer-body textarea').evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Productivity QA passed: PC split/mobile modal, edit protection, previous/next, batch parent+files, lost-response replay, original preservation, commands+IME+outline, 42-block contextual move+sticky tools, no page errors, 1440/390/320 overflow.',
  );
  await context.close();
  if (process.env.QA_PRODUCTIVITY_REGRESSION !== '0') {
    await runSearchQa(browser, base);
    await runPageConnectionQa(browser, base);
  }
} finally {
  await browser?.close();
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  await rm(dir, { recursive: true, force: true });
}
