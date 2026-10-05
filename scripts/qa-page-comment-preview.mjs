import assert from 'node:assert/strict';
import { selectAppTheme } from './qa-compact-pages.mjs';

export async function runCommentPreviewQa(browser, baseUrl) {
  const response = await fetch(baseUrl + '/api/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '교토 공유 메모' }),
  });
  assert.equal(response.status, 201);
  const { item } = await response.json();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl + '/pages/' + item.id, { waitUntil: 'networkidle' });
    const fullText = '오전에는 철학의 길을 걷고, 오후에는 카페에서 쉬기.';
    const completedSave = page.waitForResponse(
      (saved) =>
        saved.url().endsWith('/api/pages/' + item.id) &&
        saved.request().method() === 'PUT' &&
        saved.ok() &&
        saved.request().postData()?.includes('오후에는 미술관에서 전시 보기.'),
    );
    await page.locator('.page-block-editor .bn-editor').click();
    await page.keyboard.type(fullText);
    await page.keyboard.press('Enter');
    await page.keyboard.type('오후에는 미술관에서 전시 보기.');
    await completedSave;
    const before = (await (await fetch(baseUrl + '/api/pages/' + item.id)).json()).item;
    const previewWrites = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().endsWith('/api/pages/' + item.id))
        previewWrites.push(request.postData());
    });

    await page.locator('.page-block-editor .bn-block-outer[data-id]').first().hover();
    await page.getByRole('button', { name: '블록에 댓글 달기' }).first().click();
    await page.getByText('개인 블록 댓글').waitFor();
    await page.getByRole('heading', { name: '블록 대화' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '페이지 제목' }).isEditable(), false);
    assert.equal(
      await page.locator('.page-block-editor [contenteditable="true"]').count(),
      0,
      'Preview must keep the page body read-only',
    );
    await page.locator('.page-block-editor .bn-block-outer[data-id]').first().click();
    await page.locator('.page-comment-anchor p').waitFor();
    assert.match(await page.locator('.page-comment-anchor p').textContent(), /철학의 길을 걷고/);
    await page.getByRole('textbox', { name: '댓글 입력' }).fill('점심 예약도 확인해 주세요.');
    await page.getByRole('button', { name: '댓글 남기기' }).click();
    await page.getByText('점심 예약도 확인해 주세요.').waitFor();
    await page.getByRole('button', { name: '댓글 목록으로' }).click();
    await page.getByRole('button', { name: /점심 예약도 확인해 주세요/ }).click();
    await page.getByRole('textbox', { name: '답글 입력' }).waitFor();
    await page.getByRole('textbox', { name: '답글 입력' }).fill('예약번호는 메모에 적어둘게요.');
    await page.getByRole('textbox', { name: '답글 입력' }).press('Control+Enter');
    await page.getByText('예약번호는 메모에 적어둘게요.').waitFor();
    await page.getByRole('button', { name: '댓글 2개가 있는 블록 보기' }).waitFor();
    await page.getByRole('button', { name: '해결' }).click();
    await page.getByText('해결됨', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '답글 입력' }).count(), 0);
    await page.getByRole('button', { name: '댓글 2개 펼치기' }).click();
    await page.getByText('예약번호는 메모에 적어둘게요.').waitFor();
    await page.getByRole('button', { name: '다시 열기' }).click();
    await page.getByText('진행 중', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: '문서 댓글' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '댓글 패널 닫기' }).isVisible(), true);
    await page.getByRole('combobox', { name: '댓글 달 블록' }).selectOption({ index: 1 });
    await page.getByText('점심 예약도 확인해 주세요.').waitFor();

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        if (width < 760) {
          const noteWidth = await page
            .locator('.page-comment-readonly-note > span')
            .evaluate((node) => node.getBoundingClientRect().width);
          assert.ok(
            noteWidth > width * 0.55,
            'mobile preview copy must have a readable line width',
          );
        }
        assert.equal(await page.getByRole('button', { name: '댓글 패널 닫기' }).isVisible(), true);
        if (width < 760) {
          await page.getByRole('button', { name: '본문 위치', exact: true }).click();
          const compact = (await page.locator('.page-comment-panel').boundingBox()).height;
          await page.getByRole('button', { name: '댓글 패널 펼치기' }).click();
          const expanded = (await page.locator('.page-comment-panel').boundingBox()).height;
          assert.ok(
            expanded > compact + 100,
            'Sheet height can be adjusted without leaving the conversation',
          );
          await page.getByRole('button', { name: '댓글 패널 줄이기' }).click();
        }
        const composer = await page.locator('.page-comment-compose').boundingBox(),
          panel = await page.locator('.page-comment-panel').boundingBox();
        assert.ok(
          composer.y + composer.height <= panel.y + panel.height + 1,
          'Composer stays within the panel',
        );
        await page.screenshot({ path: `/tmp/leneu-comment-preview-${width}-${theme}.png` });
      }
    }

    // Visual viewport emulation follows visual captures so it cannot alter compositor evidence.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 360 });
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() =>
      document.querySelector('.page-comment-panel')?.classList.contains('has-keyboard'),
    );
    const keyboardPanel = await page.locator('.page-comment-panel').boundingBox(),
      keyboardCompose = await page.locator('.page-comment-compose').boundingBox();
    assert.ok(
      keyboardPanel.y + keyboardPanel.height <= 361,
      'Panel stays inside the simulated visual viewport',
    );
    assert.ok(
      keyboardCompose.y + keyboardCompose.height <= keyboardPanel.y + keyboardPanel.height + 1,
      'Keyboard resize keeps the composer visible',
    );
    await page.evaluate(() => {
      delete visualViewport.height;
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(
      () => !document.querySelector('.page-comment-panel')?.classList.contains('has-keyboard'),
    );
    await page.getByRole('button', { name: '댓글 닫기' }).click();
    assert.equal(await page.getByRole('textbox', { name: '페이지 제목' }).isEditable(), true);
    await page.getByRole('button', { name: '블록 댓글' }).click();
    await page.locator('.page-block-editor .bn-block-outer[data-id]').first().click();
    await page.getByText('점심 예약도 확인해 주세요.').waitFor();
    // A second block exercises plain Enter, IME, failure/retry identity and deletion.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.page-block-editor .bn-block-outer[data-id]').nth(1).click();
    const draftInput = page.getByRole('textbox', { name: '댓글 입력' });
    await draftInput.fill('전시 시간 확인');
    await draftInput.press('Enter');
    await draftInput.press('End');
    assert.match(await draftInput.inputValue(), /\n/);
    await draftInput.dispatchEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
      keyCode: 229,
    });
    assert.equal(
      (await (await fetch(baseUrl + `/api/pages/${item.id}/comments`)).json()).items.length,
      1,
      'IME Enter must not submit',
    );
    await draftInput.press('Control+Enter');
    await page.getByRole('textbox', { name: '답글 입력' }).waitFor();
    const replyInput = page.getByRole('textbox', { name: '답글 입력' });
    await replyInput.fill('입력한 답글은 실패해도 보존하기');
    let failedRequestId;
    const failure = async (route) => {
      if (route.request().method() === 'POST') {
        failedRequestId = route.request().postDataJSON().requestId;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '연결을 확인한 뒤 다시 시도해 주세요.' }),
        });
      } else await route.continue();
    };
    const commentUrl = `**/api/pages/${item.id}/comments`;
    await page.route(commentUrl, failure);
    await page.getByRole('button', { name: '답글 등록' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await replyInput.inputValue(), '입력한 답글은 실패해도 보존하기');
    await page.unroute(commentUrl, failure);
    await page.getByRole('button', { name: '댓글 패널 닫기' }).click();
    assert.equal(await page.getByRole('textbox', { name: '페이지 제목' }).isEditable(), true);
    await page.getByRole('button', { name: '댓글 1개가 있는 블록 보기' }).click();
    assert.equal(await replyInput.inputValue(), '입력한 답글은 실패해도 보존하기');
    const retried = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/pages/${item.id}/comments`),
    );
    await page.getByRole('button', { name: '답글 등록' }).click();
    assert.equal((await retried).postDataJSON().requestId, failedRequestId);
    await page.getByText('입력한 답글은 실패해도 보존하기', { exact: true }).waitFor();
    await page.getByLabel('대화 더보기').click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '대화 삭제', exact: true }).click();
    assert.equal(
      (await (await fetch(baseUrl + `/api/pages/${item.id}/comments`)).json()).items.length,
      2,
    );
    await page.getByLabel('대화 더보기').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '대화 삭제', exact: true }).click();
    await page.getByRole('textbox', { name: '댓글 입력' }).waitFor();
    assert.equal(
      (await (await fetch(baseUrl + `/api/pages/${item.id}/comments`)).json()).items.length,
      1,
    );
    await page.getByRole('button', { name: '댓글 패널 닫기' }).click();
    await page.getByRole('button', { name: '댓글 2개가 있는 블록 보기' }).click();
    await page.getByText('점심 예약도 확인해 주세요.').waitFor();
    const summaries = (
      await (await fetch(baseUrl + `/api/pages/${item.id}/comments?view=summary`)).json()
    ).items;
    assert.equal(summaries[0].count, 2);
    assert.equal('comments' in summaries[0], false);
    const after = (await (await fetch(baseUrl + '/api/pages/' + item.id)).json()).item;
    assert.equal(after.version, before.version, 'Comments must not change document version');
    assert.equal(previewWrites.length, 0, 'Comments use their own API');
    assert.deepEqual(after.document, before.document);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '블록 댓글' }).click();
    await page.locator('.page-block-editor .bn-block-outer[data-id]').first().click();
    await page.getByText('점심 예약도 확인해 주세요.').waitFor();
    console.log(
      'Persistent owner comments QA passed: thread, reply, resolve, independent document, reload, responsive themes',
    );
  } finally {
    await context.close();
  }
}
