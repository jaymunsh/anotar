import assert from 'node:assert/strict';
import { selectAppTheme } from './qa-compact-pages.mjs';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runAiTemplateRecoveryQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let release;
  try {
    const page = await context.newPage();
    let submissions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/captures')
        submissions++;
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('복구된 여행 계획 요청');
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    const select = page.getByRole('combobox', { name: 'AI 요청 템플릿' });
    await select.locator('option[value="travel-outline"]').waitFor({ state: 'attached' });
    await select.selectOption('travel-outline');
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/prompt-templates', async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('템플릿을 불러오는 중…', { exact: true }).waitFor();
    const save = page.getByRole('button', { name: /^(저장|저장하고 AI 요청|템플릿 확인 중…)$/ });
    assert.equal(
      await save.isDisabled(),
      true,
      'a restored template request must not save as direct while the library is unresolved',
    );
    await page.getByRole('textbox', { name: '메모 내용', exact: true }).press('Meta+Enter');
    assert.equal(submissions, 0);
    release();
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="AI 요청 템플릿"]');
      return select && !select.disabled && select.value === 'travel-outline';
    });
    assert.equal(await save.isEnabled(), true);
    await page.unroute('**/api/prompt-templates');
    await page.route('**/api/prompt-templates', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '복구 테스트: 템플릿 연결 실패' }),
      }),
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .locator('.capture-ai-fields .prompt-error')
      .filter({ hasText: '복구 테스트: 템플릿 연결 실패' })
      .waitFor();
    assert.equal(
      await save.isDisabled(),
      true,
      'library failure must retain the template request draft',
    );
    assert.equal(await select.inputValue(), 'travel-outline');
    assert.equal(
      await page.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
      '복구된 여행 계획 요청',
    );
    await select.selectOption('direct');
    assert.equal(
      await save.isEnabled(),
      true,
      'an explicit direct request needs no template library',
    );
    await save.click();
    await page.getByText('메모를 보관하고 AI 요청을 등록했어요.', { exact: true }).waitFor();
    const response = await fetch(
      baseUrl + '/api/captures?scope=ai&q=' + encodeURIComponent('복구된 여행 계획 요청'),
    );
    const data = await response.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].aiRequest.template, null);
    assert.equal(data.items[0].aiRequest.prompt, '복구된 여행 계획 요청');
    // A fresh draft has no explicit template ID even when the select shows direct.
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('새로운 직접 요청 초안');
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page
      .locator('.capture-ai-fields .prompt-error')
      .filter({ hasText: '복구 테스트: 템플릿 연결 실패' })
      .waitFor();
    assert.equal(await save.isDisabled(), true);
    const useDirect = page.getByRole('button', { name: '직접 요청으로 작성', exact: true });
    assert.equal(
      await useDirect.count(),
      1,
      'a fresh failed library load needs an explicit direct-request recovery action',
    );
    await page
      .locator('.capture-ai-fields')
      .screenshot({ path: '/tmp/leneu-memo-template-recovery.png' });
    await useDirect.click();
    assert.equal(await save.isEnabled(), true);
    assert.equal(
      await page.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
      '새로운 직접 요청 초안',
    );
    assert.equal(submissions, 1, 'choosing direct must not submit before the user saves');
    console.log(
      'AI recovery QA passed: delayed/failed template loading preserves draft; explicit direct request remains available',
    );
  } finally {
    release?.();
    await context.close();
  }
}

export async function runMemoLibraryQa(browser, baseUrl, dataDir) {
  if (dataDir)
    execFileSync(process.execPath, ['scripts/seed-memo-samples.mjs'], {
      env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: dataDir },
      stdio: 'pipe',
    });
  async function create(text, aiRequest) {
    const body = new FormData();
    body.set('kind', 'note');
    body.set('text', text);
    body.set('url', '');
    if (aiRequest) body.set('aiRequest', JSON.stringify(aiRequest));
    const response = await fetch(baseUrl + '/api/captures', { method: 'POST', body });
    assert.equal(response.status, 201);
    return (await response.json()).item;
  }
  const note = await create('교토 여행 준비: 숙소 예약 번호와 체크인 시간 확인');
  const request = await create('여행 메모를 일정으로 묶어보기', {
    template: null,
    additional: '휴식 시간을 남겨주세요',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl + '/memo', { waitUntil: 'networkidle' });
    assert.equal(
      await page.getByRole('heading', { name: '메모', exact: true }).count(),
      1,
      '/memo should display the memo manager',
    );
    assert.ok(await page.getByText(note.text, { exact: true }).isVisible());
    assert.equal(await page.getByText(request.text, { exact: true }).count(), 0);
    await page.getByRole('textbox', { name: '보관함 검색' }).fill('교토 여행 준비: 숙소 예약 번호');
    await page.waitForFunction(
      () => document.querySelectorAll('.memo-workspace .capture-card').length === 1,
    );
    await page.locator('.memo-workspace .capture-card').click();
    await page.getByRole('button', { name: '항목 수정' }).click();
    await page
      .getByRole('textbox', { name: '보관한 내용' })
      .fill('교토 여행 준비: 숙소 예약 확인 (메모에서 수정)');
    await page.getByRole('button', { name: '변경 저장' }).click();
    await page
      .locator('.detail-panel')
      .getByText('교토 여행 준비: 숙소 예약 확인 (메모에서 수정)', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    // Leaving a filtered manager must not reuse its query when refreshing home.
    await page
      .getByRole('tablist', { name: '항목 필터' })
      .getByRole('tab', { name: '메모', exact: true })
      .click();
    await page.getByRole('link', { name: '입력함', exact: true }).click();
    const homeCard = page
      .locator('.capture-card')
      .filter({ hasText: '교토 여행 준비: 숙소 예약 확인 (메모에서 수정)' });
    await homeCard.click();
    await page.getByRole('button', { name: '항목 수정' }).click();
    await page
      .getByRole('textbox', { name: '보관한 내용' })
      .fill('교토 여행 준비: 숙소 예약 확인 완료');
    await page.getByRole('button', { name: '변경 저장' }).click();
    await page
      .locator('.detail-panel')
      .getByText('교토 여행 준비: 숙소 예약 확인 완료', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page
      .locator('.capture-card')
      .filter({ hasText: '교토 여행 준비: 숙소 예약 확인 완료' })
      .waitFor();
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '메모', exact: true })
      .click();
    await page.route('**/api/captures?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('scope') === 'ai')
        await new Promise((resolve) => setTimeout(resolve, 200));
      await route.continue();
    });
    await page.getByRole('tab', { name: /^요청 원본/ }).click();
    assert.equal(
      await page
        .locator('.memo-workspace .capture-card')
        .filter({ hasText: '교토 여행 준비: 숙소 예약 확인 완료' })
        .count(),
      0,
      'switching scopes must not expose the previous list while a request is pending',
    );
    assert.equal(new URL(page.url()).searchParams.get('view'), 'ai');
    await page.getByText(request.text, { exact: true }).waitFor();
    assert.equal(
      await page.getByText('교토 여행 준비: 숙소 예약 확인 완료', { exact: true }).count(),
      0,
    );
    const requestCard = page
      .locator('.memo-workspace .capture-card')
      .filter({ hasText: request.text });
    await requestCard.click();
    await page.locator('.detail-panel').getByText('연결 필요', { exact: true }).waitFor();
    await page.locator('.ai-saved-prompt summary').click();
    assert.equal(
      await page.locator('.ai-saved-prompt pre').first().textContent(),
      request.aiRequest.input.content,
    );
    assert.equal(
      await page.locator('.ai-saved-prompt pre').last().textContent(),
      request.aiRequest.prompt,
    );
    await page.getByRole('button', { name: '요청문 복사', exact: true }).click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      request.aiRequest.prompt,
    );
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(request.text, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'ai');
    await page.getByRole('link', { name: '입력함', exact: true }).click();
    await page.getByRole('textbox', { name: '메모 내용' }).fill('이동 중 유지할 다음 메모');
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '메모', exact: true })
      .click();
    await page.getByRole('link', { name: '입력함', exact: true }).click();
    assert.equal(
      await page.getByRole('textbox', { name: '메모 내용' }).inputValue(),
      '이동 중 유지할 다음 메모',
    );
    for (const alias of ['/pages', '/temp']) {
      await page.goto(baseUrl + alias, { waitUntil: 'networkidle' });
      assert.equal(new URL(page.url()).pathname, '/memo');
      assert.equal(await page.getByRole('heading', { name: '메모', exact: true }).count(), 1);
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        for (const scope of ['memo', 'ai']) {
          await page
            .getByRole('tab', { name: scope === 'ai' ? /^요청 원본/ : /^보관한 메모/ })
            .click();
          await page.locator('.memo-workspace .capture-card').first().waitFor();
          const expected = scope === 'ai' ? request.text : '교토 여행 준비: 숙소 예약 확인 완료';
          assert.ok(await page.getByText(expected, { exact: true }).isVisible());
          assert.equal(await page.locator('.memo-sample').count(), 0);
          const badges = await page.locator('.capture-card').evaluateAll((cards) =>
            cards.flatMap((card) => {
              const badge = card.querySelector('.capture-new');
              if (!badge) return [];
              const bounds = badge.getBoundingClientRect();
              const meta = card.querySelector('.capture-card-top').getBoundingClientRect();
              const outer = card.getBoundingClientRect();
              return [
                {
                  inset: outer.right - bounds.right,
                  aligned: Math.abs((bounds.top + bounds.bottom - meta.top - meta.bottom) / 2),
                },
              ];
            }),
          );
          assert.ok(badges.length);
          assert.ok(
            badges.every(
              (badge) => Math.abs(badge.inset - (width > 760 ? 17 : 13)) < 1 && badge.aligned < 1,
            ),
            'NEW stays on the timestamp row at a shared right inset, including image and AI cards',
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          await page.screenshot({ path: `/tmp/leneu-memo-${scope}-${width}-${theme}.png` });
        }
      }
    }
    assert.deepEqual(errors, []);
    await runAiTemplateRecoveryQa(browser, baseUrl);
    console.log(
      'Memo QA passed: scoped lists, request snapshot/copy, editing, reload, aliases, drafts, 320/390px light/dark',
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memo-qa-'));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: '8790',
      HOST: '127.0.0.1',
    },
    stdio: 'pipe',
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch('http://127.0.0.1:8790/api/health')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    if (process.argv.includes('--template-recovery'))
      await runAiTemplateRecoveryQa(browser, 'http://127.0.0.1:8790');
    else await runMemoLibraryQa(browser, 'http://127.0.0.1:8790', dir);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
}
