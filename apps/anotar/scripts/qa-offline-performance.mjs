import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const bundle = await build({
  stdin: {
    contents:
      "import * as api from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import * as db from './src/sync/db.ts';import * as summaries from './src/sync/summaries.ts';import {persistLocalPage} from './src/pages/useLocalPage.ts';window.fixture={...api,...repo,...db,...summaries,persistLocalPage};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const app = await offlineApp();
try {
  const ctx = await app.browser.newContext(),
    page = await ctx.newPage();
  await page.goto(app.base);
  await prepareShell(page);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => fixture.getWorkspaceRuntime());
  await ctx.setOffline(true);
  const seeded = await page.evaluate(async () => {
    const { workspaceId, engine } = await fixture.getWorkspaceRuntime();
    engine.stop();
    const now = new Date().toISOString(),
      pageIds = [];
    await fixture.transaction(['entities'], 'readwrite', (tx) => {
      for (let i = 0; i < 11000; i++) {
        const kind = i < 10000 ? 'capture' : 'page',
          id = crypto.randomUUID();
        if (kind === 'page') pageIds.push(id);
        const current = {
          id,
          version: 1,
          createdAt: now,
          updatedAt: now,
          ...(kind === 'capture'
            ? {
                kind: 'note',
                text: '성능 확인 메모 ' + i,
                url: '',
                files: [],
                organizedAt: null,
                aiRequest: null,
              }
            : {
                title: '성능 확인 페이지 ' + i,
                icon: '',
                parentId: null,
                position: i,
                ...(i < 10100
                  ? {
                      document: {
                        schemaVersion: 1,
                        blocks: [
                          {
                            id: crypto.randomUUID(),
                            type: 'paragraph',
                            props: {},
                            content: [
                              { type: 'text', text: '문서 본문 '.repeat(1000), styles: {} },
                            ],
                            children: [],
                          },
                        ],
                      },
                    }
                  : {}),
              }),
        };
        const entity = {
          key: fixture.keyOf(workspaceId, kind, id),
          workspaceId,
          kind,
          id,
          base: current,
          current,
          localRevision: 0,
          dirty: false,
          localSavedAt: now,
          lastRemoteReadSeq: 0,
          blobIds: [],
        };
        if (fixture.putEntity) fixture.putEntity(tx, entity);
        else tx.objectStore('entities').put(entity);
      }
    });
    fixture.announceLocalChanges();
    return { workspaceId, pageId: pageIds[0] };
  });
  await page.goto(app.base + '/memo');
  await page.locator('[data-capture-id]').first().waitFor();
  assert.equal(
    await page.locator('[data-capture-id]').count(),
    50,
    'memo DOM must be bounded to a page of 50',
  );
  await page.locator('.sidebar-page-row').first().waitFor();
  assert.ok(
    (await page.locator('.sidebar-page-row').count()) <= 52,
    'sidebar must not mount all 1000 pages',
  );
  const firstIds=await page.locator('[data-capture-id]').evaluateAll(rows=>rows.map(row=>row.dataset.captureId));
  await page.getByRole('button',{name:'다음 50개',exact:true}).click();
  await page.waitForFunction(first=>{const rows=[...document.querySelectorAll('[data-capture-id]')];return rows.length===50&&!first.includes(rows[0].dataset.captureId);},firstIds);
  await page.getByRole('button',{name:'이전 50개',exact:true}).click();
  await page.waitForFunction(first=>document.querySelector('[data-capture-id]')?.dataset.captureId===first[0],firstIds);
  await page.goto(app.base+'/pages/'+seeded.pageId);await page.getByLabel('페이지 제목',{exact:true}).waitFor();
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const observed=[];
  for(let i=0;i<10;i++){
    const title='실제 입력 측정 '+i,started=performance.now();await page.getByLabel('페이지 제목',{exact:true}).fill(title);
    const deadline=Date.now()+10000;let committed=false;
    while(Date.now()<deadline){if(await page.evaluate(async({workspaceId,pageId,title})=>(await fixture.readLocalEntity({workspaceId,kind:'page',id:pageId}))?.current.title===title,{...seeded,title})){committed=true;break;}await new Promise(r=>setTimeout(r,10));}
    assert.ok(committed,'Actual editor input is committed');observed.push(performance.now()-started);
  }
  const sorted=[...observed].sort((a,b)=>a-b),actualEditorInputToCommit={p50:sorted[4],p95:sorted[9],max:sorted[9],samples:observed};
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const measured = await page.evaluate(async ({ pageId }) => {
    const { workspaceId, engine } = await fixture.getWorkspaceRuntime();
    engine.stop();
    const entity = await fixture.readLocalEntity({ workspaceId, kind: 'page', id: pageId });
    const commits = [],
      withDebounce = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      await new Promise((r) => setTimeout(r, 250));
      const committing = performance.now();
      await fixture.persistLocalPage(
        pageId,
        { title: '측정 ' + i, icon: '', document: entity.current.document },
        entity.base,
      );
      commits.push(performance.now() - committing);
      withDebounce.push(performance.now() - started);
    }
    const stats = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { p50: sorted[4], p95: sorted[9], max: sorted[9], samples: values };
    };
    return { commit: stats(commits), including250msDebounce: stats(withDebounce) };
  }, seeded);
  console.log(
    JSON.stringify(
      {
        dataset: { captures: 10000, pageMetadata: 1000, cachedBodies: 100 },
        machine: 'local macOS Chrome, not N100',
        ...measured,
        actualEditorInputToCommit,
      },
      null,
      2,
    ),
  );
  console.log('PASS performance: 50 memo rows, bounded page tree, 10 durable local commits');
} finally {
  await app.close();
}
