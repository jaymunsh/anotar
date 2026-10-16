import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Never load .env: the server copy has no production provider or Telegram credentials.
const base = await realpath(resolve('.local-workspace'));
const config = JSON.parse(await readFile(resolve(base, 'current.json'), 'utf8'));
const dataDir = await realpath(resolve(base, config.dataDirectory));
if (!dataDir.startsWith(base + sep) || !(await stat(resolve(dataDir, 'storage.sqlite'))).isFile())
  throw Error('별도 로컬 사본의 데이터 경로를 확인해 주세요.');
const aiEnabled = config.aiEnabled === true;
const opencodeBin = resolve(base, 'opencode-runtime/node_modules/.bin/opencode');
if (aiEnabled) {
  let version;
  try { version = execFileSync(opencodeBin, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(); }
  catch { throw Error('로컬 OpenCode 설치 필요: npm install --prefix .local-workspace/opencode-runtime --no-save --package-lock=false opencode-ai@1.18.34'); }
  if (version !== '1.18.34') throw Error('로컬 AI에는 검증된 OpenCode 1.18.34가 필요합니다.');
}
// macOS Unix sockets have a short path limit; keep IPC outside the long checkout path.
const ipcDir = await mkdtemp('/tmp/anotar-copy-');
process.on('exit', () => rmSync(ipcDir, { recursive: true, force: true }));
const env = {
  PATH: process.env.PATH, LANG: process.env.LANG || 'en_US.UTF-8',
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8788',
  DATA_DIR: dataDir, AUTH_MODE: 'disabled', BACKGROUND_WORKERS_ENABLED: 'false',
  COMMENT_SOCKET_PATH: resolve(ipcDir, 'comments.sock'),
  AI_RUNNER_KIND: aiEnabled ? 'opencode' : 'disabled',
  AI_WORKER_ENABLED: String(aiEnabled), AI_OPENCODE_ENABLED: String(aiEnabled),
  AI_OPENCODE_BIN: opencodeBin, AI_OPENCODE_MODEL: 'opencode/muse-spark-1.3-contributor-free',
  // No personal paid provider credentials or installed Devin are inherited.
  AI_OPENCODE_AUTH_FILE: resolve(base, 'opencode-no-auth.json'),
  AI_DEVIN_BIN: resolve(base, 'disabled-devin'),
  DEV_PORT: '5174', DEV_API_PORT: '8788', PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: '8791',
  PUBLIC_SHARE_ORIGIN: 'http://127.0.0.1:8791',
  HOSTED_SITES_DIR: resolve(base, 'hosted-sites'),
};
const commands = [
  ['--watch', 'server/index.mjs'], ['--watch', 'server/public.mjs'],
  ['node_modules/vite/bin/vite.js', '--strictPort'],
];
const children = commands.map(args => spawn(process.execPath, args, {
  env: args.includes('server/public.mjs')
    ? { ...env, AI_WORKER_ENABLED: 'false', AI_RUNNER_KIND: 'disabled', AI_OPENCODE_ENABLED: 'false' }
    : env,
  stdio: 'inherit',
}));
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('Oracle 사본: http://127.0.0.1:5174 · 로컬 공유: http://127.0.0.1:8791');
console.log(`서버 원본·기존 data/와 분리되어 있으며 AI ${aiEnabled ? 'OpenCode 실행 가능' : '꺼짐'} · OCR·예약 백업·Telegram 꺼짐`);
