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
const dir = await mkdtemp(join(tmpdir(), 'leneu-pwa-shell-')),
  base = `http://127.0.0.1:${port}`;
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
  const seed = new FormData();
  seed.set('kind', 'note');
  seed.set('text', '상세 경로 오프라인 회귀 원문');
  const seedResponse = await fetch(base + '/api/captures', { method: 'POST', body: seed });
  assert.equal(seedResponse.status, 201);
  const capture = (await seedResponse.json()).item;
  const context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    return names.some((name) => name.startsWith('leneu-shell-v1-'));
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.goto(base + '/captures/' + capture.id);
  await page.locator('.detail-text').getByText(capture.text, { exact: true }).waitFor();
  await context.setOffline(true);
  for (const query of ['', '?aiJob=historical', '?ocrJob=historical']) {
    await page.goto(base + '/captures/' + capture.id + query);
    await page.locator('.detail-text').getByText(capture.text, { exact: true }).waitFor();
    await page.reload();
    await page.locator('.detail-text').getByText(capture.text, { exact: true }).waitFor();
  }
  const other = await context.newPage();
  await other.goto(base + '/memo');
  await other.getByRole('heading', { name: '메모', exact: true }).waitFor();
  await other.goto(base + '/capture');
  await other
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('완전 오프라인 부팅 후 메모');
  await other.getByRole('button', { name: '저장', exact: true }).click();
  await other.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
  await other.reload();
  await other.goto(base + '/memo');
  await other.getByText('완전 오프라인 부팅 후 메모', { exact: true }).waitFor();
  const denied = await other.evaluate(async () => {
    const outcomes = [];
    for (const path of ['/api/sync/session', '/s/fake', 'https://example.com/'])
      try {
        const r = await fetch(path);
        outcomes.push((await r.text()).includes('<html'));
      } catch {
        outcomes.push(false);
      }
    return outcomes;
  });
  assert.deepEqual(denied, [false, false, false]);
  await context.setOffline(false);
  await other.goto(base);
  await other.getByRole('button', { name: '동기화 상태', exact: true }).click();
  await other.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await other.waitForFunction(() =>
    document.querySelector('.sync-status')?.textContent.includes('동기화 완료'),
  );
  assert.equal((await (await fetch(base + '/api/captures')).json()).items.length, 2);
  console.log(
    'PASS PWA shell: production prepare, offline capture detail/query reload, new tab/route/local save, API/share/external excluded, reconnect',
  );
} finally {
  await browser?.close();
  child.kill();
  await new Promise((r) => child.once('exit', r));
  await rm(dir, { recursive: true, force: true });
}
