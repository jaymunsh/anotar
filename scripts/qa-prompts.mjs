import { selectAppTheme } from './qa-compact-pages.mjs';
import assert from 'node:assert/strict';

export async function runPromptQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const externalRequests = [];
  const requests = [];
  const errors = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(url).hostname))
      return route.continue(); // Existing font assets, unrelated to AI or URL research.
    if (!url.startsWith(baseUrl + '/') && !url.startsWith('data:')) {
      externalRequests.push(url);
      return route.abort();
    }
    requests.push({ url, method: route.request().method() });
    return route.continue();
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    assert.equal(
      requests.some(({ url }) => /PromptWorkspace-.*\.js/.test(url)),
      false,
      'prompt manager must be lazy',
    );
    assert.equal(
      requests.some(({ url }) => url.includes('/api/prompt-templates')),
      false,
      'first capture load must not fetch templates',
    );
    const memo =
      'https://example.com/articles/kyoto\n교토 여행을 위한 자료예요. {{url}}은 원문 그대로 남겨 주세요.';
    await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill(memo);
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page.waitForFunction(() => {
      const input = document.querySelector('select[aria-label=\"AI 요청 템플릿\"]');
      return input && !input.disabled && input.value;
    });
    assert.equal(
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).inputValue(),
      'research-brief',
    );
    await page
      .getByRole('textbox', { name: 'AI 추가 요청' })
      .fill('예약이 필요한 곳도 따로 알려 주세요.');
    await page.locator('.capture-ai-preview summary').click();
    assert.match(
      await page.locator('.capture-ai .prompt-result').textContent(),
      /예약이 필요한 곳/,
    );
    assert.match(
      await page.locator('.capture-ai .prompt-result').textContent(),
      /\{\{url\}\}은 원문/,
    );
    await page.screenshot({ path: '/tmp/leneu-ai-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '템플릿 관리' }).click();
    await page.getByRole('heading', { name: '프롬프트', exact: true }).waitFor();
    const body = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    const editedBody =
      (await body.inputValue()) + '\n\n추가 조건: 처음 읽는 사람도 이해할 수 있게 써 주세요.';
    await body.fill(editedBody);
    await page.locator('.prompt-template-item').filter({ hasText: '생각 정리' }).click();
    await page.locator('.prompt-template-item').filter({ hasText: 'URL 리서치' }).click();
    assert.equal(await body.inputValue(), editedBody, 'switching templates must preserve drafts');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '요청 미리보기', exact: true }).click();
    await page.getByRole('textbox', { name: '미리보기 URL' }).fill('https://example.com/test');
    await page
      .getByRole('textbox', { name: '미리보기 메모' })
      .fill('테스트 입력 속 {{url}}은 치환하지 마세요.');
    assert.match(
      await page.locator('.prompt-test-area .prompt-result').textContent(),
      /URL: https:\/\/example.com\/test/,
    );
    assert.match(
      await page.locator('.prompt-test-area .prompt-result').textContent(),
      /입력 속 \{\{url\}\}/,
    );
    await page.getByRole('button', { name: '요청 복사', exact: true }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /처음 읽는 사람/);
    await page.screenshot({ path: '/tmp/leneu-prompts-preview.png', fullPage: true });
    await page.getByRole('button', { name: '입력함에서 사용', exact: true }).click();
    assert.equal(
      await page.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
      memo,
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'AI 추가 요청' }).inputValue(),
      '예약이 필요한 곳도 따로 알려 주세요.',
    );
    assert.match(await page.locator('.capture-ai .prompt-result').textContent(), /처음 읽는 사람/);
    await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
    await page.getByText('메모를 보관하고 AI 요청을 등록했어요.', { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('.capture-ai-toggle input')?.checked === false,
      null,
      { timeout: 5000 },
    );
    assert.equal(
      await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).isChecked(),
      false,
    );
    assert.equal(
      requests
        .filter(({ url }) => /\/api\/(ai|jobs)/.test(url))
        .every(({ method }) => method === 'GET'),
      true,
    );

    await page.locator('.sidebar').getByRole('link', { name: '프롬프트', exact: true }).click();
    await page.getByRole('tab', { name: '작성', exact: true }).click();
    await page.getByRole('button', { name: '새 템플릿', exact: true }).click();
    await page.getByRole('textbox', { name: '템플릿 이름' }).fill('나의 자유 요청');
    await body.fill('아래 메모에서 질문을 정리해 주세요.\n\n{{content}}');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.getByRole('textbox', { name: '템플릿 이름' }).inputValue(),
      '나의 자유 요청',
    );
    assert.match(await body.inputValue(), /질문을 정리/);

    // A failed server save keeps the editor's draft; retry uses the same draft.
    const retryBody = (await body.inputValue()) + '\n미저장 초안';
    await body.fill(retryBody);
    await page.route('**/api/prompt-templates/*', async (route) => {
      if (route.request().method() === 'PUT')
        return route.fulfill({
          status: 503,
          json: { error: '저장소 연결이 끊겼어요. 다시 시도해 주세요.' },
        });
      await route.continue();
    });
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/저장소 연결이 끊겼어요/)
      .waitFor();
    assert.equal(await body.inputValue(), retryBody);
    await page.unroute('**/api/prompt-templates/*');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '템플릿 복제', exact: true }).click();
    await page
      .getByText('복사본을 만들었어요. 원하는 문구로 바꿔보세요.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: '템플릿 이름' }).inputValue(),
      '나의 자유 요청 복사본',
    );
    await page.getByRole('button', { name: '템플릿 보관', exact: true }).click();
    await page.getByText(/보관했어요. 보관된 템플릿/).waitFor();
    await page.getByRole('tab', { name: /보관됨/ }).click();
    await page.getByRole('button', { name: '템플릿 꺼내기', exact: true }).click();
    await page.getByText('다시 사용할 수 있게 꺼냈어요.', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: '템플릿 이름' }).inputValue(),
      '나의 자유 요청 복사본',
    );

    // Two open tabs cannot silently replace one another's edits.
    const other = await context.newPage();
    await other.goto(page.url(), { waitUntil: 'networkidle' });
    await other.getByRole('textbox', { name: '프롬프트 본문' }).fill('다른 탭의 초안 {{content}}');
    await body.fill('첫 번째 탭의 최신 내용 {{content}}');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await other.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await other
      .getByRole('alert')
      .getByText(/다른 탭에서 먼저 수정/)
      .waitFor();
    assert.equal(
      await other.getByRole('textbox', { name: '프롬프트 본문' }).inputValue(),
      '다른 탭의 초안 {{content}}',
    );
    await other.getByRole('button', { name: '최신 내용 불러오기' }).click();
    assert.equal(
      await other.getByRole('textbox', { name: '프롬프트 본문' }).inputValue(),
      '첫 번째 탭의 최신 내용 {{content}}',
    );
    await other.close();
    await page.locator('.prompt-template-item').filter({ hasText: 'URL 리서치' }).click();
    await page.screenshot({ path: '/tmp/leneu-prompts-desktop.png', fullPage: true });
    await selectAppTheme(page, 'dark');
    await page.screenshot({ path: '/tmp/leneu-prompts-dark.png', fullPage: true });

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(
        () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
      );
      await selectAppTheme(page, width === 390 ? 'light' : 'dark');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        `prompt overflow at ${width}`,
      );
      await page.screenshot({ path: `/tmp/leneu-prompts-${width}.png` });
      await page.getByRole('button', { name: '입력함에서 사용', exact: true }).click();
      await page.getByRole('dialog', { name: '빠른 기록' }).waitFor();
      await page
        .getByRole('textbox', { name: '메모 내용', exact: true })
        .fill('모바일에서 바로 준비하는 요청');
      if ((await page.locator('.capture-ai-preview').getAttribute('open')) === null)
        await page.locator('.capture-ai-preview summary').click();
      assert.equal(
        await page
          .locator('.composer.mobile-open .composer-tab span')
          .evaluateAll((spans) => spans.every((span) => span.getBoundingClientRect().height < 23)),
        true,
        `capture tab labels must stay on one line at ${width}px`,
      );
      await page.locator('.capture-ai-preview .prompt-result').scrollIntoViewIfNeeded();
      const footer = await page.locator('.composer.mobile-open .composer-footer').boundingBox();
      assert.ok(
        footer && footer.y >= 0 && footer.y + footer.height <= 845,
        'mobile save footer must stay visible',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        `AI fields overflow at ${width}`,
      );
      await page.screenshot({ path: `/tmp/leneu-ai-${width}.png` });
      await page.getByRole('button', { name: '템플릿 관리' }).click();
    }
    assert.deepEqual(externalRequests, [], 'preview must not fetch URLs or call external services');
    assert.deepEqual(errors, []);
    console.log(
      'Prompt QA passed: server save, drafts, preview, copy, archive, conflict, 320/390px, no external URL or AI execution requests',
    );
  } finally {
    await context.close();
  }
}
