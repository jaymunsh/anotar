import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
const calls = [];
let failNext = false;
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  calls.push(JSON.parse(raw));
  if (failNext) { failNext = false; res.writeHead(401); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              content:
                '# 오늘의 정리\n\n요청한 내용을 정리했어요.\n\n- 핵심부터 확인하기\n- 다음 작업 정하기',
            },
            finish_reason: null,
          },
        ],
      }) +
      '\n\ndata: ' +
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 23, completion_tokens: 18 },
      }) +
      '\n\ndata: [DONE]\n\n',
  );
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const dir = await mkdtemp(join(tmpdir(), 'anotar-ai-ui-')),
  base = `http://127.0.0.1:${port}`,
  evidence = '.omo/evidence/hive-devin';
await mkdir(evidence, { recursive: true });
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dir,
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'hive',
    HIVE_API_KEY: 'fixture-only',
    HIVE_MODEL: 'fixture/first',
    HIVE_BASE_URL: `http://127.0.0.1:${provider.address().port}/api/v3`,
    AI_DEVIN_BIN: '/missing-fixture-devin',
    AI_DEVIN_CREDENTIALS_FILE: '/missing-credentials',
    GEOAPIFY_API_KEY: '',
    GOOGLE_MAPS_DEMO_KEY: '',
    OCR_RUNNER_KIND: 'disabled',
  },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await page.getByRole('button', { name: '설정 열기' }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('textbox', { name: 'Hive 모델 ID' }).fill('fixture/second');
  await page.getByRole('button', { name: 'AI 설정 저장' }).click();
  await page.getByText('저장했어요. 새 요청부터 적용됩니다.').waitFor();
  await page.screenshot({ path: evidence + '/settings-1440.png' });
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('오늘 작업의 우선순위를 정리해줘.');
  await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
  await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).selectOption('hive');
  assert.match(
    await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).textContent(),
    /fixture\/second/,
  );
  const templates = (await (await fetch(base + '/api/prompt-templates')).json()).items;
  const researchTemplate = templates.find((item) => item.id === 'research-keyword' && !item.archived);
  assert.ok(researchTemplate);
  await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption(researchTemplate.id);
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).isDisabled(), true, 'unsupported keyword research must not be queued');
  await context.setOffline(true);
  await page.waitForFunction(() => !document.querySelector('.save-button').disabled, null, { timeout: 2000 });
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('.save-button').disabled);
  await page.screenshot({ path: evidence + '/unsupported-keyword-1440.png' });
  await page.getByRole('button', { name: '메모만 저장', exact: true }).click();
  await page.getByText(/기기에 저장했어요|보관함에 저장했어요/).waitFor();
  let memos = [];
  for (let i = 0; i < 100; i++) {
    memos = (await (await fetch(base + '/api/captures')).json()).items;
    if (memos.length) break;
    await page.waitForTimeout(100);
  }
  assert.equal(memos.length, 1);
  assert.equal(memos[0].aiRequest, null);
  assert.equal(calls.length, 0, 'memo-only save must never call provider');
  await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill('오늘 작업의 우선순위를 정리해줘.');
  await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
  await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).selectOption('hive');
  await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('direct');
  await page.screenshot({ path: evidence + '/request-1440.png' });
  await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
  let job;
  for (let i = 0; i < 100; i++) {
    const list = await (await fetch(base + '/api/ai/activity')).json();
    if (list.items[0]?.status === 'result_ready') {
      job = list.items[0];
      break;
    }
    await page.waitForTimeout(100);
  }
  assert.ok(job);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'fixture/second');
  assert.equal(job.model, 'fixture/second');
  await page.goto(base + '/ai');
  await page.locator('.activity-row').first().waitFor();
  await page.screenshot({ path: evidence + '/activity-1440.png' });
  await page.locator('.activity-row').first().click();
  await page.locator('.ai-result-reading h1').waitFor();
  assert.equal(await page.locator('.memo-split-list').isVisible(), false);
  assert.equal(await page.locator('.memo-detail-navigation').count(), 0);
  assert.equal(await page.locator('.ai-original-note').getAttribute('open'), null);
  assert.ok((await page.locator('.ai-result-reading').boundingBox()).y < 400);
  await page.screenshot({ path: evidence + '/result-1440.png' });
  await page.getByRole('button', { name: '항목 수정', exact: true }).click();
  await page.getByRole('textbox', { name: '보관한 내용' }).waitFor();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.locator('.ai-result-reading h1').waitFor();
  // Historical retry must keep its model even when current settings select an unavailable CLI.
  failNext = true;
  const form = new FormData(); form.set('kind','note'); form.set('text','실패 요청 재시도'); form.set('aiRequest',JSON.stringify({template:null,additional:'',execution:{profileId:'hive',model:'fixture/second'}}));
  const failedCapture = (await (await fetch(base+'/api/captures',{method:'POST',body:form})).json()).item;
  let failedJob;
  for(let i=0;i<100;i++){const items=(await (await fetch(base+`/api/captures/${failedCapture.id}/ai-jobs`)).json()).items;if(items[0]?.status==='failed'){failedJob=items[0];break;}await page.waitForTimeout(100);}
  assert.ok(failedJob);
  const currentSettings=await (await fetch(base+'/api/ai/settings')).json();
  const setSettings=async(settings,defaultProfile,model)=>{const response=await fetch(base+'/api/ai/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:settings.version,defaultProfile,models:{hive:model,devin:'swe-2-high'}})});assert.equal(response.status,200);return response.json();};
  const changedSettings=await setSettings(currentSettings,'devin','');
  await page.goto(base+`/captures/${failedCapture.id}?aiJob=${failedJob.id}`);
  await page.getByRole('combobox',{name:'AI 실행기와 모델'}).waitFor();
  const retry=page.getByRole('button',{name:'실패한 요청 그대로 재시도',exact:true});
  assert.equal(await retry.isEnabled(),true,'current unavailable picker must not disable historical retry');await retry.click();
  await page.locator('.ai-job-state').getByText('결과 준비됨',{exact:true}).waitFor();
  assert.equal(calls.length,3);assert.equal(calls[2].model,'fixture/second');
  await setSettings(changedSettings,'hive','fixture/second');
  for (const width of [390, 320]) {
    await page.evaluate(() => localStorage.setItem('leneu:theme', 'light'));
    await page.goto(base + job.href);
    await page.locator('.ai-result-reading h1').waitFor();
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: evidence + `/result-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(base + '/ai');
    await page.getByRole('button', { name: '새 AI 요청', exact: true }).click();
    await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).waitFor();
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption(researchTemplate.id);
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '메모만 저장', exact: true }).waitFor();
    await page.screenshot({ path: evidence + `/unsupported-keyword-${width}.png` });
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('direct');
    await page.screenshot({ path: evidence + `/request-${width}.png` });
    assert.ok(
      await page
        .locator('.capture-composer-dialog')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.getByRole('button', { name: 'AI 설정 열기', exact: true }).click();
    await page.getByRole('textbox', { name: 'Hive 모델 ID' }).waitFor();
    await page.screenshot({ path: evidence + `/settings-${width}.png` });
    await page.getByRole('button', { name: '설정 닫기' }).click();
    await page.getByRole('button', { name: '입력 닫기' }).click();
    await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
    await page.getByRole('button', { name: '설정 열기' }).click();
    await page.getByRole('button', { name: '화면', exact: true }).click();
    if (await page.getByRole('button', { name: '화면 모드 전환' }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: '화면 모드 전환' }).click();
    await page.getByRole('button', { name: '설정 닫기' }).click();
    await page.goto(base + job.href);
    await page.locator('.ai-result-reading h1').waitFor();
    await page.screenshot({ path: evidence + `/result-${width}-dark.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: unsupported keyword research blocked; memo-only save makes no AI call; direct request still works; settings persisted; result-first + original editing; 1440/390/320 and dark layout; temporary DB/provider only.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
  await new Promise((r) => provider.close(r));
  await rm(dir, { recursive: true, force: true });
}
