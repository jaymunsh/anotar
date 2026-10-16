import { selectAppTheme } from './qa-compact-pages.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function runServerPromptQa(browser, baseUrl) {
  const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await a.newPage();
    await page.goto(baseUrl + '/prompts/new', { waitUntil: 'networkidle' });
    const body = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    await page.getByRole('textbox', { name: '템플릿 이름' }).fill('서버에서 공유하는 요청');
    await body.fill('다른 브라우저에서도 사용할 {{content}}');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.waitForURL(/\/prompts\/(?!new)[a-z0-9-]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1);
    assert.equal(
      (await a.request.get(`${baseUrl}/api/prompt-templates/${id}`)).status(),
      200,
      'template must be stored in the server',
    );
    const other = await b.newPage();
    await other.route('**/api/prompt-templates', (route) =>
      route.fulfill({ status: 503, json: { error: '저장소를 불러오지 못했어요.' } }),
    );
    await other.goto(page.url(), { waitUntil: 'networkidle' });
    await other.getByRole('alert').getByText('저장소를 불러오지 못했어요.').waitFor();
    assert.equal(
      await other
        .locator('.prompt-workspace-heading')
        .getByRole('button', { name: '새 템플릿', exact: true })
        .isEnabled(),
      false,
    );
    await other.unroute('**/api/prompt-templates');
    await other.getByRole('button', { name: '다시 불러오기' }).click();
    await other.getByRole('textbox', { name: '프롬프트 본문', exact: true }).waitFor();
    assert.equal(
      await other.getByRole('textbox', { name: '프롬프트 본문', exact: true }).inputValue(),
      '다른 브라우저에서도 사용할 {{content}}',
    );
    await other
      .getByRole('textbox', { name: '프롬프트 본문', exact: true })
      .fill('휴대폰 브라우저에서 고친 {{content}}');
    await other
      .locator('.prompt-mobile-actions')
      .getByRole('button', { name: '템플릿 저장', exact: true })
      .click();
    await other.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await body.fill('PC에 남은 이전 초안 {{content}}');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/다른 탭에서 먼저 수정/)
      .waitFor();
    assert.equal(await body.inputValue(), 'PC에 남은 이전 초안 {{content}}');
    await page.getByRole('button', { name: '최신 내용 불러오기' }).click();
    assert.equal(await body.inputValue(), '휴대폰 브라우저에서 고친 {{content}}');

    // A request finishing after further typing keeps the new draft and its acknowledged base.
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/prompt-templates/${id}`, async (route) => {
      if (route.request().method() === 'PUT') await gate;
      await route.continue();
    });
    await body.fill('먼저 전송한 본문');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await body.fill('요청 중 추가한 새 본문');
    release();
    await page
      .getByText('보낸 내용을 저장했어요. 추가 입력은 초안으로 남아 있어요.', { exact: true })
      .waitFor();
    assert.equal(await body.inputValue(), '요청 중 추가한 새 본문');
    await page.unroute(`**/api/prompt-templates/${id}`);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '요청 중 추가한 새 본문');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();

    // A legacy collision becomes a copy; a matching old draft follows it without overwriting the server.
    const source = {
      id,
      name: '브라우저의 이전 템플릿',
      description: '',
      kind: 'free',
      body: '가져올 저장 본문 {{content}}',
      archived: false,
      version: 7,
    };
    const raw = JSON.stringify({ schemaVersion: 1, items: [source] });
    // Seed before the next app boot, after the old document flushes its own draft.
    await page.addInitScript(
      ({ raw, source }) => {
        if (sessionStorage.getItem('qa:legacy-prompt-seeded')) return;
        sessionStorage.setItem('qa:legacy-prompt-seeded', '1');
        localStorage.setItem('leneu:prompt-templates:v1', raw);
        const session = sessionStorage.getItem('leneu:draft-session:v1');
        localStorage.setItem(
          `leneu:prompt-drafts:v1:${session}`,
          JSON.stringify({
            schemaVersion: 1,
            value: {
              [source.id]: {
                ...source,
                expectedVersion: 7,
                body: '브라우저 미저장 초안 {{content}}',
              },
            },
          }),
        );
      },
      { raw, source },
    );
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '브라우저 미저장 초안 {{content}}');
    await page.getByRole('button', { name: '브라우저 템플릿 가져오기' }).click();
    await page.getByText(/템플릿 1개를 가져왔어요/).waitFor();
    const importedId = new URL(page.url()).pathname.split('/').at(-1);
    assert.notEqual(importedId, id);
    assert.equal(await body.inputValue(), '브라우저 미저장 초안 {{content}}');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('leneu:prompt-templates:v1')),
      raw,
      'browser backup must remain untouched',
    );
    assert.equal(
      (await (await a.request.get(`${baseUrl}/api/prompt-templates/${id}`)).json()).item.body,
      '요청 중 추가한 새 본문',
    );
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '브라우저 미저장 초안 {{content}}');
    assert.equal(
      await page.getByRole('button', { name: '브라우저 템플릿 가져오기' }).count(),
      0,
      'successful migration notice must not repeat',
    );
    await other.goto(page.url(), { waitUntil: 'networkidle' });
    assert.equal(
      await other.getByRole('textbox', { name: '프롬프트 본문', exact: true }).inputValue(),
      '브라우저 미저장 초안 {{content}}',
    );

    // Export the server library and import a portable JSON template through the actual file input.
    await page.getByLabel('템플릿 가져오기·내보내기', { exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON 내보내기' }).click(),
    ]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.schemaVersion, 1);
    assert.ok(exported.items.some((item) => item.id === importedId && item.revisionId));
    const fileTemplate = {
      ...exported.items.find((item) => item.id === importedId),
      id: randomUUID(),
      name: '파일로 가져온 요청',
    };
    const fileInput = page.getByLabel('템플릿 JSON 파일', { exact: true });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/prompt-templates/import') && response.status() === 200,
      ),
      fileInput.setInputFiles({
        name: 'prompts.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, items: [fileTemplate] })),
      }),
    ]);
    await page.getByText(/템플릿 1개를 가져왔어요/).waitFor();
    assert.equal(
      (await (await a.request.get(`${baseUrl}/api/prompt-templates/${fileTemplate.id}`)).json())
        .item.body,
      fileTemplate.body,
    );
    const count = (await (await a.request.get(`${baseUrl}/api/prompt-templates`)).json()).items
      .length;
    await fileInput.setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ invalid'),
    });
    await page
      .getByRole('alert')
      .getByText(/템플릿 JSON 파일을 읽지 못했어요/)
      .waitFor();
    assert.equal(
      await page.getByText(/템플릿 1개를 가져왔어요/).count(),
      0,
      'invalid imports clear older success feedback',
    );
    assert.equal(
      (await (await a.request.get(`${baseUrl}/api/prompt-templates`)).json()).items.length,
      count,
    );

    await page.reload({ waitUntil: 'networkidle' });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      if (width < 760)
        await page.waitForFunction(
          () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
        );
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: `/tmp/leneu-server-prompts-${width}-${theme}.png` });
      }
    }
    console.log(
      'Server prompt QA passed: independent browsers, load retry, conflict, delayed save draft, legacy migration/backup, JSON transfer, light/dark 320/390/desktop',
    );
  } finally {
    await a.close();
    await b.close();
  }
}
