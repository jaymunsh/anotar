import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  createDuplicatePending,
  createPageAssetPending,
  createPageToolsPending,
  executePageToolsPending,
  forgetPageToolsPending,
  recoverPageToolsPending,
  rememberPageToolsPending,
  restorePageAssetFiles,
  deletePageTemplate,
  PageToolsResponseError,
} from '../src/pages/pageToolsApi.ts';

function storage(t) {
  const values = new Map();
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => {
    if (previous) globalThis.sessionStorage = previous;
    else delete globalThis.sessionStorage;
  });
  return values;
}
const page = (id = randomUUID(), version = 2) => ({
  id,
  version,
  title: '페이지',
  icon: '',
  parentId: null,
  position: 0,
  document: { schemaVersion: 1, blocks: [] },
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
});

test('lost duplicate receipts keep the UUID and return current created page instead of stale receipt', async (t) => {
  storage(t);
  const source = page(),
    created = page();
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      assert.equal(request.url, '/api/pages/' + created.id);
      response.end(
        JSON.stringify({ item: { ...created, version: 8, title: '나중에 수정한 제목' } }),
      );
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    requests.push(JSON.parse(text));
    if (requests.length === 1) {
      response.destroy();
      return;
    }
    response.end(JSON.stringify({ item: created, replayed: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (path, options) =>
    nativeFetch(`http://127.0.0.1:${server.address().port}` + path, options);
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const pending = createDuplicatePending(source);
  await assert.rejects(executePageToolsPending(pending));
  source.version = 99;
  const restored = recoverPageToolsPending(source.id);
  const receipt = await executePageToolsPending(restored);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[1].expectedVersion, 2);
  assert.equal(receipt.item.version, 8);
  assert.equal(receipt.item.title, '나중에 수정한 제목');
  forgetPageToolsPending(source.id);
  assert.equal(recoverPageToolsPending(source.id), null);
});

test('recovering a move retains its selected blocks and both expected versions', (t) => {
  storage(t);
  const source = page();
  const body = {
    expectedVersion: 2,
    targetPageId: randomUUID(),
    targetVersion: 4,
    blockIds: ['parent', 'child'],
  };
  const pending = createPageToolsPending('move', source.id, body);
  rememberPageToolsPending(pending);
  body.blockIds.push('later');
  body.targetVersion = 10;
  const restored = recoverPageToolsPending(source.id);
  assert.deepEqual(restored.body.blockIds, ['parent', 'child']);
  assert.equal(restored.body.targetVersion, 4);
  assert.equal(restored.body.operationId, pending.body.operationId);
});

test('recovering a neighborhood map request preserves its UUID, style, and version', (t) => {
  storage(t);
  const source = page();
  const pending = createPageToolsPending('map-image', source.id, {
    expectedVersion: source.version, blockId: 'itinerary', style: 'klokantech-basic',
  });
  rememberPageToolsPending(pending);
  assert.deepEqual(recoverPageToolsPending(source.id), pending);
});

test('ambiguous success keeps receipt until current page can be read and 409 is definitive', async (t) => {
  storage(t);
  const source = page();
  const previous = globalThis.fetch;
  let conflict = false;
  globalThis.fetch = async (_path, options) => {
    if (conflict)
      return new Response(JSON.stringify({ error: '다른 창에서 수정했어요.' }), { status: 409 });
    if (options?.method === 'POST')
      return new Response(JSON.stringify({ item: source, replayed: true }));
    return new Response('unavailable', { status: 503 });
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  const pending = createPageToolsPending('restore', source.id, {
    revisionVersion: 1,
    expectedVersion: 2,
  });
  await assert.rejects(
    executePageToolsPending(pending),
    (error) => error instanceof PageToolsResponseError && !error.definitive,
  );
  assert.equal(recoverPageToolsPending(source.id).body.operationId, pending.body.operationId);
  conflict = true;
  await assert.rejects(
    executePageToolsPending(pending),
    (error) => error instanceof PageToolsResponseError && error.definitive,
  );
  assert.equal(recoverPageToolsPending(source.id).body.operationId, pending.body.operationId);
});

test('upload retry reuses retained bytes and rejects a different file with identical metadata', async (t) => {
  storage(t);
  const source = page();
  const file = new File(['original bytes'], '여행.txt', { type: 'text/plain', lastModified: 42 });
  const pending = await createPageAssetPending(source, [file]);
  const previous = globalThis.fetch;
  const uploads = [];
  globalThis.fetch = async (_path, options) => {
    if (options?.method === 'POST') {
      uploads.push({
        operationId: options.body.get('operationId'),
        bytes: await options.body.get('files').text(),
      });
      if (uploads.length === 1) throw new TypeError('connection lost');
      return new Response(JSON.stringify({ item: source, replayed: true }));
    }
    return new Response(JSON.stringify({ item: source }));
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  await assert.rejects(executePageToolsPending(pending));
  const restored = recoverPageToolsPending(source.id);
  await assert.rejects(
    restorePageAssetFiles(restored, [
      new File(['changed! bytes'], '여행.txt', { type: 'text/plain', lastModified: 42 }),
    ]),
  );
  await executePageToolsPending(restored);
  assert.deepEqual(uploads[0], uploads[1]);
  assert.equal(uploads[1].bytes, 'original bytes');
});

test('invalid stored route cannot send a recovered mutation to another page', (t) => {
  const values = storage(t);
  const source = page();
  const pending = createDuplicatePending(source);
  rememberPageToolsPending(pending);
  const key = [...values.keys()][0];
  values.set(
    key,
    JSON.stringify({ ...pending, path: '/api/pages/' + randomUUID() + '/duplicate' }),
  );
  assert.throws(() => recoverPageToolsPending(source.id));
});

test('template delete treats boolean receipts and an already absent template as success', async (t) => {
  const previous = globalThis.fetch;
  let deleted = false;
  globalThis.fetch = async () => new Response(JSON.stringify(!deleted && (deleted = true)));
  t.after(() => {
    globalThis.fetch = previous;
  });
  await deletePageTemplate(randomUUID());
  await deletePageTemplate(randomUUID());
});

test('a reloaded upload requires original files before retrying the same UUID', async (t) => {
  storage(t);
  const source = page();
  const file = new File(['original'], '계획.txt', { type: 'text/plain', lastModified: 42 });
  const pending = await createPageAssetPending(source, [file]);
  rememberPageToolsPending(pending);
  const reloaded = await import('../src/pages/pageToolsApi.ts?upload-reload');
  const restored = reloaded.recoverPageToolsPending(source.id);
  assert.equal(reloaded.hasPageAssetFiles(restored), false);
  await assert.rejects(
    reloaded.executePageToolsPending(restored),
    (error) => error instanceof reloaded.PageToolsFilesMissingError,
  );
  assert.equal(
    reloaded.recoverPageToolsPending(source.id).body.operationId,
    pending.body.operationId,
  );
  await reloaded.restorePageAssetFiles(restored, [file]);
  assert.equal(reloaded.hasPageAssetFiles(restored), true);
});
