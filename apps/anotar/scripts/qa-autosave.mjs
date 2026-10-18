import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { qaApp } from './fixtures/qa-app.mjs';

// 온라인 전용 자동저장 검증(2026-10-19 로컬 우선 동기화 제거 후).
// 실제 페이지 편집기에서 디바운스 저장(PUT /api/pages/:id), 연속 입력 중 주기적 전송,
// 네트워크 실패 재시도, 409 충돌 처리, hidden/pagehide flush를 확인한다.
const app = await qaApp(),
  evidence = '.omo/evidence/autosave',
  report = { checks: [], measurements: {} };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitState(page, needle, timeout = 15000) {
  await page.waitForFunction(
    (text) => document.querySelector('.page-save-state')?.textContent?.includes(text),
    needle,
    { timeout },
  );
}

try {
  // 1) 디바운스: 빠른 입력은 서버로 매 글자 전송하지 않고 합쳐 저장한다.
  const { item: fixturePage } = await app.request('/api/pages', { title: 'autosave fixture' });
  const context = await app.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const puts = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/api/pages/' + fixturePage.id))
      puts.push(JSON.parse(r.postData() || '{}').title);
  });
  await page.goto(app.base + '/pages/' + fixturePage.id);
  const title = page.getByLabel('페이지 제목', { exact: true });
  await title.waitFor();
  await waitState(page, '저장됨');

  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX';
  const before = puts.length;
  await title.fill('');
  await title.pressSequentially(text, { delay: 30 });
  assert.ok(
    puts.length - before < text.length,
    'rapid typing must not send one server write per keystroke',
  );
  await waitState(page, '저장됨');
  await pause(300);
  assert.equal(puts.at(-1), text, 'the latest typed value is the one persisted');
  const serverAfterTyping = (await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json())
    .item.title;
  assert.equal(serverAfterTyping, text);
  report.measurements.rapidTyping = { inputEvents: text.length, serverWrites: puts.length - before };
  report.checks.push('real page editor: rapid title typing coalesces into few writes with the latest value');

  // 2) 연속 입력: 입력이 끝나기 전에도 주기적으로 저장하고, 최종 값이 보존된다.
  const continuousStart = puts.length;
  const startTime = Date.now();
  for (let i = 1; i <= 30; i++) {
    await title.fill('continuous ' + i);
    await pause(200);
  }
  assert.ok(puts.length > continuousStart, 'continuous typing dispatches periodically before it stops');
  await waitState(page, '저장됨');
  await pause(300);
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json()).item.title,
    'continuous 30',
  );
  report.measurements.continuousTyping = {
    durationMs: Date.now() - startTime,
    serverWrites: puts.length - continuousStart,
  };
  report.checks.push('real page editor: continuous typing keeps saving and preserves the final value');

  // 3) hidden/pagehide flush: 디바운스를 기다리지 않고 바로 저장한다.
  await title.fill('flush before hidden');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  for (let i = 0; i < 100; i++) {
    if ((await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json()).item.title === 'flush before hidden')
      break;
    await pause(50);
  }
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json()).item.title,
    'flush before hidden',
    'visibility hidden flushes the pending edit immediately',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await title.fill('flush on pagehide');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  for (let i = 0; i < 100; i++) {
    if ((await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json()).item.title === 'flush on pagehide')
      break;
    await pause(50);
  }
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + fixturePage.id)).json()).item.title,
    'flush on pagehide',
    'pagehide flushes the pending edit immediately',
  );
  report.checks.push('visibility hidden and pagehide flush pending edits without waiting for the debounce');
  await context.close();

  // 4) 네트워크 실패 재시도: 저장 실패 배너에서 다시 시도하면 입력 그대로 다시 저장된다.
  const { item: failPage } = await app.request('/api/pages', { title: 'fail fixture' });
  const failContext = await app.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const fp = await failContext.newPage();
  await fp.goto(app.base + '/pages/' + failPage.id);
  const failTitle = fp.getByLabel('페이지 제목', { exact: true });
  await failTitle.waitFor();
  await waitState(fp, '저장됨');
  await fp.route('**/api/pages/' + failPage.id, (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await failTitle.fill('실패해도 남는 제목');
  await waitState(fp, '저장 못 함');
  const errorBanner = fp.locator('.page-banner-error');
  assert.equal(await errorBanner.count(), 1, 'a save failure shows the error banner');
  assert.equal(
    await failTitle.inputValue(),
    '실패해도 남는 제목',
    'the input stays intact while saving fails',
  );
  await fp.unroute('**/api/pages/' + failPage.id);
  await errorBanner.getByRole('button', { name: /다시 시도/ }).click();
  await waitState(fp, '저장됨');
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + failPage.id)).json()).item.title,
    '실패해도 남는 제목',
    'retry re-sends the kept input and the server stores it',
  );
  report.checks.push('network failure keeps the input and the retry button re-saves it successfully');
  await failContext.close();

  // 5) 409 충돌: 다른 곳에서 먼저 바뀌면 배너로 알리고 작성 중 내용을 유지한다.
  const { item: conflictPage } = await app.request('/api/pages', { title: 'conflict fixture' });
  const conflictContext = await app.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const cp = await conflictContext.newPage();
  await cp.goto(app.base + '/pages/' + conflictPage.id);
  const conflictTitle = cp.getByLabel('페이지 제목', { exact: true });
  await conflictTitle.waitFor();
  await waitState(cp, '저장됨');
  // 서버를 먼저 바꿔 버전을 올린다.
  const current = (await (await fetch(app.base + '/api/pages/' + conflictPage.id)).json()).item;
  await app.request(
    '/api/pages/' + conflictPage.id,
    { title: '서버가 먼저 바꾼 제목', icon: '', document: current.document, expectedVersion: current.version },
    'PUT',
  );
  await conflictTitle.fill('내 창의 변경');
  await waitState(cp, '다른 곳에서 바뀜');
  const conflictBanner = cp.locator('.page-banner-error');
  assert.match(
    await conflictBanner.textContent(),
    /다른 곳에서 바뀌었어요\./,
    'conflict banner explains the remote change',
  );
  for (const name of ['서버 내용 불러오기', '내 내용 복사', '내 내용으로 덮어쓰기'])
    assert.equal(await conflictBanner.getByRole('button', { name }).count(), 1, `conflict offers ${name}`);
  assert.equal(await conflictTitle.inputValue(), '내 창의 변경', 'my unsaved edit stays in the window');
  // '내 내용으로 덮어쓰기'로 서버 최신 버전 위에 다시 저장한다.
  await conflictBanner.getByRole('button', { name: '내 내용으로 덮어쓰기' }).click();
  await waitState(cp, '저장됨');
  assert.equal(
    (await (await fetch(app.base + '/api/pages/' + conflictPage.id)).json()).item.title,
    '내 창의 변경',
    'overwrite re-saves my content against the latest server version',
  );
  report.checks.push('409 conflict banner preserves the draft and overwrite resaves onto the latest version');
  await conflictContext.close();

  await mkdir(evidence, { recursive: true });
  await writeFile(evidence + '/result.json', JSON.stringify({ status: 'PASS', ...report }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', ...report }, null, 2));
} finally {
  await app.close();
}
