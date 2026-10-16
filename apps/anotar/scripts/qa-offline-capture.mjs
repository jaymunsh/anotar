import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const dir = await mkdtemp(join(tmpdir(), 'leneu-offline-capture-'));
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: String(port),
    HOST: '127.0.0.1',
    AI_RUNNER_KIND: 'disabled',
    AI_RUNNER_URL: '',
    GEOAPIFY_API_KEY: '',
    GOOGLE_MAPS_DEMO_KEY: '',
  },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: '동기화 상태', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  // Stage A Task 5 blocks API only; full network offline/relaunch is separately covered by Task 6.
  await context.route('**/api/**', (route) => route.abort());
  await page.getByRole('textbox', { name: '새 할 일', exact: true }).fill('오프라인 준비');
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByRole('checkbox', { name: '오프라인 준비 완료', exact: true }).check();
  const input = page.getByRole('textbox', { name: '메모 내용', exact: true });
  await input.fill('네트워크 없이 남기는 메모');
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'offline.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('offline exact bytes'),
    });
  await page.getByText('첨부 임시저장 중…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '');
  await page.reload();
  await page.getByText('네트워크 없이 남기는 메모', { exact: true }).first().waitFor();
  const before = await (await fetch(base + '/api/captures')).json();
  assert.equal(before.items.length, 0);
  await context.unroute('**/api/**');
  await page.getByRole('button', { name: '동기화 상태', exact: true }).click();
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  const saved = await (await fetch(base + '/api/captures')).json();
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].text, '네트워크 없이 남기는 메모');
  assert.equal(
    await (await fetch(base + `/api/assets/${saved.items[0].files[0].id}`)).text(),
    'offline exact bytes',
  );
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  assert.equal((await (await fetch(base + '/api/captures')).json()).items.length, 1);
  const tasks = await (await fetch(base + '/api/tasks?status=done')).json();
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].title, '오프라인 준비');
  console.log(
    'PASS offline capture and task: local save/reload, pending visibility, one server row, exact attachment, replay',
  );
} finally {
  await browser?.close();
  child.kill();
  await new Promise((r) => child.once('exit', r));
  await rm(dir, { recursive: true, force: true });
}
