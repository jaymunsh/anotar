import assert from 'node:assert/strict';
import { clickPageTool } from './qa-page-tools.mjs';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function runAiQa(browser, baseUrl, { configured = false, smoke = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1327, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const save = async (text) => {
    const body = new FormData();
    body.set('kind', 'note');
    body.set('text', text);
    body.set('aiRequest', JSON.stringify({ template: null, additional: '간결하게' }));
    const response = await fetch(baseUrl + '/api/captures', { method: 'POST', body });
    assert.equal(response.status, 201);
    return (await response.json()).item;
  };
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('느긋한 교토 여행을 계획하기 [SLOW]');
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('direct');
    await page.getByRole('button', { name: '저장하고 AI 요청', exact: true }).click();
    await page.getByText(/메모를 보관하고 AI 요청을 등록했어요\.|기기에 저장했어요\. 연결되면 동기화해요\./).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
      '',
    );
    let first;
    for (let attempt = 0; attempt < 100; attempt++) {
      const list = await (await fetch(baseUrl + '/api/captures?scope=ai')).json();
      first = list.items.find(item => item.text.includes('[SLOW]'));
      if (first) break;
      await page.waitForTimeout(100);
    }
    assert.ok(first, 'locally saved AI memo must sync before inspecting its job');
    await page.goto(baseUrl + '/captures/' + first.id, { waitUntil: 'domcontentloaded' });
    const panel = page.getByRole('region', { name: 'AI 처리 결과' });
    await panel.waitFor();
    if (!configured) {
      await panel.getByText('연결 필요', { exact: true }).waitFor();
      assert.equal(
        await panel.getByRole('button', { name: '현재 메모로 다시 요청' }).isEnabled(),
        false,
      );
      console.log('AI unavailable QA passed: raw save, distinct failure and connection-needed UI.');
      return;
    }
    await panel.locator('.ai-job-state').getByText('결과 준비됨', { exact: true }).waitFor();
    assert.match(await panel.locator('.ai-result-reading').textContent(), /여행 정리/);
    await panel.getByRole('button', { name: 'Markdown 복사', exact: true }).click();
    await panel.getByText('결과를 복사했어요.').waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /여행 정리/);
    assert.equal(await page.evaluate(() => window.aiInjected), undefined);
    const before = await (await fetch(baseUrl + '/api/captures/' + first.id)).json();
    const beforeJobs = await (await fetch(baseUrl + `/api/captures/${first.id}/ai-jobs`)).json();
    const parent = (
      await (
        await fetch(baseUrl + '/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'AI 리서치' }),
        })
      ).json()
    ).item;
    await panel.getByRole('button', { name: '결과를 페이지로 정리', exact: true }).click();
    const picker = page.locator('.detail-panel');
    const expectedPageTitle = '느긋한 교토 여행을 계획하기 [SLOW] · AI 요청 결과';
    assert.equal(
      await picker.getByRole('textbox', { name: '새 페이지 제목' }).inputValue(),
      expectedPageTitle,
    );
    await picker.getByRole('button', { name: 'AI 리서치 내 페이지', exact: true }).click();
    if (smoke) {
      await picker.getByText('정리 후 원본', { exact: true }).waitFor();
      assert.equal(await picker.locator('.capture-import-submit').textContent().then(text => text.trim()), '새 페이지로 정리');
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('AI request UI smoke passed: saved request synced, runner completed, result copied safely, new-page organization preview preserved.');
      return;
    }
    let lostPage = false;
    const pageSubmissions = [];
    await page.route('**/api/pages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      pageSubmissions.push(route.request().postDataJSON());
      if (!lostPage) {
        lostPage = true;
        await route.fetch();
        return route.abort('failed');
      }
      return route.continue();
    });
    await picker.locator('.capture-import-submit').click();
    await picker.getByText(/같은 요청으로 다시 확인/).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await panel.getByRole('button', { name: '결과를 페이지로 정리', exact: true }).click();
    await picker.locator('.capture-import-pending').waitFor();
    await picker.getByRole('button', { name: '같은 요청 다시 확인', exact: true }).click();
    await page.waitForURL(/\/pages\/.+\?import=/);
    await page.unroute('**/api/pages');
    assert.equal(pageSubmissions.length, 2);
    assert.deepEqual(pageSubmissions[1], pageSubmissions[0]);
    await page.locator('.bn-editor').waitFor();
    assert.equal(await page.locator('.capture-ref-block:visible').count(), 0);
    await page.locator('.bn-editor table').waitFor();
    await page.locator('[data-content-type="diagram"]').waitFor();
    const pageId = new URL(page.url()).pathname.split('/').at(-1);
    const adopted = (await (await fetch(baseUrl + '/api/pages/' + pageId)).json()).item;
    assert.ok(adopted.document.blocks.some((block) => block.type === 'bulletListItem'));
    assert.ok(adopted.document.blocks.some((block) => block.type === 'table'));
    assert.ok(adopted.document.blocks.some((block) => block.type === 'diagram'));
    assert.equal(adopted.title, expectedPageTitle);
    assert.equal(adopted.parentId, parent.id);
    assert.equal(
      (await (await fetch(baseUrl + '/api/pages')).json()).items.filter(
        (item) => item.title === expectedPageTitle,
      ).length,
      1,
    );
    const organizedSource = (await (await fetch(baseUrl + '/api/captures/' + first.id)).json())
      .item;
    for (const key of ['text', 'url', 'files', 'version', 'createdAt', 'updatedAt', 'aiRequest'])
      assert.deepEqual(organizedSource[key], before.item[key]);
    assert.ok(organizedSource.organizedAt);
    assert.equal(organizedSource.organizedPageId, pageId);
    assert.deepEqual(
      await (await fetch(baseUrl + `/api/captures/${first.id}/ai-jobs`)).json(),
      beforeJobs,
    );
    assert.equal(await page.evaluate(() => window.aiInjected), undefined);
    await clickPageTool(page, 'Markdown 복사');
    const pageMarkdown = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(pageMarkdown.startsWith('# ' + expectedPageTitle));
    assert.equal((pageMarkdown.match(/^# 여행 정리$/gm) || []).length, 1);
    assert.match(pageMarkdown, /```mermaid/);
    assert.match(pageMarkdown, /장소/);
    assert.match(pageMarkdown, /참고 링크/);
    assert.match(pageMarkdown, /https:\/\/example.com\/travel/);
    await page
      .locator('.bn-editor')
      .getByText('하루에 한 장소를 중심으로 여유 있게 여행해요.', { exact: true })
      .click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 추가 메모');
    let edited = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = (await (await fetch(baseUrl + '/api/pages/' + pageId)).json()).item;
      if (JSON.stringify(current.document).includes('추가 메모')) {
        edited = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    assert.ok(edited, 'Converted AI content can be edited and autosaved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .locator('.bn-editor')
      .getByText(/추가 메모/)
      .waitFor();
    await page.goto(baseUrl + '/captures/' + first.id, { waitUntil: 'domcontentloaded' });
    await panel.locator('.ai-job-state').getByText('결과 준비됨', { exact: true }).waitFor();
    await page.getByRole('button', { name: '항목 수정', exact: true }).click();
    await page
      .getByRole('textbox', { name: '보관한 내용', exact: true })
      .fill('다시 쓴 교토 여행 계획');
    await page.getByRole('button', { name: '변경 저장', exact: true }).click();
    await panel.getByText('이전 내용 기준', { exact: true }).waitFor();
    await panel.locator('.ai-request-again > summary').click();
    await panel.getByRole('button', { name: '현재 메모로 다시 요청', exact: true }).click();
    await panel.locator('.ai-job-state').getByText('결과 준비됨', { exact: true }).waitFor();
    await panel
      .locator('.ai-history')
      .getByText(/이전 요청/)
      .click();
    assert.ok((await panel.locator('.ai-history button').count()) >= 2);
    const failed = await save('실패 확인 [FAIL]');
    await page.goto(baseUrl + '/captures/' + failed.id, { waitUntil: 'domcontentloaded' });
    await panel.locator('.ai-job-state').getByText('처리 실패', { exact: true }).waitFor();
    await panel.getByText(/AI 실행에 실패/).waitFor();
    await panel.getByRole('button', { name: '실패한 요청 그대로 재시도' }).click();
    await panel.locator('.ai-job-state').getByText('처리 실패', { exact: true }).waitFor();

    const visible = await save('목록 상태 갱신 [SLOW]');
    await page.goto(baseUrl + '/memo?view=ai', { waitUntil: 'domcontentloaded' });
    await page
      .locator(`[data-capture-id="${visible.id}"] .memo-request-state`)
      .getByText('결과 준비됨', { exact: true })
      .waitFor();
    const hidden = await save('백그라운드 요청 [SLOW]');
    await page.goto(baseUrl + '/captures/' + hidden.id, { waitUntil: 'domcontentloaded' });
    await panel.waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    let hiddenRequests = 0;
    const count = (request) => {
      if (request.url().includes('/ai-jobs')) hiddenRequests++;
    };
    page.on('request', count);
    await page.waitForTimeout(2300);
    assert.equal(hiddenRequests, 0);
    page.off('request', count);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await panel.locator('.ai-job-state').getByText('결과 준비됨', { exact: true }).waitFor();

    // A committed response is lost: preserve UUID and the exact selected prompt through reload.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('응답 유실 뒤 한 번만 저장하기');
    let dropped = false;
    await page.route('**/api/captures', async (route) => {
      if (route.request().method() === 'POST' && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.locator('.feedback.error').waitFor();
    await page.unroute('**/api/captures');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByText('보관함에 저장했어요', { exact: true }).waitFor();
    const found = (
      await (
        await fetch(baseUrl + '/api/captures?q=' + encodeURIComponent('응답 유실 뒤 한 번만'))
      ).json()
    ).items;
    assert.equal(found.length, 1);

    if (process.env.QA_AI_SCREENSHOTS !== '0') {
      const screenshotDir = process.env.QA_AI_SCREENSHOT_DIR || '.impeccable/review/ai';
      await mkdir(screenshotDir, { recursive: true });
      for (const width of [1327, 390, 320])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl + '/captures/' + first.id, { waitUntil: 'domcontentloaded' });
          await panel.locator('.ai-job-state').getByText('결과 준비됨', { exact: true }).waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const inside = await panel.evaluate((el) => el.scrollWidth <= el.clientWidth);
          assert.ok(inside, 'AI panel overflow');
          for (const button of await panel.locator('button').all()) {
            if (!(await button.isVisible())) continue;
            const box = await button.boundingBox();
            if (box)
              assert.ok(
                box.height >= 44,
                `AI button smaller than 44px: ${await button.textContent()} ${box.height}`,
              );
          }
          await page.screenshot({ path: `${screenshotDir}/ai-${width}-${theme}.png` });
          await panel.getByRole('button', { name: '결과를 페이지로 정리', exact: true }).click();
          await picker.getByRole('textbox', { name: '새 페이지 제목' }).waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: `${screenshotDir}/import-${width}-${theme}.png` });
          await page.goto(baseUrl + '/pages/' + pageId, { waitUntil: 'domcontentloaded' });
          await page.locator('.bn-editor').waitFor();
          await page.locator('[data-content-type="diagram"] svg').waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: `${screenshotDir}/page-${width}-${theme}.png` });
        }
    }
    assert.deepEqual(errors, []);
    console.log(
      'AI QA passed: raw save, status/result, AI child page/Markdown/table/Mermaid/sources, editable autosave, lost adoption response/reload/replay, source/result preservation, current request/history, failure/retry and visible/hidden polling.' +
        (process.env.QA_AI_SCREENSHOTS !== '0' ? ' 18 responsive theme captures.' : ''),
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-ai-qa-'));
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    if (input.prompt.includes('[SLOW]')) await new Promise((r) => setTimeout(r, 1100));
    if (input.prompt.includes('[FAIL]')) {
      res.writeHead(500);
      res.end('fixture failure');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        sources: [{ title: '여행 지도', url: 'https://example.com/travel' }],
        markdown:
          '# 여행 정리\n\n하루에 한 장소를 중심으로 여유 있게 여행해요.\n\n- 숙소 위치 확인\n- 산책할 골목 저장\n- 교통편 예약\n\n| 장소 | 일정 |\n| --- | --- |\n| 골목 | 산책 |\n\n```mermaid\ngraph TD\n A[숙소] --> B[산책]\n```\n\n<script>window.aiInjected=true</script>\n\nhttps://example.com/a-very-long-resource-address-for-a-compact-mobile-detail-view',
      }),
    );
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'http',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
      AI_RUNNER_LABEL: '개발용 실행기',
      AI_RUNNER_MODE: 'test',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runAiQa(browser, `http://127.0.0.1:${port}`, { configured: true, smoke: process.env.QA_AI_SMOKE === '1' });
  } finally {
    await browser?.close();
    const exited = once(server, 'exit');
    server.kill();
    await exited;
    await new Promise((r) => gateway.close(r));
    await rm(dir, { recursive: true, force: true });
  }
}
