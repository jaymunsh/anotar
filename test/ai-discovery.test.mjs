import test from 'node:test';
import assert from 'node:assert/strict';
import * as output from '../server/ai/devinOutput.mjs';
import { AiExecutionError } from '../server/ai/contracts.mjs';
import * as discovery from '../server/ai/discovery.mjs';
const signal = () => new AbortController().signal;
const trace = (patch = {}) => ({
  schema_version: 'ATIF-v1.7',
  session_id: 'fixture',
  agent: { name: 'Devin' },
  steps: [
    {
      step_id: 1,
      timestamp: '2026-09-29T00:00:00Z',
      source: 'agent',
      message: '',
      tool_calls: [
        {
          tool_call_id: 'search-1',
          function_name: 'web_search',
          arguments: { query: 'SQLite FTS5', num_results: 5 },
        },
      ],
      observation: {
        results: [
          {
            source_call_id: 'search-1',
            content:
              '## 1. SQLite\nURL: https://sqlite.org/fts5.html\n\n## 2. Guide\nURL: https://example.com/guide\n',
          },
        ],
      },
      ...patch,
    },
  ],
  final_metrics: {},
});
const parse = (...args) => {
  assert.equal(
    typeof output.parseDevinSearch,
    'function',
    'search must require actual native tool evidence',
  );
  return output.parseDevinSearch(...args);
};
const collect = (...args) => {
  assert.equal(typeof discovery.collectKeywordResearch, 'function', 'keyword collector is missing');
  return discovery.collectKeywordResearch(...args);
};
const answer = {
  sources: [
    { url: 'https://sqlite.org/fts5.html#section', title: 'SQLite' },
    { url: 'https://sqlite.org/fts5.html', title: 'duplicate' },
  ],
};

test('native search results require linked tool evidence and normalize duplicate candidate URLs', () => {
  assert.deepEqual(parse('Welcome to Devin CLI!\n' + JSON.stringify(answer), trace()), [
    { url: 'https://sqlite.org/fts5.html', title: 'SQLite' },
  ]);
});

test('a genuine search with no results reports missing sources instead of a malformed response', () => {
  assert.throws(
    () =>
      parse(
        JSON.stringify({ sources: [] }),
        trace({
          observation: { results: [{ source_call_id: 'search-1', content: 'No results found.' }] },
        }),
      ),
    (error) => error.code === 'research_no_sources',
  );
});

test('search-less, unlinked, invented and out-of-contract native tool outputs fail', () => {
  for (const value of [
    trace({ tool_calls: [] }),
    trace({
      observation: {
        results: [{ source_call_id: 'other', content: 'URL: https://sqlite.org/fts5.html' }],
      },
    }),
    trace({ tool_calls: [{ tool_call_id: 'x', function_name: 'exec', arguments: {} }] }),
    trace({ tool_calls: [...trace().steps[0].tool_calls, ...trace().steps[0].tool_calls] }),
    trace({
      tool_calls: [
        {
          tool_call_id: 'search-1',
          function_name: 'web_search',
          arguments: { query: 'x'.repeat(241), num_results: 5 },
        },
      ],
    }),
  ])
    assert.throws(
      () => parse(JSON.stringify(answer), value),
      (error) => error.code === 'invalid_result',
    );
  assert.throws(
    () => parse(JSON.stringify({ sources: [{ url: 'https://invented.example/' }] }), trace()),
    (error) => error.code === 'invalid_result',
  );
  assert.throws(
    () => parse(JSON.stringify({ sources: Array(6).fill(answer.sources[0]) }), trace()),
    (error) => error.code === 'invalid_result',
  );
  assert.throws(
    () => parse(JSON.stringify({ sources: [] }), trace()),
    (error) => error.code === 'research_no_sources',
  );
});

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
