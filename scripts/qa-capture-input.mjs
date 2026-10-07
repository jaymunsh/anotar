import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';

const app = await offlineApp();
const out = '.omo/evidence/capture-input';
await mkdir(out, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await app.browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.base + '/memo');
    await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
    await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
    const dialog = page.locator('.capture-composer-dialog');
    const input = dialog.getByRole('textbox', { name: '메모 내용', exact: true });
    await dialog.locator('.composer-options > summary').click();
    await dialog.getByRole('tab', { name: '이미지', exact: true }).click();
    await dialog.locator('.upload-zone').waitFor();
    await input.click();
    assert.equal(await dialog.locator('.upload-zone').count(), 0, 'Returning to writing hides the empty image picker');
    assert.equal(await dialog.locator('.composer-heading-icon').count(), 0);
    await dialog.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await dialog.getByRole('button', { name: '입력 닫기', exact: true }).click();
    assert.equal(await page.locator('.mobile-create-draft').count(), 0, 'AI selection alone is not a content draft');
    await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
    await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'AI 요청', exact: true }).uncheck();
    await input.fill('첨부와 함께 이어 쓸 메모');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('preserved attachment') });
    await dialog.locator('.attached-files').filter({ hasText: 'keep.txt' }).waitFor();
    await dialog.getByRole('button', { name: '입력 닫기', exact: true }).click();
    await page.locator('.mobile-create-draft').waitFor();
    await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
    assert.match(await page.locator('.mobile-create-sheet').textContent(), /메모 이어쓰기/);
    await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
    assert.equal(await input.inputValue(), '첨부와 함께 이어 쓸 메모');
    assert.match(await dialog.locator('.attached-files').textContent(), /keep.txt/);
    assert.equal(await dialog.locator('.upload-zone').count(), 0);
    await dialog.locator('.composer-options > summary').click();
    await dialog.getByRole('tab', { name: '메모', exact: true }).click();
    assert.equal(await dialog.locator('.upload-zone').count(), 0);
    assert.match(await dialog.locator('.attached-files').textContent(), /keep.txt/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${out}/${width}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(out + '/RESULT.json', JSON.stringify({ desktop: true, mobile: true, attachmentAndTextPreserved: true, imagePickerCollapses: true, decorativePlusRemoved: true, draftIndicatorReflectsContent: true }));
  console.log('PASS capture input: collapsible image picker, preserved draft and attachments, clear draft menu; desktop/mobile');
} finally {
  await app.close();
}
