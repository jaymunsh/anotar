// Temporary DB/fake CLI only. The loopback search candidate must be blocked;
// this verifies UI admission and real worker dispatch without external AI calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const root = await mkdtemp(join(tmpdir(), 'anotar-search-qa-'));
const bin = join(root, 'opencode-fixture');
await writeFile(
  bin,
  `#!${process.execPath}
if(process.argv[2]==='--version'){console.log('1.18.34');process.exit(0)}
const fs=require('node:fs');let raw='';process.stdin.on('data',s=>raw+=s);process.stdin.on('end',()=>{
 const config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT), search=config.permission.websearch==='allow';
 fs.appendFileSync(process.argv[1]+'.calls',JSON.stringify({search,input:JSON.parse(raw)})+'\\n');
 const emit=e=>console.log(JSON.stringify(e));
 if(search){emit({type:'tool_use',part:{tool:'websearch',callID:'fixture-search',state:{status:'completed',input:{query:'Synthetic QA topic',numResults:5,type:'fast',contextMaxCharacters:10000},metadata:{provider:'exa'},output:'Title: Private address must be blocked\\nURL: http://127.0.0.1:1/private'}}});emit({type:'step_finish',part:{reason:'tool-calls'}})}
 else emit({type:'text',part:{text:'# QA summary\\n\\nSynthetic direct request completed.'}});
 emit({type:'step_finish',part:{reason:'stop'}});
});`,
);
await chmod(bin, 0o755);
const holder = createServer();
await new Promise((r) => holder.listen(0, '127.0.0.1', r));
const port = holder.address().port;
await new Promise((r) => holder.close(r));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: join(root, 'data'),
    HOST: '127.0.0.1',
    PORT: String(port),
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'opencode',
    AI_OPENCODE_ENABLED: 'true',
    AI_OPENCODE_BIN: bin,
    AI_OPENCODE_MODEL: 'opencode/muse-spark-1.3-contributor-free',
    AI_OPENCODE_AUTH_FILE: join(root, 'missing-auth'),
    AI_DEVIN_BIN: '/missing',
    HIVE_API_KEY: '',
    AI_RUNNER_URL: '',
    OCR_RUNNER_KIND: 'disabled',
    SERVICE_TELEGRAM_ENABLED: 'false',
  },
  stdio: 'ignore',
});
let browser;
async function waitJob() {
  for (let i = 0; i < 100; i++) {
    const { items } = await (await fetch(base + '/api/ai/activity')).json();
    if (['result_ready', 'failed'].includes(items[0]?.status)) return items[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Job did not finish');
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const settings = await (await fetch(base + '/api/ai/settings')).json();
  assert.deepEqual(settings.profiles.find((p) => p.id === 'opencode').researchModes, [
    'url',
    'keyword',
  ]);
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/ai');
    await page.getByRole('button', { name: '새 AI 요청', exact: true }).first().click();
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('Synthetic keyword research');
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('research-keyword');
    await page
      .getByRole('combobox', { name: 'AI 실행기와 모델' })
      .selectOption('opencode|opencode/muse-spark-1.3-contributor-free');
    await page.waitForFunction(() => !document.querySelector('.save-button').disabled);
    assert.equal(await page.getByRole('button', { name: '메모만 저장', exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).selectOption('hive');
    await page.waitForFunction(() => document.querySelector('.save-button').disabled);
    await page
      .getByRole('combobox', { name: 'AI 실행기와 모델' })
      .selectOption('opencode|opencode/muse-spark-1.3-contributor-free');
    await page.waitForFunction(() => !document.querySelector('.save-button').disabled);
  }
  await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
  const keyword = await waitJob().catch(async (error) => {
    console.log(
      'QA diagnostics',
      await page.locator('body').innerText(),
      await (await fetch(base + '/api/captures')).text(),
    );
    throw error;
  });
  assert.equal(keyword.status, 'failed');
  assert.equal(
    keyword.errorCode,
    'research_no_sources',
    'keyword must reach discovery, then reject the private body URL',
  );
  const calls = (await readFile(bin + '.calls', 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].search, true);
  assert.equal(calls[0].input.topic, 'Synthetic keyword research');
  const capture = (await (await fetch(base + `/api/captures/${keyword.captureId}`)).json()).item;
  assert.equal(capture.text, 'Synthetic keyword research');
  await page.goto(base + '/ai');
  await page.getByRole('button', { name: '새 AI 요청', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('Synthetic direct request');
  await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('direct');
  await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
  // Ignore the older failed job until the new local capture reaches the server.
  let direct;
  for (let i = 0; i < 100; i++) {
    const { items } = await (await fetch(base + '/api/ai/activity')).json();
    direct = items.find((j) => j.id !== keyword.id && j.status === 'result_ready');
    if (direct) break;
    await page.waitForTimeout(100);
  }
  assert.ok(direct);
  await page.goto(base + direct.href);
  await page.locator('.ai-result-reading h1').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: OpenCode keyword admission at 1440/390/320; unsupported Hive blocked; CLI discovery dispatched; private URL blocked; original preserved; direct request/result regression; temporary DB/fake CLI only.',
  );
} finally {
  await browser?.close();
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
  await rm(root, { recursive: true, force: true });
}
