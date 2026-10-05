import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevinRunner } from '../server/ai/devin.mjs';
import { createAiWorker } from '../server/ai/worker.mjs';
import { openStore } from '../server/store.mjs';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isExecuting(pid) {
  try {
    process.kill(pid, 0);
    // An orphan awaiting init's reap has already exited and consumes no execution capacity.
    if (
      process.platform === 'linux' &&
      readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z')
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
async function until(read, predicate) {
  for (let i = 0; i < 600; i++) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(10);
  }
  throw new Error('native fixture did not settle');
}
function killFixture(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}
const job = {
  id: 'example',
  request: { kind: 'free', prompt: '공유할 메모만 전달', input: { content: '글', url: '' } },
  runToken: 'PRIVATE-TOKEN',
};
async function fixture(t, code) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-devin-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-devin');
  await writeFile(executable, `#!${process.execPath}\n${code}`);
  await chmod(executable, 0o755);
  return {
    dir,
    runner: createDevinRunner({
      AI_DEVIN_BIN: executable,
      AI_DEVIN_MODEL: 'fixture-model',
      DATA_DIR: 'MUST_NOT_PASS',
      AI_RUNNER_TOKEN: 'MUST_NOT_PASS',
    }),
  };
}
test('Devin runs in a temporary text workspace with fixed deny rules and minimal environment; cleans up', async (t) => {
  const { runner } = await fixture(
    t,
    `const fs=require('node:fs');const args=process.argv.slice(2);const config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1],'utf8'));const prompt=fs.readFileSync(args[args.indexOf('--prompt-file')+1],'utf8');console.log('Welcome to Devin CLI!\\n');console.log(JSON.stringify({markdown:JSON.stringify({config,prompt,args,cwd:process.cwd(),leaked:process.env.DATA_DIR||process.env.AI_RUNNER_TOKEN||null,files:fs.readdirSync('.')})}));`,
  );
  assert.equal(runner.enabled, true);
  const result = await runner.run({ job, materials: [] }, new AbortController().signal);
  const info = JSON.parse(result.markdown);
  assert.equal(info.leaked, null);
  assert.doesNotMatch(info.prompt, /PRIVATE-TOKEN/);
  assert.deepEqual(info.files.sort(), ['.runtime', 'config.json', 'input.txt']);
  assert.ok(info.config.permissions.deny.includes('exec'));
  assert.ok(info.config.permissions.deny.includes('mcp__*'));
  assert.ok(info.config.permissions.deny.includes('web_search'));
  assert.equal(info.config.subagents_enabled, false);
  assert.ok(info.args.includes('--prompt-file'));
  await assert.rejects(readdir(info.cwd), (e) => e.code === 'ENOENT');
});

test('discovery reads actual linked search export in an isolated workspace and cleans up', async (t) => {
  const { dir, runner } = await fixture(
    t,
    `
const fs=require('node:fs'),args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1],'utf8'));
fs.writeFileSync(process.argv[1]+'.search.json',JSON.stringify({cwd:process.cwd(),config}));
fs.writeFileSync(args[args.indexOf('--export')+1],JSON.stringify({steps:[{source:'agent',tool_calls:[{tool_call_id:'s1',function_name:'web_search',arguments:{query:'SQLite FTS5',num_results:5}}],observation:{results:[{source_call_id:'s1',content:'## 1. SQLite\\nURL: https://sqlite.org/fts5.html\\n'}]}}]}));
console.log(JSON.stringify({sources:[{url:'https://sqlite.org/fts5.html',title:'SQLite'}]}));
`,
  );
  assert.equal(typeof runner.discover, 'function');
  const result = await runner.discover({ job }, new AbortController().signal);
  assert.deepEqual(result, [{ url: 'https://sqlite.org/fts5.html', title: 'SQLite' }]);
  const info = JSON.parse(await readFile(join(dir, 'fake-devin.search.json'), 'utf8'));
  assert.ok(info.config.permissions.allow.includes('web_search'));
  assert.ok(!info.config.permissions.deny.includes('web_search'));
  assert.ok(info.config.permissions.deny.includes('exec'));
  assert.equal(info.config.subagents_enabled, false);
  assert.ok(Object.values(info.config.read_config_from).every((value) => value === false));
  await assert.rejects(readdir(info.cwd), (error) => error.code === 'ENOENT');
});

test('discovery rejects invented search and oversized export, with cleanup and sanitized failure', async (t) => {
  for (const oversized of [false, true]) {
    const { dir, runner } = await fixture(
      t,
      `
const fs=require('node:fs'),args=process.argv.slice(2);
fs.writeFileSync(process.argv[1]+'.cwd',process.cwd());
fs.writeFileSync(args[args.indexOf('--export')+1],${oversized ? "'x'.repeat(1024*1024+1)" : 'JSON.stringify({steps:[]})'});
console.log(JSON.stringify({sources:[{url:'https://invented.example/'}]}));
`,
    );
    assert.equal(typeof runner.discover, 'function');
    await assert.rejects(
      runner.discover({ job }, new AbortController().signal),
      (error) => error.code === 'invalid_result',
    );
    const cwd = await readFile(join(dir, 'fake-devin.cwd'), 'utf8');
    await assert.rejects(readdir(cwd), (error) => error.code === 'ENOENT');
  }
});

test('discovery abort drains the native process before exposing capacity again', async (t) => {
  const { dir, runner } = await fixture(
    t,
    `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1]+'.pid',JSON.stringify({pid:process.pid,cwd:process.cwd()}));setInterval(()=>{},1000);`,
  );
  assert.equal(typeof runner.discover, 'function');
  const controller = new AbortController();
  const pending = runner.discover({ job }, controller.signal);
  const info = await until(
    () => readFile(join(dir, 'fake-devin.pid'), 'utf8').then(JSON.parse),
    Boolean,
  );
  try {
    controller.abort(new Error('search stopped'));
    await runner.drain(controller.signal);
    await assert.rejects(pending, /search stopped/);
    assert.equal(isExecuting(info.pid), false);
    await assert.rejects(readdir(info.cwd), (error) => error.code === 'ENOENT');
  } finally {
    killFixture(info.pid);
  }
});
test('abort kills the CLI and discards late output; no alternate provider fallback', async (t) => {
  const { runner } = await fixture(
    t,
    `setTimeout(()=>console.log(JSON.stringify({markdown:'late'})),60000)`,
  );
  const controller = new AbortController();
  const pending = runner.run({ job, materials: [] }, controller.signal);
  setTimeout(() => controller.abort(new Error('stop')), 30);
  await assert.rejects(pending, /stop/);
  assert.equal(createDevinRunner({ AI_DEVIN_BIN: '/not/installed/devin' }).enabled, false);
});
test('malformed CLI output becomes a sanitized result error, never exposes stderr identity or prompt', async (t) => {
  const { runner } = await fixture(
    t,
    `console.error('private identity');console.log('invalid output')`,
  );
  await assert.rejects(
    runner.run({ job, materials: [] }, new AbortController().signal),
    (e) => e.code === 'invalid_result' && !e.message.includes('identity'),
  );
});

test('abort waits for SIGTERM-resistant CLI and its owned descendants to exit before rejecting', async (t) => {
  const { dir, runner } = await fixture(
    t,
    `
const fs=require('node:fs'), {spawn}=require('node:child_process');
process.on('SIGTERM',()=>{});
const marker=process.argv[1]+'.pid';
spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",marker+'.child'],{stdio:'ignore'});
fs.writeFileSync(marker,JSON.stringify({pid:process.pid,cwd:process.cwd()}));
setInterval(()=>{},1000);
`,
  );
  const marker = join(dir, 'fake-devin.pid');
  const controller = new AbortController();
  const pending = runner.run({ job, materials: [] }, controller.signal);
  const parent = await until(() => readFile(marker, 'utf8').then(JSON.parse), Boolean);
  const descendant = Number(await until(() => readFile(marker + '.child', 'utf8'), Boolean));
  try {
    controller.abort(new Error('stop resistant process'));
    await assert.rejects(pending, /stop resistant process/);
    assert.equal(
      isExecuting(parent.pid),
      false,
      'run must not settle while the CLI is still alive',
    );
    if (process.platform !== 'win32')
      await until(
        () => isExecuting(descendant),
        (alive) => !alive,
      );
    await assert.rejects(readdir(parent.cwd), (e) => e.code === 'ENOENT');
  } finally {
    controller.abort();
    killFixture(parent.pid);
    killFixture(descendant);
  }
});

test('native timeout drains execution before next queue claim, and shutdown waits for process exit', async (t) => {
  const { dir, runner } = await fixture(
    t,
    `
const fs=require('node:fs'),args=process.argv.slice(2),prompt=fs.readFileSync(args[args.indexOf('--prompt-file')+1],'utf8');
const marker=process.argv[1]+'.pid';
if(prompt.includes('next-success')){
const previous=JSON.parse(fs.readFileSync(marker,'utf8'));let alive=false;try{process.kill(previous.pid,0);alive=true}catch{}
console.log(JSON.stringify({markdown:'previous alive: '+alive}));
}else{
process.on('SIGTERM',()=>{});fs.writeFileSync(marker,JSON.stringify({pid:process.pid,cwd:process.cwd()}));setInterval(()=>{},1000);
}
`,
  );
  const store = openStore(join(dir, 'store'));
  const worker = createAiWorker({ store, runner, timeoutMs: 1500 });
  let current;
  try {
    const first = store.createCapture({
      kind: 'note',
      text: 'first-stubborn',
      aiRequest: { template: null, additional: '' },
    });
    const next = store.createCapture({
      kind: 'note',
      text: 'next-success',
      aiRequest: { template: null, additional: '' },
    });
    worker.start();
    current = await until(
      () => readFile(join(dir, 'fake-devin.pid'), 'utf8').then(JSON.parse),
      Boolean,
    );
    const result = await until(
      () => store.getAiJob(next.latestAiJob.id),
      (value) => value.status === 'result_ready',
    );
    assert.equal(store.getAiJob(first.latestAiJob.id).errorCode, 'timeout');
    assert.equal(result.result.markdown, 'previous alive: false');
    assert.equal(isExecuting(current.pid), false);
    await assert.rejects(readdir(current.cwd), (e) => e.code === 'ENOENT');
    const last = store.createCapture({
      kind: 'note',
      text: 'shutdown-stubborn',
      aiRequest: { template: null, additional: '' },
    });
    const previousPid = current.pid;
    worker.wake();
    current = await until(
      () => readFile(join(dir, 'fake-devin.pid'), 'utf8').then(JSON.parse),
      (value) => value.pid !== previousPid,
    );
    await worker.stop();
    assert.equal(store.getAiJob(last.latestAiJob.id).errorCode, 'interrupted');
    assert.equal(isExecuting(current.pid), false, 'shutdown must await native execution cleanup');
    await assert.rejects(readdir(current.cwd), (e) => e.code === 'ENOENT');
  } finally {
    if (current) killFixture(current.pid);
    await worker.stop();
    store.close();
  }
});

test('Devin keeps session databases, caches and logs in disposable roots; preserves shared credentials', async (t) => {
  const { dir } = await fixture(t, `
const fs=require('node:fs'),path=require('node:path');
const roots=Object.fromEntries(['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME'].map(k=>[k,process.env[k]?fs.realpathSync(process.env[k]):null]));
const credentials=roots.XDG_DATA_HOME&&path.join(roots.XDG_DATA_HOME,'devin/credentials.toml');
const info={cwd:process.cwd(),roots,credentialLinked:!!credentials&&fs.existsSync(credentials)&&fs.lstatSync(credentials).isSymbolicLink()};
for(const dir of Object.values(roots)){if(dir&&dir.startsWith(process.cwd()+path.sep)){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'session-fixture'),'PRIVATE-PROMPT');}}
fs.writeFileSync(process.argv[1]+'.isolation.json',JSON.stringify(info));
console.log(JSON.stringify({markdown:'result'}));
`);
  const credentials = join(dir, 'credentials.toml');
  await writeFile(credentials, 'fixture-credential', { mode: 0o600 });
  const runner = createDevinRunner({ AI_DEVIN_BIN: join(dir, 'fake-devin'), AI_DEVIN_CREDENTIALS_FILE: credentials });
  assert.equal((await runner.run({job,materials:[]},new AbortController().signal)).markdown,'result');
  const info=JSON.parse(await readFile(join(dir,'fake-devin.isolation.json'),'utf8'));
  for(const root of Object.values(info.roots)) {
    assert.ok(root?.startsWith(info.cwd+'/'), 'CLI persistence must be isolated under the owned request workspace');
    await assert.rejects(readdir(root),e=>e.code==='ENOENT');
  }
  assert.equal(info.credentialLinked,true);
  assert.equal(await readFile(credentials,'utf8'),'fixture-credential');
});
