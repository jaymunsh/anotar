import { selectAppTheme } from './qa-compact-pages.mjs';
import assert from 'node:assert/strict';

export async function runDraftQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const memo = page.getByRole('textbox', { name: '메모 내용', exact: true });
    await memo.fill('다시 열어도 남아야 하는 메모\n{{url}}');
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page.waitForFunction(() => {
      const input = document.querySelector('select[aria-label=\"AI 요청 템플릿\"]');
      return input && !input.disabled && input.value;
    });
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('idea-outline');
    await page.getByRole('textbox', { name: 'AI 추가 요청' }).fill('중요한 질문부터');
    await page.reload({ waitUntil: 'networkidle' }); // Immediate pagehide must flush the debounce.
    assert.equal(await memo.inputValue(), '다시 열어도 남아야 하는 메모\n{{url}}');
    assert.equal(
      await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).inputValue(),
      'idea-outline',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'AI 추가 요청' }).inputValue(),
      '중요한 질문부터',
    );
    await page.locator('input[type=file]').setInputFiles({
      name: 'draft.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('복구할 첨부 바이트'),
    });
    await page.getByText('첨부 임시저장 중…', { exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() =>
      document.querySelector('.attached-files')?.textContent.includes('draft.txt'),
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.attached-files').getByText('draft.txt', { exact: true }).waitFor();

    const other = await context.newPage();
    await other.goto(baseUrl, { waitUntil: 'networkidle' });
    await other.getByRole('textbox', { name: '메모 내용', exact: true }).fill('다른 탭의 메모');
    await other.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await other.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
      '다른 탭의 메모',
    );
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await memo.inputValue(), '다시 열어도 남아야 하는 메모\n{{url}}');
    await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
    await page.getByText('메모를 보관하고 AI 요청을 등록했어요.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await memo.inputValue(), '');
    assert.equal(await page.locator('.attached-files').count(), 0);
    const captures = await (await context.request.get(baseUrl + '/api/captures')).json();
    const recoveredCapture = captures.items.find(
      (item) => item.text.replace(/\r\n/g, '\n') === '다시 열어도 남아야 하는 메모\n{{url}}',
    );
    assert.ok(recoveredCapture, 'restored memo must be saved with its attachment');
    const recoveredFile = recoveredCapture.files[0];
    assert.equal(
      await (await context.request.get(`${baseUrl}/api/assets/${recoveredFile.id}`)).text(),
      '복구할 첨부 바이트',
    );
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page.waitForFunction(() => {
      const input = document.querySelector('select[aria-label=\"AI 요청 템플릿\"]');
      return input && !input.disabled && input.value;
    });
    assert.equal(
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).inputValue(),
      'idea-outline',
      'last free template must survive save and reload',
    );
    await page.locator('.composer-tabs').getByRole('tab', { name: '링크' }).click();
    await page.getByRole('textbox', { name: '링크 주소' }).fill('https://example.com/second');
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('travel-outline');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).inputValue(),
      'travel-outline',
    );

    await page.locator('.sidebar').getByRole('link', { name: '프롬프트', exact: true }).click();
    await page.getByRole('button', { name: '새 템플릿', exact: true }).click();
    await page.getByRole('textbox', { name: '템플릿 이름' }).fill('미저장 템플릿');
    const promptBody = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    await promptBody.fill('새로고침 전에 저장하지 않은 {{content}}');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await promptBody.inputValue(), '새로고침 전에 저장하지 않은 {{content}}');
    assert.equal(
      await page.getByRole('textbox', { name: '템플릿 이름' }).inputValue(),
      '미저장 템플릿',
    );
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();

    // Variable buttons must respect the same limit as typing/pasting.
    await promptBody.fill('가'.repeat(9995));
    await page.getByRole('button', { name: '{{content}}', exact: true }).click();
    assert.equal(
      (await promptBody.inputValue()).length,
      9995,
      'variable insertion must not invalidate draft recovery',
    );
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal((await promptBody.inputValue()).length, 9995);
    await promptBody.fill('초안 복구와 본문 상한을 확인했어요. {{content}}');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();

    // Archiving must not replace a stale draft's original conflict version.
    const templateId = new URL(page.url()).pathname.split('/').at(-1);
    await promptBody.fill('내 미저장 본문');
    await other.goto(page.url(), { waitUntil: 'networkidle' });
    await other
      .getByRole('textbox', { name: '프롬프트 본문', exact: true })
      .fill('다른 탭 최신 본문');
    await other.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await other.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '템플릿 보관', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/다른 탭에서 먼저 수정/)
      .waitFor();
    const storedTemplate = (
      await (await context.request.get(`${baseUrl}/api/prompt-templates/${templateId}`)).json()
    ).item;
    assert.equal(
      storedTemplate.archived,
      false,
      'archive must refuse a stale draft instead of replacing its expected version',
    );
    assert.equal(storedTemplate.body, '다른 탭 최신 본문');
    assert.equal(await promptBody.inputValue(), '내 미저장 본문');
    await page.getByRole('button', { name: '최신 내용 불러오기', exact: true }).click();
    assert.equal(await promptBody.inputValue(), '다른 탭 최신 본문');

    // New input during a delayed save belongs to the next draft, not the sent capture.
    await page.locator('.sidebar').getByRole('link', { name: '입력함', exact: true }).click();
    await page.locator('.composer-tabs').getByRole('tab', { name: '메모', exact: true }).click();
    await memo.fill('전송할 원문');
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/captures', async (route) => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
    await memo.fill('전송 중 새로 작성한 메모');
    release();
    await page.getByText('메모를 보관하고 AI 요청을 등록했어요.', { exact: true }).waitFor();
    assert.equal(await memo.inputValue(), '전송 중 새로 작성한 메모');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await memo.inputValue(), '전송 중 새로 작성한 메모');
    await other.close();

    for (const width of [390, 320]) {
      await page.goto(baseUrl + '/prompts/research-brief', { waitUntil: 'networkidle' });
      await page.setViewportSize({ width, height: 844 });
      await selectAppTheme(page, width === 320 ? 'dark' : 'light');
      await page.waitForFunction(
        () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
      );
      const bodyBounds = await promptBody.boundingBox();
      assert.ok(bodyBounds && bodyBounds.y < 550, 'mobile editor must put the prompt body first');
      const saveButton = page
        .locator('.prompt-mobile-actions')
        .getByRole('button', { name: /템플릿 저장|저장됨/ });
      const bounds = await saveButton.boundingBox();
      assert.ok(
        bounds && bounds.y + bounds.height <= 844,
        'mobile template save must be reachable',
      );
      assert.equal(
        await page.locator('.mobile-capture-dock').isVisible(),
        false,
        'template toolbar replaces the global capture dock',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        'mobile screen must not overflow sideways',
      );
      await page.screenshot({ path: `/tmp/leneu-prompt-usability-${width}.png` });
      await promptBody.fill(`${width}px에서 모바일 본문을 먼저 쓸 수 있어요. {{content}}`);
      await saveButton.click();
      await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    }
    console.log(
      'Draft QA passed: reload, attachments, tab isolation, clear, delayed save, recent choices, mobile editor',
    );
  } finally {
    await context.close();
  }
}
