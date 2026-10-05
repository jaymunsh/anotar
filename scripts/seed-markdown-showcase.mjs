import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.env.LENEU_BASE_URL || 'http://127.0.0.1:5173';
const force = process.argv.includes('--force');
const sample = await readFile(new URL('../examples/markdown-showcase.md', import.meta.url), 'utf8');
const [titleLine, ...bodyLines] = sample.split('\n');
const title = titleLine.replace(/^#\s+/, '').trim();
const body = bodyLines.join('\n').trim();
const previousTitle = 'Markdown 사용 예시';

const listResponse = await fetch(baseUrl + '/api/pages');
if (!listResponse.ok) throw new Error('페이지 API가 준비되지 않았습니다: ' + listResponse.status);
const { items } = await listResponse.json();
let page = items.find((item) => item.title === title || item.title === previousTitle);
if (!page) {
  const response = await fetch(baseUrl + '/api/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error('예시 페이지를 만들지 못했습니다: ' + response.status);
  page = (await response.json()).item;
}

const detailResponse = await fetch(baseUrl + '/api/pages/' + page.id);
const { item: detail } = await detailResponse.json();
if (detail.document.blocks.length > 1) {
  if (!force) {
    console.log('기존 예시 페이지를 보존했습니다: ' + baseUrl + '/pages/' + page.id);
    process.exit(0);
  }
  const reset = await fetch(baseUrl + '/api/pages/' + page.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      document: {
        schemaVersion: 1,
        blocks: [{ id: randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }],
      },
      expectedVersion: detail.version,
    }),
  });
  if (!reset.ok) throw new Error('예시 페이지 초기화에 실패했습니다: ' + reset.status);
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const tab = await context.newPage();
  await tab.goto(baseUrl + '/pages/' + page.id, { waitUntil: 'networkidle' });
  await tab.locator('.bn-editor').click();
  await tab.evaluate((text) => navigator.clipboard.writeText(text), body);
  await tab.keyboard.press('ControlOrMeta+V');

  const required = [
    'heading',
    'bulletListItem',
    'numberedListItem',
    'checkListItem',
    'quote',
    'table',
    'codeBlock',
    'diagram',
    'divider',
  ];
  let types = [];
  let saved = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(baseUrl + '/api/pages/' + page.id);
    const { item } = await response.json();
    types = item.document.blocks.map((block) => block.type);
    saved =
      required.every((type) => types.includes(type)) &&
      JSON.stringify(item.document).includes('하루에 하나의 중심만 정하고');
    if (saved) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!saved) throw new Error('예시 저장이 불완전합니다. 저장된 블록: ' + types.join(', '));
  await tab.locator('.page-save-state').getByText('저장됨', { exact: true }).waitFor();
  console.log('예시 페이지를 만들었습니다: ' + baseUrl + '/pages/' + page.id);
} finally {
  await browser.close();
}
