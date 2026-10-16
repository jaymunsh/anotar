import assert from 'node:assert/strict';

export async function runCompactPageQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    const response = await fetch(baseUrl + '/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '정리한 문서' }),
    });
    assert.equal(response.status, 201);
    const { item } = await response.json();
    const id = item.id;
    await page.goto(baseUrl + '/pages/' + id, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
    const timestamps = page.locator('.page-document-dates time');
    assert.deepEqual(await timestamps.evaluateAll((nodes) => nodes.map((node) => node.dateTime)), [
      item.createdAt,
      item.updatedAt,
    ]);
    assert.equal(
      await page.locator('.topbar:visible').count(),
      1,
      'desktop document has one compact document toolbar',
    );
    assert.ok(await page.getByRole('button', { name: '설정 열기' }).isVisible());
    assert.ok(await page.locator('.sidebar .today-label').isVisible());
    const title = await page.getByRole('textbox', { name: '페이지 제목' }).boundingBox();
    assert.ok(title.y < 190, 'the editable title should start near the document controls');
    await page.getByRole('textbox', { name: '페이지 제목' }).fill('정리한 문서에서 작성한 실제 글');
    await page.getByRole('textbox', { name: '페이지 제목' }).press('Enter');
    await page.keyboard.type('분배하기 전 보관할 내용');
    await page.getByText('서버 반영됨', { exact: true }).waitFor();
    await page.waitForFunction(async (pageId) => {
      const { item } = await (await fetch('/api/pages/' + pageId)).json();
      return (
        item.title === '정리한 문서에서 작성한 실제 글' &&
        JSON.stringify(item.document).includes('분배하기 전 보관할 내용')
      );
    }, id);
    const saved = (await (await fetch(baseUrl + '/api/pages/' + id)).json()).item;
    await page.waitForFunction(
      (updatedAt) =>
        document
          .querySelector('.page-document-dates > div:last-child time')
          ?.getAttribute('datetime') === updatedAt,
      saved.updatedAt,
    );
    assert.deepEqual(
      await timestamps.evaluateAll((nodes) => nodes.map((node) => node.dateTime)),
      [item.createdAt, saved.updatedAt],
      'Saving updates the visible final modification time and preserves creation time',
    );
    await page.goto(baseUrl + '/pages/' + id, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/pages/' + id);
    assert.equal(
      await page.getByRole('textbox', { name: '페이지 제목' }).inputValue(),
      '정리한 문서에서 작성한 실제 글',
    );

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({ path: `/tmp/leneu-compact-pages-${width}-${theme}.png` });
      }
    }
    console.log(
      'Compact page QA passed: direct editing/persistence, desktop space, mobile menu/theme, light/dark 320/390/desktop',
    );
  } finally {
    await context.close();
  }
}

export async function selectAppTheme(page, theme) {
  const inMenu = await page.evaluate(() => matchMedia('(max-width: 760px)').matches);
  if (inMenu && !(await page.locator('.sidebar.sidebar-open').count())) {
    await page.waitForFunction(
      () => document.querySelector('.sidebar')?.getBoundingClientRect().right <= 1,
    );
    await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  }
  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  const control = page.getByRole('button', { name: '화면 모드 전환', exact: true });
  if ((await control.getAttribute('aria-pressed')) !== String(theme === 'dark'))
    await control.click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await page.getByRole('dialog', { name: '설정', exact: true }).waitFor({ state: 'hidden' });
  if (inMenu) {
    const width = await page.evaluate(() => innerWidth);
    await page
      .getByRole('button', { name: '메뉴 닫기', exact: true })
      .click({ position: { x: width - 10, y: 100 } });
    await page.locator('.sidebar.sidebar-open').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.querySelector('.sidebar')?.getBoundingClientRect().right <= 1,
    );
  }
}
