import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { clickPageTool } from './qa-page-tools.mjs';
const dir = await mkdtemp(join(tmpdir(), 'anotar-document-productivity-')),
  evidence = '.omo/evidence/document-productivity';
await mkdir(evidence, { recursive: true });
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dir,
    BACKUP_DIR: dir + '-backups',
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'disabled',
    GEOAPIFY_API_KEY: '',
    GOOGLE_MAPS_DEMO_KEY: '',
  },
  stdio: 'ignore',
});
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok, await response.clone().text());
  return response.json();
}
async function savedUntil(id, check) {
  for (let n = 0; n < 100; n++) {
    const value = (await api('/api/pages/' + id)).item;
    if (check(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Saved document did not reach expected state');
}
const paragraph = (text = '') => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children: [],
});
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const target = (await api('/api/pages', 'POST', { title: '관련 자료' })).item;
  let source = (await api('/api/pages', 'POST', { title: '검토 이전' })).item;
  const first = paragraph('처음 작성한 내용');
  source = (
    await api('/api/pages/' + source.id, 'PUT', {
      title: '검토 문서',
      expectedVersion: source.version,
      document: {
        schemaVersion: 1,
        blocks: [
          { ...first, content: [{ type: 'text', text: '수정한 본문', styles: {} }] },
          paragraph(),
        ],
      },
    })
  ).item;
  const rejected = await fetch(base + '/api/bookmarks/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:1/private' }),
  });
  assert.equal(rejected.status, 422);
  for (const [width, colorScheme] of [
    [1440, 'light'],
    [390, 'light'],
    [1440, 'dark'],
    [320, 'dark'],
  ]) {
    if (width !== 1440 || colorScheme !== 'light') {
      source = (await api('/api/pages', 'POST', { title: '검토 이전' })).item;
      source = (
        await api('/api/pages/' + source.id, 'PUT', {
          title: '검토 문서',
          expectedVersion: source.version,
          document: {
            schemaVersion: 1,
            blocks: [
              { ...first, content: [{ type: 'text', text: '수정한 본문', styles: {} }] },
              paragraph(),
            ],
          },
        })
      ).item;
    }
    const suffix = colorScheme === 'light' ? String(width) : `${width}-${colorScheme}`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const editorRequests = [];
    page.on('request', (request) => {
      if (/\/api\/pages\/search|\/backlinks/.test(request.url()))
        editorRequests.push(request.url());
    });
    await page.route('**/api/bookmarks/preview', (route) =>
      route.fulfill({
        json: {
          item: {
            url: 'https://example.org/read',
            title: '여행 준비 안내',
            description: '출발부터 귀국까지 확인할 내용을 정리한 공식 안내입니다.',
            imageData: '',
          },
        },
      }),
    );
    await page.goto(base + '/pages/' + target.id + '?commentBlock=private&aiJob=private#section');
    await page.locator('.bn-editor').waitFor();
    await clickPageTool(page, '페이지 링크 복사');
    await page
      .getByText('페이지 링크를 복사했어요. 다른 문서에 붙여넣어 연결할 수 있어요.', {
        exact: true,
      })
      .waitFor();
    const copiedAddress = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copiedAddress, `${base}/pages/${target.id}`);
    await page.goto(base + '/pages/' + source.id);
    await page.locator('.bn-editor').waitFor();
    assert.equal(
      await page.locator('.page-connections').count(),
      0,
      'pages must not render an automatic backlinks footer',
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), colorScheme);
    await page.getByText('수정한 본문', { exact: true }).first().waitFor();
    const block = page.locator('.bn-block-content[data-content-type="paragraph"]').last();
    await block.click();
    await block.evaluate((node) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'https://example.org/read');
      node.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      );
    });
    const choice = page.getByRole('dialog', { name: 'URL 붙여넣기 방식' });
    await choice.waitFor();
    await page.screenshot({ path: `${evidence}/url-choice-${suffix}.png` });
    await choice.getByRole('button', { name: /^북마크/ }).click();
    await page.locator('.saved-bookmark strong').filter({ hasText: '여행 준비 안내' }).waitFor();
    assert.equal(
      await page.locator('.bn-formatting-toolbar').isVisible(),
      false,
      'bookmark must not expose file actions',
    );
    await page.waitForFunction(
      () => document.querySelector('.page-save-state')?.textContent === '서버 반영됨',
    );
    const current = await savedUntil(source.id, (value) =>
      value.document.blocks.some((b) => b.type === 'bookmark'),
    );
    assert(current.document.blocks.some((b) => b.type === 'bookmark'));
    await page.getByText('수정한 본문', { exact: true }).first().waitFor();
    assert(
      JSON.stringify(current.document).includes('수정한 본문'),
      'bookmark paste must preserve surrounding text',
    );
    await page.locator('.page-title-input').click();
    assert.equal(
      await page.locator('.page-selection-tools').count(),
      0,
      'outside click must clear block actions',
    );
    await page.getByText('수정한 본문', { exact: true }).first().waitFor();
    if (process.env.QA_DOCUMENT_DIAGNOSTICS === '1') {
      console.log(
        JSON.stringify({
          width,
          colorScheme,
          blocks: await page.locator('.bn-editor .bn-block-content').evaluateAll((nodes) =>
            nodes.map((node) => ({
              text: node.textContent,
              type: node.getAttribute('data-content-type'),
              rect: node.getBoundingClientRect().toJSON(),
              display: getComputedStyle(node).display,
              visibility: getComputedStyle(node).visibility,
            })),
          ),
        }),
      );
    }
    await page.screenshot({ path: `${evidence}/bookmark-${suffix}.png` });
    await page
      .locator('.bookmark-actions')
      .getByRole('button', { name: '일반 링크로' })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelector('.page-save-state')?.textContent === '서버 반영됨',
    );
    const converted = await savedUntil(
      source.id,
      (value) => !value.document.blocks.some((b) => b.type === 'bookmark'),
    );
    assert(!converted.document.blocks.some((b) => b.type === 'bookmark'));
    if (width === 1440 && colorScheme === 'light') {
      await page.locator(`[data-id="${first.id}"] .bn-block-content`).hover();
      await page.getByRole('button', { name: '블록 메뉴 열기', exact: true }).click();
      await page.getByRole('menuitem', { name: '블록 복제', exact: true }).click();
      const duplicated = await savedUntil(
        source.id,
        (value) =>
          value.document.blocks.filter((b) => JSON.stringify(b.content).includes('수정한 본문'))
            .length === 2,
      );
      const copy = duplicated.document.blocks.find(
        (b) => b.id !== first.id && JSON.stringify(b.content).includes('수정한 본문'),
      );
      await page.locator(`[data-id="${copy.id}"] .bn-block-content`).hover();
      await page.getByRole('button', { name: '블록 메뉴 열기', exact: true }).click();
      await page.getByRole('menuitem', { name: '블록 유형 변경', exact: true }).hover();
      await page.getByRole('menuitem', { name: '제목 2', exact: true }).click();
      await savedUntil(source.id, (value) =>
        value.document.blocks.some(
          (b) => b.id === copy.id && b.type === 'heading' && b.props.level === 2,
        ),
      );
      await page.keyboard.press('Meta+z');
      await savedUntil(source.id, (value) =>
        value.document.blocks.some((b) => b.id === copy.id && b.type === 'paragraph'),
      );
      await page.keyboard.press('Meta+Shift+z');
      await savedUntil(source.id, (value) =>
        value.document.blocks.some((b) => b.id === copy.id && b.type === 'heading'),
      );
    }
    // Existing commands and ordinary @ input remain independent of page links.
    await page
      .locator('.bn-block-content[data-content-type="paragraph"] .bn-inline-content')
      .last()
      .evaluate((node) => {
        node.closest('.bn-editor').focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    await page.keyboard.press('Enter');
    const linkParagraph = {
      id: await page
        .locator('.bn-block-content[data-content-type="paragraph"]')
        .last()
        .evaluate((node) => node.closest('[data-id]').getAttribute('data-id')),
    };
    await page.keyboard.type('/');
    await page.getByRole('option', { name: /^제목\s*1/ }).waitFor();
    assert.equal(await page.getByRole('option', { name: /관련 자료/ }).count(), 0);
    await page.getByRole('option', { name: /^제목\s*1/ }).click();
    await savedUntil(source.id, (value) =>
      value.document.blocks.some(
        (block) =>
          block.id === linkParagraph.id && block.type === 'heading' && block.props.level === 1,
      ),
    );
    await page.keyboard.type('/');
    await page.getByRole('option', { name: /^본문/ }).click();
    await savedUntil(source.id, (value) =>
      value.document.blocks.some(
        (block) => block.id === linkParagraph.id && block.type === 'paragraph',
      ),
    );
    await page.keyboard.type('@');
    assert.equal(await page.getByRole('option', { name: /관련 자료/ }).count(), 0);
    await page.keyboard.press('Backspace');
    await page
      .locator(`[data-id="${linkParagraph.id}"] .bn-block-content`)
      .evaluate((node, address) => {
        const data = new DataTransfer();
        data.setData('text/plain', address);
        node.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
        );
      }, copiedAddress);
    await page.getByRole('dialog', { name: 'URL 붙여넣기 방식' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^북마크/ }).count(), 0);
    await page.getByRole('button', { name: /^페이지 링크/ }).click();
    const linked = await savedUntil(source.id, (value) =>
      value.document.blocks.some(
        (block) =>
          block.id === linkParagraph.id &&
          block.type === 'page' &&
          block.props.pageId === target.id,
      ),
    );
    assert(JSON.stringify(linked.document).includes('수정한 본문'));
    const pageLink = page.locator(`.page-link-block[href="/pages/${target.id}"]`);
    await pageLink.getByText('관련 자료', { exact: true }).waitFor();
    await page.screenshot({ path: `${evidence}/page-link-${suffix}.png` });
    await pageLink.click();
    await page.waitForFunction(
      () => document.querySelector('.page-title-input')?.value === '관련 자료',
    );
    assert(page.url().endsWith(`/pages/${target.id}`));
    assert.equal(await page.locator('.page-connections').count(), 0);
    assert.equal(
      editorRequests.length,
      0,
      'editing commands must not search pages or poll backlinks',
    );
    await page.goto(base + '/pages/' + source.id);
    await page.locator('.bn-editor').waitFor();
    await clickPageTool(page, '수정 이력');
    await page.getByRole('button', { name: '현재와 비교', exact: true }).waitFor();
    const select = page.getByLabel('수정본', { exact: true });
    const options = await select.locator('option').all();
    await select.selectOption(await options[options.length - 1].getAttribute('value'));
    await page.locator('.page-revision-diff').waitFor();
    await page.screenshot({ path: `${evidence}/revision-diff-${suffix}.png` });
    await page.getByRole('button', { name: '수정본 전체', exact: true }).click();
    await page.getByRole('article', { name: /읽기 전용 내용/ }).waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await context.close();
  }
  console.log(
    'URL bookmark/convert, copied page link/paste/navigation, slash commands and plain @, no backlinks footer/search, history comparison/snapshot, 1440/390 light + 1440/320 dark: PASS',
  );
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
  await rm(dir + '-backups', { recursive: true, force: true });
}
