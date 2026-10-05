import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';

const app = await offlineApp();
const evidence = '.omo/evidence/page-link-stability';
await mkdir(evidence, { recursive: true });
const text = (value) => [{ type: 'text', text: value, styles: {} }];
async function getPage(id) {
  return (await (await fetch(`${app.base}/api/pages/${id}`)).json()).item;
}
async function putPage(item, changes) {
  return (
    await app.request(
      `/api/pages/${item.id}`,
      {
        title: item.title,
        icon: item.icon,
        document: item.document,
        expectedVersion: item.version,
        ...changes,
      },
      'PUT',
    )
  ).item;
}
const targets = [];
for (const [title, icon] of [
  ['첫 번째 자료', '🔎'],
  ['두 번째 자료', '🧳'],
  ['세 번째 자료', '📝'],
  ['네 번째 자료', '🛠️'],
]) {
  const { item } = await app.request('/api/pages', { title });
  targets.push(await putPage(item, { icon }));
}
let source = (await app.request('/api/pages', { title: '링크 안정성 확인' })).item;
source = await putPage(source, {
  document: {
    schemaVersion: 1,
    blocks: targets.map((item) => ({
      id: randomUUID(),
      type: 'page',
      props: { pageId: item.id, title: '저장된 제목' },
      children: [],
    })),
  },
});
const failures = [];
async function check(label, work) {
  try {
    await work();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
try {
  for (const [width, colorScheme] of [
    [1440, 'light'],
    [390, 'dark'],
  ]) {
    const context = await app.browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    const page = await context.newPage();
    const errors = [];
    const reads = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (targets.some((item) => request.url().includes(`/api/sync/entities/page/${item.id}`)))
        reads.push(request.url());
    });
    const first = page.locator(`.page-link-block[href="/pages/${targets[0].id}"]`);
    await page.goto(`${app.base}/pages/${source.id}`);
    for (const target of targets) {
      await page
        .locator(`.page-link-block[href="/pages/${target.id}"]`)
        .getByText(target.title, { exact: true })
        .waitFor();
      await page.waitForFunction(
        ({ id, icon }) =>
          document.querySelector(`.page-link-block[href="/pages/${id}"] .page-link-icon`)
            ?.textContent === icon,
        target,
      );
    }
    await page.evaluate(
      (expected) => {
        window.linkFlickers = [];
        window.expectedIcons = expected;
        window.linkObserver = new MutationObserver(() => {
          for (const [id, icon] of Object.entries(window.expectedIcons)) {
            const current = document.querySelector(
              `.page-link-block[href="/pages/${id}"] .page-link-icon`,
            )?.textContent;
            if (current !== icon) window.linkFlickers.push({ id, current });
          }
        });
        window.linkObserver.observe(document.querySelector('.bn-editor'), {
          subtree: true,
          childList: true,
          characterData: true,
        });
      },
      Object.fromEntries(targets.map((item) => [item.id, item.icon])),
    );
    await check(`idle requests and icon continuity ${width}-${colorScheme}`, async () => {
      // A short bounded observation must settle well before the normal 30s poll.
      const before = reads.length;
      await page.waitForTimeout(2500);
      const additionalReads = reads.length - before;
      const flickers = await page.evaluate(() => window.linkFlickers);
      console.log(JSON.stringify({ width, additionalReads, flickers: flickers.length }));
      assert(
        additionalReads <= 12,
        `idle links kept requesting their pages: ${additionalReads} reads`,
      );
      assert.deepEqual(
        flickers,
        [],
        'resolved icons must not revert to a generic icon during reads',
      );
      const settledReads = reads.length;
      await page.waitForTimeout(1000);
      assert.equal(reads.length - settledReads, 0, 'settled links must stop refreshing themselves');
      assert.equal(
        (await getPage(source.id)).version,
        source.version,
        'link rendering must not save the source document',
      );
    });
    await check(`focus refresh preserves icon ${width}-${colorScheme}`, async () => {
      await page.route(`**/api/sync/entities/page/${targets[0].id}`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        await route.continue();
      });
      await page.evaluate(() => {
        window.linkFlickers = [];
        dispatchEvent(new Event('focus'));
      });
      await page.waitForTimeout(600);
      assert.deepEqual(
        await page.evaluate(() => window.linkFlickers),
        [],
        'focus refresh must retain resolved icons',
      );
      await page.unroute(`**/api/sync/entities/page/${targets[0].id}`);
    });
    if (!failures.length) {
      const latest = await getPage(targets[0].id);
      const renamed = await putPage(latest, { title: '이름과 아이콘 변경', icon: '🌿' });
      await page.evaluate(
        ({ id, icon }) => {
          window.linkObserver.disconnect();
          window.expectedIcons[id] = icon;
          dispatchEvent(new Event('focus'));
        },
        { id: renamed.id, icon: renamed.icon },
      );
      await first.getByText(renamed.title, { exact: true }).waitFor();
      assert.equal(await first.locator('.page-link-icon').innerText(), renamed.icon);
      await page.screenshot({ path: `${evidence}/links-${width}-${colorScheme}.png` });
      await prepareShell(page);
      await context.setOffline(true);
      await page.reload();
      await first.getByText(renamed.title, { exact: true }).waitFor();
      assert.equal(await first.locator('.page-link-icon').innerText(), renamed.icon);
      await context.setOffline(false);
      const deleted = await app.request(
        `/api/pages/${renamed.id}/trash`,
        { operationId: randomUUID(), expectedVersion: renamed.version },
        'POST',
      );
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await first.getByText('페이지를 찾을 수 없어요', { exact: true }).waitFor();
      const trash = await (await fetch(`${app.base}/api/trash?type=page`)).json();
      const entry = trash.items.find(
        (item) => item.id === deleted.item.id && item.targetId === renamed.id,
      );
      assert(entry, 'deleted page must be restorable');
      await app.request(`/api/trash/${entry.id}/restore`, { operationId: randomUUID() }, 'POST');
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await first.getByText(renamed.title, { exact: true }).waitFor();
      assert.equal(await first.locator('.page-link-icon').innerText(), renamed.icon);
      console.log(`PASS title/icon updates, offline, deletion/restore ${width}-${colorScheme}`);
      targets[0] = renamed;
      assert.deepEqual(errors, []);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await context.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(
    'PASS linked page stability: bounded idle reads, continuous icons, refresh, metadata updates, offline, delete/restore',
  );
} finally {
  await app.close();
}
