import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { openStore } from '../server/store.mjs';
import { chromium } from 'playwright-core';
const dir = await mkdtemp(join(tmpdir(), 'leneu-limit-'));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = 'http://127.0.0.1:' + port;
const store = openStore(join(dir, 'data'));
const target = store.createPage({ title: 'Block limit review target' });
const text = Array.from({ length: 1001 }, () => 'a').join('\n\n');
assert.ok(text.length < 10000);
const source = store.createCapture({ kind: 'note', text, files: [] });
store.close();
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, DATA_DIR: join(dir, 'data'), BACKUP_DIR: join(dir, 'backups'), HOST: '127.0.0.1', PORT: String(port), AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', OCR_RUNNER_URL: '', GEOAPIFY_API_KEY: '', GOOGLE_MAPS_DEMO_KEY: '' },
  stdio: ['ignore','ignore','pipe'],
});
let browser; let serverLog=''; server.stderr.on('data',chunk=>serverLog+=chunk);
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if(server.exitCode!==null) throw new Error(serverLog);
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto(base + '/pages/' + target.id, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '자료 가져오기', exact: true }).first().click();
  await page.locator('.page-materials-results > button').first().click();
  await page.getByRole('textbox', { name: '자료 본문', exact: true }).waitFor();
  await page.getByRole('button', { name: '본문 끝에 넣기', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.bn-block-outer').count(), 1, 'Invalid insertion must leave the existing document intact');
  await page.locator('.page-materials').getByRole('alert').filter({ hasText: /1,000|1000|블록/ }).waitFor();
  const after = (await (await fetch(base + '/api/pages/' + target.id)).json()).item;
  assert.deepEqual(after.document, target.document);
  assert.equal(after.version, target.version);
  assert.equal((await (await fetch(base + '/api/captures/' + source.id)).json()).item.text, text);
  console.log('PASS: 1001 source paragraphs rejected before editor mutation; original target/source and version retained');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await rm(dir, { recursive: true, force: true });
}
