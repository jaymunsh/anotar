import { selectAppTheme } from './qa-compact-pages.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runTaskQa(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = async (path = '/api/tasks', method = 'GET', body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, `Task API ${method} ${path}: ${response.status}`);
    return response.json();
  };
  const waitForTask = async (id, predicate) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const { item } = await api(`/api/tasks/${id}`);
      if (predicate(item)) return item;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('할 일의 최종 상태가 저장되지 않았습니다.');
  };
  try {
    await page.addInitScript(() => localStorage.setItem('leneu:tasks:view', 'list'));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const panel = page.getByRole('region', { name: '할 일', exact: true });
    await panel.waitFor({ timeout: 3000 });
    await panel.getByRole('textbox', { name: '새 할 일' }).fill('항공권 확인');
    await panel.getByRole('button', { name: '할 일 추가', exact: true }).click();
    let row = panel.locator('.task-row').filter({ hasText: '항공권 확인' });
    await row.waitFor();
    const id = await row.getAttribute('data-task-id');
    row = panel.locator(`[data-task-id="${id}"]`);
    // Retry an ambiguous create response without duplicating the persisted task.
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '추가 응답 실패 테스트' }),
      });
    });
    await panel.getByRole('textbox', { name: '새 할 일' }).fill('숙소 체크인 시간 확인');
    await panel.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    assert.equal(
      await panel.getByRole('textbox', { name: '새 할 일' }).inputValue(),
      '숙소 체크인 시간 확인',
    );
    await page.unroute('**/api/tasks');
    await panel.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await panel.getByText('숙소 체크인 시간 확인', { exact: true }).waitFor();
    assert.equal((await api()).counts.open, 2);
    await row.getByRole('button', { name: '항공권 확인 수정' }).click();
    await row.getByRole('textbox', { name: '할 일 내용' }).fill('항공권 날짜 확인');
    await row.getByLabel('기한', { exact: true }).fill('2028-02-29');
    await row.getByRole('button', { name: '저장', exact: true }).click();
    row = panel.locator(`[data-task-id="${id}"]`);
    await row.getByText('2028년 2월 29일', { exact: true }).waitFor();
    await row.getByRole('checkbox').check();
    await waitForTask(id, (item) => item.status === 'done');
    await panel.getByRole('button', { name: /^완료/ }).click();
    await row.getByRole('checkbox').uncheck();
    await waitForTask(id, (item) => item.status === 'open');
    await panel.getByRole('button', { name: /^할 일 \d/ }).click();
    await row.waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await row.getByText('항공권 날짜 확인', { exact: true }).waitFor();
    await panel.getByRole('button', { name: /^할 일 \d/ }).click();
    await row.waitFor({ timeout: 1500 });

    // A failed checkbox rolls back and exposes an explicit retry.
    await page.route(`**/api/tasks/${id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: '저장 실패 테스트' }),
          })
        : route.continue(),
    );
    await row.getByRole('checkbox').check();
    await row.getByRole('alert').waitFor();
    assert.equal(await row.getByRole('checkbox').isChecked(), false);
    await page.unroute(`**/api/tasks/${id}`);
    await row.getByRole('button', { name: '다시 시도' }).click();
    await waitForTask(id, (item) => item.status === 'done');
    await panel.getByRole('button', { name: /^완료/ }).click();
    await row.getByRole('checkbox').uncheck();
    await waitForTask(id, (item) => item.status === 'open');
    await panel.getByRole('button', { name: /^할 일 \d/ }).click();

    // Multiple gestures in flight must retain the user's final choice.
    await page.route(`**/api/tasks/${id}`, async (route) => {
      if (route.request().method() === 'PATCH')
        await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    });
    await row.getByRole('checkbox').check();
    await row.getByRole('checkbox').uncheck();
    await row.getByRole('checkbox').check();
    await waitForTask(id, (item) => item.status === 'done');
    await page.unroute(`**/api/tasks/${id}`);
    await panel.getByRole('button', { name: /^완료/ }).click();
    await row.getByRole('checkbox').uncheck();
    await waitForTask(id, (item) => item.status === 'open');
    await panel.getByRole('button', { name: /^할 일 \d/ }).click();

    // A stale edit cannot discard the draft or overwrite a newer title.
    await row.getByRole('button', { name: '항공권 날짜 확인 수정' }).click();
    await row.getByRole('textbox', { name: '할 일 내용' }).fill('내 편집 초안');
    const { item: current } = await api(`/api/tasks/${id}`);
    await api(`/api/tasks/${id}`, 'PATCH', {
      title: '다른 탭의 최신 제목',
      expectedVersion: current.version,
    });
    await row.getByRole('button', { name: '저장', exact: true }).click();
    await row.getByRole('alert').waitFor();
    assert.equal(
      await row.getByRole('textbox', { name: '할 일 내용' }).inputValue(),
      '내 편집 초안',
    );
    assert.equal((await api(`/api/tasks/${id}`)).item.title, '다른 탭의 최신 제목');
    await row.getByRole('button', { name: '최신 내용 불러오기' }).click();
    assert.equal(
      await row.getByRole('textbox', { name: '할 일 내용' }).inputValue(),
      '다른 탭의 최신 제목',
    );
    await row.getByRole('button', { name: '취소', exact: true }).click();

    const sampleTitles = [
      '여행 일정 페이지 정리',
      '미니PC 백업 자동화 방법 찾아보기',
      '여권 유효기간 확인',
    ];
    for (let i = 0; i < 53; i++)
      await api('/api/tasks', 'POST', { title: sampleTitles[i] || `추가 할 일 ${i + 1}` });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await panel.locator('.task-row').count(), 5);
    await panel.getByRole('textbox', { name: '새 할 일' }).fill('작업 영역을 바꿔도 남는 초안');
    await panel.getByRole('button', { name: '전체 보기' }).click();
    assert.equal(new URL(page.url()).pathname, '/tasks');
    const full = page.locator('.task-workspace-full');
    await full.locator('.task-row').nth(49).waitFor();
    assert.equal(await full.locator('.task-row').count(), 50);
    const beforePaging = await api('/api/tasks?limit=100');
    const hiddenTaskId = beforePaging.items[50].id;
    const firstTask = beforePaging.items[0];
    const { item: completedElsewhere } = await api(`/api/tasks/${firstTask.id}`, 'PATCH', {
      status: 'done',
      expectedVersion: firstTask.version,
    });
    await full.getByRole('button', { name: '더 보기' }).click();
    await full.locator(`[data-task-id="${hiddenTaskId}"]`).waitFor({ timeout: 1500 });
    assert.equal(await full.locator(`[data-task-id="${firstTask.id}"]`).count(), 0);
    assert.equal(await full.locator('.task-row').count(), 50);
    await full.getByRole('button', { name: '더 보기' }).click();
    await full.locator('.task-row').nth(53).waitFor();
    assert.equal(await full.locator('.task-row').count(), 54);
    await api(`/api/tasks/${firstTask.id}`, 'PATCH', {
      status: 'open',
      expectedVersion: completedElsewhere.version,
    });
    await page.reload({ waitUntil: 'networkidle' });
    await full.locator('.task-row').nth(49).waitFor();
    await full.getByRole('textbox', { name: '새 할 일' }).fill('작업 영역을 바꿔도 남는 초안');
    await full.getByRole('button', { name: '더 보기' }).click();
    await full.locator('.task-row').nth(54).waitFor();
    assert.equal(await full.locator('.task-row').count(), 55);
    assert.equal(
      await full.getByRole('textbox', { name: '새 할 일' }).inputValue(),
      '작업 영역을 바꿔도 남는 초안',
    );
    await page.reload({ waitUntil: 'networkidle' });
    await full.waitFor();
    await full.getByRole('textbox', { name: '새 할 일' }).fill('작업 영역을 바꿔도 남는 초안');
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '입력함', exact: true })
      .click();
    assert.equal(
      await panel.getByRole('textbox', { name: '새 할 일' }).inputValue(),
      '작업 영역을 바꿔도 남는 초안',
    );
    await panel.getByRole('textbox', { name: '새 할 일' }).fill('');

    // A late save must refresh the current full view, rather than its former panel limit.
    let savedDuringNavigation = false;
    await page.route(`**/api/tasks/${id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const response = await route.fetch();
      savedDuringNavigation = true;
      await route.fulfill({ response });
    });
    const refreshAfterNavigation = page.waitForResponse(
      (response) => savedDuringNavigation && response.url().includes('/api/tasks?'),
    );
    await panel.locator(`[data-task-id="${id}"]`).getByRole('checkbox').check();
    await panel.getByRole('button', { name: '전체 보기' }).click();
    const refreshResponse = await refreshAfterNavigation;
    assert.equal(new URL(refreshResponse.url()).searchParams.get('limit'), '50');
    await page.unroute(`**/api/tasks/${id}`);
    await full.getByRole('button', { name: /^완료/ }).click();
    await full.locator(`[data-task-id="${id}"]`).getByRole('checkbox').uncheck();
    await waitForTask(id, (item) => item.status === 'open');
    await full.getByRole('button', { name: /^할 일 \d/ }).click();
    await full.getByRole('button', { name: '입력함으로' }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.task-panel .task-row').length === 5,
    );

    // A row being edited must stay visible when the compact list shrinks.
    const fifth = panel.locator('.task-row').nth(4);
    const fifthId = await fifth.getAttribute('data-task-id');
    await fifth.getByRole('button').click();
    await fifth.getByRole('textbox', { name: '할 일 내용' }).fill('모바일에서도 남는 편집 초안');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForFunction(
      () => document.querySelectorAll('.task-panel .task-row').length === 3,
    );
    const pinnedEdit = panel.locator(`[data-task-id="${fifthId}"]`);
    await pinnedEdit.getByRole('textbox', { name: '할 일 내용' }).waitFor({ timeout: 3000 });
    assert.equal(
      await pinnedEdit.getByRole('textbox', { name: '할 일 내용' }).inputValue(),
      '모바일에서도 남는 편집 초안',
    );
    await pinnedEdit.getByRole('button', { name: '취소', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.task-panel .task-row').length === 5,
    );

    await page.screenshot({ path: '/tmp/leneu-tasks-desktop.png', fullPage: true });
    await selectAppTheme(page, 'dark');
    await page.screenshot({ path: '/tmp/leneu-tasks-dark.png', fullPage: true });
    for (const width of [1160, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.waitFor();
      assert.equal(await panel.isVisible(), true, `${width}px 할 일 표시`);
      if (width < 760) {
        await page.waitForFunction(
          () => document.querySelectorAll('.task-panel .task-row').length === 3,
        );
        await page.waitForFunction(
          () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0.5,
        );
        assert.equal(await panel.locator('.task-row').count(), 3);
      }
      const bounds = await panel.boundingBox();
      const recent = await page.locator('.recent-section').boundingBox();
      assert.ok(
        bounds && recent && bounds.y < recent.y,
        '좁은 화면은 할 일이 보관 목록 위에 있어야 합니다.',
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${width}px 가로 넘침`,
      );
      await page.screenshot({ path: `/tmp/leneu-tasks-${width}.png`, fullPage: true });
    }
    await selectAppTheme(page, 'light');
    await page.screenshot({ path: '/tmp/leneu-tasks-mobile-light.png', fullPage: true });
    await panel.getByRole('button', { name: '전체 보기' }).click();
    await page.getByRole('button', { name: '바로 기록하기', exact: true }).click();
    await page.getByRole('dialog', { name: '빠른 기록' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.deepEqual(errors, []);
    console.log(
      'Task QA passed: create/edit/date, done/undo, retry, quick toggles, conflict draft, pagination, desktop/mobile/themes',
    );
  } finally {
    await page.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = await mkdtemp(join(tmpdir(), 'leneu-task-qa-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = String(probe.address().port);
  await new Promise((resolve) => probe.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dataDir,
      PORT: port,
      HOST: '127.0.0.1',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runTaskQa(browser, baseUrl);
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const exit = once(server, 'exit');
      server.kill();
      await exit;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}
