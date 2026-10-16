import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
import { clickPageTool } from './qa-page-tools.mjs';

const app = await offlineApp();
const evidence = '.omo/evidence/editor-canvas';
await mkdir(evidence, { recursive: true });
const failures = [];
const text = (value) => [{ type: 'text', text: value, styles: {} }];
async function createDocument(title, blocks) {
  const { item } = await app.request('/api/pages', { title });
  await app.request(
    `/api/pages/${item.id}`,
    {
      title,
      expectedVersion: item.version,
      document: { schemaVersion: 1, blocks },
    },
    'PUT',
  );
  return item.id;
}
async function cursor(page) {
  return page.evaluate(() => {
    const selection = getSelection();
    const parent = selection?.anchorNode?.parentElement;
    return {
      collapsed: selection?.isCollapsed,
      id: parent?.closest('.bn-block-outer[data-id]')?.getAttribute('data-id'),
      type: parent?.closest('.bn-block-content')?.getAttribute('data-content-type'),
      editorFocused: Boolean(document.activeElement?.closest('.bn-editor')),
    };
  });
}
async function clickBelow(page, articlePadding = false) {
  const canvas = page.locator('.page-block-editor');
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((node, padding) => {
    const rect = node.getBoundingClientRect();
    const groups = node.querySelector('.bn-editor > .bn-block-group');
    const last = groups?.lastElementChild?.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: padding ? rect.bottom + 24 : Math.min(rect.bottom - 24, (last?.bottom ?? rect.top) + 40),
    };
  }, articlePadding);
  await page.evaluate((point) => scrollBy(0, Math.max(0, point.y - innerHeight + 80)), point);
  const adjusted = await canvas.boundingBox();
  const y = articlePadding
    ? adjusted.y + adjusted.height + 24
    : await canvas.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const last = node
          .querySelector('.bn-editor > .bn-block-group')
          ?.lastElementChild?.getBoundingClientRect();
        return Math.min(rect.bottom - 24, (last?.bottom ?? rect.top) + 40);
      });
  if (page.viewportSize().width < 800)
    await page.touchscreen.tap(adjusted.x + adjusted.width / 2, y);
  else await page.mouse.click(adjusted.x + adjusted.width / 2, y);
}
async function check(label, action) {
  try {
    await action();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

try {
  for (const [width, colorScheme] of [
    [1440, 'light'],
    [390, 'light'],
    [1440, 'dark'],
    [320, 'dark'],
  ]) {
    const context = await app.browser.newContext({
      viewport: { width, height: 900 },
      colorScheme,
      hasTouch: width < 800,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const suffix = `${width}-${colorScheme}`;
    await check(`ordinary cursor / real selection ${suffix}`, async () => {
      const id = await createDocument('선택과 입력', [
        {
          id: 'first',
          type: 'paragraph',
          props: {},
          content: text('일반 클릭으로 선택하지 않은 문장'),
          children: [],
        },
        { id: 'last', type: 'paragraph', props: {}, content: [], children: [] },
      ]);
      await page.goto(`${app.base}/pages/${id}`);
      const inline = page.locator('[data-id="first"] .bn-inline-content').first();
      await inline.click();
      await page.keyboard.press('End');
      await page.keyboard.insertText(' 입력');
      await page.getByText('서버 반영됨', { exact: true }).waitFor();
      assert.equal(
        await page.locator('.page-selection-tools').count(),
        0,
        'typing must not select its current block',
      );
      await page.keyboard.press('Shift+Home');
      assert.equal(await page.locator('.page-selection-tools').count(), 0);
      assert.equal(await page.locator('.page-selection-tools').count(), 0, 'selection must not insert a document banner');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => !document.querySelector('.page-selection-tools'));
      await clickPageTool(page, '선택 블록 이동');
      await page.locator('.page-inspector[aria-label="선택 블록 이동"]').waitFor();
      assert.match(await page.locator('.page-tools-selection').innerText(), /1/);
      await page.getByRole('button', { name: '선택 블록 이동 닫기', exact: true }).click();
      assert.equal(
        await page.locator('.page-selection-tools').count(),
        0,
        'closing a tool must not manufacture a selection',
      );
      await inline.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Home');
      assert.equal(await page.locator('.page-selection-tools').count(), 0);
      await clickBelow(page);
      await page.waitForFunction(() => !document.querySelector('.page-selection-tools'));
      assert.equal((await cursor(page)).id, 'last');
      await page.screenshot({ path: `${evidence}/caret-${suffix}.png` });
    });
    await check(`bottom canvas reuse / append ${suffix}`, async () => {
      const id = await createDocument('문서 아래에서 이어 쓰기', [
        {
          id: 'preserved',
          type: 'paragraph',
          props: {},
          content: text('보존할 첫 문장'),
          children: [],
        },
        {
          id: 'tail',
          type: 'heading',
          props: { level: 2 },
          content: text('마지막 제목'),
          children: [],
        },
      ]);
      await page.goto(`${app.base}/pages/${id}`);
      await page.locator('.bn-editor').waitFor();
      await page.locator('[data-id="preserved"] .bn-inline-content').first().click();
      await page.keyboard.press('End');
      const initialCount = await page
        .locator('.bn-editor > .bn-block-group > .bn-block-outer')
        .count();
      if (width === 1440) {
        const canvas = await page.locator('.page-block-editor').boundingBox();
        const x = canvas.x + canvas.width / 2,
          y = canvas.y + canvas.height - 50;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - 30, { steps: 4 });
        await page.mouse.up();
        assert.equal(
          await page.locator('.bn-editor > .bn-block-group > .bn-block-outer').count(),
          initialCount,
          'dragging the blank canvas must not append',
        );
      }
      await clickBelow(page);
      const focused = await cursor(page);
      assert.equal(
        focused.type,
        'paragraph',
        'blank canvas must put a caret in the last paragraph',
      );
      assert.equal(focused.collapsed, true);
      assert.equal(focused.editorFocused, true);
      assert.notEqual(
        focused.id,
        'preserved',
        'blank canvas must not leave the cursor in prior content',
      );
      const count = await page.locator('.bn-editor > .bn-block-group > .bn-block-outer').count();
      if (count > initialCount) {
        await page.keyboard.press('Meta+z');
        await page.waitForFunction(
          (id) => !document.querySelector(`[data-id="${id}"]`),
          focused.id,
        );
        await page.keyboard.press('Meta+Shift+z');
        await page.locator(`.bn-block-outer[data-id="${focused.id}"]`).waitFor();
      }
      await clickBelow(page);
      await clickBelow(page, true);
      assert.equal((await cursor(page)).id, focused.id, 'repeat clicks reuse the empty paragraph');
      assert.equal(
        await page.locator('.bn-editor > .bn-block-group > .bn-block-outer').count(),
        count,
      );
      await page.keyboard.insertText('아래 공간에서 이어 쓴 내용');
      await page.getByText('서버 반영됨', { exact: true }).waitFor();
      const saved = (await (await fetch(`${app.base}/api/pages/${id}`)).json()).item;
      assert.deepEqual(saved.document.blocks[0].content, text('보존할 첫 문장'));
      assert.equal(saved.document.blocks[1].id, 'tail');
      assert(
        saved.document.blocks
          .slice(2)
          .some((block) => JSON.stringify(block.content).includes('아래 공간에서 이어 쓴 내용')),
      );
      await page.screenshot({ path: `${evidence}/continued-${suffix}.png` });
      await page.getByRole('button', { name: '블록 댓글', exact: true }).click();
      const before = await page.locator('.bn-editor > .bn-block-group > .bn-block-outer').count();
      await clickBelow(page);
      assert.equal(
        await page.locator('.bn-editor > .bn-block-group > .bn-block-outer').count(),
        before,
        'comment mode must not append a paragraph',
      );
      await page.getByRole('button', { name: '댓글 닫기', exact: true }).click();
      if (width === 390) {
        await prepareShell(page);
        await context.setOffline(true);
        await clickBelow(page);
        await page.keyboard.insertText(' 오프라인 작성');
        await page.getByText('기기에 저장됨', { exact: true }).waitFor();
        await page.reload();
        await page.getByText('오프라인 작성', { exact: false }).first().waitFor();
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(
    'PASS editor canvas: ordinary caret/selection/tools, append/reuse, bottom padding, comments guard, offline, desktop/mobile light/dark',
  );
} finally {
  await app.close();
}
