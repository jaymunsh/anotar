import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { selectAppTheme } from './qa-compact-pages.mjs';

const dir = await mkdtemp(join(tmpdir(), 'leneu-task-board-'));
const evidence = '.omo/evidence/task-board';
await mkdir(evidence, { recursive: true });
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    PORT: String(port),
    AI_RUNNER_KIND: 'disabled',
    AI_RUNNER_URL: '',
  },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const api = async (path, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  };
  const create = async (title, stage = 'todo') => {
    let { item } = await api('/api/tasks', { title });
    if (stage !== 'todo')
      ({ item } = await api(
        `/api/tasks/${item.id}`,
        { stage, expectedVersion: item.version },
        'PATCH',
      ));
    return item;
  };
  const waitStage = async (id, stage) => {
    for (let i = 0; i < 100; i++) {
      const { item } = await api('/api/tasks/' + id);
      if (item.stage === stage) return item;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error('stage not saved: ' + stage);
  };
  const a = await create('숙소 예약과 체크인 시간 확인');
  const b = await create('여행 일정에 이동 시간 정리', 'doing');
  const c = await create('공유할 준비물 목록 정리', 'done');
  const d = await create(
    '긴 제목도 깔끔하게 읽을 수 있도록 줄바꿈과 카드 너비를 확인하는 할 일 '.repeat(4),
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/tasks', { waitUntil: 'networkidle' });
  await page.locator('.task-board').waitFor();
  const column = (stage) => page.locator(`[data-task-stage="${stage}"]`);
  const row = (id) => page.locator(`[data-task-id="${id}"]`);
  await column('todo').locator(`[data-task-id="${a.id}"]`).waitFor();
  await column('doing').locator(`[data-task-id="${b.id}"]`).waitFor();
  await column('done').locator(`[data-task-id="${c.id}"]`).waitFor();
  await page.screenshot({ path: evidence + '/desktop-light.png', fullPage: true });
  // Actual native drag transfers the existing task; no second task is created.
  await row(a.id).dragTo(column('doing'));
  await waitStage(a.id, 'doing');
  await column('doing').locator(`[data-task-id="${a.id}"]`).waitFor();
  assert.equal(await page.locator('.task-board .task-stage-control').count(), 0);
  await row(a.id)
    .getByRole('button', { name: a.title + ' 수정', exact: true })
    .click();
  await row(a.id).getByRole('combobox', { name: '할 일 상태' }).selectOption('done');
  await row(a.id).getByRole('button', { name: '저장', exact: true }).click();
  await waitStage(a.id, 'done');
  await column('done').locator(`[data-task-id="${a.id}"]`).waitFor();
  // Editing locks view/state changes and retains a draft across a mobile resize.
  await row(b.id)
    .getByRole('button', { name: b.title + ' 수정', exact: true })
    .click();
  await row(b.id).getByRole('textbox', { name: '할 일 내용' }).fill('이동 시간과 쉬는 시간 정리');
  assert.ok(await page.getByRole('button', { name: '목록', exact: true }).isDisabled());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await row(b.id).getByRole('textbox', { name: '할 일 내용' }).inputValue(),
    '이동 시간과 쉬는 시간 정리',
  );
  await row(b.id).getByRole('button', { name: '저장', exact: true }).click();
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-task-id="${id}"] .task-edit`),
    b.id,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  // A remote failure preserves the local stage and shows pending instead of discarding an offline write.
  await page.route('**/api/sync/operations', route => {
    const op=route.request().postDataJSON();
    return op.entityId===d.id ? route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'fixture unavailable'})}) : route.continue();
  });
  await row(d.id).dragTo(column('doing'));
  await column('doing').locator(`[data-task-id="${d.id}"]`).waitFor();
  await page.waitForFunction(()=>document.querySelector('.sync-status')?.textContent.includes('대기'));
  assert.equal((await api('/api/tasks/' + d.id)).item.stage,'todo');
  await page.unroute('**/api/sync/operations');
  await page.getByRole('button',{name:'동기화 상태',exact:true}).click();
  await page.getByRole('button',{name:'지금 동기화',exact:true}).click();
  await waitStage(d.id,'doing');
  await page.getByRole('button',{name:'동기화 상태 닫기',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});
  await column('doing').locator(`[data-task-id="${d.id}"]`).waitFor();
  // Concurrent server changes preserve both copies and stop this entity's operation.
  let remoteChanged=false;
  await page.route('**/api/sync/operations', async route => {
    const op=route.request().postDataJSON();
    if(op.entityId===d.id&&!remoteChanged){remoteChanged=true;const remote=(await api('/api/tasks/'+d.id)).item;await api('/api/tasks/'+d.id,{title:'다른 탭에서 수정한 준비',expectedVersion:remote.version},'PATCH');}
    await route.continue();
  });
  await row(d.id).dragTo(column('done'));
  await page.waitForFunction(()=>document.querySelector('.sync-status')?.textContent.includes('변경 확인 필요'));
  assert.equal((await api('/api/tasks/'+d.id)).item.stage,'doing');
  await page.unroute('**/api/sync/operations');
  // Remaining board regression cases use another healthy entity; resolution UI is verified by conflict QA.
  await api('/api/tasks/'+d.id,{stage:'done',expectedVersion:(await api('/api/tasks/'+d.id)).item.version},'PATCH');
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await page.locator('.task-board').waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.getByRole('button', { name: '목록', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: '보드', exact: true }).click();
  await page.locator('.task-board').waitFor();
  await page.getByRole('textbox', { name: '새 할 일' }).fill('보드에서 추가한 할 일');
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  const added = page.locator('.task-row').filter({ hasText: '보드에서 추가한 할 일' });
  await added.waitFor();
  const addedId = await added.getAttribute('data-task-id');
  await added.dragTo(column('doing'));
  await waitStage(addedId, 'doing');
  // Completion history and active columns are independently bounded and paginated.
  for (let i = 0; i < 24; i++) await create('대기 목록 ' + i);
  for (let i = 0; i < 11; i++) await create('완료 기록 ' + i, 'done');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(()=>document.querySelectorAll('[data-task-stage="todo"] .task-row').length===20);
  assert.equal(await column('todo').locator('.task-row').count(), 20);
  assert.equal(await column('done').locator('.task-row').count(), 10);
  await column('todo').getByRole('button', { name: '더 보기', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-task-stage="todo"] .task-row').length === 24,
  );
  await column('done').getByRole('button', { name: '이전 완료 보기', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-task-stage="done"] .task-row').length === 14,
  );
  // Revision reset must refresh every column, including external moves.
  await page.reload({ waitUntil: 'networkidle' });
  const todo = (await api('/api/tasks?stage=todo')).items[0];
  await api('/api/tasks/' + todo.id, { stage: 'doing', expectedVersion: todo.version }, 'PATCH');
  await column('todo').getByRole('button', { name: '더 보기', exact: true }).click();
  await column('doing').locator(`[data-task-id="${todo.id}"]`).waitFor();
  assert.equal(await column('todo').locator(`[data-task-id="${todo.id}"]`).count(), 0);
  // An exact linked task must not force the user's list filter back on refresh.
  await page.goto(base + `/tasks?taskId=${b.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const doneTab = page.locator('.task-tabs').getByRole('button', { name: /^완료/ });
  await doneTab.click();
  await page.waitForFunction(()=>document.querySelector('.task-tabs button[aria-pressed="true"]')?.textContent.startsWith('완료'));
  assert.equal(await doneTab.getAttribute('aria-pressed'), 'true');
  assert.equal(await row(b.id).count(), 0);
  await page.getByRole('button', { name: '보드', exact: true }).click();
  // Mobile tabs show a single column; direct task links select their exact stage.
  for (const [width, theme] of [
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + `/tasks?taskId=${b.id}`, { waitUntil: 'networkidle' });
    await row(b.id).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.task-board-column:visible').count(), 1);
    assert.equal(
      await page.locator('.task-board-column:visible').getAttribute('data-task-stage'),
      'doing',
    );
    if (theme === 'dark') {
      await selectAppTheme(page, theme);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${evidence}/mobile-${width}-${theme}.png`, fullPage: true });
  }
  // A linked pin must be reconciled on external/focus reload, not override fresh cards.
  let linked = (await api('/api/tasks/' + b.id)).item;
  linked = (
    await api(
      '/api/tasks/' + b.id,
      { stage: 'done', title: '다른 탭에서 완료한 일정 준비', expectedVersion: linked.version },
      'PATCH',
    )
  ).item;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await column('done').locator(`[data-task-id="${b.id}"]`).waitFor({ state: 'visible' });
  assert.equal(await row(b.id).getByRole('combobox').count(), 0);
  assert.ok((await row(b.id).textContent()).includes(linked.title));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/tasks', { waitUntil: 'networkidle' });
  await page.screenshot({ path: evidence + '/desktop-dark.png', fullPage: true });
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.task-board').count(), 0);
  assert.ok(await page.locator('.task-panel').isVisible());
  assert.equal(await page.locator('.task-panel .task-row').count(), 5);
  assert.deepEqual(errors, []);
  await writeFile(
    evidence + '/browser.json',
    JSON.stringify(
      {
        nativeDrag: true,
        editStage: true,
        unclutteredCards: true,
        resizeDraft: true,
        failedMoveRetry: true,
        conflictRetry: true,
        viewPreference: true,
        columnPagination: true,
        externalMoveReset: true,
        linkedRefresh: true,
        mobileOneColumn: true,
        linkedStage: true,
        homeList: true,
        noPageErrors: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS task board: drag/status/edit/draft/retry/conflict/preference/pagination/external move/mobile/home',
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
