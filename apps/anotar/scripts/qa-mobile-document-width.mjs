import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { offlineApp } from './fixtures/offline-app.mjs';

const out = '.omo/evidence/mobile-document-width';
await mkdir(out, { recursive: true });
const app = await offlineApp();
try {
  const { item } = await app.request('/api/pages', { title: 'Shared Pages', icon: '🌐' });
  await app.request('/api/pages/' + item.id, {
    title: item.title, icon: item.icon, expectedVersion: item.version,
    document: { schemaVersion: 1, blocks: [
      { id: 'intro', type: 'paragraph', props: {}, content: [{ type: 'text', text: '화면 전체 폭에서 좌우 여백을 맞춰 읽습니다.', styles: {} }], children: [] },
      { id: 'note', type: 'callout', props: { icon: 'info', border: true }, content: [{ type: 'text', text: '모바일에서도 제목과 본문 끝이 같은 선에 맞습니다.', styles: {} }], children: [] },
    ] },
  }, 'PUT');
  const context = await app.browser.newContext({ viewport: { width: 660, height: 900 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app.base + '/pages/' + item.id);
  await page.locator('.bn-editor').waitFor();
  const sizes = [];
  for (const width of [320, 390, 660, 760]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.locator('.page-document').evaluate(el => {
      const s = getComputedStyle(el), b = el.getBoundingClientRect();
      const editor = el.querySelector('.page-block-editor').getBoundingClientRect();
      return { viewport: innerWidth, x: b.x, width: b.width, left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight), contentLeft: editor.left, contentRight: editor.right, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    console.log(size);
    assert.equal(size.left, size.right, 'Mobile document has symmetric margins');
    assert.equal(size.left, 18);
    assert.equal(size.width, width, 'Document fills the available viewport');
    assert.ok(Math.abs(size.contentLeft - (width - size.contentRight)) < 1, 'Body is centered');
    assert.equal(size.overflow, false);
    assert.equal(await page.locator('.page-comment-gutter').isVisible(), false, 'Comment gutter takes space only while commenting');
    await page.screenshot({ path: `${out}/mobile-${width}.png` });
    sizes.push(size);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '블록 댓글', exact: true }).click();
  await page.locator('.page-document.page-comment-mode').waitFor();
  assert.equal(await page.locator('.page-comment-gutter').isVisible(), true);
  const commentPadding = await page.locator('.page-document').evaluate(el => parseFloat(getComputedStyle(el).paddingRight));
  assert.equal(commentPadding, 74, 'Comment mode still reserves room for block controls');
  await page.getByLabel('댓글 달 블록', { exact: true }).selectOption('intro');
  await page.locator('.page-comment-panel.has-selection').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/mobile-comments.png` });
  await page.getByRole('button', { name: '댓글 패널 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.page-document.page-comment-mode'));
  assert.equal(await page.locator('.page-document').evaluate(el => getComputedStyle(el).paddingRight), '18px');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('.page-document').evaluate(el => parseFloat(getComputedStyle(el).paddingRight) - parseFloat(getComputedStyle(el).paddingLeft)), 56, 'Desktop gutter is preserved');
  await page.screenshot({ path: `${out}/desktop.png` });
  assert.deepEqual(errors, []);
  await writeFile(out + '/RESULT.json', JSON.stringify({ sizes, commentPadding, errors }, null, 2));
  console.log('PASS mobile document full width, symmetric margins, comment access and desktop gutter');
} finally { await app.close(); }
