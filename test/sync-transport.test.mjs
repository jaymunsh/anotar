import test from 'node:test';
import assert from 'node:assert/strict';
import { transport } from '../src/sync/transport.ts';
test('HTML, broken JSON, authentication and Retry-After never become canonical data', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response('<html>offline</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(transport.session(), (e) => e.status === 502);
    }
    globalThis.fetch = async () =>
      new Response('{"error":"limited","code":"slow"}', {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
      });
    await assert.rejects(transport.session(), (e) => e.status === 503 && e.retryAfter === 10000);
    globalThis.fetch = async () =>
      new Response('{"error":"auth"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    await assert.rejects(transport.session(), (e) => e.status === 401);
    globalThis.fetch = async () => {
      throw new DOMException('timeout', 'AbortError');
    };
    await assert.rejects(transport.session(), (e) => e.name === 'AbortError');
  } finally {
    globalThis.fetch = original;
  }
});
