import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { openStore } from '../server/store.mjs';
import { createAuthenticator } from '../server/auth/service.mjs';
import { totp } from '../server/auth/crypto.mjs';
const evidence = '.omo/evidence/private-auth';
await mkdir(evidence, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-ui-')),
  key = 'ad'.repeat(32),
  secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const store = openStore(dir);
const recovery = await createAuthenticator({ store, key }).provision({
  password: 'UI fixture private password!',
  secret,
});
store.close();
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: String(port),
    HOST: '127.0.0.1',
    AUTH_MODE: 'required',
    AUTH_SECRET_KEY: key,
    AUTH_COOKIE_SECURE: 'false',
    AI_RUNNER_KIND: 'disabled',
    OCR_RUNNER_URL: '',
    GEOAPIFY_API_KEY: '',
    GOOGLE_MAPS_DEMO_KEY: '',
    PRIVATE_ALLOWED_ORIGINS: '',
  },
  stdio: 'ignore',
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const failures = [];
let report = [];
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const [width, theme] of [
    [1440, 'light'],
    [390, 'light'],
    [1440, 'dark'],
    [320, 'dark'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', (e) => failures.push(e.message));
    await page.goto(base);
    await page.getByLabel('비밀번호', { exact: true }).waitFor({ timeout: 3000 });
    assert.equal(
      await page.locator('.app-shell').count(),
      0,
      'private app must not initialize before first login',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: `${evidence}/login-${width}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto(base);
  await page.getByLabel('비밀번호', { exact: true }).fill('UI fixture private password!');
  await page.getByLabel('인증 코드', { exact: true }).fill(totp(secret));
  await page.getByLabel('이 브라우저를 30일 동안 기억하기').check();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '동기화 상태', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  // Locate the existing quick memo textarea without relying on placeholder copy.
  const memo = page.locator('textarea').first();
  await memo.fill('인증이 만료되어도 남아야 하는 입력 초안');
  // Preserve existing IndexedDB and drafts while forcing server cookie expiration.
  await ctx.clearCookies();
  await page.getByRole('button', { name: '동기화 상태', exact: true }).click();
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await page.locator('.auth-expiry').waitFor();
  assert.equal(await memo.inputValue(), '인증이 만료되어도 남아야 하는 입력 초안');
  await page.getByRole('button', { name: '동기화 상태 닫기' }).click();
  // Saving while authentication is unavailable keeps a durable operation and attachment locally.
  await memo.fill('인증 대기 중 저장한 메모');
  await page.locator('input[type=file]').setInputFiles({
    name: 'auth-offline.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('auth queue exact bytes'),
  });
  await page.getByText('첨부 임시저장 중…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
  const pending = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('leneu-offline-v1', 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const items = await new Promise((resolve, reject) => {
      const r = db.transaction('outbox').objectStore('outbox').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return items.find((p) => p.operation.kind === 'capture.create' && p.state !== 'acked')
      ?.operation;
  });
  assert.ok(pending, 'capture must remain in the outbox');
  const originalUUID = pending.operationId;
  assert.ok(originalUUID);
  await memo.fill('인증이 만료되어도 남아야 하는 입력 초안');
  await page.locator('.auth-expiry').getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).fill('UI fixture private password!');
  await page.getByRole('button', { name: '복구 코드 사용' }).click();
  await page.getByLabel('복구 코드', { exact: true }).fill(recovery.recoveryCodes[0]);
  await page.locator('.auth-dialog').getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.auth-dialog'));
  assert.equal(await memo.inputValue(), '인증이 만료되어도 남아야 하는 입력 초안');
  await page.waitForFunction(() =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  const saved = await (await ctx.request.get(base + '/api/captures')).json();
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].text, '인증 대기 중 저장한 메모');
  assert.equal(
    await (await ctx.request.get(base + '/api/assets/' + saved.items[0].files[0].id)).text(),
    'auth queue exact bytes',
  );
  const acknowledged = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('leneu-offline-v1', 2);
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction('meta').objectStore('meta').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows.filter((p) => p.result).map((p) => p.result.operationId);
  });
  assert.ok(
    acknowledged.includes(originalUUID),
    're-login must acknowledge the identical operation UUID',
  );
  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  await page.getByRole('button', { name: '보안', exact: true }).click();
  await page.getByText('현재 브라우저', { exact: true }).first().waitFor();
  // A recovery login must also be able to revoke a lost browser without its Authenticator.
  await page.getByRole('button', { name: '복구 코드로 확인', exact: true }).click();
  await page
    .getByLabel('로그아웃 확인용 복구 코드', { exact: true })
    .fill(recovery.recoveryCodes[1]);
  await page.getByRole('button', { name: '내 브라우저 로그아웃', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.security-devices li').length === 1);
  await page.screenshot({ path: `${evidence}/security-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${evidence}/security-mobile-dark.png` });
  const second = await ctx.newPage();
  second.on('pageerror', (e) => failures.push(e.message));
  await second.goto(base);
  await second.getByRole('button', { name: '설정 열기', exact: true }).click();
  await second.locator('dialog:modal').waitFor();
  await page.getByRole('button', { name: '이 브라우저 로그아웃', exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).waitFor();
  assert.equal(
    await page.locator('dialog:modal').count(),
    0,
    'logout must close hidden native modals',
  );
  await page.getByLabel('비밀번호', { exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).fill('UI fixture private password!');
  assert.equal(
    await page.getByLabel('비밀번호', { exact: true }).inputValue(),
    'UI fixture private password!',
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('textarea')?.value),
    '인증이 만료되어도 남아야 하는 입력 초안',
  );
  await second.getByLabel('비밀번호', { exact: true }).waitFor();
  assert.equal(
    await second.locator('dialog:modal').count(),
    0,
    'other tab logout also closes native modal',
  );
  await second.getByLabel('비밀번호', { exact: true }).click();
  await second.close();
  await page.getByRole('button', { name: '복구 코드 사용', exact: true }).click();
  await page.getByLabel('복구 코드', { exact: true }).fill(recovery.recoveryCodes[2]);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.auth-screen'));
  assert.equal(await memo.inputValue(), '인증이 만료되어도 남아야 하는 입력 초안');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  await page.getByRole('button', { name: '보안', exact: true }).click();
  await page.getByRole('button', { name: '이 브라우저 로그아웃', exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel('비밀번호', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.app-shell:visible').count(),
    0,
    'explicit logout stays locked after reload',
  );
  report.push(
    '1440/390/320px both themes; first-login gate; password+TOTP; remembered cookie;401 preserves mounted memo draft and exact attachment/UUID; queued save resumes once; recovery re-login resumes; security device list; recovery code revokes other device; logout closes current/other-tab native modals; immediate re-login retains draft; reload stays locked.',
  );
  await ctx.close();
  assert.deepEqual(failures, []);
  await writeFile(`${evidence}/ui-report.txt`, report.join('\n') + '\n');
  console.log('Private authentication browser QA passed');
} finally {
  await browser.close();
  const exit = once(child, 'exit');
  child.kill();
  await exit;
  await rm(dir, { recursive: true, force: true });
}
