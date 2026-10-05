import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHttpRunner } from '../server/ai/runner.mjs';
const job = {
  id: 'test-job',
  request: { kind: 'free', prompt: '정리', input: { content: '원문', url: '' } },
};
test('gateway never redirects credentials and rejects malformed or oversized results without exposing response bodies', async (t) => {
  let mode = 'redirect',
    calls = 0;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Bearer dummy-test-only');
    if (mode === 'redirect') {
      res.writeHead(302, { location: '/should-not-follow' });
      res.end();
    } else if (mode === 'large') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ markdown: 'x'.repeat(256 * 1024) }));
    } else {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('private provider error');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const runner = createHttpRunner({
    AI_RUNNER_URL: `http://127.0.0.1:${server.address().port}`,
    AI_RUNNER_TOKEN: 'dummy-test-only',
  });
  assert.equal(JSON.stringify(runner.info).includes('dummy-test-only'), false);
  await assert.rejects(
    runner.run({ job, materials: [] }, new AbortController().signal),
    (e) => e.code === 'runner_failed',
  );
  assert.equal(calls, 1);
  mode = 'large';
  await assert.rejects(
    runner.run({ job, materials: [] }, new AbortController().signal),
    (e) => e.code === 'invalid_result',
  );
  mode = 'error';
  await assert.rejects(
    runner.run({ job, materials: [] }, new AbortController().signal),
    (e) => e.code === 'runner_failed' && !e.message.includes('private'),
  );
  assert.equal(createHttpRunner({ AI_RUNNER_URL: 'http://public.example/' }).enabled, false);
  assert.equal(
    createHttpRunner({ AI_RUNNER_URL: 'https://user:password@example.com/' }).enabled,
    false,
  );
});
