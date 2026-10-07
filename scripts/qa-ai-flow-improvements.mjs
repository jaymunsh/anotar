import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const output = '.omo/evidence/ai-flow-improvements';
await mkdir(output, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'anotar-ai-flow-'));
const store = openStore(dir);
const execution = { profileId: 'hive', model: 'qa-model' };
const selection = { template: null, additional: '기존 요청의 지시', execution };
const originalText = '요청 당시 원본 메모: 다음 주 제품 출시를 준비한다.';
const resultText =
  '# 출시 준비 요약\n\n제품 페이지 확인과 고객 안내를 먼저 진행합니다.\n\n## 다음 단계\n\n- 안내 초안 작성\n- 배포 일정 확인\n\n' +
  '제품 출시 후 고객 반응과 지원 요청을 확인합니다.\n\n'.repeat(15).trimEnd();
const capture = store.createCapture({ kind: 'note', text: originalText, aiRequest: selection });
const resultJob = store.claimAiJob({ label: '임시 검증 실행기', mode: 'test' });
store.completeAiJob(resultJob.id, resultJob.runToken, {
  markdown: resultText,
  sources: [],
  usage: null,
});
const failureCapture = store.createCapture({
  kind: 'note',
  text: '실패 당시 원본',
  aiRequest: selection,
});
const failure = store.claimAiJob();
store.failAiJob(failure.id, failure.runToken, 'timeout');
store.updateCapture({
  id: failureCapture.id,
  expectedVersion: failureCapture.version,
  text: '실패 후 수정한 현재 메모',
  url: '',
});
let pageRecord = store.createPage({ title: '출시 준비 페이지' });
store.importCaptureIntoPage({
  pageId: pageRecord.id,
  captureId: capture.id,
  operationId: randomUUID(),
  disposition: 'organize',
  copyContent: true,
  assetIds: [],
});
store.close();
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
// No .env or inherited provider credentials; all background execution is disabled.
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    PATH: process.env.PATH,
    LANG: 'en_US.UTF-8',
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    PORT: String(port),
    AUTH_MODE: 'disabled',
    AI_RUNNER_KIND: 'disabled',
    AI_OPENCODE_ENABLED: 'false',
    HIVE_MODEL: 'qa-model',
    BACKGROUND_WORKERS_ENABLED: 'false',
    COMMENT_SOCKET_PATH: join(dir, 'comments.sock'),
  },
  stdio: 'pipe',
});
let serverLogs = '';
child.stderr.on('data', (chunk) => {
  serverLogs += chunk;
});
let browser;
const errors = [];
const json = async (path) => await (await fetch(base + path)).json();
// Reloaded navigation can wait for the prior sync leader's 30s lease to expire.
async function waitFor(check, attempts = 450) {
  for (let i = 0; i < attempts; i++) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw Error('Fixture condition did not become true');
}
try {
  await waitFor(async () => {
    try {
      return (await fetch(base + '/api/health')).ok;
    } catch {
      return false;
    }
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  // Only the connection presentation is a fixture. Saves, sync, ownership, retry and jobs use the real server.
  await context.route('**/api/ai/settings', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 0,
        defaultProfile: 'hive',
        profiles: [
          {
            id: 'hive',
            label: '임시 QA 실행기',
            model: 'qa-model',
            enabled: true,
            status: 'configured',
            credentialsConfigured: true,
            researchModes: ['url', 'keyword'],
          },
        ],
      }),
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('보존해야 하는 작성 중 초안');
  await pause(350);
  await page.goto(base + `/captures/${capture.id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.ai-result-summary').waitFor();
  assert.equal(await page.getByRole('article', { name: 'AI 결과 본문' }).isVisible(), false);
  assert.equal(await page.getByRole('region', { name: '연결된 페이지', exact: true }).count(), 0);
  await page.getByRole('button', { name: '입력함으로 되돌리기', exact: true }).waitFor();
  if (process.env.QA_AI_FLOW_SCREENSHOTS !== '0')
    await page.screenshot({ path: `${output}/memo-compact-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '이 결과로 추가 요청', exact: true }).click();
  const form = page.getByRole('region', { name: 'AI 추가 요청', exact: true });
  await form.waitFor();
  await form
    .getByText('원하는 작업을 적거나 작업 지시가 담긴 템플릿을 선택해 주세요.', { exact: true })
    .waitFor();
  assert.equal(
    await form.getByRole('button', { name: '새 AI 요청 등록', exact: true }).isDisabled(),
    true,
  );
  await form
    .getByRole('textbox', { name: 'AI 추가 요청', exact: true })
    .fill('담당자별 체크리스트로 만들어 주세요.');
  assert.equal(
    await form.getByRole('radio', { name: '현재 AI 결과', exact: true }).isChecked(),
    true,
  );
  assert.equal(await form.getByRole('radio', { name: /선택/ }).count(), 0);
  await form.locator('.ai-followup-source summary').click();
  assert.equal(await form.locator('.ai-followup-source pre').textContent(), resultText);
  await form.getByRole('radio', { name: '원본 메모 · 요청 당시 사본', exact: true }).check();
  assert.equal(await form.locator('.ai-followup-source pre').textContent(), originalText);
  assert.equal(
    await form.getByRole('textbox', { name: 'AI 추가 요청', exact: true }).inputValue(),
    '담당자별 체크리스트로 만들어 주세요.',
  );
  await form.getByRole('radio', { name: '현재 AI 결과', exact: true }).check();
  await form.locator('.ai-followup-source summary').click();
  await form.getByRole('button', { name: '새 AI 요청 등록', exact: true }).waitFor();
  await waitFor(
    async () =>
      await form.getByRole('button', { name: '새 AI 요청 등록', exact: true }).isEnabled(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog', { name: '보관한 항목', exact: true }).waitFor();
  await form.getByText('작성하던 추가 요청 초안을 이어서 열었어요.', { exact: true }).waitFor();
  assert.equal(
    await form.getByRole('textbox', { name: 'AI 추가 요청', exact: true }).inputValue(),
    '담당자별 체크리스트로 만들어 주세요.',
  );
  assert.equal(
    await form.getByRole('radio', { name: '현재 AI 결과', exact: true }).isChecked(),
    true,
  );
  await page.setViewportSize({ width: 1327, height: 1000 });
  await page.getByRole('region', { name: '보관한 항목', exact: true }).waitFor();
  assert.equal(
    await form.getByRole('textbox', { name: 'AI 추가 요청', exact: true }).inputValue(),
    '담당자별 체크리스트로 만들어 주세요.',
  );
  await waitFor(
    async () =>
      await form.getByRole('button', { name: '새 AI 요청 등록', exact: true }).isEnabled(),
  );
  if (process.env.QA_AI_FLOW_SCREENSHOTS !== '0')
    await page.screenshot({ path: `${output}/followup-desktop.png`, fullPage: true });
  await form.getByRole('button', { name: '새 AI 요청 등록', exact: true }).click();
  const created = await waitFor(async () => {
    const data = await json('/api/captures?scope=ai&organization=inbox');
    return data.items.find((item) => item.id !== capture.id && item.text === resultText);
  });
  assert.notEqual(created.id, capture.id);
  assert.equal(created.aiRequest.additional, '담당자별 체크리스트로 만들어 주세요.');
  assert.equal(created.aiRequest.input.content, resultText);
  assert.deepEqual(created.aiRequest.execution, execution);
  assert.equal((await json(`/api/captures/${capture.id}`)).item.text, originalText);
  assert.equal((await json(`/api/ai-jobs/${resultJob.id}`)).item.result.markdown, resultText);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(
    await page.getByRole('textbox', { name: '메모 내용', exact: true }).inputValue(),
    '보존해야 하는 작성 중 초안',
  );
  await page.goto(base + `/captures/${failureCapture.id}?aiJob=${failure.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: '요청 수정·실행기 변경', exact: true }).click();
  const edit = page.getByRole('region', { name: 'AI 요청 수정', exact: true });
  assert.equal(
    await edit.getByRole('textbox', { name: 'AI 추가 요청', exact: true }).inputValue(),
    '기존 요청의 지시',
  );
  await edit.locator('.ai-followup-source summary').click();
  assert.equal(await edit.locator('.ai-followup-source pre').textContent(), '실패 당시 원본');
  await edit.getByRole('button', { name: '취소', exact: true }).click();
  const retryButton = page.getByRole('button', { name: '같은 조건으로 재시도', exact: true });
  await retryButton.click();
  await pause(1200);
  await page.getByRole('region', { name: '기기에서 전송 대기', exact: true }).waitFor();
  assert.equal(
    await retryButton.isDisabled(),
    true,
    'Pending AI submission must block a second registration',
  );
  await retryButton.click({ force: true });
  const pendingRetryIds = await page.evaluate(async (retryOf) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('leneu-offline-v1', 2);
      request.onsuccess = () => resolve(request.result);
    });
    const pending = await new Promise((resolve) => {
      const request = db.transaction('outbox').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return pending
      .filter(
        (row) => row.operation.kind === 'ai.submit' && row.operation.payload.retryOf === retryOf,
      )
      .map((row) => row.operation.operationId);
  }, failure.id);
  assert.equal(new Set(pendingRetryIds).size, 1);

  // Rapid hard-navigation can leave a previous engine's 30s fenced lease alive.
  // Wait for admission while the existing workflow queue reports the actual pending state.
  const retry = await waitFor(
    async () =>
      (await json(`/api/captures/${failureCapture.id}/ai-jobs`)).items.find(
        (job) => job.retryOf === failure.id,
      ),
    400,
  );
  assert.equal(
    (await json(`/api/captures/${failureCapture.id}/ai-jobs`)).items.filter(
      (job) => job.retryOf === failure.id,
    ).length,
    1,
  );
  assert.equal(retry.request.input.content, '실패 당시 원본');
  assert.equal(retry.request.additional, '기존 요청의 지시');
  assert.deepEqual(retry.request.execution, execution);
  assert.equal(
    (await json(`/api/captures/${failureCapture.id}`)).item.text,
    '실패 후 수정한 현재 메모',
  );
  await page.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /^확인할 결과/ }).click();
  await page.locator(`[data-ai-job-id="${resultJob.id}"]`).waitFor();
  assert.match(
    await page.locator(`[data-ai-job-id="${resultJob.id}"]`).textContent(),
    /원본 정리 완료/,
  );
  if (process.env.QA_AI_FLOW_SCREENSHOTS !== '0')
    await page.screenshot({ path: `${output}/activity-desktop.png`, fullPage: true });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(base + `/captures/${capture.id}?aiJob=${resultJob.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await mobile.getByRole('button', { name: '이 결과로 추가 요청', exact: true }).click();
  const mobileForm = mobile.getByRole('region', { name: 'AI 추가 요청', exact: true });
  await mobileForm.getByText('서버에서 AI 실행이 꺼져 있어요.', { exact: true }).waitFor();
  assert.equal(
    await mobileForm.getByRole('button', { name: '새 AI 요청 등록', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  if (process.env.QA_AI_FLOW_SCREENSHOTS !== '0')
    await mobile.screenshot({ path: `${output}/followup-mobile-disabled.png`, fullPage: true });
  await mobileForm.getByRole('button', { name: '취소', exact: true }).click();
  await mobile.goto(base + '/ai', { waitUntil: 'domcontentloaded' });
  await mobile.locator('.activity-list').waitFor();
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  if (process.env.QA_AI_FLOW_SCREENSHOTS !== '0')
    await mobile.screenshot({ path: `${output}/activity-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/qa-report.json`,
    JSON.stringify(
      {
        passed: true,
        sourceChoice: true,
        independentCapture: true,
        priorSourceAndResultPreserved: true,
        existingComposerDraftPreserved: true,
        requestEditFixedInput: true,
        fixedRetrySourceAndExecution: true,
        pendingRetrySingleUUID: true,
        pendingRetrySingleBackendJob: true,
        portalRemountDraftPreserved: true,
        disabledRunnerBlocksSubmission: true,
        mobileNoOverflow: true,
        pageErrors: errors,
        providerCalls: 0,
        fixtureDirRemovedOnExit: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'AI flow QA PASS: frozen result/original source, independent capture submission, original/result and existing draft preservation, fixed failure retry and editable new request, no connection-tracking section, compact result, activity and 390px disabled-runner form. Temporary fixtures, workers disabled, zero provider calls.',
  );
  await mobileContext.close();
  await context.close();
} catch (error) {
  console.error(serverLogs.slice(-1500));
  throw error;
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await rm(dir, { recursive: true, force: true });
}
