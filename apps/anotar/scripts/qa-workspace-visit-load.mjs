import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';

// A stable component mount exercises the retained-document invariant independently of root route keys.
const a = randomUUID(),
  b = randomUUID();
const record = (id, title) => ({
  id,
  title,
  icon: '',
  parentId: null,
  position: 0,
  version: 1,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
  document: { schemaVersion: 1, blocks: [] },
});
const records = [record(a, 'A'), record(b, 'B')];
const fixturePlugin = {
  name: 'workspace-visit-fixture',
  configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      if (request.url !== '/__workspace-visit-fixture') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(
        await vite.transformIndexHtml(
          request.url,
          `<html><body><div id="root"></div><script type="module">
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import Workspace from '/src/pages/PageWorkspace.tsx';
    function Harness() { const [id,setId]=useState(${JSON.stringify(a)}); return React.createElement(React.Fragment,null,
      React.createElement('button',{onClick:()=>setId(${JSON.stringify(a)})},'Open A'),
      React.createElement('button',{onClick:()=>setId(${JSON.stringify(b)})},'Open B'),
      React.createElement(Workspace,{selectedId:id,navigate:()=>{},sidebarTarget:null,dashboardTarget:null,showContent:true,theme:'light',onTrashed:()=>{}})); }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
  </script></body></html>`,
        ),
      );
    });
  },
};
const vite = await createServer({
  plugins: [fixturePlugin],
  server: { port: 0, host: '127.0.0.1' },
});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const visits = [];
  let failA = false;
  await page.route('**/src/pages/PageEditor.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export default function Editor(){return null}',
    }),
  );
  await page.route('**/api/**', (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/pages')
      return route.fulfill({
        json: { items: records.map(({ document, ...summary }) => summary), stagingPageId: null },
      });
    if (path.endsWith('/workspace')) {
      visits.push(request.postDataJSON());
      return route.fulfill({ json: { favorites: [], recentVisited: [], favoriteIds: [] } });
    }
    if (path === '/api/workspace/pages')
      return route.fulfill({ json: { favorites: [], recentVisited: [], favoriteIds: [] } });
    if (path === '/api/pages/' + b || (path === '/api/pages/' + a && failA))
      return route.fulfill({ status: 503, json: { error: 'fixture failed load' } });
    if (path === '/api/pages/' + a) return route.fulfill({ json: { item: records[0] } });
    return route.fulfill({ status: 404, json: { error: 'fixture unknown route' } });
  });
  await page.goto(base + '/__workspace-visit-fixture', { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Fixture mounts without browser errors');
  assert.equal(visits.length, 1, 'Successful A opening records one visit');
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  await page.locator('.pages-error').waitFor();
  assert.equal(visits.length, 1, 'Failed B opening records no visit');
  failA = true;
  const failed = page.waitForResponse(
    (response) => response.url().endsWith('/api/pages/' + a) && response.status() === 503,
  );
  await page.getByRole('button', { name: 'Open A', exact: true }).click();
  await failed;
  await page.locator('.pages-error').waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    visits.length,
    1,
    'Retained A document cannot record a visit before its new GET succeeds',
  );
  failA = false;
  const successful = page.waitForResponse(
    (response) =>
      response.url().endsWith('/workspace') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await successful;
  assert.equal(visits.length, 2, 'Successful retry records the actual reopened A once');
  console.log(
    'Stable Workspace load QA passed: success A, failed B, failed A retain prior visit count; successful retry records once',
  );
  await context.close();
} finally {
  await browser?.close();
  await vite.close();
}
