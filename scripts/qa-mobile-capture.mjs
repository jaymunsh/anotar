import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function postShare(page, content) {
  const target = await page.evaluate(async (content) => {
    const form = new FormData();
    for (const key of ['title', 'text', 'url']) if (content[key] !== undefined) form.set(key, content[key]);
    for (const file of content.files ?? []) form.append('files', new File([file.bytes], file.name, { type: file.type }));
    const response = await fetch('/capture/share', { method: 'POST', body: form });
    return response.url;
  }, content);
  await page.goto(target, { waitUntil: 'networkidle' });
  return target;
}

async function pendingCount(page) {
  return page.evaluate(async () => (await (await import('/capture-store.js')).listPendingShares()).length);
}

async function captureDraft(page) {
  return page.evaluate(() => {
    const session = sessionStorage.getItem('leneu:draft-session:v1');
    return JSON.parse(localStorage.getItem(`leneu:capture-draft:v1:${session}`) || 'null');
  });
}

async function chooseCaptureKind(page, name) {
  const tab = page.locator('.composer-tabs').getByRole('tab', { name, exact: true });
  if (!(await tab.isVisible())) await page.locator('.composer-options > summary').click();
  await tab.click();
}

export async function runMobileCaptureQa(browser, baseUrl, evidenceDir = '.omo/evidence/migration-ready/mobile') {
  await mkdir(evidenceDir, { recursive: true });
  const results = [];
  const manifest = await (await fetch(`${baseUrl}/capture.webmanifest`)).json();
  assert.equal(manifest.share_target.action, '/capture/share');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.equal(manifest.start_url, '/capture');
  for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, baseUrl))).status, 200);
  const rawForm = new FormData(); rawForm.set('text', 'must not save without worker');
  const unsupported = await fetch(`${baseUrl}/capture/share`, { method: 'POST', body: rawForm, redirect: 'manual' });
  assert.equal(unsupported.status, 303);
  assert.match(unsupported.headers.get('location'), /shareError=unsupported/);

  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`${baseUrl}/capture`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
      assert.equal(await page.evaluate(() => window.isSecureContext), true);
      const memo = page.getByRole('textbox', { name: '메모 내용', exact: true });
      await memo.fill('기존 작성 내용');
      await chooseCaptureKind(page, '링크');
      await page.getByRole('textbox', { name: '링크 주소', exact: true }).fill('https://old.example/original');
      await page.locator('input[type=file]').first().setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: Buffer.from('기존 파일 바이트') });
      await page.waitForFunction(() => document.querySelector('.attached-files')?.textContent.includes('original.txt') && !document.querySelector('.capture-draft-status')?.textContent.includes('임시저장 중'));
      assert.equal(await page.getByRole('textbox', { name: '링크 주소', exact: true }).inputValue(), 'https://old.example/original', 'mobile attachment selection preserves an existing link');
      await page.waitForFunction(() => {
        const key = `leneu:capture-draft:v1:${sessionStorage.getItem('leneu:draft-session:v1')}`;
        return JSON.parse(localStorage.getItem(key) || 'null')?.value.fileCount === 1;
      });
      const serverBefore = await (await fetch(`${baseUrl}/api/captures`)).json();
      const url = await postShare(page, { title: '공유 원본', text: '<script>window.sharedHtmlExecuted=true</script>', url: 'https://new.example/article', files: [{ name: 'shared.png', type: 'image/png', bytes: 'shared-file-bytes' }] });
      assert.match(url, /share=/);
      await page.getByRole('region', { name: '공유 내용 검토' }).waitFor();
      assert.equal(await memo.inputValue(), '기존 작성 내용');
      assert.equal(await page.getByRole('textbox', { name: '링크 주소', exact: true }).inputValue(), 'https://old.example/original');
      assert.equal(await pendingCount(page), 1);
      assert.equal(await page.evaluate(() => Boolean(window.sharedHtmlExecuted)), false);
      const payloadBytes = await page.evaluate(async () => (await (await import('/capture-store.js')).listPendingShares())[0].files[0].text());
      assert.equal(payloadBytes, 'shared-file-bytes');
      await page.getByRole('button', { name: '기존 초안 계속 쓰기', exact: true }).click();
      assert.equal(await memo.inputValue(), '기존 작성 내용');
      await page.getByRole('button', { name: '공유 대기 1건 보기', exact: true }).click();
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await pendingCount(page), 1, 'shared file survives refresh before review');
      await page.screenshot({ path: join(evidenceDir, `review-${width}.png`), fullPage: true });

      if (width === 320) {
        await page.evaluate(() => {
          window.originalCaptureStorageSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('leneu:capture-draft:v1:')) throw new DOMException('fixture quota', 'QuotaExceededError');
            return window.originalCaptureStorageSetItem.call(this, key, value);
          };
        });
        await page.getByRole('button', { name: '초안에 추가 가져오기', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '초안을 임시저장하지 못했어요' }).waitFor();
        assert.equal(await memo.inputValue(), '기존 작성 내용');
        assert.equal(await pendingCount(page), 1, 'failed localStorage retains incoming source');
        assert.equal((await captureDraft(page)).value.fileCount, 1);
        const bytes = await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => { const req = indexedDB.open('leneu-draft-files-v1', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
          const records = await new Promise((resolve, reject) => { const tx = db.transaction('attachments'); const request = tx.objectStore('attachments').get(sessionStorage.getItem('leneu:draft-session:v1')); tx.oncomplete = () => resolve(request.result); tx.onerror = reject; });
          db.close(); return Promise.all(records.map(async (record) => ({ name: record.name, bytes: await record.blob.text() })));
        });
        assert.deepEqual(bytes, [{ name: 'original.txt', bytes: '기존 파일 바이트' }], 'failed import restores original attachment bytes');
        await page.evaluate(() => { Storage.prototype.setItem = window.originalCaptureStorageSetItem; });
        await page.evaluate(() => {
          window.originalCaptureTransaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (...args) {
            if (this.name === 'leneu-draft-files-v1' && args[1] === 'readwrite') throw new DOMException('fixture quota', 'QuotaExceededError');
            return window.originalCaptureTransaction.apply(this, args);
          };
        });
        await page.getByRole('button', { name: '초안에 추가 가져오기', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '공유 첨부를 초안에 임시저장하지 못했어요' }).waitFor();
        assert.equal(await memo.inputValue(), '기존 작성 내용');
        assert.equal(await pendingCount(page), 1, 'failed attachment IDB transaction retains incoming source');
        await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalCaptureTransaction; });
      }
      await page.getByRole('button', { name: '초안에 추가 가져오기', exact: true }).click();
      await page.getByText('공유 내용을 초안에 가져왔어요. 내용과 첨부를 확인한 뒤 저장해 주세요.', { exact: true }).waitFor();
      assert.equal(await pendingCount(page), 0);
      assert.equal(await page.locator('.attached-files .file-pill').count(), 2);
      assert.equal(await page.getByRole('textbox', { name: '링크 주소', exact: true }).inputValue(), 'https://old.example/original');
      assert.equal(await memo.inputValue(), '기존 작성 내용\n\n공유 원본\n\n<script>window.sharedHtmlExecuted=true</script>\n\nhttps://new.example/article');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.attached-files').getByText('shared.png', { exact: true }).waitFor();
      assert.equal((await memo.inputValue()).split('공유 원본').length - 1, 1, 'refresh never applies an import twice');
      const serverAfterReview = await (await fetch(`${baseUrl}/api/captures`)).json();
      assert.equal(serverAfterReview.items.length, serverBefore.items.length, 'receiving/reviewing does not save to server');
      assert.equal(await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).isChecked(), false);
      assert.equal(await page.evaluate(async () => { for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (new URL(request.url).pathname.startsWith('/api/')) return false; return true; }), true, 'worker caches shell only, never API content');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(evidenceDir, `imported-${width}.png`), fullPage: true });

      if (width === 390) {
        // Explicit save is the only point that sends data to the server.
        await page.getByRole('button', { name: '저장', exact: true }).click();
        await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('.sync-status')?.textContent.includes('동기화 완료'));
        const saved = (await (await fetch(`${baseUrl}/api/captures`)).json()).items.find((item) => item.text.includes('공유 원본'));
        assert.ok(saved);
        assert.equal(saved.files.length, 2);
        const attachment = saved.files.find((file) => file.name === 'shared.png');
        assert.equal(await (await fetch(`${baseUrl}/api/assets/${attachment.id}`)).text(), 'shared-file-bytes');
        await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
        await page.getByRole('button', { name: '빠른 메모', exact: true }).click();
        await chooseCaptureKind(page, '메모');
        await memo.fill('새 메모 초안');
        await postShare(page, { url: 'https://note.example/preserve-url' });
        await page.getByRole('button', { name: '초안에 추가 가져오기', exact: true }).click();
        await page.getByText('공유 내용을 초안에 가져왔어요. 내용과 첨부를 확인한 뒤 저장해 주세요.', { exact: true }).waitFor();
        assert.equal(await memo.inputValue(), '새 메모 초안\n\nhttps://note.example/preserve-url');
        await page.getByRole('button', { name: '저장', exact: true }).click();
        await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('.sync-status')?.textContent.includes('동기화 완료'));
        const savedNote = (await (await fetch(`${baseUrl}/api/captures`)).json()).items.find((item) => item.text.includes('https://note.example/preserve-url'));
        assert.ok(savedNote, 'non-link draft retains imported URL in its actual saved body');
      }

      const rejected = await postShare(page, { text: 'file test', files: [{ name: 'malicious.html', type: 'text/html', bytes: '<script>bad()</script>' }] });
      assert.match(rejected, /shareError=/);
      await page.getByRole('alert').filter({ hasText: '이미지, PDF' }).waitFor();
      assert.equal(await pendingCount(page), 0);

      const storageChecks = await page.evaluate(async () => {
        const imports = await import('/capture-store.js');
        let idbError = '';
        const originalOpen = indexedDB.open.bind(indexedDB);
        indexedDB.open = () => { throw new DOMException('fixture denied', 'SecurityError'); };
        try { await imports.putPendingShare({ text: 'storage failure' }); } catch (error) { idbError = error.message; }
        indexedDB.open = originalOpen;
        for (let n = 0; n < 16; n++) await imports.putPendingShare({ text: `queued ${n}` }, `queue-${n}`);
        let overflow = '';
        try { await imports.putPendingShare({ text: 'overflow' }, 'queue-overflow'); } catch (error) { overflow = error.message; }
        await imports.putPendingShare({ text: 'duplicate content' }, 'queue-0');
        const count = (await imports.listPendingShares()).length;
        const once = await imports.finishPendingShare('queue-0');
        const twice = await imports.finishPendingShare('queue-0');
        await imports.putPendingShare({ text: 'already consumed' }, 'queue-0');
        const after = (await imports.listPendingShares()).length;
        for (let n = 1; n < 16; n++) await imports.finishPendingShare(`queue-${n}`);
        return { idbError, overflow, count, once, twice, after };
      });
      assert.match(storageChecks.idbError, /브라우저 저장 공간/);
      assert.match(storageChecks.overflow, /가득/);
      assert.deepEqual({ count: storageChecks.count, once: storageChecks.once, twice: storageChecks.twice, after: storageChecks.after }, { count: 16, once: true, twice: false, after: 15 });
      assert.deepEqual(errors, []);
      results.push({ width, controlledWorker: true, draftCollision: 'preserved', bytes: 'verified', explicitSave: width === 390, storageChecks });
    } finally { await context.close(); }
  }
  await writeFile(join(evidenceDir, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), fixtureOnly: true, results }, null, 2));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dataDir = await mkdtemp(join(tmpdir(), 'leneu-mobile-capture-'));
  const baseUrl = 'http://127.0.0.1:8797';
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '8797', DATA_DIR: dataDir, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', OCR_RUNNER_KIND: 'disabled' }, stdio: 'pipe' });
  let logs = ''; server.stderr.on('data', (chunk) => { logs += chunk; });
  let browser;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch { /* temporary fixture starting */ }
      if (server.exitCode !== null) throw new Error(logs || 'fixture server exited');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    console.log(JSON.stringify(await runMobileCaptureQa(browser, baseUrl), null, 2));
  } finally {
    await browser?.close();
    if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
    await rm(dataDir, { recursive: true, force: true });
  }
}
