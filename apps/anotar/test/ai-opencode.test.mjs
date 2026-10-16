import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeRunner, parseOpenCodeOutput } from '../server/ai/opencode.mjs';
import * as opencode from '../server/ai/opencode.mjs';
import { openStore } from '../server/store.mjs';
import { createAiWorker } from '../server/ai/worker.mjs';
async function fixture(t, code) {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'fixture-cli');
  await writeFile(
    bin,
    `#!${process.execPath}\nif(process.argv[2]==='--version'){console.log('1.18.34');process.exit(0)}\n${code}`,
  );
  await chmod(bin, 0o755);
  return {
    dir,
    bin,
    runner: createOpenCodeRunner({
      AI_OPENCODE_ENABLED: 'true',
      AI_OPENCODE_BIN: bin,
      AI_OPENCODE_MODEL: 'opencode/fixture',
      HIVE_API_KEY: 'must-not-pass',
    }),
  };
}
const job = {
  request: { prompt: '기록 정리', input: { content: '가나다', url: '' } },
  runToken: 'private-run-token',
};
const events = (text) =>
  JSON.stringify({ type: 'text', part: { text } }) +
  '\n' +
  JSON.stringify({
    type: 'step_finish',
    part: { reason: 'stop', tokens: { input: 4, output: 3 } },
  }) +
  '\n';
const searchEvents = () => [
  { type: 'step_start' },
  { type: 'text', part: { text: 'Searching now' } },
  {
    type: 'tool_use',
    part: {
      tool: 'websearch',
      callID: 'call-search',
      state: {
        status: 'completed',
        input: { query: 'SQLite FTS5', numResults: 5, type: 'fast', contextMaxCharacters: 10000 },
        metadata: { provider: 'exa', truncated: false },
        output:
          'Title: SQLite FTS5\nURL: https://sqlite.org/fts5.html\nText: actual search result\n\nTitle: SQLite docs\nURL: https://sqlite.org/docs.html\nText: another result',
      },
    },
  },
  { type: 'step_finish', part: { reason: 'tool-calls' } },
  { type: 'text', part: { text: '{"sources":[{"url":"https://fabricated.example/"}]}' } },
  { type: 'step_finish', part: { reason: 'stop' } },
];
const jsonLines = (items) => items.map((item) => JSON.stringify(item)).join('\n');

test('OpenCode search uses actual tool result URLs, never model-invented final URLs', () => {
  assert.equal(typeof opencode.parseOpenCodeSearch, 'function');
  assert.deepEqual(opencode.parseOpenCodeSearch(jsonLines(searchEvents())), [
    { url: 'https://sqlite.org/fts5.html', title: 'SQLite FTS5' },
    { url: 'https://sqlite.org/docs.html', title: 'SQLite docs' },
  ]);
});

test('OpenCode search rejects missing, failed, extra or malformed tool evidence', () => {
  assert.equal(typeof opencode.parseOpenCodeSearch, 'function');
  const mutations = [
    (items) => items.filter((e) => e.type !== 'tool_use'),
    (items) => {
      items[2].part.tool = 'bash';
      return items;
    },
    (items) => {
      items[2].part.state.status = 'error';
      return items;
    },
    (items) => {
      items[2].part.state.input.numResults = 8;
      return items;
    },
    (items) => {
      items[2].part.state.input.query = 'q'.repeat(241);
      return items;
    },
    (items) => {
      items[2].part.state.metadata.provider = 'parallel';
      return items;
    },
    (items) => {
      items[2].part.state.metadata.truncated = true;
      return items;
    },
    (items) => {
      items[2].part.state.output = 'Title: private\nURL: https://user:pass@example.com/';
      return items;
    },
    (items) => {
      items.splice(3, 0, structuredClone(items[2]));
      return items;
    },
    (items) => items.slice(0, -1),
    (items) => {
      items.at(-1).part.reason = 'length';
      return items;
    },
  ];
  for (const mutate of mutations)
    assert.throws(
      () => opencode.parseOpenCodeSearch(jsonLines(mutate(searchEvents()))),
      (e) => e.code === 'invalid_result',
    );
  const empty = searchEvents();
  empty[2].part.state.output = 'No search results found.';
  assert.deepEqual(opencode.parseOpenCodeSearch(jsonLines(empty)), []);
});

test('OpenCode discovery enables only search, isolates history, then uses tool-free summarization', async (t) => {
  const { runner, bin } = await fixture(
    t,
    `const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);const search=c.permission.websearch==='allow';fs.appendFileSync(process.argv[1]+'.probe',JSON.stringify({cwd:process.cwd(),input,search,config:c,searchProvider:process.env.OPENCODE_WEBSEARCH_PROVIDER,enableExa:process.env.OPENCODE_ENABLE_EXA,secret:process.env.HIVE_API_KEY})+'\\n');process.stdout.write(search ? ${JSON.stringify(jsonLines(searchEvents()))} : ${JSON.stringify(events('# Verified summary'))});});`,
  );
  assert.equal(typeof runner.discover, 'function');
  const signal = new AbortController().signal;
  const candidates = await runner.discover(
    { job: { ...job, request: { ...job.request, additional: 'Official recent sources only' } } },
    signal,
  );
  assert.equal(candidates[0].url, 'https://sqlite.org/fts5.html');
  const result = await runner.run(
    { job, materials: [{ url: candidates[0].url, text: 'Collected public body' }] },
    signal,
  );
  assert.equal(result.markdown, '# Verified summary');
  const [search, summary] = (await readFile(bin + '.probe', 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(search.config.permission, { '*': 'ask', websearch: 'allow' });
  assert.deepEqual(search.config.agent.anotar.permission, { '*': 'ask', websearch: 'allow' });
  assert.equal(search.searchProvider, 'exa');
  assert.equal(search.enableExa, 'true');
  assert.equal(search.secret, undefined);
  assert.doesNotMatch(search.input, /private-run-token/);
  assert.deepEqual(JSON.parse(search.input), {
    topic: '가나다',
    conditions: 'Official recent sources only',
  });
  assert.deepEqual(summary.config.permission, { '*': 'ask' });
  assert.equal(summary.enableExa, undefined);
  assert.match(summary.input, /Collected public body/);
  assert.notEqual(search.cwd, summary.cwd);
  for (const cwd of [search.cwd, summary.cwd])
    await assert.rejects(readdir(cwd), (e) => e.code === 'ENOENT');
});

test('OpenCode keyword jobs collect bodies, store verified sources and preserve the original request', async (t) => {
  const { dir, runner } = await fixture(
    t,
    `let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);if(c.permission.websearch==='allow')process.stdout.write(${JSON.stringify(jsonLines(searchEvents()))});else{const data=JSON.parse(input);if(!data.materials.every(m=>m.text==='Collected public body'))process.exit(4);process.stdout.write(${JSON.stringify(events('# Collected summary'))});}});`,
  );
  const store = openStore(join(dir, 'data'));
  const worker = createAiWorker({
    store,
    runner,
    collect: async (url) => ({
      url,
      title: 'Collected document',
      text: 'Collected public body',
      fetchedAt: '2026-10-06T00:00:00Z',
    }),
  });
  t.after(async () => {
    await worker.stop();
    store.close();
  });
  const template = store.getPromptTemplate('research-keyword');
  const capture = store.createCapture({
    kind: 'note',
    text: 'SQLite FTS5 research',
    aiRequest: { template, additional: 'Keep original instructions' },
  });
  worker.start();
  let done;
  for (let i = 0; i < 200; i++) {
    done = store.getAiJob(capture.latestAiJob.id);
    if (['result_ready', 'failed'].includes(done.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(done.status, 'result_ready', done.errorCode);
  assert.equal(done.result.markdown, '# Collected summary');
  assert.deepEqual(
    done.result.sources.map((s) => [s.url, s.verified]),
    [
      ['https://sqlite.org/fts5.html', true],
      ['https://sqlite.org/docs.html', true],
    ],
  );
  assert.equal(store.getCapture(capture.id).text, 'SQLite FTS5 research');
  assert.equal(store.getCapture(capture.id).version, capture.version);
  assert.equal(done.request.additional, 'Keep original instructions');
});
test('OpenCode pins model, auto-rejects tool permissions, passes prompt via stdin, isolates credentials/history and cleans up', async (t) => {
  const { dir, bin } = await fixture(
    t,
    `const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);fs.writeFileSync(process.argv[1]+'.probe',JSON.stringify({cwd:process.cwd(),input,args:process.argv.slice(2),config:c,disableClaude:process.env.OPENCODE_DISABLE_CLAUDE_CODE,disableSkills:process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS,secret:process.env.HIVE_API_KEY,auth:JSON.parse(fs.readFileSync(process.env.XDG_DATA_HOME+'/opencode/auth.json','utf8'))}));console.log(JSON.stringify({type:'text',part:{text:'# 정리'}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));});`,
  );
  const auth = join(dir, 'auth.json');
  await writeFile(
    auth,
    JSON.stringify({
      opencode: { type: 'api', key: 'fixture-secret' },
      openai: { key: 'other-secret' },
    }),
  );
  const runner = createOpenCodeRunner({
    AI_OPENCODE_ENABLED: 'true',
    AI_OPENCODE_BIN: bin,
    AI_OPENCODE_MODEL: 'opencode/fixture',
    AI_OPENCODE_AUTH_FILE: auth,
    HIVE_API_KEY: 'must-not-pass',
  });
  assert.equal(runner.enabled, true);
  const result = await runner.run({ job, materials: [] }, new AbortController().signal);
  assert.equal(result.markdown, '# 정리');
  const info = JSON.parse(await readFile(bin + '.probe', 'utf8'));
  assert.equal(info.config.default_agent, 'anotar');
  assert.equal(info.config.agent.anotar.permission['*'], 'ask');
  assert.match(info.config.agent.anotar.prompt, /supplied materials/);
  assert.equal(info.config.model, 'opencode/fixture');
  assert.equal(info.config.small_model, 'opencode/fixture');
  assert.equal(info.config.permission['*'], 'ask');
  assert.equal(info.config.share, 'disabled');
  assert.equal(info.disableClaude, 'true');
  assert.equal(info.disableSkills, 'true');
  assert.equal(
    info.config.provider,
    undefined,
    'use official provider metadata and request headers',
  );
  assert.equal(info.secret, undefined);
  assert.deepEqual(info.auth, { opencode: { type: 'api', key: 'fixture-secret' } });
  assert.doesNotMatch(info.input, /private-run-token/);
  assert.ok(!info.args.some((a) => a.includes('가나다')));
  assert.ok(
    !info.args.some((a) => ['--auto', '--yolo', '--dangerously-skip-permissions'].includes(a)),
  );
  assert.ok(info.args.includes('--pure'), 'disable external plugins with official CLI flag');
  await assert.rejects(readdir(info.cwd), (e) => e.code === 'ENOENT');
  assert.ok(await readFile(auth));
});
test('OpenCode rejects truncated/failed/tool outputs and never reports them as success', () => {
  assert.equal(parseOpenCodeOutput(events('완료')).markdown, '완료');
  assert.deepEqual(parseOpenCodeOutput(events('완료')).usage, { inputTokens: 4, outputTokens: 3 });
  for (const output of [
    JSON.stringify({ type: 'text', part: { text: '일부' } }),
    events(''),
    events('글').replace('"stop"', '"length"'),
    JSON.stringify({ type: 'error', error: { message: 'secret' } }) + '\n' + events('글'),
    JSON.stringify({ type: 'tool_use' }) + '\n' + events('글'),
  ])
    assert.throws(() => parseOpenCodeOutput(output));
});
test('OpenCode execution remains off until explicitly enabled', async (t) => {
  const { bin } = await fixture(t, 'process.exit(9)');
  assert.equal(
    createOpenCodeRunner({ AI_OPENCODE_BIN: bin, AI_OPENCODE_MODEL: 'opencode/fixture' }).enabled,
    false,
  );
});
test('OpenCode cancellation waits for process closure and deletes owned history', async (t) => {
  const { runner, bin } = await fixture(
    t,
    `require('node:fs').writeFileSync(process.argv[1]+'.cwd',process.cwd());setInterval(()=>{},100);`,
  );
  const controller = new AbortController();
  const pending = runner.run({ job, materials: [] }, controller.signal);
  let cwd;
  for (let i = 0; i < 100; i++) {
    try {
      cwd = await readFile(bin + '.cwd', 'utf8');
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(cwd);
  controller.abort(Error('stop'));
  await assert.rejects(pending, /stop/);
  await runner.drain(controller.signal);
  await assert.rejects(readdir(cwd), (e) => e.code === 'ENOENT');
});

test('OpenCode rejects an unverified CLI version before sending request data', async (t) => {
  const { bin } = await fixture(t, 'process.exit(9)');
  await writeFile(
    bin,
    `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='--version'){fs.writeFileSync(process.argv[1]+'.cwd',process.cwd());console.log('1.18.33')}else{fs.writeFileSync(process.argv[1]+'.ran','unsafe');console.log(${JSON.stringify(events('unexpected'))})}`,
  );
  const runner = createOpenCodeRunner({
    AI_OPENCODE_ENABLED: 'true',
    AI_OPENCODE_BIN: bin,
    AI_OPENCODE_MODEL: 'opencode/fixture',
  });
  await assert.rejects(
    runner.run({ job, materials: [] }, new AbortController().signal),
    (e) => e.code === 'runner_unavailable',
  );
  await assert.rejects(readFile(bin + '.ran'), (e) => e.code === 'ENOENT');
  const cwd = await readFile(bin + '.cwd', 'utf8');
  await assert.rejects(readdir(cwd), (e) => e.code === 'ENOENT');
});
