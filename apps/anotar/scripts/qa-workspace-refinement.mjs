import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// Read-only browser fixtures: no seed, actual writes, or external AI calls.
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/api/**', async (route) => {
  const req = route.request();
  if (req.method() !== 'GET') return route.abort();
  const url = new URL(req.url());
  if (url.pathname === '/api/captures')
    return route.fulfill({ json: { items: [], counts: { memo: 0, ai: 0 } } });
  if (url.pathname === '/api/shared-comments')
    return route.fulfill({
      json: { items: [], counts: { all: 1, unread: 0, open: 1, resolved: 0 }, nextCursor: null },
    });
  if (url.pathname === '/api/ai/activity')
    return route.fulfill({
      json: {
        items:
          url.searchParams.get('status') === 'all'
            ? [
                {
                  id: 'fixture-job',
                  ownerKind: 'memo',
                  preview: '여행 교통편 비교',
                  templateName: '리서치',
                  organized: false,
                  status: 'result_ready',
                  createdAt: '2026-10-01T00:00:00Z',
                  finishedAt: '2026-10-01T00:01:00Z',
                  href: '/memo?capture=fixture&aiJob=fixture-job',
                },
              ]
            : [],
        counts: { queued: 0, running: 0, failed: 0, result_ready: 1 },
        total: url.searchParams.get('status') === 'all' ? 1 : 0,
      },
    });
  return route.continue();
});
try {
  await page.goto(base + '/comments', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '미해결 댓글 보기' }).click({ timeout: 4000 });
  assert.equal(new URL(page.url()).searchParams.get('view'), 'open');
  assert.equal(
    await page.getByRole('button', { name: /미해결 1/ }).getAttribute('aria-pressed'),
    'true',
  );
  await page.goto(base + '/memo', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '검색·필터 초기화' }).click();
  assert.equal(
    await page.getByRole('tab', { name: '전체', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.goto(base + '/ai?status=active', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '전체 요청 보기' }).click();
  const row = page.locator('[data-ai-job-id="fixture-job"]');
  await row.getByText('결과 보기', { exact: true }).waitFor();
  assert.equal(await row.getAttribute('href'), '/memo?capture=fixture&aiJob=fixture-job');
  await page.keyboard.press('Tab');
  await row.focus();
  assert.ok(await row.evaluate((node) => node.matches(':focus-visible')));
  assert.ok(
    await row.evaluate((node) => parseFloat(getComputedStyle(node).outlineOffset) <= -2),
    'Keyboard focus remains inside the clipped list',
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: memo filter recovery, comment follow-up, AI result destination, narrow layout; no writes.',
  );
} finally {
  await browser.close();
}
