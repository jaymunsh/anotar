import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const dataDir = await mkdtemp(join(tmpdir(), 'leneu-sc-'));
const ownerPort = await freePort(),
  publicPort = await freePort();
const owner = 'http://127.0.0.1:' + ownerPort,
  shared = 'http://127.0.0.1:' + publicPort;
const socketPath = join(dataDir, 'comments.sock');
const env = {
  ...process.env,
  DATA_DIR: dataDir,
  HOST: '127.0.0.1',
  PORT: String(ownerPort),
  PUBLIC_HOST: '127.0.0.1',
  PUBLIC_PORT: String(publicPort),
  PUBLIC_SHARE_ORIGIN: shared,
  COMMENT_SOCKET_PATH: socketPath,
  AI_RUNNER_KIND: 'disabled',
  GOOGLE_MAPS_DEMO_KEY: '',
  BACKUP_DIR: join(dataDir, 'backups'),
};
const children = [];
let output = '';
let browser;
function start(file) {
  const c = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => (output += d));
  c.stderr.on('data', (d) => (output += d));
  children.push(c);
  return c;
}
async function waitHealth(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Startup failed: ' + output);
}
async function json(url, body, method = 'POST') {
  const r = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(url.startsWith(shared) ? { Origin: shared } : {}),
    },
    body: JSON.stringify(body),
  });
  const b = await r.json();
  assert.ok(r.ok, JSON.stringify(b));
  return b;
}
try {
  start('server/index.mjs');
  await waitHealth(owner + '/api/health');
  start('server/public.mjs');
  await waitHealth(shared + '/health');
  const { item } = await json(owner + '/api/pages', { title: '함께 검토하는 하루 계획' });
  const blocks = [
    {
      id: crypto.randomUUID(),
      type: 'paragraph',
      props: {},
      content: [
        { type: 'text', text: '오전에는 전시를 보고, 오후에는 골목을 천천히 걸어요.', styles: {} },
      ],
      children: [],
    },
  ];
  const draftBlock = {
    ...blocks[0],
    id: crypto.randomUUID(),
    content: [{ type: 'text', text: '저녁 식사 장소도 함께 정해요.', styles: {} }],
  };
  blocks.push(draftBlock);
  await json(
    owner + '/api/pages/' + item.id,
    { title: item.title, expectedVersion: item.version, document: { schemaVersion: 1, blocks } },
    'PUT',
  );
  const before = (await (await fetch(owner + '/api/pages/' + item.id)).json()).item;
  const { token, item: link } = await json(owner + '/api/pages/' + item.id + '/shares', {
    expiresInDays: 1,
    commentsEnabled: true,
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await visitor.emulateMedia({ colorScheme: 'dark' });
  const errors = [];
  visitor.on('pageerror', (e) => errors.push(e.message));
  await visitor.goto(shared + '/s/' + token, { waitUntil: 'networkidle' });
  const mode = visitor.getByRole('combobox', { name: '화면 모드' });
  await mode.waitFor({ timeout: 2000 });
  assert.equal(await mode.inputValue(), 'light');
  assert.equal(
    await visitor.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  await mode.selectOption('dark');
  assert.equal(
    await visitor.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'dark',
  );
  await visitor.reload({ waitUntil: 'networkidle' });
  assert.equal(await mode.inputValue(), 'dark');
  await mode.selectOption('light');
  assert.equal(
    await visitor.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  await mode.selectOption('system');
  assert.equal(await visitor.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await visitor.emulateMedia({ colorScheme: 'light' });
  await visitor.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const blockBeforeOpen = await visitor.locator('[data-comment-block-id]').first().boundingBox();
  const scrollBeforeOpen = await visitor.evaluate(() => ({ x: scrollX, y: scrollY }));
  await visitor.locator('[data-comment-block-id]').first().hover();
  await visitor.getByRole('button', { name: '블록에 댓글 달기' }).first().click();
  const blockAfterOpen = await visitor.locator('[data-comment-block-id]').first().boundingBox();
  assert.equal(
    blockAfterOpen.x,
    blockBeforeOpen.x,
    'Opening comments must not move the block horizontally',
  );
  assert.equal(
    blockAfterOpen.y,
    blockBeforeOpen.y,
    'Opening comments must not move the block vertically',
  );
  assert.equal(
    blockAfterOpen.width,
    blockBeforeOpen.width,
    'Opening comments must not reflow the block',
  );
  assert.deepEqual(await visitor.evaluate(() => ({ x: scrollX, y: scrollY })), scrollBeforeOpen);
  await visitor.getByRole('button', { name: '댓글 닫기', exact: true }).click();
  const blockAfterClose = await visitor.locator('[data-comment-block-id]').first().boundingBox();
  assert.equal(blockAfterClose.x, blockBeforeOpen.x);
  assert.equal(blockAfterClose.width, blockBeforeOpen.width);
  await visitor.getByRole('button', { name: '블록에 댓글 달기' }).first().click();
  await visitor.getByRole('textbox', { name: '이름', exact: true }).fill('민지');
  await visitor
    .getByRole('textbox', { name: '댓글 입력', exact: true })
    .fill('비가 오면 실내 일정으로 바꾸면 어떨까요?');
  await visitor.getByRole('button', { name: '댓글 남기기', exact: true }).click();
  await visitor.getByText('비가 오면 실내 일정으로 바꾸면 어떨까요?', { exact: true }).waitFor();
  const received = (await (await fetch(shared + '/s/' + token + '/comments')).json()).items;
  assert.equal(received[0].comments[0].name, '민지');
  assert.equal(received[0].comments[0].isOwner, false);
  const ownerPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  ownerPage.on('pageerror', (e) => errors.push(e.message));
  await ownerPage.goto(owner + '/pages/' + item.id, { waitUntil: 'networkidle' });
  await ownerPage.getByRole('button', { name: '블록 댓글', exact: true }).click();
  await ownerPage.getByRole('button', { name: '공유 댓글', exact: true }).click();
  await ownerPage.locator('.page-comment-thread-list button').click();
  await ownerPage.locator('.page-comment-author').filter({ hasText: '민지' }).waitFor();
  await ownerPage
    .getByRole('textbox', { name: '답글 입력' })
    .fill('좋아요. 전시 시간을 넉넉히 잡아둘게요.');
  await ownerPage.getByRole('button', { name: '답글 등록' }).click();
  await ownerPage.getByText('작성자', { exact: true }).waitFor();
  await ownerPage
    .getByRole('button', { name: '댓글 새로고침', exact: true })
    .click({ timeout: 2000 });
  await visitor.getByRole('button', { name: '댓글 새로고침', exact: true }).click();
  await visitor.getByText('좋아요. 전시 시간을 넉넉히 잡아둘게요.', { exact: true }).waitFor();
  const emptyGap = await visitor.evaluate(() => {
    const messages = [...document.querySelectorAll('.share-comments-message')];
    return (
      document.querySelector('.share-comments-composer').getBoundingClientRect().top -
      messages.at(-1).getBoundingClientRect().bottom
    );
  });
  assert.ok(
    emptyGap <= 48,
    'Short conversations must not leave a large blank area above the composer',
  );
  await visitor.reload({ waitUntil: 'networkidle' });
  await visitor
    .getByRole('button', { name: /댓글 2개/ })
    .first()
    .click();
  await visitor.getByText('좋아요. 전시 시간을 넉넉히 잡아둘게요.', { exact: true }).waitFor();
  assert.equal(
    await visitor.getByRole('textbox', { name: '이름', exact: true }).inputValue(),
    '민지',
  );
  // A block draft must remain available after someone else starts its conversation.
  const draftTarget = visitor.locator('[data-comment-block-id="' + draftBlock.id + '"]');
  await draftTarget.hover();
  await draftTarget.getByRole('button', { name: '블록에 댓글 달기', exact: true }).click();
  const unsent = '아직 등록하지 않은 첫 댓글 초안입니다.';
  await visitor.getByRole('textbox', { name: '댓글 입력', exact: true }).fill(unsent);
  await json(
    shared + '/s/' + token + '/comments',
    {
      requestId: crypto.randomUUID(),
      action: 'create',
      blockId: draftBlock.id,
      name: '수진',
      text: '이곳은 어떨까요?',
    },
    'POST',
  );
  // A 409 refresh runs while sending is still true; preserve the same draft as a reply.
  await visitor.getByRole('button', { name: '댓글 남기기', exact: true }).click();
  await visitor.getByRole('textbox', { name: '답글 입력' }).waitFor();
  assert.equal(await visitor.getByRole('textbox', { name: '답글 입력' }).inputValue(), unsent);
  await visitor.reload({ waitUntil: 'networkidle' });
  await draftTarget.getByRole('button', { name: /댓글 1개/ }).click();
  assert.equal(await visitor.getByRole('textbox', { name: '답글 입력' }).inputValue(), unsent);
  await visitor.reload({ waitUntil: 'networkidle' });
  await draftTarget.getByRole('button', { name: /댓글 1개/ }).click();
  assert.equal(await visitor.getByRole('textbox', { name: '답글 입력' }).inputValue(), unsent);
  const evidence = '.omo/evidence/shared-comments';
  await mkdir(evidence, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await visitor.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const colorScheme of ['light', 'dark']) {
      await visitor.emulateMedia({ colorScheme });
      await visitor.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await visitor.waitForFunction(() => {
        const panel = document.querySelector('.share-comments-panel').getBoundingClientRect();
        const submit = document.querySelector('.share-comments-submit').getBoundingClientRect();
        return panel.bottom <= innerHeight + 1 && submit.bottom <= panel.bottom + 1;
      });
      const gutterGap = await visitor
        .locator('[data-comment-block-id]')
        .first()
        .evaluate(
          (el) =>
            el.querySelector(':scope > .share-comments-bubble').getBoundingClientRect().left -
            el.getBoundingClientRect().right,
        );
      assert.ok(gutterGap >= 12, 'Comment bubble must have at least 12px of separate gutter');
      assert.equal(
        await visitor.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await visitor.screenshot({
        path: join(evidence, `public-${width}-${colorScheme}.png`),
        animations: 'disabled',
      });
    }
  }
  // Long conversations scroll inside the panel, keeping the composer visible.
  for (let i = 0; i < 6; i++) {
    const current = (
      await (await fetch(owner + '/api/pages/' + item.id + '/shared-comments')).json()
    ).items.find((t) => t.id === received[0].id);
    await json(owner + '/api/pages/' + item.id + '/shared-comments', {
      requestId: crypto.randomUUID(),
      action: 'reply',
      threadId: current.id,
      expectedVersion: current.version,
      text: '긴 대화에서도 입력란은 계속 보여야 해요. '.repeat(24),
    });
  }
  await visitor.setViewportSize({ width: 1440, height: 520 });
  await visitor.getByRole('button', { name: '댓글 닫기', exact: true }).click();
  await visitor
    .locator('[data-comment-block-id]')
    .first()
    .getByRole('button', { name: /댓글 2개/ })
    .click();
  await Promise.all([
    visitor.waitForResponse((r) => r.url().endsWith('/comments') && r.request().method() === 'GET'),
    visitor.getByRole('button', { name: '댓글 새로고침', exact: true }).click(),
  ]);
  await visitor.waitForFunction(() => {
    const body = document.querySelector('.share-comments-body');
    const submit = document.querySelector('.share-comments-submit').getBoundingClientRect();
    return body.scrollHeight > body.clientHeight && submit.bottom <= innerHeight;
  });
  await Promise.all([
    ownerPage.waitForResponse(
      (r) => r.url().endsWith('/shared-comments') && r.request().method() === 'GET',
    ),
    ownerPage.getByRole('button', { name: '댓글 새로고침', exact: true }).click(),
  ]);
  await ownerPage.getByRole('button', { name: '해결', exact: true }).click();
  await ownerPage.getByRole('button', { name: '다시 열기' }).waitFor();
  await ownerPage.getByRole('button', { name: '다시 열기' }).click();
  await ownerPage.getByRole('textbox', { name: '답글 입력' }).waitFor();
  await ownerPage.getByRole('button', { name: '개인 댓글', exact: true }).click();
  assert.equal(
    await ownerPage.locator('.page-comment-author').filter({ hasText: '민지' }).count(),
    0,
  );
  await ownerPage.getByRole('button', { name: '댓글 패널 닫기' }).click();
  await ownerPage.getByRole('button', { name: '페이지 공유', exact: true }).click();
  const policy = ownerPage.getByRole('checkbox', { name: '방문자 댓글 허용' });
  await ownerPage.waitForFunction(
    () => document.querySelector('.page-share-comment-policy input')?.checked,
  );
  await Promise.all([
    ownerPage.waitForResponse(
      (r) => r.url().endsWith('/shares/' + link.id) && r.request().method() === 'PATCH' && r.ok(),
    ),
    policy.click(),
  ]);
  await ownerPage.waitForFunction(
    () => !document.querySelector('.page-share-comment-policy input')?.checked,
  );
  await visitor.reload({ waitUntil: 'networkidle' });
  assert.equal(await visitor.locator('[data-share-comments]').count(), 0);
  assert.equal((await fetch(shared + '/s/' + token + '/comments')).status, 404);
  const after = (await (await fetch(owner + '/api/pages/' + item.id)).json()).item;
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  console.log(
    'Shared comments QA passed: named guest, author reply, persisted name, concurrent block-to-thread draft recovery, privacy tabs, resolve/reopen, policy disable, six responsive/theme captures, original unchanged.',
  );
  await writeFile(
    join(evidence, 'browser.log'),
    'PASS: named guest/author/persistence/concurrent draft recovery/privacy/resolve/policy/1440/390/320/light/dark.\n',
  );
} finally {
  await browser?.close();
  for (const c of children) c.kill('SIGTERM');
  console.log('Temporary data:', dataDir);
}
