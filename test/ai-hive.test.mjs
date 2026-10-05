import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHiveRunner } from '../server/ai/hive.mjs';
const job = {
  id: 'job',
  request: { prompt: '요약해줘', input: { content: '합성 메모', url: '' }, kind: 'free' },
};
async function fixture(t, handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  return createHiveRunner({
    HIVE_API_KEY: 'test-only-secret',
    HIVE_MODEL: 'fixture/model',
    HIVE_BASE_URL: `http://127.0.0.1:${s.address().port}/api/v3`,
  });
}
test('Hive SSE joins split UTF-8 packets and usage without sending app secrets or tools', async (t) => {
  let body;
  const runner = await fixture(t, async (req, res) => {
    assert.equal(req.url, '/api/v3/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-only-secret');
    let raw = '';
    for await (const x of req) raw += x;
    body = JSON.parse(raw);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const bytes = Buffer.from(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: '안녕 메모' } }] }) +
        '\r\n\r\ndata: ' +
        JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }) +
        '\n\ndata: [DONE]\n\n',
    );
    for (let n = 0; n < bytes.length; n += 7) res.write(bytes.subarray(n, n + 7));
    res.end();
  });
  const result = await runner.run({ job, materials: [] }, new AbortController().signal);
  assert.equal(result.markdown, '안녕 메모');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 5 });
  assert.equal(body.model, 'fixture/model');
  assert.equal(body.stream, true);
  assert.equal(body.max_completion_tokens, 4096);
  assert.equal(body.tools, undefined);
  assert.ok(!JSON.stringify(body).includes('test-only-secret'));
  assert.ok(!JSON.stringify(runner.info).includes('test-only-secret'));
});
test('Hive rejects redirects, auth/rate errors, truncated SSE and tool output; no fallback', async (t) => {
  let mode = 'redirect',
    calls = 0;
  const r = await fixture(t, (req, res) => {
    calls++;
    if (mode === 'redirect') {
      res.writeHead(302, { location: '/other' });
      return res.end();
    }
    if (mode === 'auth' || mode === 'rate') {
      res.writeHead(mode === 'auth' ? 401 : 429);
      return res.end('private account identity');
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: mode === 'tools' ? { tool_calls: [{}] } : { content: 'partial' } }],
        }) +
        '\n\n' +
        (mode === 'tools' ? 'data: [DONE]\n\n' : ''),
    );
  });
  for (const [m, code] of [
    ['redirect', 'runner_failed'],
    ['auth', 'runner_authentication'],
    ['rate', 'runner_rate_limit'],
    ['cut', 'invalid_result'],
    ['tools', 'invalid_result'],
  ]) {
    mode = m;
    await assert.rejects(
      r.run({ job, materials: [] }, new AbortController().signal),
      (e) => e.code === code && !e.message.includes('identity'),
    );
  }
  assert.equal(calls, 5);
});
test('Hive JSON response accepts missing usage and abort stops response reading', async (t) => {
  const r = await fixture(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '결과' }, finish_reason: 'stop' }] }));
  });
  assert.equal((await r.run({ job, materials: [] }, new AbortController().signal)).usage, null);
  const c = new AbortController();
  c.abort(new Error('cancel'));
  await assert.rejects(r.run({ job, materials: [] }, c.signal), /cancel/);
  assert.equal(createHiveRunner({ HIVE_MODEL: 'm' }).enabled, false);
  assert.equal(
    createHiveRunner({ HIVE_MODEL: 'm', HIVE_API_KEY: 'k', HIVE_BASE_URL: 'http://public.example' })
      .enabled,
    false,
  );
});

test('Hive rejects legacy function calls in JSON and SSE', async t => {
  let stream=false;
  const runner=await fixture(t,(req,res)=>{
    const choice={message:{content:'partial',function_call:{name:'shell',arguments:'{}'}},delta:{content:'partial'},finish_reason:'function_call'};
    res.writeHead(200,{'content-type':stream?'text/event-stream':'application/json'});
    res.end(stream?'data: '+JSON.stringify({choices:[choice]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[choice]}));
  });
  for(const mode of [false,true]){stream=mode;await assert.rejects(runner.run({job,materials:[]},new AbortController().signal),e=>e.code==='invalid_result');}
});

test('Hive aborts an in-progress SSE response without returning partial output', async t => {
  let started;const received=new Promise(r=>started=r);
  const runner=await fixture(t,(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');started();});
  const controller=new AbortController();const running=runner.run({job,materials:[]},controller.signal);
  await received;controller.abort(Error('cancel-in-progress'));
  await assert.rejects(running,/cancel-in-progress/);
});
