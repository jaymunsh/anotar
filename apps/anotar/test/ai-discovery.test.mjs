import test from 'node:test';
import assert from 'node:assert/strict';
import { AiExecutionError } from '../server/ai/contracts.mjs';
import * as discovery from '../server/ai/discovery.mjs';
const signal = () => new AbortController().signal;
const collect = (...args) => {
  assert.equal(typeof discovery.collectKeywordResearch, 'function', 'keyword collector is missing');
  return discovery.collectKeywordResearch(...args);
};
test('keyword collection skips unavailable sources and redirect duplicates; bounds verified text and count', async () => {
  const candidates = ['blocked', 'one', 'duplicate', 'two', 'three'].map((name) => ({
    url: `https://example.com/${name}`,
    title: name,
  }));
  let calls = 0;
  const result = await collect(candidates, signal(), async (url) => {
    calls++;
    if (url.endsWith('blocked')) throw new AiExecutionError('research_blocked');
    return {
      url: url.endsWith('duplicate') ? 'https://example.com/one' : url,
      title: url,
      text: '가'.repeat(50_000),
      fetchedAt: '2026-09-29T00:00:00Z',
    };
  });
  assert.equal(calls, 5);
  assert.equal(result.candidateCount, 5);
  assert.deepEqual(
    result.materials.map((item) => item.url),
    ['https://example.com/one', 'https://example.com/two', 'https://example.com/three'],
  );
  assert.equal(
    result.materials.reduce((sum, item) => sum + item.text.length, 0),
    49_998,
  );
  assert.equal(candidates[1].title, 'one');
  let limited = 0;
  const capped = await collect(candidates, signal(), async (url) => {
    limited++;
    return { url, title: 'x', text: 'body', fetchedAt: 'now' };
  });
  assert.equal(capped.materials.length, 3);
  assert.equal(limited, 3);
});

test('no verified bodies and malformed candidates fail; cancellation cannot be swallowed as a source failure', async () => {
  await assert.rejects(
    collect([{ url: 'https://example.com/' }], signal(), async () => {
      throw new AiExecutionError('research_failed');
    }),
    (error) => error.code === 'research_no_sources',
  );
  await assert.rejects(
    collect(Array(6).fill({ url: 'https://example.com/' }), signal(), async () => {}),
    (error) => error.code === 'invalid_result',
  );
  const controller = new AbortController();
  await assert.rejects(
    collect([{ url: 'https://example.com/' }], controller.signal, async () => {
      controller.abort(new AiExecutionError('timeout'));
      throw controller.signal.reason;
    }),
    (error) => error.code === 'timeout',
  );
});
