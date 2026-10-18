import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickPageTool } from './qa-page-tools.mjs';

// 페이지가 많으면 목록 앞부분에 없을 수 있어, 검색창으로 찾아서 고른다. 접혀 있으면 먼저 편다.
async function pickImportPage(dialog, title, label) {
  const destination = dialog.locator('details.capture-import-destination');
  if (!(await destination.evaluate((node) => node.open))) await destination.locator('summary').click();
  await dialog.getByRole('textbox', { name: '정리할 페이지 검색' }).fill(title);
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

export async function runPageConnectionQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  const post = async (path, value) => {
    const response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const read = async (id) => (await (await fetch(baseUrl + '/api/pages/' + id)).json()).item;
  try {
    const parent = (await post('/api/pages', { title: '주말 여행 정리' })).item;
    const data = new FormData();
    data.set('kind', 'image');
    data.set('text', '# 여행 메모\n- 예약 번호 확인\n\n쉬는 시간을 남겨두기');
    data.append(
      'files',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'image/png' },
      ),
      '여행.png',
    );
    data.append('files', new Blob(['여행 준비물'], { type: 'text/plain' }), '준비물.txt');
    const capture = (
      await (await fetch(baseUrl + '/api/captures', { method: 'POST', body: data })).json()
    ).item;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl + '/memo', { waitUntil: 'domcontentloaded' });
    await page.locator('.capture-card').filter({ hasText: '# 여행 메모' }).click();
    await page
      .getByRole('button', { name: '내 페이지에 정리', exact: true })
      .click({ timeout: 3000 });
    const dialog = page.locator('.detail-panel');
    await pickImportPage(dialog, '주말 여행 정리', '주말 여행 정리 내 페이지');
    await dialog.getByRole('checkbox', { name: '준비물.txt' }).uncheck();
    await dialog.locator('.capture-import-submit').click();
    await page.waitForURL('**/pages/' + parent.id + '?import=*');
    assert.equal(await page.locator('.capture-ref-block:visible').count(), 0);
    await page.locator('.page-asset-image img').waitFor();
    assert.equal(
      (await read(parent.id)).document.blocks.filter((b) => b.type === 'asset').length,
      1,
    );
    assert.ok(await page.locator('.bn-editor').getByText('# 여행 메모', { exact: true }).count());
    await clickPageTool(page, 'Markdown 보기');
    const md = await page.locator('.page-markdown-source').inputValue();
    assert.ok(
      !md.includes(capture.id) &&
        md.includes(capture.files.find((file) => file.mime === 'image/png').id),
      JSON.stringify({ md, files: capture.files }),
    );
    await clickPageTool(page, '편집기로 돌아가기');
    await page.locator('.page-info > summary').click();
    await page.locator('.page-menu-info > summary').click();
    await page.locator(`a[href="/captures/${capture.id}"]`).click();
    await page.waitForURL('**/captures/' + capture.id);
    await page.locator('.detail-panel').locator('.detail-text').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.detail-panel').locator('.detail-text').waitFor();
    assert.equal(
      await page.locator('.detail-panel').locator('.detail-text').textContent(),
      capture.text,
    );
    await page.getByRole('button', { name: '내 페이지에 정리', exact: true }).click();
    await dialog.getByRole('button', { name: '새 페이지', exact: true }).click();
    await pickImportPage(dialog, '주말 여행 정리', '주말 여행 정리 내 페이지');
    await dialog.getByRole('textbox', { name: '새 페이지 제목' }).fill('예약과 교통');
    await dialog.getByRole('checkbox', { name: '여행.png' }).uncheck();
    // 온라인 전용: 응답이 유실되면 같은 제출을 다시 확인해도 페이지가 한 번만 생긴다.
    let lost=false;
    await page.route('**/api/**',async route=>{
      const request=route.request();
      if(lost||request.method()!=='POST'||!/\/api\/(pages(\?|$)|pages\/[^/]+\/capture-imports|capture-batches)/.test(request.url()))return route.continue();
      lost=true;await route.fetch();await route.abort('failed').catch(()=>{});
    });
    await dialog.locator('.capture-import-submit').click();
    await dialog.getByText('다시 확인해도 중복으로 담기지 않아요.',{exact:false}).waitFor();
    await page.unroute('**/api/**');
    // 앱이 이어서 끝내고 새 페이지로 넘어갈 수도 있다. 버튼이 남아 있을 때만 다시 확인을 누른다.
    // 어느 쪽이든 아래에서 '예약과 교통'이 정확히 1개인지 본다.
    const retrySubmit=dialog.locator('.capture-import-submit');
    if(await retrySubmit.isVisible().catch(()=>false))await retrySubmit.click().catch(()=>{});
    await page.waitForURL('**/pages/*');
    let list=[];
    for(let i=0;i<450;i++){list=(await(await fetch(baseUrl+'/api/pages')).json()).items;if(list.some(item=>item.title==='예약과 교통'))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(list.filter(item=>item.title==='예약과 교통').length,1);
    const childId=list.find(item=>item.title==='예약과 교통').id;
    await page.goto(baseUrl+'/pages/'+childId);await page.locator('.page-asset-file').waitFor();
    assert.equal((await read(childId)).parentId,parent.id);
    await page.evaluate(
      (id) => localStorage.setItem('leneu:sidebar-collapsed', JSON.stringify([id])),
      parent.id,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.page-document').waitFor();
    const selectedChildRevealed =
      (await page.locator(`.sidebar-page-item[href="/pages/${childId}"]`).count()) === 1;
    assert.equal(selectedChildRevealed,true,'An opened child reveals collapsed ancestors');

    // Importing into a page open elsewhere must retain its editor draft on 409.
    const old = await context.newPage();
    await old.goto(baseUrl + '/pages/' + parent.id, { waitUntil: 'domcontentloaded' });
    await old.locator('.bn-editor[contenteditable=true]').waitFor();
    await post(`/api/pages/${parent.id}/capture-imports`, {
      operationId: crypto.randomUUID(),
      captureId: capture.id,
      copyContent: false,
      assetIds: [],
    });
    await old.getByRole('textbox', { name: '페이지 제목' }).fill('충돌 중인 초안');
    await old.getByText('다른 곳에서 바뀌었어요.', {exact:false}).waitFor();
    assert.equal(await old.getByRole('textbox',{name:'페이지 제목',exact:true}).inputValue(),'충돌 중인 초안');
    await old.reload({waitUntil:'domcontentloaded'});
    // 새로고침하면 서버 본문을 열고, 409로 남은 초안은 덮지 않고 복사 안내로 보여준다.
    await old.getByText('다른 기기에서 수정된 뒤 남은 초안이 있어요.', {exact:true}).waitFor();
    await old.getByRole('button',{name:'초안 복사',exact:true}).waitFor();
    await old.close();

    // 온라인 전용: 원본 조회가 실패하면 기술 문구 없이 다시 불러오기를 안내하고, 복구 후 원본을 연다.
    await page.route(`**/api/captures/${capture.id}`,route=>route.fulfill({status:502,contentType:'text/html',body:'<html>temporary connection failure</html>'}));
    await page.goto(baseUrl+'/captures/'+capture.id,{waitUntil:'domcontentloaded'});
    const routeError=page.locator('.capture-route-error[role="alert"]');
    await routeError.getByText('원본 메모를 불러오지 못했어요. 다시 시도해 주세요.',{exact:true}).waitFor();
    await page.unroute(`**/api/captures/${capture.id}`);
    await routeError.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await dialog.locator('.detail-text').waitFor();
    assert.equal(await dialog.locator('.detail-text').textContent(),capture.text);

    if (process.env.QA_CAPTURE_SCREENSHOTS !== '0') {
      await mkdir('.impeccable/review/page-connections', { recursive: true });
      for (const width of [1327, 390, 320])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl + '/captures/' + capture.id, { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: '내 페이지에 정리', exact: true }).click();
          // 두 번째부터는 직전에 고른 페이지가 선택된 채 목록이 접혀 있다. 아직 고르지 않았을 때만 고른다.
          await page.locator('.capture-import-submit').waitFor();
          if (await page.locator('.capture-import-submit').isDisabled())
            await pickImportPage(dialog, '주말 여행 정리', '주말 여행 정리 내 페이지');
          assert.ok(
            await page.locator('.capture-import-submit').isVisible(),
          );
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({
            path: `.impeccable/review/page-connections/import-${width}-${theme}.png`,
          });
          await page.goto(baseUrl + '/pages/' + childId, { waitUntil: 'domcontentloaded' });
          await page.locator('.bn-editor').waitFor();
          assert.equal(await page.locator('.capture-ref-block:visible').count(), 0);
          await page.screenshot({
            path: `.impeccable/review/page-connections/page-${width}-${theme}.png`,
          });
        }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Page connections QA passed: original, selected assets, child, lost response retry without duplicate, visible selected child, 409 draft kept, original reload after endpoint failure.' +
        (process.env.QA_CAPTURE_SCREENSHOTS !== '0' ? ' Six viewport/theme pairs captured.' : ''),
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = await mkdtemp(join(tmpdir(), 'leneu-connection-qa-'));
  const port = 8793;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(baseUrl + '/api/health')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runPageConnectionQa(browser, baseUrl);
  } finally {
    if (browser) await browser.close();
    server.kill();
    await once(server, 'exit');
    await rm(dataDir, { recursive: true, force: true });
  }
}
