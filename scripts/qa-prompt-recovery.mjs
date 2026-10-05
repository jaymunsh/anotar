import assert from 'node:assert/strict';

export async function runPromptRecoveryQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl + '/prompts/new', { waitUntil: 'networkidle' });
    const body = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    await page.getByRole('textbox', { name: '템플릿 이름' }).fill('응답이 끊긴 뒤 복구하는 요청');
    await body.fill('처음 보낸 본문');
    let committed;
    await page.route('**/api/prompt-templates', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      committed = (await response.json()).item;
      await route.abort();
    });
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(committed, 'server must have committed before its response was lost');
    await page.unroute('**/api/prompt-templates');
    await body.fill('응답이 끊긴 뒤 추가한 본문');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '응답이 끊긴 뒤 추가한 본문');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.waitForURL(baseUrl + '/prompts/' + committed.id);
    await page
      .getByText('보낸 내용을 저장했어요. 추가 입력은 초안으로 남아 있어요.', { exact: true })
      .waitFor();
    assert.equal(await body.inputValue(), '응답이 끊긴 뒤 추가한 본문');
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText('저장소에 저장했어요.', { exact: true }).waitFor();
    const library = await (await context.request.get(baseUrl + '/api/prompt-templates')).json();
    const recovered = library.items.filter((item) => item.name === '응답이 끊긴 뒤 복구하는 요청');
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].body, '응답이 끊긴 뒤 추가한 본문');

    // An import completion must respect a capture selection changed while it was in flight.
    const preset = library.items.find((item) => item.id === 'research-brief');
    const response = await context.request.put(`${baseUrl}/api/prompt-templates/${preset.id}`, {
      data: {
        ...preset,
        body: '서버에서 먼저 수정한 URL {{url}}',
        expectedVersion: preset.version,
        expectedRevisionId: preset.revisionId,
      },
    });
    assert.equal(response.status(), 200);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page
      .getByRole('textbox', { name: '메모 내용', exact: true })
      .fill('https://example.com/research');
    await page.getByRole('checkbox', { name: 'AI 요청', exact: true }).check();
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('research-brief');
    await page.getByRole('button', { name: '템플릿 관리' }).click();
    const legacy = {
      ...preset,
      body: '이전 브라우저의 리서치 {{url}}',
      version: 7,
      revisionId: undefined,
    };
    await page.evaluate(
      (item) =>
        localStorage.setItem(
          'leneu:prompt-templates:v1',
          JSON.stringify({ schemaVersion: 1, items: [item] }),
        ),
      legacy,
    );
    await page.reload({ waitUntil: 'networkidle' });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/prompt-templates/import', async (route) => {
      await gate;
      await route.continue();
    });
    const synced = await page.evaluate(() => localStorage.getItem('leneu:prompt-library-sync:v1'));
    await page.getByRole('button', { name: '브라우저 템플릿 가져오기' }).click();
    await page.locator('.sidebar').getByRole('link', { name: '입력함', exact: true }).click();
    await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).selectOption('idea-outline');
    const imported = page.waitForResponse(
      (item) => item.url().endsWith('/api/prompt-templates/import') && item.status() === 200,
    );
    release();
    await imported;
    await page.waitForFunction(
      (before) => localStorage.getItem('leneu:prompt-library-sync:v1') !== before,
      synced,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page.getByRole('combobox', { name: 'AI 요청 템플릿' }).inputValue(),
      'idea-outline',
      'late import must keep the latest capture selection',
    );
    assert.equal(new URL(page.url()).pathname, '/');
  } finally {
    await context.close();
  }
  await runCombinedDraftQa(browser, baseUrl);
  await runConcurrentCreationDraftQa(browser, baseUrl);
  console.log(
    'Prompt recovery QA passed: lost creation response, changed/reloaded retry, no duplicate, separate drafts preserved, latest selection during import, combined legacy/server drafts, corrupt backup preservation',
  );
}

async function runConcurrentCreationDraftQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl + '/prompts/new', { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: '템플릿 이름' }).fill('동일 항목의 두 초안');
    const body = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    await body.fill('처음 전송한 내용');
    let created;
    await page.route('**/api/prompt-templates', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      created = (await (await route.fetch()).json()).item;
      await route.abort();
    });
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.unroute('**/api/prompt-templates');
    await body.fill('새 작성 화면에서 남긴 초안');
    await page.goto(`${baseUrl}/prompts/${created.id}`, { waitUntil: 'networkidle' });
    await body.fill('서버 항목에서 별도로 남긴 초안');
    await page.goto(baseUrl + '/prompts/new', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
    await page.getByText(/보낸 내용을 저장했어요/).waitFor();
    assert.equal(new URL(page.url()).pathname, '/prompts/new');
    await page.getByText(/복제해서 따로 저장할 수 있어요/).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    const value = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            `leneu:prompt-drafts:v1:${sessionStorage.getItem('leneu:draft-session:v1')}`,
          ),
        ).value,
    );
    assert.equal(
      value[created.id]?.body,
      '서버 항목에서 별도로 남긴 초안',
      'acknowledgement must not replace a separate target draft',
    );
    assert.equal(value.new?.body, '새 작성 화면에서 남긴 초안');
    await page.getByRole('button', { name: '템플릿 복제', exact: true }).click();
    await page
      .getByText('복사본을 만들었어요. 원하는 문구로 바꿔보세요.', { exact: true })
      .waitFor();
    assert.equal(await body.inputValue(), '새 작성 화면에서 남긴 초안');
    const copiedId = new URL(page.url()).pathname.split('/').at(-1);
    assert.notEqual(copiedId, created.id);
    const library = await (await context.request.get(baseUrl + '/api/prompt-templates')).json();
    assert.equal(
      library.items.find((item) => item.id === copiedId).body,
      '새 작성 화면에서 남긴 초안',
    );
    await page.goto(`${baseUrl}/prompts/${created.id}`, { waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '서버 항목에서 별도로 남긴 초안');
  } finally {
    await context.close();
  }
}

async function runCombinedDraftQa(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (sessionStorage.getItem('qa:combined-drafts')) return;
      sessionStorage.setItem('qa:combined-drafts', '1');
      const session = crypto.randomUUID();
      sessionStorage.setItem('leneu:draft-session:v1', session);
      const items = Array.from({ length: 200 }, (_, i) => ({
        id: crypto.randomUUID(),
        name: `이전 템플릿 ${i}`,
        description: '',
        kind: 'free',
        body: `저장한 본문 ${i}`,
        archived: false,
        version: 1,
      }));
      localStorage.setItem(
        'leneu:prompt-templates:v1',
        JSON.stringify({ schemaVersion: 1, items }),
      );
      const value = Object.fromEntries(
        items.map((item, i) => [
          item.id,
          { ...item, expectedVersion: 1, body: `미저장 초안 ${i}` },
        ]),
      );
      value.new = {
        name: '작성 중인 새 요청',
        description: '',
        kind: 'free',
        body: '새 초안',
        archived: false,
      };
      localStorage.setItem(
        `leneu:prompt-drafts:v1:${session}`,
        JSON.stringify({ schemaVersion: 1, value }),
      );
    });
    await page.goto(baseUrl + '/prompts/research-brief', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '브라우저 템플릿 가져오기' }).click();
    await page.getByRole('alert').getByText(/200개/).waitFor();
    const body = page.getByRole('textbox', { name: '프롬프트 본문', exact: true });
    await body.fill('서버 템플릿의 미저장 초안도 함께 유지');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await body.inputValue(), '서버 템플릿의 미저장 초안도 함께 유지');
    assert.equal(await page.getByText('이 기기에 남은 초안', { exact: true }).count(), 201);
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(
            JSON.parse(
              localStorage.getItem(
                `leneu:prompt-drafts:v1:${sessionStorage.getItem('leneu:draft-session:v1')}`,
              ),
            ).value,
          ).length,
      ),
      202,
    );

    // Even an invalid envelope must not be replaced by a later edit.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('qa:corrupt-draft')) return;
      sessionStorage.setItem('qa:corrupt-draft', '1');
      localStorage.setItem(
        `leneu:prompt-drafts:v1:${sessionStorage.getItem('leneu:draft-session:v1')}`,
        '{ invalid',
      );
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('alert')
      .getByText(/새 초안의 임시저장은 멈췄어요/)
      .waitFor();
    await body.fill('복구 실패 뒤 새로 쓴 내용');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem(
          `leneu:prompt-drafts:v1:${sessionStorage.getItem('leneu:draft-session:v1')}`,
        ),
      ),
      '{ invalid',
    );
  } finally {
    await context.close();
  }
}
