import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeRunner, parseOpenCodeOutput } from '../server/ai/opencode.mjs';
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
