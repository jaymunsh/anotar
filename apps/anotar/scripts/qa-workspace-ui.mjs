import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { openStore } from '../server/store.mjs';
import { clickPageTool } from './qa-page-tools.mjs';
import { selectAppTheme } from './qa-compact-pages.mjs';

export async function runWorkspaceUiQa(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
  const post = async (path, body, method = 'POST') => {
    const response = await context.request.fetch(base + path, { method, data: body });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  try {
    const document = (await post('/api/pages', { title: '여유로운 교토 여행 계획' })).item;
    const headingId = randomUUID();
    const block = (type, text, props = {}) => ({
      id: randomUUID(),
      type,
      props,
      content: [{ type: 'text', text, styles: {} }],
      children: [],
    });
    const saved = (
      await post(
        '/api/pages/' + document.id,
        {
          expectedVersion: document.version,
          title: document.title,
          document: {
            schemaVersion: 1,
            blocks: [
              { ...block('heading', '여행의 기준', { level: 2 }), id: headingId },
              block('paragraph', '하루의 중심 장소만 정하고, 이동 사이에는 여유를 남겨두기.'),
              block('heading', '첫날 시간표', { level: 2 }),
              block('bulletListItem', '10:00 철학의 길에서 만나기'),
              block('bulletListItem', '12:30 점심과 카페에서 쉬기'),
              block('heading', '만남 장소', { level: 3 }),
              {
                id: randomUUID(),
                type: 'map',
                props: { label: '철학의 길', latitude: 35.0267, longitude: 135.7945, zoom: 14 },
                children: [],
              },
              ...Array.from({ length: 24 }, (_, i) =>
                block(
                  'paragraph',
                  `여행 기록 ${i + 1}. 오래 읽는 문서에서도 경로와 도구를 바로 찾을 수 있어요.`,
                ),
              ),
            ],
          },
        },
        'PUT',
      )
    ).item;
    for (let i = 0; i < 28; i++)
      await post('/api/pages', { title: `계획 자료 ${String(i + 1).padStart(2, '0')}` });

    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(
      requests.some((url) => /\/api\/pages\//.test(url)),
      false,
      'Home loads page metadata only',
    );
    assert.equal(
      requests.some((url) => /\/assets\/PageEditor-/.test(url)),
      false,
      'Home does not load the document editor',
    );
    assert.ok((await page.locator('.home-dashboard').boundingBox()).width <= 1160);
    assert.equal(Math.round((await page.locator('.dashboard-secondary').boundingBox()).width), 304);
    assert.equal(
      await page.locator('.workspace-topbar:visible').count(),
      1,
      'Every private screen has one shared toolbar',
    );
    assert.equal(await page.locator('.workspace-topbar h1').innerText(), '입력함');
    assert.ok(
      (await page.locator('.composer-heading').boundingBox()).height <= 39,
      'Compact capture heading',
    );
    assert.ok(
      (await page.locator('.composer-footer').boundingBox()).height <= 45,
      'Compact capture footer',
    );
    assert.ok(
      (await page.locator('.dashboard-page-row').first().boundingBox()).height <= 56,
      'Readable 14px page titles retain compact two-line rows',
    );
    const scroll = page.locator('.sidebar-scroll');
    assert.equal(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight), true);
    await scroll.evaluate((node) => (node.scrollTop = node.scrollHeight));
    const last = await page.locator('.sidebar-page-item').last().boundingBox();
    const footer = await page.locator('.sidebar-footer').boundingBox();
    assert.ok(last.y + last.height <= footer.y, 'Long page tree stays above footer');
    await page.getByRole('button', { name: '통합 검색 열기' }).click();
    await page.getByRole('dialog', { name: '통합 검색' }).waitFor();
    await page.keyboard.press('Escape');

    await page.goto(base + '/pages/' + saved.id, { waitUntil: 'networkidle' });
    await page.locator('.bn-editor').waitFor();
    assert.equal(
      await page.locator('.document-topbar .page-document-top').count(),
      1,
      'Document tools belong in the page header',
    );
    assert.equal(
      await page.locator('.page-document .page-document-top').count(),
      0,
      'Document body does not duplicate the toolbar',
    );
    assert.equal(await page.getByRole('textbox', { name: '지도 장소 이름' }).isVisible(), false);
    await page.getByRole('button', { name: '위치 수정', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '지도 장소 이름' }).isVisible(), true);
    await page.getByRole('button', { name: '수정 닫기', exact: true }).click();
    assert.equal(await page.locator('.sidebar-management, .workspace-favorite-action').count(), 0);
    assert.equal(await page.locator('.sidebar nav[aria-label="최근 열람 페이지"]').count(), 0);
    const favorite = page.getByRole('button', { name: '페이지 즐겨찾기', exact: true });
    await favorite.click();
    await page
      .locator('nav[aria-label="즐겨찾기 페이지"] a[href="/pages/' + saved.id + '"]')
      .waitFor();
    await favorite.click();
    await page.waitForFunction(
      () =>
        document.querySelector('.page-favorite-toggle')?.getAttribute('aria-pressed') === 'false',
    );
    const menu = page.locator('.page-info');
    await menu.locator(':scope > summary').click();
    assert.equal(
      await menu.locator('.page-origins').count(),
      0,
      'Origins stay lazy until expanded',
    );
    await menu.locator('.page-menu-info > summary').click();
    await menu.getByText('연결한 원본 메모가 없어요.', { exact: true }).waitFor();
    assert.notEqual(await menu.getAttribute('open'), null, 'Nested info does not dismiss the menu');
    await menu.locator('.page-menu-info > summary').click();
    assert.notEqual(await menu.getAttribute('open'), null);
    await menu.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
    await menu.getByRole('button', { name: '취소', exact: true }).click();

    await menu.getByRole('checkbox', { name: '넓게 보기' }).check();
    await menu.getByRole('checkbox', { name: '작은 글씨' }).check();
    assert.ok(await page.locator('.page-document.page-wide.page-small-text').count());
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.bn-block-content[data-content-type="paragraph"]'))
          .fontSize === '14px',
    );
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('open'), null);
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok(
      await page.locator('.page-document.page-wide.page-small-text').count(),
      'Display preferences survive reload',
    );
    await clickPageTool(page, '목차 열기');
    const outline = page.getByRole('navigation', { name: '페이지 목차' });
    assert.equal(await outline.getByRole('button').count(), 3);
    await outline.getByRole('button', { name: '여행의 기준', exact: true }).click();
    assert.equal(
      await outline
        .getByRole('button', { name: '여행의 기준', exact: true })
        .getAttribute('aria-current'),
      'location',
    );
    await page.getByRole('button', { name: '목차 닫기', exact: true }).click();
    const heading = page.locator(`.bn-block-content[data-content-type="heading"]`).first();
    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' · 천천히');
    const deadline=Date.now()+45000;
    let persisted=false;
    while(Date.now()<deadline){
      const response=await context.request.get(base+'/api/pages/'+saved.id);
      if(response.ok()&&JSON.stringify((await response.json()).item.document).includes(' · 천천히')){persisted=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(persisted,'Edited heading reaches canonical server through the sync operation');
    await clickPageTool(page, '목차 열기');
    await outline.getByRole('button', { name: '여행의 기준 · 천천히', exact: true }).waitFor();
    await page.getByRole('button', { name: '페이지 AI 요청', exact: true }).click();
    assert.equal(await outline.isVisible(), false, 'Only one inspector stays open');
    await page.getByRole('region', { name: '페이지 AI', exact: true }).waitFor();
    await page.getByRole('button', { name: '요청과 결과 닫기' }).click();
    await menu.locator(':scope > summary').click();
    await page.getByRole('textbox', { name: '페이지 제목' }).click();
    assert.equal(await menu.getAttribute('open'), null, 'Clicking outside dismisses tools');

    const version = (await (await context.request.get(base + '/api/pages/' + saved.id)).json()).item
      .version;
    await mkdir('.impeccable/review/workspace-ui', { recursive: true });
    for (const width of [1920, 1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 760 ? 844 : 900 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        const buttons = await page
          .locator('.page-document-actions > button')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => node.getBoundingClientRect().width > 0)
              .map((node) => node.getBoundingClientRect().y),
          );
        assert.equal(
          new Set(buttons.map(Math.round)).size,
          1,
          'Primary document actions stay on one row',
        );
        await menu.locator(':scope > summary').click();
        const panel = menu.locator('.page-info-panel');
        await panel.evaluate((node) => (node.scrollTop = node.scrollHeight));
        const infoRow = menu.locator('.page-menu-info > summary');
        const trashRow = menu.locator('.trash-move-button');
        assert.equal(Math.round((await infoRow.boundingBox()).height), width > 760 ? 30 : 44);
        assert.equal(Math.round((await trashRow.boundingBox()).height), width > 760 ? 30 : 44);
        assert.equal(await panel.evaluate((node) => node.scrollWidth > node.clientWidth), false);
        if (process.env.QA_WORKSPACE_SCREENSHOTS === '1')
          await page.screenshot({
            path: `.impeccable/review/workspace-ui/menu-${width}-${theme}.png`,
          });
        await page.keyboard.press('Escape');
        await page.evaluate(() => scrollTo(0, 650));
        const topbar = await page.locator('.document-topbar').boundingBox();
        assert.equal(
          Math.round(topbar.y),
          0,
          'Document toolbar remains at the viewport top while scrolling',
        );
        assert.equal(
          Math.round(topbar.height),
          width > 760 ? 44 : 48,
          'Compact desktop toolbar with mobile touch space',
        );
        assert.equal(await page.locator('.topbar:visible').count(), 1);
        await page.getByRole('button', { name: '페이지 공유', exact: true }).click();
        await page.locator('.page-share-panel').waitFor();
        await page.getByRole('button', { name: '공유 설정 닫기', exact: true }).click();
        await page.evaluate(() => scrollTo(0, 0));
        if (process.env.QA_WORKSPACE_SCREENSHOTS === '1')
          await page.screenshot({
            path: `.impeccable/review/workspace-ui/page-${width}-${theme}.png`,
          });
      }
    }
    await page.setViewportSize({ width: 1024, height: 320 });
    await page.evaluate(() => scrollTo(0, 650));
    await page.getByRole('button', { name: '페이지 공유', exact: true }).click();
    const shortShare = page.locator('.page-share-panel');
    await shortShare.waitFor();
    const shareBounds = await shortShare.boundingBox();
    assert.ok(
      shareBounds.y + shareBounds.height <= 312,
      'Fixed share panel fits short desktop windows',
    );
    assert.equal(await shortShare.evaluate((node) => getComputedStyle(node).overflowY), 'auto');
    const linkButton = shortShare.getByRole('button', { name: '공유 링크 만들기', exact: true });
    await linkButton.scrollIntoViewIfNeeded();
    assert.ok((await linkButton.boundingBox()).y < 300, 'Bottom sharing action remains reachable');
    await page.getByRole('button', { name: '공유 설정 닫기', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await clickPageTool(page, '목차 열기');
    assert.equal(
      await page.locator('.mobile-capture-dock').isVisible(),
      false,
      'Dock leaves room for the inspector sheet',
    );
    await page.getByRole('button', { name: '목차 닫기', exact: true }).click();
    const final = (await (await context.request.get(base + '/api/pages/' + saved.id)).json()).item;
    assert.equal(
      final.version,
      version,
      'Navigation and display settings never write the document',
    );
    const toolbarRoutes = [
      ['/', '입력함', null],
      ['/memo', '메모', '기록하기'],
      ['/journal', '일지', null],
      ['/tasks', '할 일', '새 할 일 작성'],
      ['/ai', 'AI 작업', '새 AI 요청'],
      ['/prompts', '프롬프트', '새 템플릿'],
      ['/trash', '휴지통', '휴지통 새로고침'],
      ['/comments', '공유 댓글', '댓글 새로고침'],
      ['/backups', '백업', '지금 백업'],
      ['/hosting', '웹 호스팅', null],
    ];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [route, title, action] of toolbarRoutes) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('.sidebar nav[aria-label="최근 열람 페이지"]').count(), 0);
        if (route === '/') {
          await page
            .locator('.workspace-continue')
            .getByText('최근 열람', { exact: true })
            .waitFor();
          await page.locator('.workspace-continue a[href="/pages/' + saved.id + '"]').waitFor();
        }
        const toolbar = page.locator('.workspace-topbar');
        await toolbar.getByRole('heading', { name: title, exact: true }).waitFor();
        assert.equal(await toolbar.count(), 1);
        assert.equal(
          await page.locator('.workspace-toolbar').count(),
          1,
          'Only active route owns toolbar',
        );
        if (action) {
          assert.ok(await toolbar.getByRole('button', { name: action, exact: true }).isVisible());
        } else {
          assert.ok(await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).isVisible());
          if (route === '/') assert.equal(await toolbar.getByRole('button', { name: '새 페이지', exact: true }).count(), 0);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${width}px overflow: ${route}`,
        );
        const box = await toolbar.boundingBox();
        assert.equal(Math.round(box.height), width > 760 ? 44 : 48);
        for (const button of await toolbar.locator('button:visible, summary:visible').all()) {
          const control = await button.boundingBox();
          assert.ok(
            control.x >= 0 && control.x + control.width <= width + 1,
            `Toolbar action inside viewport: ${route}`,
          );
          assert.ok(
            control.y + control.height <= box.y + box.height + 1,
            `Single toolbar row: ${route}`,
          );
        }
        if (route === '/memo' && width < 760) {
          await toolbar.getByRole('button', { name: '메모 검색 열기' }).click();
          const search = toolbar.getByRole('textbox', { name: '보관함 검색' });
          await search.fill('교토');
          await search.evaluate((el) =>
            el.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
            ),
          );
          assert.ok(await search.isVisible(), 'IME Escape does not collapse active search');
          assert.ok(await search.evaluate((el) => el === document.activeElement));

          await search.press('Escape');
          assert.equal(await search.isVisible(), false);
          await toolbar.getByRole('button', { name: '메모 검색 열기' }).click();
          assert.equal(await search.inputValue(), '교토');
          assert.ok(await search.evaluate((el) => el === document.activeElement));
          const popup = await page.locator('.toolbar-search-field').boundingBox();
          assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1);
          await search.fill('');
          await search.press('Escape');
        }
        if (route === '/prompts') {
          await toolbar.getByText('가져오기·내보내기', { exact: true }).locator('..').click();
          await toolbar.getByRole('button', { name: 'JSON 내보내기' }).waitFor();
          const menu = await toolbar.locator('.prompt-transfer-menu').boundingBox();
          assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1);
          await page.keyboard.press('Escape');
          assert.equal(await toolbar.locator('details').getAttribute('open'), null);
        }
      }
    }
    // SPA transitions preserve the long-lived template editor and capture draft owners.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/prompts', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '새 템플릿', exact: true }).click();
    const templateName = page.getByRole('textbox', { name: '템플릿 이름' });
    await templateName.fill('상단바 이동 후에도 남아 있는 초안');
    await page.locator('.sidebar-primary-navigation a[href="/tasks"]').click();
    await page
      .locator('.workspace-toolbar')
      .getByRole('button', { name: '목록', exact: true })
      .click();
    assert.equal(
      await page
        .locator('.workspace-toolbar')
        .getByRole('button', { name: '목록', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.locator('.workspace-toolbar').getByRole('button', { name: '새 할 일 작성' }).click();
    assert.ok(
      await page
        .getByRole('textbox', { name: '새 할 일' })
        .evaluate((el) => el === document.activeElement),
    );
    await page.getByRole('button', { name: '설정 열기', exact: true }).click();
    await page.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '작업 공간', exact: true }).click();
    await page
      .getByRole('dialog', { name: '설정', exact: true })
      .getByRole('button', { name: '프롬프트', exact: true })
      .click();
    assert.equal(await page.locator('.workspace-settings').count(), 0);
    assert.equal(await templateName.inputValue(), '상단바 이동 후에도 남아 있는 초안');
    await page.getByRole('link', { name: 'anotar 홈', exact: true }).click();
    const captureDraft = page.locator('.composer textarea');
    await captureDraft.fill('메모 초안과 도구는 화면을 이동해도 유지돼요.');
    await page.locator('.sidebar-primary-navigation a[href="/memo"]').click();
    await page
      .locator('.workspace-toolbar')
      .getByRole('button', { name: '메모 선택', exact: true })
      .click();
    await page.getByText('0개 선택 · 최대 20개', { exact: true }).waitFor();
    await page
      .locator('.workspace-toolbar')
      .getByRole('button', { name: '선택 취소', exact: true })
      .click();
    await page
      .locator('.workspace-toolbar')
      .getByRole('button', { name: '기록하기', exact: true })
      .click();
    assert.equal(await captureDraft.inputValue(), '메모 초안과 도구는 화면을 이동해도 유지돼요.');
    await page.getByRole('button', { name: '작성 메뉴 열기', exact: true }).click();
    await page.getByRole('dialog', { name: '새로 작성', exact: true })
      .getByRole('button', { name: '새 페이지', exact: true }).click();
    await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
    assert.equal(await page.locator('.workspace-topbar .page-document-top').count(), 1);
    assert.equal(await page.locator('.workspace-toolbar').count(), 0);
    if (process.env.QA_WORKSPACE_SCREENSHOTS === '1') {
      for (const width of [1920, 390]) {
        await page.setViewportSize({ width, height: width < 760 ? 844 : 900 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => localStorage.setItem('leneu:theme', value), theme);
          for (const route of [
            '/',
            '/memo',
            '/tasks',
            '/ai',
            '/prompts',
            '/comments',
            '/backups',
            '/trash',
          ]) {
            await page.goto(base + route, { waitUntil: 'networkidle' });
            await page.screenshot({
              path: `.impeccable/review/workspace-ui/${route.slice(1) || 'home'}-${width}-${theme}.png`,
            });
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Workspace UI QA passed: bounded home, scrolling sidebar, tools/preferences, live outline, exclusive inspectors, map editing, responsive routes, no unexpected writes',
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-workspace-ui-'));
  const store = openStore(dir);
  store.createCapture({
    kind: 'note',
    text: '교토 일정은 하루 한 곳만 중심으로 잡기. 이동과 식사 사이에는 여유를 두자.',
  });
  store.createCapture({
    kind: 'link',
    url: 'https://example.org/guide',
    text: '여행 전 다시 읽어볼 교통 안내',
  });
  store.createTask({ title: '숙소 예약과 체크인 시간 확인하기' });
  store.createCapture({
    kind: 'note',
    text: '비 오는 날의 교토 실내 일정 조사',
    aiRequest: { template: null, additional: '' },
  });
  const job = store.claimAiJob({ label: 'QA fixture', mode: 'test' });
  store.completeAiJob(job.id, job.runToken, {
    markdown: '# 실내 일정\n\n박물관과 카페 사이에 휴식 시간을 두세요.',
    sources: [],
    usage: null,
  });
  store.close();
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: String(port),
      AI_RUNNER_KIND: 'disabled',
    },
    stdio: 'pipe',
  });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runWorkspaceUiQa(browser, base);
  } finally {
    await browser?.close();
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
}
