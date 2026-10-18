import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { qaApp } from './fixtures/qa-app.mjs';
import { openStore } from '../server/store.mjs';

// 온라인 전용 페이지 새로고침·충돌(2026-10-19 로컬 우선 동기화 제거 후).
// 서버가 원본이므로 새로고침으로 서버 최신본을 반영하고, 저장 시 409 충돌을 배너로 처리한다.
// 예전 기기 저장소·'지금 동기화'·충돌 비교 화면(.sync-conflict)은 더 이상 없다.
const app = await qaApp();
const document = (text) => ({
  schemaVersion: 1,
  blocks: [
    { id: 'remote-paragraph', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] },
  ],
});
const evidence = '.omo/evidence/page-remote-refresh';
await mkdir(evidence, { recursive: true });
try {
  const store = openStore(app.dir);
  const initial = store.createPage({ title: '초기 문서', document: document('초기 본문') });
  store.close();
  const page = await app.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app.base + '/pages/' + initial.id);
  await page.locator('.page-title-input').waitFor();

  const current = async () => (await (await fetch(app.base + '/api/pages/' + initial.id)).json()).item;
  const serverEdit = async (title, text) => {
    const p = await current();
    return app.request(
      '/api/pages/' + initial.id,
      { title, icon: '📘', document: document(text), expectedVersion: p.version },
      'PUT',
    );
  };

  // 1) 다른 곳(서버)에서 바뀐 내용을 새로고침으로 깔끔히 반영한다.
  await serverEdit('서버에서 갱신', '갱신된 본문');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.page-title-input')?.value === '서버에서 갱신');
  await page.waitForFunction(() =>
    document.querySelector('.page-block-editor')?.textContent.includes('갱신된 본문'),
  );
  assert.equal(await page.locator('.page-banner-error').count(), 0, 'a clean refresh shows no conflict banner');

  // 2) 새로고침으로 올라온 최신 버전 위에서 바로 수정·저장할 수 있다.
  await page.locator('.page-title-input').fill('갱신 후 수정');
  await page.waitForFunction(() => document.querySelector('.page-save-state')?.textContent?.includes('저장됨'), null, { timeout: 15000 });
  for (let i = 0; i < 100; i++) {
    if ((await current()).title === '갱신 후 수정') break;
    if (i === 99) throw Error('edit after refresh did not save against the new server version');
    await new Promise((r) => setTimeout(r, 100));
  }

  // 3) 서버가 먼저 바뀐 뒤 내 창에서 저장하면 409 충돌 배너로 알리고 작성 내용을 유지한다.
  await serverEdit('경합한 서버 문서', '서버 경합 내용');
  await page.locator('.page-title-input').fill('기기에 남긴 변경');
  await page.waitForFunction(() => document.querySelector('.page-save-state')?.textContent?.includes('다른 곳에서 바뀜'), null, { timeout: 15000 });
  const banner = page.locator('.page-banner-error');
  assert.equal(await banner.count(), 1, 'remote change surfaces the conflict banner');
  assert.match((await banner.textContent()), /다른 곳에서 바뀌었어요\./);
  assert.equal(await page.locator('.page-title-input').inputValue(), '기기에 남긴 변경', 'my unsaved edit stays in the window');
  for (const name of ['서버 내용 불러오기', '내 내용 복사', '내 내용으로 덮어쓰기'])
    assert.equal(await banner.getByRole('button', { name }).count(), 1, `conflict offers ${name}`);
  await page.screenshot({ path: evidence + '/conflict-banner.png' });

  // 4) '서버 내용 불러오기'는 서버 최신본으로 다시 읽어 충돌을 해소한다.
  await banner.getByRole('button', { name: '서버 내용 불러오기' }).click();
  await page.waitForFunction(() => document.querySelector('.page-title-input')?.value === '경합한 서버 문서');
  assert.equal(await page.locator('.page-banner-error').count(), 0, 'reloading the server copy clears the conflict');
  assert.deepEqual(errors, []);

  await writeFile(
    evidence + '/RESULT.json',
    JSON.stringify(
      { cleanRemoteRefresh: true, editAfterRefresh: true, conflictBanner: true, loadServerCopy: true, errors },
      null,
      2,
    ),
  );
  console.log('PASS clean server refresh, save after refresh, 409 conflict banner, load-server-copy resolution');
} finally {
  await app.close();
}
