import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  recoverPageAiPending,
  rememberPageAiPending,
  forgetPageAiPending,
  sendPageAiPending,
  PageAiResponseError,
} from '../src/ai/pageSubmission.ts';

test('lost Page AI responses retain the first UUID/body through navigation and reload for requests and applies', async (t) => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => {
    if (previous) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  });
  const bodies = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (bodies.length % 2) {
      response.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ item: { id: request.url.endsWith('ai-jobs') ? 'job' : 'page' } }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (path, options) =>
    nativeFetch(`http://127.0.0.1:${server.address().port}` + path, options);
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  for (const kind of ['request', 'apply']) {
    const pageId = randomUUID(),
      uuid = randomUUID();
    const body = {
      expectedVersion: 2,
      ...(kind === 'request'
        ? { requestId: uuid, aiRequest: { template: null, additional: '最初の依頼' } }
        : { operationId: uuid, mode: 'append', document: { schemaVersion: 1, blocks: [] } }),
    };
    const pending = {
      kind,
      path: `/api/pages/${pageId}/${kind === 'request' ? 'ai-jobs' : 'ai-applies'}`,
      body,
    };
    rememberPageAiPending(pageId, pending);
    await assert.rejects(sendPageAiPending(pending));
    body.expectedVersion = 99;
    const restored = recoverPageAiPending(pageId);
    assert.equal(restored.body.expectedVersion, 2);
    await sendPageAiPending(restored);
    assert.deepEqual(bodies.at(-1), bodies.at(-2));
    forgetPageAiPending(pageId);
    assert.equal(recoverPageAiPending(pageId), null);
  }
});
