import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const bundle = await build({
  stdin: {
    contents:
      "import * as db from './src/sync/db.ts';import * as repo from './src/sync/repository.ts';import * as summaries from './src/sync/summaries.ts';import * as storage from './src/offline/storage.ts';window.fixture={...db,...repo,...summaries,...storage};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const server = createServer((q, r) => {
  r.setHeader('Content-Type', q.url === '/fixture.js' ? 'application/javascript' : 'text/html');
  r.end(
    q.url === '/fixture.js' ? bundle.outputFiles[0].text : '<script src="/fixture.js"></script>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const ctx = await browser.newContext(),
    hold = await ctx.newPage();
  await hold.goto(`http://127.0.0.1:${server.address().port}`);
  await hold.evaluate(async () => {
    window.held = await new Promise((resolve, reject) => {
      const r = indexedDB.open('leneu-offline-v1', 1);
      r.onupgradeneeded = () => {
        for (const name of ['entities', 'outbox', 'blobs', 'conflicts', 'pins', 'meta', 'leases']) {
          const store = r.result.createObjectStore(name, { keyPath: 'key' });
          store.createIndex('workspace', 'workspaceId');
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = held.transaction(['entities', 'meta'], 'readwrite');
      tx.objectStore('entities').put({
        key: 'old',
        workspaceId: 'w',
        kind: 'page',
        id: 'old',
        current: { title: '기존 원문', document: { schemaVersion: 1, blocks: [] } },
        base: null,
        dirty: false,
        localRevision: 0,
        blobIds: [],
        localSavedAt: '2026-10-03',
        lastRemoteReadSeq: 0,
      });
      tx.objectStore('meta').put({ key: 'receipt', workspaceId: 'w', fixed: 'keep' });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  });
  const other = await ctx.newPage();
  await other.goto(`http://127.0.0.1:${server.address().port}`);
  await assert.rejects(
    other.evaluate(() => fixture.openWorkspaceDb()),
    /다른 leneu 창/,
  );
  await hold.evaluate(() => held.close());
  await other.waitForTimeout(100);
  const migrated = await other.evaluate(async () => {
    const db = await fixture.openWorkspaceDb();
    return {
      version: db.version,
      rows: await fixture.listRecords('entities', 'w'),
      summaries: await fixture.querySummaries('w', 'page'),
      meta: await fixture.listRecords('meta', 'w'),
    };
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.rows[0].current.title, '기존 원문');
  assert.equal(migrated.summaries.rows[0].current.document, undefined);
  assert.equal(migrated.meta[0].fixed, 'keep');
  await other.evaluate(async () => {
    await fixture.saveLocalEntity({
      workspaceId: 'w',
      kind: 'capture',
      id: 'pending',
      value: { text: '미전송 원문', kind: 'file', files: [{ id: 'blob', name: 'keep.txt' }] },
      blobs: [
        {
          id: 'blob',
          blob: new Blob(['절대 삭제 금지']),
          hash: 'hash',
          name: 'keep.txt',
          mime: 'text/plain',
        },
      ],
    });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'entities') throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, value, ...args);
    };
    try {
      await fixture.saveLocalEntity({
        workspaceId: 'w',
        kind: 'capture',
        id: 'fail',
        value: { text: '입력 유지' },
      });
      throw Error('quota failure missing');
    } catch (e) {
      if (!e.message.includes('저장 공간이 부족')) throw e;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    if (await fixture.readLocalEntity({ workspaceId: 'w', kind: 'capture', id: 'fail' }))
      throw Error('failed transaction left an entity');
    if ((await fixture.querySummaries('w', 'capture')).rows.some((r) => r.id === 'fail'))
      throw Error('failed transaction left summary');
    try {
      await fixture.checkDownloadSpace('w', 1, 0);
      throw Error('budget failure missing');
    } catch (e) {
      if (!e.message.includes('공간이 부족')) throw e;
    }
    const preserved = await fixture.readLocalBlob('w', 'blob');
    if ((await preserved.blob.text()) !== '절대 삭제 금지')
      throw Error('quota deleted pending bytes');
  });
  console.log(
    'PASS storage: blocked upgrade guidance, additive v1→v2 retains body/receipts, summary backfill, quota atomic rollback and pending bytes retained',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
