import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { selectAppTheme } from './qa-compact-pages.mjs';

export async function runShellRecoveryQa(browser, baseUrl) {
  const text = '연결 복구 확인용 메모';
  const body = new FormData();
  body.set('kind', 'note');
  body.set('text', text);
  body.set('url', '');
  assert.equal((await fetch(baseUrl + '/api/captures', { method: 'POST', body })).status, 201);
  const task = '연결 복구 확인용 할 일';
  assert.equal(
    (
      await fetch(baseUrl + '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Keep the fixture in the home summary even after other QA suites add many tasks.
        body: JSON.stringify({ title: task, dueDate: '2000-01-01' }),
      })
    ).status,
    201,
  );
  const context = await browser.newContext({ viewport: { width: 1327, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let failure = '';
    await page.goto(baseUrl+'/',{waitUntil:'networkidle'});
    await page.locator('.task-title-button').filter({hasText:task}).waitFor();
    await page.locator('.capture-card').filter({hasText:text}).waitFor();
    const failList = (route) => {
      if (route.request().method() !== 'GET' || !failure) return route.continue();
      return route.fulfill({
        status: failure === 'empty' ? 502 : 200,
        contentType: 'text/html',
        body: failure === 'empty' ? '' : '<html>unavailable</html>',
      });
    };
    await page.route('**/api/captures?**', failList);
    await page.route('**/api/tasks?**', failList);
    await page.route('**/api/sync/**', failList);
    const recent = page.locator('.memo-recent');
    for (const mode of ['empty', 'html']) {
      failure = mode;
      await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
      await page.locator('.task-title-button').filter({hasText:task}).waitFor();
      await recent.locator('.capture-card').filter({hasText:text}).waitFor();
      await page.getByRole('button',{name:'동기화 상태',exact:true}).click();
      await page.getByRole('button',{name:'지금 동기화',exact:true}).click();
      await page.locator('.sync-status-panel [role="alert"]').waitFor();
      const message=await page.locator('.sync-status-panel [role="alert"]').textContent();
      assert.equal(/Unexpected|JSON|SyntaxError/i.test(message),false,'Network parser details must not reach UI');
      assert.equal(await recent.locator('.loading-state').count(),0,'Cached rows must not be stuck loading');
      await page.getByRole('button',{name:'동기화 상태 닫기'}).click();
      await page.getByRole('textbox',{name:'메모 내용',exact:true}).fill('연결 실패 중에도 남길 초안');
      failure='';
      await page.getByRole('button',{name:'동기화 상태',exact:true}).click();
      const retry=page.getByRole('button',{name:'지금 동기화',exact:true});
      if(mode==='html'){await retry.focus();await page.keyboard.press('Enter');}else await retry.click();
      await page.waitForFunction(()=>document.querySelector('.sync-status')?.textContent.includes('동기화 완료'));
      await page.getByRole('button',{name:'동기화 상태 닫기'}).click();
      assert.equal(await page.getByRole('textbox',{name:'메모 내용',exact:true}).inputValue(),'연결 실패 중에도 남길 초안');
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      'leneu. 홈',
      'the brand home link is the first keyboard navigation target',
    );
    await page.getByRole('button', { name: '설정 열기', exact: true }).focus();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      '설정 열기',
    );
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
      'none',
      'the keyboard-focused settings button needs a visible focus indicator',
    );
    for (const width of [1327, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1327 ? 1000 : 844 });
      for (const theme of ['light', 'dark']) {
        await selectAppTheme(page, theme);
        if (width <= 760) {
          await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
          await page.waitForFunction(
            () => document.querySelector('.sidebar').getBoundingClientRect().left >= 0,
          );
        }
        const positions = await page.evaluate(() => {
          const brand = document.querySelector('.brand').getBoundingClientRect();
          const control = document
            .querySelector('.brand-line .today-label')
            .getBoundingClientRect();
          return {
            beside: control.left >= brand.right - 1,
            aligned:
              Math.abs((brand.top + brand.bottom) / 2 - (control.top + control.bottom) / 2) < 2,
          };
        });
        assert.deepEqual(
          positions,
          { beside: true, aligned: true },
          'date must sit beside the logo',
        );
        assert.match(
          await page.locator('.today-label').textContent(),
          /^\d{4}-\d{2}-\d{2} \([가-힣]\)$/,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({ path: `/tmp/leneu-shell-${width}-${theme}.png` });
        if (width <= 760) {
          await page
            .getByRole('button', { name: '메뉴 닫기', exact: true })
            .click({ position: { x: width - 10, y: 100 } });
          await page.waitForFunction(
            () => document.querySelector('.sidebar').getBoundingClientRect().right <= 1,
          );
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Shell QA passed: empty/HTML sync API failure, cached memo/task, mouse/keyboard retry, draft preservation, visible keyboard theme focus, adjacent theme selector, full KST date and 1327/390/320px themes',
    );
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-shell-qa-'));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: '8793',
      HOST: '127.0.0.1',
    },
    stdio: 'pipe',
  });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch('http://127.0.0.1:8793/api/health')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    await runShellRecoveryQa(browser, 'http://127.0.0.1:8793');
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const exit = once(server, 'exit');
      server.kill();
      await exit;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
