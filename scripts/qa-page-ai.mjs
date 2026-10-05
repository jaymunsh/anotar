import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clickPageTool } from './qa-page-tools.mjs';

const paragraph = (text) => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPageAiQa(browser, baseUrl, calls) {
  const context = await browser.newContext({
    viewport: { width: 1327, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const widths = process.env.QA_PAGE_AI_WIDTHS
    ? process.env.QA_PAGE_AI_WIDTHS.split(',').map(Number)
    : [1327, 390, 320];
  assert.ok(widths.length && widths.every((width) => [1327, 390, 320].includes(width)));
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  const openAi = async () => {
    const tool = page.getByRole('button', { name: '페이지 AI 요청', exact: true });
    if ((await tool.getAttribute('aria-expanded')) !== 'true') await tool.click();
    await page.getByRole('region', { name: '페이지 AI', exact: true }).waitFor();
  };
  const get = async (path) => {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const send = async (path, body, { method = 'POST', status } = {}) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (status !== undefined)
      assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
    else assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const readPage = async (id) => (await get('/api/pages/' + id)).item;
  const waitUntil = async (read, accept) => {
    for (let index = 0; index < 900; index++) {
      const value = await read();
      if (accept(value)) return value;
      await pause(50);
    }
    throw new Error('Page AI fixture did not reach the expected state.');
  };
  const waitJob = async (id) =>
    waitUntil(
      async () => (await get('/api/ai-jobs/' + id)).item,
      (item) => item.status === 'result_ready' || item.status === 'failed',
    );
  try {
    const body = new FormData();
    body.set('kind', 'file');
    body.set('text', '예약 번호 확인하고 여유로운 여행 일정 만들기');
    body.append(
      'files',
      new Blob(['PRIVATE-ATTACHMENT-BYTES'], { type: 'text/plain' }),
      '준비물.txt',
    );
    const response = await fetch(baseUrl + '/api/captures', { method: 'POST', body });
    assert.equal(response.status, 201);
    const original = (await response.json()).item;
    const target = (await send('/api/pages', { title: '이번 주 여행 노트' })).item;
    const legacy = (await send('/api/pages', { title: '이전에 정리한 노트' })).item;
    await send(`/api/pages/${legacy.id}/capture-imports`, {
      operationId: randomUUID(),
      captureId: original.id,
      copyContent: true,
      assetIds: [],
    });
    const legacySaved = await readPage(legacy.id);
    const legacyRef = legacySaved.document.blocks.find((block) => block.type === 'captureRef');
    assert.ok(legacyRef);
    const legacyParent = paragraph('출처가 들어 있어도 부모 문장은 보여야 해요.');
    legacyParent.children = [
      {
        ...legacyRef,
        id: randomUUID(),
        children: [paragraph('숨긴 출처 아래의 작성 내용도 유지해요.')],
      },
    ];
    await send(
      '/api/pages/' + legacy.id,
      {
        title: legacySaved.title,
        expectedVersion: legacySaved.version,
        document: {
          ...legacySaved.document,
          blocks: [...legacySaved.document.blocks, legacyParent],
        },
      },
      { method: 'PUT', status: 200 },
    );

    const organize = {
      operationId: randomUUID(),
      captureId: original.id,
      disposition: 'organize',
      copyContent: true,
      assetIds: [original.files[0].id],
    };
    const imported = await send(`/api/pages/${target.id}/capture-imports`, organize);
    assert.equal(
      imported.item.document.blocks.some((block) => block.type === 'captureRef'),
      false,
    );
    assert.ok(imported.item.document.blocks.some((block) => block.type === 'asset'));
    const organized = (await get('/api/captures/' + original.id)).item;
    assert.ok(organized.organizedAt);
    assert.equal(organized.organizedPageId, target.id);
    for (const key of ['text', 'url', 'files', 'version', 'createdAt', 'updatedAt', 'aiRequest'])
      assert.deepEqual(organized[key], original[key], `Organization preserves ${key}`);
    assert.equal(
      (await get('/api/captures')).items.some((item) => item.id === original.id),
      false,
    );
    assert.ok(
      (await get('/api/captures?organization=organized')).items.some(
        (item) => item.id === original.id,
      ),
    );
    assert.equal(
      (await get('/api/search?q=' + encodeURIComponent('예약 번호'))).items.some(
        (item) => item.type === 'memo',
      ),
      false,
    );
    assert.equal(
      (await get('/api/search?q=' + encodeURIComponent('준비물'))).items.find(
        (item) => item.type === 'file',
      )?.href,
      '/pages/' + target.id,
    );
    assert.ok(
      (await get(`/api/pages/${target.id}/origins`)).items.some(
        (item) => item.capture.id === original.id,
      ),
    );
    assert.equal((await fetch(baseUrl + '/api/assets/' + original.files[0].id)).status, 200);

    const hiddenReads = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/captures/' + original.id)
        hiddenReads.push(request.url());
    });
    await page.goto(baseUrl + '/pages/' + legacy.id, { waitUntil: 'networkidle' });
    await page.locator('.bn-editor[contenteditable=true]').waitFor();
    assert.equal(await page.locator('.capture-ref-block:visible').count(), 0);
    await page.getByText('출처가 들어 있어도 부모 문장은 보여야 해요.', { exact: true }).waitFor();
    await page.getByText('숨긴 출처 아래의 작성 내용도 유지해요.', { exact: true }).waitFor();
    assert.deepEqual(hiddenReads, [], 'Hidden legacy source blocks do not fetch each Capture.');
    await clickPageTool(page, 'Markdown 보기');
    assert.equal(
      (await page.locator('.page-markdown-source').inputValue()).includes(original.id),
      false,
    );
    assert.match(await page.locator('.page-markdown-source').inputValue(), /부모 문장은 보여야/);
    assert.match(await page.locator('.page-markdown-source').inputValue(), /작성 내용도 유지/);
    assert.ok(
      (await readPage(legacy.id)).document.blocks.some((block) => block.type === 'captureRef'),
      'Opening/export does not rewrite a legacy document.',
    );

    await page.goto(baseUrl + '/pages/' + target.id, { waitUntil: 'networkidle' });
    await openAi();
    const ai = page.getByRole('region', { name: '페이지 AI', exact: true });
    await ai.waitFor();
    const templates = (await get('/api/prompt-templates')).items;
    const template = templates.find((item) => item.kind === 'free' && !item.archived);
    assert.ok(template);
    await ai.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption(template.id);
    if (await ai.locator('.ai-additional-options').getAttribute('open') === null) await ai.locator('.ai-additional-options > summary').click();
    await ai.getByRole('textbox', { name: 'AI 추가 요청' }).fill('세 가지로 정리 [SLOW-PAGE]');
    let lostRequest = false;
    const requestBodies = [];
    await page.route('**/api/sync/operations', async (route) => {
      const body=route.request().postDataJSON();
      if(body.kind!=='ai.submit'||body.entityId!==target.id)return route.continue();
      requestBodies.push(body);
      if (lostRequest) return route.continue();
      lostRequest = true;
      await route.fetch();
      return route.abort('failed');
    });
    await ai.getByRole('button', { name: '현재 페이지로 요청', exact: true }).click();
    const requested = (await waitUntil(()=>get(`/api/pages/${target.id}/ai-jobs`),result=>result.items.length>0)).items[0];
    assert.equal(requested.pageId, target.id);
    assert.equal(requested.captureId, null);
    assert.match(requested.request.input.content, /이번 주 여행 노트/);
    assert.match(requested.request.input.content, /예약 번호/);
    assert.doesNotMatch(requested.request.prompt, /PRIVATE-ATTACHMENT-BYTES/);
    assert.equal(requested.request.prompt.includes(original.files[0].id), false);
    await page.reload({waitUntil:'networkidle'});await openAi();
    await waitUntil(async()=>requestBodies.length,count=>count>=2);
    assert.deepEqual(requestBodies[1],requestBodies[0]);
    await page.unroute('**/api/sync/operations');
    await ai.locator('.ai-job-heading .ai-job-state').filter({ hasText: '결과 준비됨' }).waitFor();
    const resultJob = await waitJob(requested.id);
    assert.equal(resultJob.status, 'result_ready');
    assert.equal((await get(`/api/pages/${target.id}/ai-jobs`)).items.length, 1);
    const beforeApply = await readPage(target.id);
    let lostApply = false;
    const applyBodies = [];
    await page.route(`**/api/pages/${target.id}/ai-applies`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      applyBodies.push(route.request().postDataJSON());
      if (lostApply) return route.continue();
      lostApply = true;
      await route.fetch();
      return route.abort('failed');
    });
    await ai.getByRole('button', { name: '본문 아래 추가', exact: true }).click();
    await ai.getByRole('button', { name: '같은 요청 다시 확인', exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await openAi();
    await ai.getByRole('button', { name: '같은 요청 다시 확인', exact: true }).click();
    await waitUntil(()=>applyBodies.length,n=>n>=2);
    assert.equal(applyBodies.length, 2);
    assert.deepEqual(applyBodies[1], applyBodies[0]);
    await page.unroute(`**/api/pages/${target.id}/ai-applies`);
    await waitUntil(
      () => readPage(target.id),
      (item) => item.version === beforeApply.version + 1,
    );
    const adopted = await readPage(target.id);
    assert.equal(adopted.document.blocks.filter((block) => block.type === 'diagram').length, 1);
    assert.equal(adopted.document.blocks.filter((block) => block.type === 'table').length, 1);
    assert.ok(adopted.document.blocks.some((block) => block.type === 'asset'));
    assert.equal(JSON.stringify(adopted.document).includes('https://example.com/reference'), true);
    assert.equal(await page.evaluate(() => window.aiInjected), undefined);
    assert.deepEqual((await get('/api/ai-jobs/' + requested.id)).item.result, resultJob.result);
    await ai.getByRole('button', { name: 'AI 반영 되돌리기', exact: true }).click();
    await waitUntil(
      () => readPage(target.id),
      (item) => JSON.stringify(item.document) === JSON.stringify(beforeApply.document),
    );

    const beforeUiSelection = await readPage(target.id);
    await page.reload({ waitUntil: 'networkidle' });
    const selectedText = page.locator('.bn-editor').getByText(original.text, { exact: true });
    await selectedText.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    assert.ok(await page.evaluate(() => Boolean(window.getSelection()?.toString().trim())));
    await openAi();
    await ai.getByRole('radio', { name: /선택한 블록/ }).check();
    await ai.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption(template.id);
    if (await ai.locator('.ai-additional-options').getAttribute('open') === null) await ai.locator('.ai-additional-options > summary').click();
    await ai.getByRole('textbox', { name: 'AI 추가 요청' }).fill('선택한 문단을 정리해 주세요.');
    const selectionSubmitted = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/sync/operations' && request.postDataJSON()?.kind==='ai.submit' && request.postDataJSON()?.entityId===target.id,
      {timeout:45000},
    );
    await ai.getByRole('button', { name: '현재 페이지로 요청', exact: true }).click();
    const selectedOperation = (await selectionSubmitted).postDataJSON();
    const selectedBody={...selectedOperation.payload,expectedVersion:selectedOperation.baseVersion};
    assert.equal(selectedBody.expectedVersion, beforeUiSelection.version);
    assert.ok(
      selectedBody.blockIds.length > 0,
      'Native editor selection is captured before toolbar focus.',
    );
    const uiSelectionJob = await waitUntil(
      async () => (await get(`/api/pages/${target.id}/ai-jobs`)).items,
      (items) => items.some((item) => item.requestId === selectedBody.requestId),
    ).then((items) => items.find((item) => item.requestId === selectedBody.requestId));
    const uiSelectionResult = await waitJob(uiSelectionJob.id);
    assert.deepEqual(uiSelectionResult.targetBlockIds, selectedBody.blockIds);
    assert.match(uiSelectionResult.request.input.content, /예약 번호/);
    assert.doesNotMatch(uiSelectionResult.request.input.content, /PRIVATE-ATTACHMENT-BYTES/);
    await ai.getByRole('button', { name: '선택한 블록 교체', exact: true }).click();
    const uiReplaced = await waitUntil(
      () => readPage(target.id),
      (item) => item.version === beforeUiSelection.version + 1,
    );
    assert.ok(uiReplaced.document.blocks.some((block) => block.type === 'asset'));
    assert.equal(
      uiReplaced.document.blocks.some((block) => selectedBody.blockIds.includes(block.id)),
      false,
    );
    await ai.getByRole('button', { name: 'AI 반영 되돌리기', exact: true }).click();
    await waitUntil(
      () => readPage(target.id),
      (item) => JSON.stringify(item.document) === JSON.stringify(beforeUiSelection.document),
    );

    const selectedBase = await readPage(target.id);
    const selectedBlock = selectedBase.document.blocks.find(
      (block) => block.type === 'paragraph' && block.content?.length,
    );
    assert.ok(selectedBlock);
    const selectionRequest = {
      requestId: randomUUID(),
      expectedVersion: selectedBase.version,
      aiRequest: { template, additional: '선택 내용만 정리' },
      blockIds: [selectedBlock.id],
    };
    const selectionJob = (await send(`/api/pages/${target.id}/ai-jobs`, selectionRequest)).item;
    const selectionResult = await waitJob(selectionJob.id);
    assert.equal(selectionResult.status, 'result_ready');
    const replacement = {
      schemaVersion: 1,
      blocks: [paragraph('선택한 문단을 간결하게 정리했어요.')],
    };
    const replace = await send(`/api/pages/${target.id}/ai-applies`, {
      operationId: randomUUID(),
      expectedVersion: selectedBase.version,
      jobId: selectionJob.id,
      mode: 'replace',
      document: replacement,
    });
    assert.equal(
      replace.item.document.blocks.some((block) => block.id === selectedBlock.id),
      false,
    );
    assert.ok(replace.item.document.blocks.some((block) => block.type === 'asset'));
    await send(
      `/api/pages/${target.id}/ai-applies/${replace.operationId}/undo`,
      {
        operationId: randomUUID(),
        expectedVersion: replace.item.version,
      },
      { status: 200 },
    );

    const staleBase = await readPage(target.id);
    const staleJob = (
      await send(`/api/pages/${target.id}/ai-jobs`, {
        ...selectionRequest,
        requestId: randomUUID(),
        expectedVersion: staleBase.version,
        aiRequest: { template, additional: '추가 조사 [SLOW-PAGE]' },
      })
    ).item;
    const edited = (
      await send(
        '/api/pages/' + target.id,
        {
          title: '직접 수정한 여행 노트',
          document: staleBase.document,
          expectedVersion: staleBase.version,
        },
        { method: 'PUT', status: 200 },
      )
    ).item;
    const staleResult = await waitJob(staleJob.id);
    assert.equal(staleResult.stale, true);
    assert.equal(staleResult.sourceTitle, staleBase.title);
    assert.match(staleResult.request.input.content, /예약 번호/);
    assert.doesNotMatch(staleResult.request.input.content, /직접 수정한 여행 노트/);
    const staleApply = await fetch(baseUrl + `/api/pages/${target.id}/ai-applies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: randomUUID(),
        expectedVersion: edited.version,
        jobId: staleJob.id,
        mode: 'replace',
        document: replacement,
      }),
    });
    assert.equal(staleApply.status, 409);
    assert.deepEqual((await readPage(target.id)).document, staleBase.document);
    const child = await send(`/api/pages/${target.id}/ai-applies`, {
      operationId: randomUUID(),
      expectedVersion: edited.version,
      jobId: staleJob.id,
      mode: 'child',
      title: '여행 조사 결과',
      document: replacement,
    });
    assert.equal(child.item.parentId, target.id);
    assert.equal((await readPage(target.id)).version, edited.version);
    const appended = await send(`/api/pages/${target.id}/ai-applies`, {
      operationId: randomUUID(),
      expectedVersion: edited.version,
      jobId: staleJob.id,
      mode: 'append',
      document: replacement,
    });
    const later = (
      await send(
        '/api/pages/' + target.id,
        {
          title: '되돌리기 전 새 편집',
          document: appended.item.document,
          expectedVersion: appended.item.version,
        },
        { method: 'PUT', status: 200 },
      )
    ).item;
    const undoConflict = await fetch(
      baseUrl + `/api/pages/${target.id}/ai-applies/${appended.operationId}/undo`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: randomUUID(), expectedVersion: later.version }),
      },
    );
    assert.equal(undoConflict.status, 409);
    assert.equal((await readPage(target.id)).title, later.title);

    if (process.env.QA_PAGE_AI_SCREENSHOTS !== '0') {
      const folder = process.env.QA_PAGE_AI_SCREENSHOT_DIR || '.impeccable/review/page-ai';
      await mkdir(folder, { recursive: true });
      for (const width of widths)
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl + '/pages/' + target.id, { waitUntil: 'networkidle' });
          await page.locator('.bn-editor[contenteditable=true]').waitFor();
          assert.equal(await page.locator('.capture-ref-block:visible').count(), 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const status = page.locator('.page-document-controls .page-save-state');
          assert.equal(
            await status.evaluate((element) => getComputedStyle(element).whiteSpace),
            'nowrap',
          );
          await page.screenshot({ path: `${folder}/page-${width}-${theme}.png` });
          await openAi();
          await ai
            .locator('.ai-job-heading .ai-job-state')
            .filter({ hasText: '결과 준비됨' })
            .waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: `${folder}/ai-${width}-${theme}.png` });
        }
    }

    await page.goto(baseUrl + '/memo', { waitUntil: 'networkidle' });
    await page
      .getByRole('combobox', { name: '메모 정리 상태', exact: true })
      .selectOption('organized');
    await page.locator('.capture-card').filter({ hasText: original.text }).click();
    await page.getByRole('button', { name: '입력함으로 되돌리기', exact: true }).click();
    await waitUntil(
      async () => (await get('/api/captures')).items,
      (items) => items.some((item) => item.id === original.id),
    );
    const restored = (await get('/api/captures/' + original.id)).item;
    assert.equal(restored.organizedAt, null);
    await send(`/api/pages/${target.id}/capture-imports`, organize);
    assert.equal(
      (await get('/api/captures/' + original.id)).item.organizedAt,
      null,
      'Old import replay does not organize a restored memo.',
    );
    assert.ok(calls.length >= 3);
    assert.ok(calls.every((call) => !call.prompt.includes('PRIVATE-ATTACHMENT-BYTES')));
    assert.deepEqual(errors, []);
    console.log(
      'Page AI QA passed: organize/restore/search/file ownership, no legacy body cards or hidden fetches, saved Page request and immutable snapshot, request/apply response loss/reload/UUID replay, table/Mermaid/sources, append/selected replacement/child, undo and edit/version conflicts; original/job/assets preserved.' +
        (process.env.QA_PAGE_AI_SCREENSHOTS !== '0'
          ? ` ${widths.length * 4} responsive theme captures.`
          : ''),
    );
  } catch (cause) {
    await writeFile(
      '.omo/evidence/lifecycle-ui-failure.json',
      JSON.stringify(
        {
          message: String(cause),
          url: page.url(),
          panel: await page
            .locator('.page-ai-panel')
            .textContent()
            .catch(() => null),
          storage: await page.evaluate(() =>
            Object.fromEntries(
              Object.entries(localStorage).filter(([key]) => key.includes('page-ai')),
            ),
          ),
          pageErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    throw cause;
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = await mkdtemp(join(tmpdir(), 'leneu-page-ai-qa-'));
  const calls = [];
  const gateway = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    calls.push(input);
    if (input.prompt.includes('[SLOW-PAGE]')) await pause(1000);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        markdown:
          '# 여행 정리\n\n하루에 한 장소를 중심으로 여유 있게 여행해요.\n\n- 예약 번호 확인\n- 산책할 골목 저장\n\n| 장소 | 일정 |\n| --- | --- |\n| 골목 | 산책 |\n\n```mermaid\ngraph TD\n A[숙소] --> B[산책]\n```\n\n<script>window.aiInjected=true</script>',
        sources: [{ title: '여행 참고 자료', url: 'https://example.com/reference' }],
      }),
    );
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_RUNNER_KIND: 'http',
      AI_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
      AI_RUNNER_LABEL: '개발용 실행기',
      AI_RUNNER_MODE: 'test',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    let ready = false;
    for (let index = 0; index < 900; index++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await pause(50);
    }
    assert.ok(ready, 'Temporary Page AI server started.');
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runPageAiQa(browser, `http://127.0.0.1:${port}`, calls);
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const ended = once(server, 'exit');
      server.kill();
      await ended;
    }
    await new Promise((resolve) => gateway.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}
