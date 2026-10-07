import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { renderSharedPage } from '../server/publicPage.mjs';
const root = await mkdtemp(join(tmpdir(), 'leneu-attachments-'));
const evidence = resolve(process.env.QA_ATTACHMENT_EVIDENCE_DIR || '.omo/evidence/page-attachments');
await mkdir(evidence, { recursive: true });
const portServer = createServer();
await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: root,
    HOST: '127.0.0.1',
    PORT: String(port),
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'disabled',
    AI_RUNNER_URL: '',
    GOOGLE_MAPS_API_KEY: '',
  },
  stdio: 'pipe',
});
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const base = `http://127.0.0.1:${port}`;
let browser, publicServer;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/pages')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const created = await context.request.post(base + '/api/pages', {
    data: { title: '이미지와 자료 기록' },
  });
  assert.ok(created.ok(), await created.text());
  const record = (await created.json()).item;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#b9cead';
    x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#315843';
    x.fillRect(160, 120, 480, 360);
    x.fillStyle = '#f7fbf3';
    x.font = '42px sans-serif';
    x.fillText('IMAGE ORIGINAL', 215, 325);
    return c.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const imageFile = { name: 'landscape.png', mimeType: 'image/png', buffer: png };
  const textFile = {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('original attachment bytes'),
  };
  async function current() {
    return (await (await context.request.get(base + '/api/pages/' + record.id)).json()).item;
  }
  async function saved(check) {
    // A hard reload can leave the prior engine's fenced 30s lease until expiry.
    for (let i = 0; i < 400; i++) {
      const item = await current();
      if (check(item)) return item;
      await page.waitForTimeout(100);
    }
    assert.fail('Page update did not persist');
  }
  async function slashUpload(label, file) {
    await page.locator('.bn-editor').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await page.keyboard.insertText(label);
    const option = page.getByText(label, { exact: true }).filter({ visible: true }).last();
    await option.waitFor({ timeout: 5000 });
    const chooser = page.waitForEvent('filechooser');
    await option.click();
    await (await chooser).setFiles(file);
  }
  await page.goto(base + '/pages/' + record.id, { waitUntil: 'networkidle' });
  await slashUpload('이미지', imageFile);
  const first = page.locator('.page-attachment').first();
  await first.locator('img').waitFor();
  assert.equal(await first.locator('.page-attachment-file-link').count(), 0);
  assert.equal(await first.getByText('이미지에서 글자 읽기', { exact: true }).count(), 0);
  await saved((item) => item.document.blocks.some((b) => b.type === 'asset'));
  await page.reload({ waitUntil: 'networkidle' });
  await first.locator('img').waitFor();
  await first.hover();
  await first.getByRole('button', { name: '설명 추가' }).click();
  await first.getByRole('textbox', { name: '첨부 설명' }).fill('오후에 기록한 초록 풍경');
  await page.getByRole('textbox', { name: '페이지 제목' }).fill('이미지와 자료 기록 보완');
  await saved((item) => item.title === '이미지와 자료 기록 보완');
  assert.equal(
    await first.getByRole('textbox', { name: '첨부 설명' }).inputValue(),
    '오후에 기록한 초록 풍경',
    'caption draft survives sync',
  );
  await first.getByRole('button', { name: '저장', exact: true }).click();
  await saved((item) =>
    item.document.blocks.some((b) => b.props?.caption === '오후에 기록한 초록 풍경'),
  );
  await first.hover();
  await first.getByRole('button', { name: '자르기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '이미지 자르기' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '적용', exact: true }).waitFor();
  const handle = dialog.locator('.asset-crop-handle-se');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y - 90, { steps: 8 });
  await page.mouse.up();
  const width = Number(await dialog.getByRole('slider', { name: '영역 너비' }).inputValue());
  assert.ok(width < 0.95 && width > 0.05, 'pointer drag adjusts crop');
  await page.screenshot({ path: join(evidence, 'desktop-crop.png'), fullPage: true });
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(
    (await current()).document.blocks.find((b) => b.type === 'asset').props.crop || '',
    '',
  );
  await first.hover();
  await first.getByRole('button', { name: '자르기', exact: true }).click();
  await dialog.getByRole('slider', { name: '영역 너비' }).fill('0.6');
  await dialog.getByRole('slider', { name: '영역 높이' }).fill('0.6');
  await dialog.getByRole('slider', { name: '가로 위치' }).fill('0.2');
  await dialog.getByRole('slider', { name: '세로 위치' }).fill('0.2');
  await dialog.getByRole('button', { name: '적용', exact: true }).click();
  let item = await saved((item) => item.document.blocks.some((b) => b.props?.crop));
  const image = item.document.blocks.find((b) => b.type === 'asset');
  const crop = JSON.parse(image.props.crop);
  assert.equal(crop.width, 0.6);
  assert.equal(crop.imageWidth, 800);
  assert.equal(crop.imageHeight, 600);
  await page.reload({ waitUntil: 'networkidle' });
  await first.locator('.page-attachment-cropped').waitFor();
  assert.equal(
    await first.locator('.page-attachment-caption').innerText(),
    '오후에 기록한 초록 풍경',
  );
  assert.equal(await first.locator('.page-attachment-caption').evaluate(node => getComputedStyle(node).textAlign), 'center');
  await first.hover();
  const download = page.waitForEvent('download');
  await first.getByRole('link', { name: '내려받기', exact: true }).click();
  const bytes = await readFile(await (await download).path());
  assert.deepEqual(bytes, png);
  await slashUpload('파일', textFile);
  await page.getByText('notes.txt', { exact: true }).first().waitFor();
  const fileView = page.locator('.page-asset-file').first();
  assert.equal(await fileView.locator('.page-attachment-preview').count(), 0);
  assert.equal(await fileView.locator('.page-attachment-toolbar').count(), 0);
  assert.equal(await fileView.getByRole('button', { name: /설명/ }).count(), 0);
  item = await saved((item) => item.document.blocks.filter((b) => b.type === 'asset').length === 2);
  const file = item.document.blocks.find((b) => b.type === 'asset' && b.props.display === 'file');
  assert.ok(file);
  assert.deepEqual(
    await (await context.request.get(base + '/api/assets/' + file.props.assetId)).body(),
    textFile.buffer,
  );
  // Exercise clipboard files without relying on operating-system clipboard permissions.
  await page.locator('.page-block-editor').evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['pasted original'], 'pasted.txt', { type: 'text/plain' }));
    node.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.getByText('pasted.txt', { exact: true }).first().waitFor();
  await saved((item) => item.document.blocks.filter((b) => b.type === 'asset').length === 3);
  await page.locator('.page-block-editor').evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['dropped original'], 'dropped.txt', { type: 'text/plain' }));
    node.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.getByText('dropped.txt', { exact: true }).first().waitFor();
  item = await saved((item) => item.document.blocks.filter((b) => b.type === 'asset').length === 4);
  await first.hover();
  await page.waitForFunction(() => !document.querySelector('.page-resource-state'));
  await page.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true });
  const assets = new Map();
  for (const block of item.document.blocks.filter((b) => b.type === 'asset'))
    assets.set(
      block.props.assetId,
      (
        await (
          await context.request.get(base + '/api/assets/' + block.props.assetId + '/info')
        ).json()
      ).item,
    );
  const html = renderSharedPage(item, 'qa-token', assets);
  await writeFile(join(evidence, 'shared.html'), html);
  const shareResponse = await context.request.post(base + '/api/pages/' + record.id + '/shares', {
    data: { expiresInDays: 30 },
  });
  assert.ok(shareResponse.ok(), await shareResponse.text());
  const share = await shareResponse.json();
  const publicPortServer = createServer();
  await new Promise((r) => publicPortServer.listen(0, '127.0.0.1', r));
  const publicPort = publicPortServer.address().port;
  await new Promise((r) => publicPortServer.close(r));
  publicServer = spawn(process.execPath, ['server/public.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: root,
      PUBLIC_HOST: '127.0.0.1',
      PUBLIC_PORT: String(publicPort),
    },
    stdio: 'pipe',
  });
  publicServer.stderr.on('data', (b) => (log += b));
  const sharedUrl = `http://127.0.0.1:${publicPort}/s/${share.token}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(sharedUrl)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const shared = await context.newPage();
  await shared.goto(sharedUrl, { waitUntil: 'networkidle' });
  assert.doesNotMatch(await shared.locator('main').innerText(), /NaN|undefined/);
  assert.match(await shared.locator('main').innerText(), /1 KB/);
  const sharedImage = shared.locator('.shared-image-attachment').first();
  assert.equal(await sharedImage.locator('figcaption a').count(), 0);
  assert.equal(await sharedImage.locator('figcaption').evaluate(node => getComputedStyle(node).textAlign), 'center');
  await shared.locator('main img').waitFor();
  assert.equal(
    await shared.locator('main figure').first().locator('p').innerText(),
    '오후에 기록한 초록 풍경',
  );
  assert.deepEqual(
    await (await context.request.get(sharedUrl + '/assets/' + image.props.assetId)).body(),
    png,
  );
  assert.equal(
    (await context.request.get(`http://127.0.0.1:${publicPort}/api/pages`)).status(),
    404,
  );
  await shared.screenshot({ path: join(evidence, 'shared-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await first.scrollIntoViewIfNeeded();
  assert.ok(await first.getByRole('button', { name: /첨부 메뉴/ }).isVisible());
  await page.screenshot({ path: join(evidence, 'mobile.png'), fullPage: true });
  assert.equal(await first.getByRole('button', { name: '자르기', exact: true }).isVisible(), false);
  await first.getByRole('button', { name: /첨부 메뉴/ }).click();
  await first.getByRole('button', { name: '자르기', exact: true }).click();
  await dialog.waitFor();
  await page.screenshot({ path: join(evidence, 'mobile-crop.png'), fullPage: true });
  await dialog.getByRole('button', { name: '원본 영역으로 초기화' }).click();
  assert.equal(await dialog.getByRole('slider', { name: '영역 너비' }).inputValue(), '1');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.locator('.page-info>summary').click();
  await page.getByRole('button', { name: '이 페이지 오프라인 보관', exact: true }).click();
  await page.getByText('문서·직접 첨부 오프라인 사용 가능', { exact: true }).waitFor();
  await page.locator('.page-info>summary').click();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await first.locator('.page-attachment-cropped img').waitFor();
  assert.equal(await first.locator('img').evaluate((node) => node.naturalWidth), 800);
  await first.getByRole('button', { name: /첨부 메뉴/ }).click();
  await first.getByRole('button', { name: '설명 편집', exact: true }).click();
  await first.getByRole('textbox', { name: '첨부 설명' }).fill('오프라인에서 보완한 풍경');
  await first.getByRole('button', { name: '저장', exact: true }).click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('오프라인에서 보완한 풍경', { exact: true }).waitFor();
  await first.getByRole('button', { name: /첨부 메뉴/ }).click();
  const offlineDownload = page.waitForEvent('download');
  await first.getByRole('link', { name: '내려받기', exact: true }).click();
  assert.deepEqual(await readFile(await (await offlineDownload).path()), png);
  await context.setOffline(false);
  item = await saved((item) =>
    item.document.blocks.some((b) => b.props?.caption === '오프라인에서 보완한 풍경'),
  );
  const lock = await context.request.put(base + '/api/pages/' + record.id + '/lock', {
    data: { locked: true, expectedLockVersion: 0, expectedVersion: item.version },
  });
  assert.ok(lock.ok(), await lock.text());
  await page.reload({ waitUntil: 'networkidle' });
  await first.locator('img').waitFor();
  assert.equal(await first.getByRole('button', { name: '자르기', exact: true }).count(), 0);
  assert.equal(await first.getByRole('button', { name: /설명 (편집|추가)/ }).count(), 0);
  await first.getByRole('button', { name: /첨부 메뉴/ }).click();
  assert.ok(await first.getByRole('link', { name: '내려받기', exact: true }).isVisible());
  const before = await current();
  await page.locator('.page-block-editor').evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['locked'], 'blocked.txt', { type: 'text/plain' }));
    node.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(300);
  assert.deepEqual((await current()).document, before.document);
  await page.screenshot({ path: join(evidence, 'mobile-locked.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'no mobile horizontal overflow',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'REPORT.md'),
    '# Page attachments QA\n\nPassed with temporary data and headless Chrome.\n\n- /이미지 and /파일 choose and upload original bytes through existing page asset UUID API.\n- Reload retains image and file references, caption and crop.\n- Pointer crop resize; keyboard sliders; cancel/reset/apply.\n- Original download matches uploaded PNG byte for byte after crop.\n- Clipboard and drop each append one file reference.\n- Shared renderer preserves caption/crop and scoped original links. Offline ZIP uses the same renderer (unit tests pass).\n- Mobile toolbar and crop controls visible; no horizontal overflow.\n- Locked page hides caption/crop controls, preserves download and ignores dropped files.\n- No uncaught browser errors.\n\nScreenshots: desktop, desktop-crop, shared-desktop, mobile, mobile-crop, mobile-locked.\n',
  );
  console.log('Page attachments QA passed. Evidence: ' + evidence);
} catch (error) {
  console.error(log);
  const diagnostic = browser?.contexts()[0]?.pages().find(p => p.url().includes('/pages/'));
  if (diagnostic) {
    console.error((await diagnostic.locator('body').innerText()).slice(-5000));
    await diagnostic.screenshot({path: join(evidence, 'failure.png')});
  }
  throw error;
} finally {
  await browser?.close();
  publicServer?.kill('SIGTERM');
  server.kill('SIGTERM');
  await rm(root, { recursive: true, force: true });
}
