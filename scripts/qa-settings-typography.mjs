import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { offlineApp } from './fixtures/offline-app.mjs';

const evidence = '.omo/evidence/settings-typography';
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
try {
  const created = (
    await app.request('/api/pages', { title: '차분하게 읽고, 가볍게 기록하는 작업 공간' })
  ).item;
  const block = (type, text, props = {}) => ({
    id: randomUUID(),
    type,
    props,
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  });
  const document = {
    schemaVersion: 1,
    blocks: [
      block(
        'paragraph',
        '하루를 돌아보며 떠오른 생각을 기록해요. 일정과 메모를 따로 정리해도, 필요할 때 다시 찾을 수 있어야 합니다. 한글과 English가 함께 있어도 편안하게 읽히는 간격을 확인합니다.',
      ),
      block('heading', '기록을 이어가는 방법', { level: 2 }),
      block(
        'paragraph',
        '본문은 글자 사이를 억지로 좁히지 않고 자연스럽게 읽습니다. 여러 문단이 이어질 때에는 행간과 문단 사이의 간격으로 내용을 구분해요.',
      ),
      block('heading', '작은 메모부터 시작하기', { level: 3 }),
      block('bulletListItem', '한글 문장과 영문 이름을 함께 기록하고 필요한 링크를 남겨두기.'),
      block('codeBlock', 'const note = "기록을 계속해요";', { language: 'javascript' }),
    ],
  };
  const saved = (
    await app.request(
      '/api/pages/' + created.id,
      { expectedVersion: created.version, title: created.title, document },
      'PUT',
    )
  ).item;
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app.base + '/pages/' + created.id);
  await page.locator('.bn-editor').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() => {
    const read = (selector) => {
      const c = getComputedStyle(document.querySelector(selector));
      return {
        family: c.fontFamily,
        size: c.fontSize,
        leading: c.lineHeight,
        tracking: c.letterSpacing,
      };
    };
    return {
      title: read('.page-title-input'),
      body: read('[data-content-type="paragraph"] .bn-inline-content'),
      h2: read('[data-content-type="heading"][data-level="2"]'),
      h3: read('[data-content-type="heading"][data-level="3"]'),
      code: read('[data-content-type="codeBlock"] .bn-inline-content'),
    };
  });
  assert.match(styles.body.family, /Noto Sans KR/);
  assert.equal(styles.body.size, '16px');
  assert.equal(styles.body.tracking, 'normal');
  assert.ok(parseFloat(styles.body.leading) >= 27);
  assert.equal(styles.h2.size, '24px');
  assert.equal(styles.h3.size, '20px');
  assert.match(styles.code.family, /mono/i);
  await page.screenshot({ path: evidence + '/document-desktop.png' });
  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정', exact: true });
  const section = (name) =>
    page.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name, exact: true });
  await section('기기 저장소').click();
  await page
    .locator('.settings-storage-usage strong')
    .getByText('0.0 MB', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '저장 공간 유지 요청', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '전송 대기 자료 내보내기', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.zip$/);

  // Fixture-only pinned records stress long titles and a scrollable list.
  const bundle = await build({
    stdin: {
      contents:
        "import {writeRecord} from './src/sync/repository.ts'; import {getWorkspaceRuntime} from './src/sync/runtime.ts'; window.settingsFixture={writeRecord,getWorkspaceRuntime};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async () => {
    const { workspaceId } = await settingsFixture.getWorkspaceRuntime();
    for (let i = 0; i < 12; i++)
      await settingsFixture.writeRecord('pins', workspaceId, ['fixture-' + i], {
        pageId: 'fixture-' + i,
        title: '긴 제목도 자연스럽게 읽히는 서울과 간사이 여행 계획 ' + (i + 1),
        state: i === 0 ? 'partial' : 'ready',
      });
  });
  await section('화면').click();
  await section('기기 저장소').click();
  await page.locator('.settings-pins li').first().waitFor();
  assert.equal(await page.locator('.settings-pins li').count(), 12);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('leneu:theme')),
    null,
    'Opening settings does not replace the default system preference',
  );
  await section('화면').click();
  await page.getByRole('button', { name: '화면 모드 전환', exact: true }).click();
  const captures = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    for (const theme of ['light', 'dark']) {
      await section('화면').click();
      const toggle = page.getByRole('button', { name: '화면 모드 전환', exact: true });
      if ((await toggle.getAttribute('aria-pressed')) !== String(theme === 'dark'))
        await toggle.click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      assert.equal(await page.evaluate(() => localStorage.getItem('leneu:theme')), theme);
      for (const name of ['화면', '기기 저장소', '작업 공간']) {
        await section(name).click();
        await page.waitForTimeout(250);
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
          `dialog overflow ${width}/${theme}/${name}`,
        );
        assert.equal(
          await page.locator('.settings-content').evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
          `content overflow ${width}/${theme}/${name}`,
        );
        const bounds = await dialog.boundingBox();
        assert.ok(
          bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= width + 1 &&
            bounds.y + bounds.height <= 1000,
        );
        await page.screenshot({ path: `${evidence}/settings-${width}-${theme}-${name}.png` });
        captures.push({ width, theme, section: name });
      }
    }
  }
  // Native modal focus stays inside across both directions, including every control.
  await section('기기 저장소').click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).focus();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
  }
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '설정 열기', exact: true }).click();
  await page.mouse.click(8, 8);
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(
    await page
      .getByRole('button', { name: '설정 열기', exact: true })
      .evaluate((el) => el === document.activeElement),
  );

  for (const [label, route] of [
    ['프롬프트', '/prompts'],
    ['백업', '/backups'],
    ['휴지통', '/trash'],
  ]) {
    await page.getByRole('button', { name: '설정 열기', exact: true }).click();
    await section('작업 공간').click();
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).pathname, route);
  }
  await page.goto(app.base + '/pages/' + created.id);
  await page.locator('.bn-editor').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: evidence + '/document-mobile-dark.png' });
  const canonical = await (await fetch(app.base + '/api/pages/' + created.id)).json();
  assert.equal(
    canonical.item.version,
    saved.version,
    'Reading and settings never update the document',
  );
  assert.deepEqual(canonical.item.document, document);
  assert.deepEqual(errors, []);
  await writeFile(
    evidence + '/qa.json',
    JSON.stringify(
      {
        styles,
        captures,
        errors,
        navigation: true,
        focusTrap: true,
        returnFocus: true,
        download: true,
        documentUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS settings/type: 3 sections × 4 widths × 2 themes; persistence, native focus, Escape/backdrop, all management routes, storage permission/export; Noto body/16px/1.7, descending headings, monospace code; original document unchanged.',
  );
} finally {
  await app.close();
}
