import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { offlineApp } from './fixtures/offline-app.mjs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const bundle = await build({
  stdin: {
    contents:
      "import * as runtime from './src/sync/runtime.ts';import * as repo from './src/sync/repository.ts';import * as db from './src/sync/db.ts';import * as workflows from './src/sync/workflows.ts';import * as pages from './src/pages/useLocalPage.ts';import * as cache from './src/offline/pageCache.ts';import * as recovery from './src/offline/recovery.ts';import * as exp from './src/offline/exportPending.ts';import {transport} from './src/sync/transport.ts';import {cachedRequest} from './src/sync/cachedRequest.ts';window.fixture={...runtime,...repo,...db,...workflows,...pages,...cache,...recovery,...exp,transport,cachedRequest};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const app = await offlineApp(),
  failures = [];
const source = (await app.request('/api/pages', { title: '리뷰 원본' })).item;
async function setup() {
  const context = await app.browser.newContext();
  await context.route('**/fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>fixture</main>' }),
  );
  const page = await context.newPage();
  await page.goto(app.base + '/fixture');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async (id) => {
    const r = await fixture.getWorkspaceRuntime();
    await fixture.workspaceFetch('/api/pages/' + id);
    r.engine.stop();
    await r.engine.requestSync();
  }, source.id);
  return { context, page };
}
async function test(name, work) {
  const env = await setup();
  try {
    await work(env);
    console.log('PASS ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL ' + name + ': ' + e.message);
  } finally {
    await env.context.close();
  }
}
try {
  await test('C1 same-IDB competing revisions preserved', async ({ context, page }) => {
    const other = await context.newPage();
    await other.goto(app.base + '/fixture');
    await other.addScriptTag({ content: bundle.outputFiles[0].text });
    await other.evaluate(async () => {
      (await fixture.getWorkspaceRuntime()).engine.stop();
    });
    await context.setOffline(true);
    const base = await page.evaluate(async (id) => {
      const { workspaceId } = await fixture.getWorkspaceRuntime();
      return (await fixture.readLocalEntity({ workspaceId, kind: 'page', id })).current;
    }, source.id);
    await page.evaluate(
      ({ id, base }) =>
        fixture.persistLocalPage(
          id,
          { title: 'A에서 저장한 원문', icon: '', document: base.document },
          base,
          0,
        ),
      { id: source.id, base },
    );
    await assert.rejects(
      other.evaluate(
        ({ id, base }) =>
          fixture.persistLocalPage(
            id,
            { title: 'B에서 쓴 경쟁 사본', icon: '', document: base.document },
            base,
            0,
          ),
        { id: source.id, base },
      ),
      /다른 창/,
    );
    const copies = await page.evaluate(async (id) => {
      const { workspaceId } = await fixture.getWorkspaceRuntime();
      return {
        current: (await fixture.readLocalEntity({ workspaceId, kind: 'page', id })).current,
        meta: await fixture.listRecords('meta', workspaceId, 100),
      };
    }, source.id);
    assert.equal(copies.current.title, 'A에서 저장한 원문');
    assert.ok(JSON.stringify(copies.meta).includes('B에서 쓴 경쟁 사본'));
  });
  await test('I1 canceled operation cannot be claimed', async ({ context, page }) => {
    await context.setOffline(true);
    await page.evaluate(async (id) => {
      const { workspaceId, repository } = await fixture.getWorkspaceRuntime();
      const requestId = crypto.randomUUID();
      await fixture.queueWorkflow('ai.submit', 'page', id, requestId, {
        request: { template: null, additional: '취소할 요청' },
      });
      const candidate = await fixture.readRecord('outbox', workspaceId, requestId);
      const lease = await repository.acquireLease('review', Date.now() + 60000);
      await fixture.cancelQueuedWorkflow(requestId);
      if ((await repository.markSending(candidate, lease)) !== false)
        throw Error('Canceled candidate claimed');
      if (await fixture.readRecord('outbox', workspaceId, requestId))
        throw Error('Canceled row resurrected');
    }, source.id);
  });
  await test('I2 normal remote refresh preserves complete pin', async ({ context, page }) => {
    await context.setOffline(true);
    await page.evaluate(async () => {
      const { workspaceId } = await fixture.getWorkspaceRuntime(),
        id = crypto.randomUUID(),
        a = crypto.randomUUID(),
        b = crypto.randomUUID();
      const doc = (assetId) => ({
        schemaVersion: 1,
        blocks: [{ id: crypto.randomUUID(), type: 'asset', props: { assetId }, children: [] }],
      });
      const incoming = {
        entityKind: 'page',
        entityId: id,
        version: 1,
        readSeq: 10,
        tombstone: false,
        item: { id, title: '보관 페이지', version: 1, document: doc(a) },
      };
      await fixture.pinPage(
        { pageId: id },
        {
          workspaceId,
          shell: async () => ({ ready: true, appVersion: 'test' }),
          fetchEntity: async () => incoming,
          fetchAsset: async () => ({ blob: new Blob(['a']), name: 'a', mime: 'text/plain' }),
        },
      );
      await fixture.applyRemoteEntity(workspaceId, {
        ...incoming,
        version: 2,
        readSeq: 11,
        item: { ...incoming.item, version: 2, document: doc(b) },
      });
      const pin = await fixture.readRecord('pins', workspaceId, id),
        entity = await fixture.readLocalEntity({ workspaceId, kind: 'page', id });
      if (pin.state !== 'partial') throw Error('New missing asset still ready');
      if (entity.current.document.blocks[0].props.assetId !== a)
        throw Error('Last complete document lost');
    });
  });
  await test('I4 archived conflict/operation attachment export+GC', async ({ context, page }) => {
    await context.setOffline(true);
    await page.evaluate(async () => {
      const { workspaceId } = await fixture.getWorkspaceRuntime(),
        assetId = crypto.randomUUID(),
        pageId = crypto.randomUUID(),
        blob = new Blob(['archived bytes']),
        hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
      const document = { schemaVersion: 1, blocks: [{ type: 'asset', props: { assetId } }] };
      await fixture.writeRecord('blobs', workspaceId, [assetId], {
        id: assetId,
        blob,
        hash,
        name: 'archive.txt',
        mime: 'text/plain',
      });
      await fixture.writeRecord('pins', workspaceId, [pageId], {
        pageId,
        state: 'ready',
        assetIds: [assetId],
        version: 1,
      });
      await fixture.writeRecord('meta', workspaceId, ['recoveryArchive', 'archive'], {
        entities: [],
        conflicts: [{ local: { document, blobIds: [assetId] } }],
        outbox: [{ operation: { payload: { sourceSnapshot: { document } } } }],
      });
      const exported = await fixture.exportPendingWorkspace(workspaceId);
      if (!exported.manifest.files.some((f) => f.id === assetId))
        throw Error('Archived attachment missing from ZIP');
      await fixture.unpinPage(pageId, { workspaceId });
      if (!(await fixture.readLocalBlob(workspaceId, assetId)))
        throw Error('Archive-only attachment garbage collected');
      await fixture.transaction(['blobs'], 'readwrite', (tx) =>
        tx.objectStore('blobs').delete(fixture.keyOf(workspaceId, assetId)),
      );
      try {
        await fixture.exportPendingWorkspace(workspaceId);
        throw Error('Export accepted missing attachment');
      } catch (e) {
        if (!e.message.includes('첨부')) throw e;
      }
    });
  });
  await test('I4 server-only missing attachment is reported without blocking text export', async ({
    context,
    page,
  }) => {
    await context.setOffline(true);
    await page.evaluate(async () => {
      const { workspaceId } = await fixture.getWorkspaceRuntime(),
        id = crypto.randomUUID(),
        assetId = crypto.randomUUID();
      const value = {
        id,
        title: '서버 첨부가 있는 수정 사본',
        version: 1,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: crypto.randomUUID(),
              type: 'asset',
              props: { assetId, display: 'file' },
              children: [],
            },
          ],
        },
      };
      await fixture.applyRemoteEntity(workspaceId, {
        entityKind: 'page',
        entityId: id,
        version: 1,
        readSeq: 1,
        tombstone: false,
        item: value,
      });
      await fixture.queueValue('page', id, { ...value, title: '원문 수정' });
      const result = await fixture.exportPendingWorkspace(workspaceId);
      if (!result.manifest.missingAssets?.includes(assetId) || result.manifest.complete !== false)
        throw Error('Missing server-only reference not disclosed');
    });
  });
  await test('I5 explicit corrected rejected write unblocks', async ({ context, page }) => {
    await context.setOffline(true);
    await page.evaluate(async (id) => {
      const { workspaceId, repository } = await fixture.getWorkspaceRuntime();
      const entity = await fixture.readLocalEntity({ workspaceId, kind: 'page', id });
      await fixture.queueValue('page', id, { ...entity.current, title: '거부될 수정' });
      const old = (await fixture.listRecords('outbox', workspaceId, 50))[0],
        lease = await repository.acquireLease('review', Date.now() + 60000);
      await repository.reject(
        old,
        'failed',
        { status: 422, code: 'invalid', message: 'validation' },
        0,
        lease,
      );
      await fixture.queueValue('page', id, { ...entity.current, title: '고친 원문' });
      if (!fixture.replaceRejectedWrite) throw Error('No correction action');
      await fixture.replaceRejectedWrite(old.operation.operationId);
      const next = await repository.nextOperation(Date.now(), ['page.update']);
      if (
        !next ||
        next.operation.operationId === old.operation.operationId ||
        next.operation.payload.title !== '고친 원문'
      )
        throw Error('Corrected immutable write still blocked');
    }, source.id);
  });
  await test('I6 recovery blocks foreign direct/cache ingress', async ({ page }) => {
    await page.evaluate(async (id) => {
      const r = await fixture.getWorkspaceRuntime();
      const cached = await fixture.readLocalEntity({
        workspaceId: r.workspaceId,
        kind: 'page',
        id,
      });
      const session = await fixture.transport.session();
      fixture.transport.session = async () => ({ ...session, workspaceId: crypto.randomUUID() });
      let calls = 0;
      fixture.transport.fetchEntity = async () => {
        calls++;
        return {
          entityKind: 'page',
          entityId: id,
          item: { ...cached.current, title: '다른 서버 본문' },
          version: 1,
          readSeq: 999,
          tombstone: false,
        };
      };
      await r.engine.requestSync();
      await r.engine.requestSync();
      if (fixture.getSyncSnapshot().state !== 'recovery') throw Error('recovery not active');
      const result = await fixture.workspaceFetch('/api/pages/' + id);
      if ((await result.json()).item.title === '다른 서버 본문' || calls)
        throw Error('foreign content fetched/stored during recovery');
      await fixture.writeRecord('meta', r.workspaceId, ['http', '/api/test'], {
        snapshot: { title: '기존 캐시' },
      });
      const original = window.fetch;
      window.fetch = async () => {
        throw Error('remote read must be skipped');
      };
      try {
        if ((await fixture.cachedRequest('/api/test')).title !== '기존 캐시')
          throw Error('cached request failed recovery isolation');
      } finally {
        window.fetch = original;
      }
    }, source.id);
  });
  await test('I3 recovery remaps selected hierarchy/references', async ({ context, page }) => {
    await context.setOffline(true);
    const ids = await page.evaluate(async () => {
      const send = async (title, parentId) => {
        const r = await fixture.workspaceFetch('/api/pages', {
          method: 'POST',
          body: JSON.stringify({ title, parentId }),
        });
        return (await r.json()).item;
      };
      const parent = await send('복구 부모', null),
        child = await send('복구 자식', parent.id);
      await fixture.workspaceFetch('/api/pages/' + parent.id, {
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: 1,
          title: parent.title,
          icon: '',
          document: {
            schemaVersion: 1,
            blocks: [
              {
                id: crypto.randomUUID(),
                type: 'page',
                props: { pageId: child.id, title: child.title },
                children: [],
              },
            ],
          },
        }),
      });
      return { parent: parent.id, child: child.id };
    });
    const db = new DatabaseSync(join(app.dir, 'storage.sqlite'));
    db.prepare('UPDATE sync_meta SET epoch=?').run(randomUUID());
    db.close();
    await context.setOffline(false);
    await page.evaluate(async () => {
      await fixture.requestWorkspaceSync();
      const r = await fixture.getWorkspaceRuntime();
      await fixture.exportPendingWorkspace(r.workspaceId);
      const keys = (await fixture.listRecords('entities', r.workspaceId, 100))
        .filter((e) => e.dirty)
        .map((e) => e.key);
      await fixture.reconnectAfterReview({ reviewed: true, selectedKeys: keys });
      await fixture.requestWorkspaceSync();
    });
    let pages = [];
    for (let i = 0; i < 450; i++) {
      pages = (await (await fetch(app.base + '/api/pages')).json()).items;
      if (pages.some((p) => p.title.startsWith('복구 자식'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const parent = pages.find((p) => p.title.startsWith('복구 부모')),
      child = pages.find((p) => p.title.startsWith('복구 자식'));
    assert.ok(parent && child, 'Recovered pages missing');
    assert.equal(child.parentId, parent.id, 'Recovered child hierarchy lost');
    const document = (await (await fetch(app.base + '/api/pages/' + parent.id)).json()).item
      .document;
    assert.ok(
      document.blocks.some((b) => b.props?.pageId === child.id),
      'Recovered page reference not remapped',
    );
  });
  if (failures.length) throw Error('Review regression failures: ' + failures.join(', '));
} finally {
  await app.close();
}
