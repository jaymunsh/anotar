import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickPageTool } from './qa-page-tools.mjs';

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
    await dialog.getByRole('button', { name: '주말 여행 정리 내 페이지', exact: true }).click();
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
    await dialog.getByRole('button', { name: '주말 여행 정리 내 페이지', exact: true }).click();
    await dialog.getByRole('textbox', { name: '새 페이지 제목' }).fill('예약과 교통');
    await dialog.getByRole('checkbox', { name: '여행.png' }).uncheck();
    let lost=false;
    await page.route('**/api/sync/operations',async route=>{
      if(route.request().postDataJSON()?.kind!=='capture.organize'||lost)return route.continue();
      lost=true;await route.fetch();await route.abort('failed');
    });
    await dialog.locator('.capture-import-submit').click();
    await dialog.getByText('페이지에 정리 대기 · 연결 후 원본과 페이지를 함께 반영해요.',{exact:true}).waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'동기화 상태',exact:true}).click();
    await page.getByRole('button',{name:'지금 동기화',exact:true}).click();
    await page.getByRole('button',{name:'동기화 상태 닫기'}).click();
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
    await old.getByText('다른 기기에서 수정했어요', {exact:true}).waitFor();
    await old.reload({waitUntil:'domcontentloaded'});
    assert.equal(await old.getByRole('textbox',{name:'페이지 제목',exact:true}).inputValue(),'충돌 중인 초안');
    await old.close();

    // A cached original stays readable when its legacy REST endpoint fails.
    await page.route(`**/api/captures/${capture.id}`,route=>route.fulfill({status:502,contentType:'text/html',body:'<html>temporary connection failure</html>'}));
    await page.goto(baseUrl+'/captures/'+capture.id,{waitUntil:'domcontentloaded'});
    await dialog.locator('.detail-text').waitFor();
    assert.equal(await dialog.locator('.detail-text').textContent(),capture.text);
    await page.unroute(`**/api/captures/${capture.id}`);

    if (process.env.QA_CAPTURE_SCREENSHOTS !== '0') {
      await mkdir('.impeccable/review/page-connections', { recursive: true });
      for (const width of [1327, 390, 320])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          await page.goto(baseUrl + '/captures/' + capture.id, { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: '내 페이지에 정리', exact: true }).click();
          await dialog
            .getByRole('button', { name: '주말 여행 정리 내 페이지', exact: true })
            .click();
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
      'Page connections QA passed: original, selected assets, child, lost response/reload, durable delivery recovery, visible selected child, stale draft, cached original on endpoint failure.' +
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
