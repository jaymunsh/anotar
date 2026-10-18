import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { qaApp, prepareShell, openQuickMemo } from './fixtures/qa-app.mjs';

// 온라인 전용 PWA 앱 쉘(2026-10-19 로컬 우선 동기화 제거 후).
// 앱 쉘 캐시·설치는 유지 기능이다: 오프라인에서도 앱 껍데기는 뜨지만 자료는 연결이 필요하고,
// 연결이 끊긴 동안 저장하면 입력을 유지한 채 안내하며, 연결이 복구되면 정상 저장된다.
// 예전 기기 저장('기기에 저장했어요')·'지금 동기화'·오프라인 자료 열람은 더 이상 없다.
const app = await qaApp();
const evidence = '.omo/evidence/pwa-shell';
await mkdir(evidence, { recursive: true });
try {
  const context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(app.base + '/');
  await prepareShell(page);

  // 1) 앱 쉘이 캐시된다.
  await page.waitForFunction(
    async () => (await caches.keys()).some((name) => name.startsWith('leneu-shell-v1-')),
    null,
    { timeout: 20000 },
  );
  const shellCaches = await page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith('leneu-shell-v1-')),
  );
  assert.equal(shellCaches.length, 1, 'the app shell is cached under a single versioned cache');

  // 2) 완전 오프라인에서도 앱 쉘이 뜬다(브라우저 오류 화면이 아니라 작성 UI가 동작).
  await context.setOffline(true);
  await page.goto(app.base + '/');
  await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).waitFor({ timeout: 15000 });

  // 3) API·공유·외부 요청은 캐시된 앱 쉘 HTML로 대체되지 않는다(자료는 연결 필요).
  const servedHtml = await page.evaluate(async () => {
    const outcomes = [];
    for (const path of ['/api/captures', '/s/fake', 'https://example.com/'])
      try {
        const response = await fetch(path);
        outcomes.push((await response.text()).includes('<!doctype html'));
      } catch {
        outcomes.push(false);
      }
    return outcomes;
  });
  assert.deepEqual(servedHtml, [false, false, false], 'offline never serves app-shell HTML for API/share/external');
  await page.screenshot({ path: evidence + '/offline-shell.png' });

  // 4) 연결이 끊긴 동안 저장하면 입력을 유지한 채 연결 필요를 안내한다.
  const input = await openQuickMemo(page);
  await input.fill('연결 끊긴 동안 쓴 메모');
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  await page
    .getByText('저장 여부를 확인하지 못했어요. 입력은 남아 있으니 다시 저장해 주세요.', { exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), '연결 끊긴 동안 쓴 메모', 'the offline input stays intact');
  assert.equal(
    (await (await fetch(app.base + '/api/captures')).json()).items.length,
    0,
    'nothing is stored while offline',
  );

  // 5) 연결이 복구되면 같은 입력이 정상 저장되어 서버에 반영된다.
  await context.setOffline(false);
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  await page.getByText('보관함에 저장했어요', { exact: true }).waitFor();
  await page.waitForFunction(
    async () => {
      const response = await fetch('/api/captures');
      return response.ok && (await response.json()).items.some((item) => item.text === '연결 끊긴 동안 쓴 메모');
    },
    null,
    { timeout: 15000 },
  );
  const saved = (await (await fetch(app.base + '/api/captures')).json()).items;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, '연결 끊긴 동안 쓴 메모');
  await page.screenshot({ path: evidence + '/reconnected.png' });

  await context.close();
  await writeFile(
    evidence + '/result.json',
    JSON.stringify(
      {
        status: 'PASS',
        shellCached: true,
        offlineShellBoots: true,
        apiNotServedAsShell: true,
        offlineSaveKeepsInput: true,
        reconnectSaves: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS PWA shell: shell cache, offline shell boot, API/share/external excluded, offline save keeps input, reconnect saves to server',
  );
} finally {
  await app.close();
}
