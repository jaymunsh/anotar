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

// 온라인 전용 개인 인증(2026-10-19 로컬 우선 동기화 제거 후).
// 인증은 유지 기능이다: 잠긴 상태는 로그인 화면으로 가리고, 로그인한 뒤 저장할 수 있다.
// 저장 중 401이 나면 입력을 유지하고, 다시 로그인하면 같은 입력이 한 번만 저장된다.
// 예전 기기 저장·전송 대기(outbox)·'지금 동기화'는 더 이상 없다.
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
const report = [];
// 잠긴 상태로 열어 로그인 화면을 보여준다.
const lockedInit = () => {
  try {
    localStorage.setItem('leneu:auth-locked', 'true');
  } catch {
    /* 메모리 상태만으로도 이 탭은 잠긴다 */
  }
};
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // 1) 잠긴 상태의 로그인 화면은 앱 셸을 가리고 어떤 뷰포트·테마에서도 넘치지 않는다.
  for (const [width, theme] of [
    [1440, 'light'],
    [390, 'light'],
    [1440, 'dark'],
    [320, 'dark'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => failures.push(e.message));
    await page.addInitScript(lockedInit);
    await page.goto(base);
    await page.getByLabel('비밀번호', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.app-shell:visible').count(),
      0,
      'the locked login screen must hide the private workspace',
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/login-${width}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
  report.push('locked login screen at 1440/390/320 in light/dark hides the workspace without overflow');

  // 2) 비밀번호+TOTP 로그인(이 브라우저 기억)으로 앱에 들어간다.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => failures.push(e.message));
  await page.addInitScript(lockedInit);
  await page.goto(base);
  await page.getByLabel('비밀번호', { exact: true }).fill('UI fixture private password!');
  await page.getByLabel('인증 코드', { exact: true }).fill(totp(secret));
  await page.getByLabel('이 브라우저를 30일 동안 기억하기').check();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.auth-screen'));
  await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).waitFor();
  report.push('password + TOTP login with remembered browser unlocks the workspace');

  // 3) 인증 만료(쿠키 삭제) 중 저장 시도는 입력을 유지하고 로그인 안내를 보여준다.
  const openMemo = async () => {
    const existing = page.getByRole('textbox', { name: '메모 내용', exact: true });
    if (await existing.isVisible().catch(() => false)) return existing;
    await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
    await page
      .getByRole('dialog', { name: '새로 작성' })
      .getByRole('button', { name: '빠른 메모', exact: true })
      .click();
    await existing.waitFor();
    return existing;
  };
  const memo = await openMemo();
  await memo.fill('인증이 만료되어도 남아야 하는 입력');
  await ctx.clearCookies();
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  // 저장이 401로 실패하면 다시 로그인하라는 안내를 보여주고 입력은 그대로 둔다.
  await page.getByText('다시 로그인해 주세요. 기기에 저장한 글은 유지돼요.', { exact: false }).waitFor();
  assert.equal(await memo.inputValue(), '인증이 만료되어도 남아야 하는 입력', 'the input survives the 401');
  // 앱은 연결 복구 시 인증을 다시 확인한다. 그때 재로그인 안내가 사이드바에 뜬다.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('.auth-expiry').waitFor();
  assert.match(
    await page.locator('.auth-expiry').innerText(),
    /로그인이 필요해요\. 로그인한 뒤 저장할 수 있고/,
  );
  assert.equal(await memo.inputValue(), '인증이 만료되어도 남아야 하는 입력', 'the re-login notice keeps the input');
  report.push('a 401 save shows the re-login message, keeps the input, and surfaces the re-login notice on reconnect');

  // 4) 안내의 '로그인'으로 다시 로그인하면(복구 코드 사용) 입력이 그대로 남고 한 번만 저장된다.
  // 빠른 기록 다이얼로그는 모달이라 사이드바 안내를 가린다. 닫아도 초안은 그대로 남는다.
  await page.getByRole('button', { name: '입력 닫기', exact: true }).click();
  await page.locator('.auth-expiry').getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).fill('UI fixture private password!');
  await page.getByRole('button', { name: '복구 코드 사용' }).click();
  await page.getByLabel('복구 코드', { exact: true }).fill(recovery.recoveryCodes[0]);
  await page.locator('.auth-dialog').getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.auth-dialog'));
  const resumed = await openMemo();
  assert.equal(await resumed.inputValue(), '인증이 만료되어도 남아야 하는 입력', 'the draft is restored after re-login');
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  await page.getByText('보관함에 저장했어요', { exact: true }).waitFor();
  const saved = await (await ctx.request.get(base + '/api/captures')).json();
  assert.equal(saved.items.length, 1, 're-login resumes the save exactly once');
  assert.equal(saved.items[0].text, '인증이 만료되어도 남아야 하는 입력');
  report.push('re-login restores the kept draft and stores it exactly once');

  // 5) 보안 설정에서 로그아웃하면 잠기고, 새로고침해도 잠긴 로그인 화면이 유지된다.
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
  report.push('security logout locks the workspace and the lock survives a reload');

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
