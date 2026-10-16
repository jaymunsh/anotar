import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
const dir = await mkdtemp(join(tmpdir(), 'anotar-opencode-ui-'));
const bin = join(dir, 'opencode-fixture');
await writeFile(
  bin,
  `#!${process.execPath}\nconst fs=require('node:fs');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{fs.appendFileSync(process.argv[1]+'.calls',JSON.stringify({args:process.argv.slice(2),input:JSON.parse(text)})+'\\n');console.log(JSON.stringify({type:'text',part:{text:'# 계획 요약\\n\\n요청한 기록을 정리했어요.'}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop',tokens:{input:4,output:3}}}));});`,
);
await chmod(bin, 0o755);
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`,
  evidence = '.omo/evidence/opencode-models';
await mkdir(evidence, { recursive: true });
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: join(dir, 'data'),
    PORT: String(port),
    HOST: '127.0.0.1',
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'hive',
    HIVE_API_KEY: '',
    AI_DEVIN_BIN: '/missing',
    AI_OPENCODE_ENABLED: 'true',
    AI_OPENCODE_BIN: bin,
    AI_OPENCODE_AUTH_FILE: join(dir, 'missing-auth'),
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '설정 열기' }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('combobox', { name: '기본 AI 실행기' }).selectOption('opencode');
  await page
    .getByRole('combobox', { name: '기본 OpenCode 모델' })
    .selectOption('opencode/space-bunny-free');
  await page.locator('.settings-model-library summary').click();
  await page.getByRole('textbox', { name: 'OpenCode 모델 검색' }).fill('space-bunny');
  await page
    .getByRole('textbox', { name: 'opencode/space-bunny-free 표시 이름', exact: true })
    .fill('내 요약 모델');
  await page
    .getByRole('textbox', { name: '새 OpenCode 모델 ID', exact: true })
    .fill('opencode/fixture-free');
  await page.getByRole('textbox', { name: '새 OpenCode 모델 이름', exact: true }).fill('간단 정리');
  await page.getByRole('button', { name: '모델 추가', exact: true }).click();
  // Refresh is a preview and must not discard local names, additions or paid choices.
  await page.route('**/api/ai/models/opencode', (route) =>
    route.fulfill({
      json: {
        source: 'https://opencode.ai/zen/v1/models',
        checkedAt: '2026-10-05',
        models: [
          {
            id: 'opencode/space-bunny-free',
            name: 'remote-name',
            pricing: 'free',
            enabled: false,
            available: true,
          },
          {
            id: 'opencode/new-free',
            name: '새 무료',
            pricing: 'unknown',
            enabled: false,
            available: true,
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: '공식 목록 갱신', exact: true }).click();
  await page.getByText(/공식 목록을 가져왔어요/).waitFor();
  assert.equal(
    await page
      .getByRole('textbox', { name: 'opencode/space-bunny-free 표시 이름', exact: true })
      .inputValue(),
    '내 요약 모델',
  );
  await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click();
  await page.getByText('저장했어요. 새 요청부터 적용됩니다.').waitFor();
  const saved = await (await fetch(base + '/api/ai/settings')).json();
  const profile = saved.profiles.find((p) => p.id === 'opencode');
  assert.equal(saved.defaultProfile, 'opencode');
  assert.equal(profile.catalog.find((m) => m.id === 'opencode/new-free').enabled, false);
  assert.equal(profile.catalog.find((m) => m.id === 'opencode/fixture-free').enabled, true);
  // Conflicts must preserve unsaved input.
  await fetch(base + '/api/ai/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedVersion: saved.version,
      defaultProfile: 'opencode',
      models: Object.fromEntries(saved.profiles.map((p) => [p.id, p.model])),
      opencodeModels: profile.catalog,
    }),
  });
  await page
    .getByRole('textbox', { name: 'opencode/space-bunny-free 표시 이름', exact: true })
    .fill('초안 유지');
  await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /AI 설정이 변경/ })
    .waitFor();
  assert.equal(
    await page
      .getByRole('textbox', { name: 'opencode/space-bunny-free 표시 이름', exact: true })
      .inputValue(),
    '초안 유지',
  );
  await page.getByRole('button', { name: '최신 설정 불러오기', exact: true }).click();
  await page.locator('.settings-model-library summary').waitFor();
  await page.locator('.settings-model-library summary').click();
  await page.getByRole('textbox', { name: 'OpenCode 모델 검색' }).fill('space-bunny');
  await page
    .getByRole('textbox', { name: 'opencode/space-bunny-free 표시 이름', exact: true })
    .waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.settings-model-row').first().scrollIntoViewIfNeeded();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const overflowing = await page
        .locator('.settings-models')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflowing, false, `catalog overflow ${width}`);
      await page.screenshot({ path: `${evidence}/settings-${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await page.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '새 AI 요청', exact: true }).first().click();
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill('오늘 기록을 요약해줘');
  await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
  await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('direct');
  await page
    .getByRole('combobox', { name: 'AI 실행기와 모델' })
    .selectOption('opencode|opencode/fixture-free');
  await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/request-1440.png` });
  assert.equal(await page.getByRole('combobox', { name: 'AI 실행기와 모델' }).inputValue(), 'opencode|opencode/fixture-free');
  await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
  let activity;
  for (let i = 0; i < 100; i++) {
    const list = await (await fetch(base + '/api/ai/activity')).json();
    if (list.items[0]?.status === 'result_ready') {
      activity = list.items[0];
      break;
    }
    await page.waitForTimeout(100);
  }
  assert.ok(activity);
  assert.equal(activity.model, 'opencode/fixture-free');
  const calls = (await readFile(bin + '.calls', 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'opencode/fixture-free');
  await page.goto(base + activity.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'AI 결과', exact: true }).waitFor();
  await page.getByText('opencode/fixture-free', { exact: false }).first().waitFor();
  for (const width of [390, 320]) {
    const mobileContext = await browser.newContext({ viewport: { width, height: 1000 } });
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
    await mobile.getByRole('button', { name: '새 AI 요청', exact: true }).first().click();
    const picker = mobile.getByRole('combobox', { name: 'AI 실행기와 모델' });
    await picker.selectOption('opencode|opencode/fixture-free');
    await picker.scrollIntoViewIfNeeded();
    await mobile.locator('.capture-composer-dialog[open]').waitFor();
    await mobile.screenshot({ path: `${evidence}/request-${width}.png` });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await mobile.locator('.capture-composer-dialog').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await mobileContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        pass: true,
        catalog: profile.catalog.length,
        widths: [1440, 390, 320],
        themes: ['light', 'dark'],
        cliFixtureCalls: calls.length,
        pinnedModel: activity.model,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
  await rm(dir, { recursive: true, force: true });
}
