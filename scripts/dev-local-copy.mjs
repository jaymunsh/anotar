import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Never load .env: the server copy has no production provider or Telegram credentials.
const base = await realpath(resolve('.local-workspace'));
const config = JSON.parse(await readFile(resolve(base, 'current.json'), 'utf8'));
const dataDir = await realpath(resolve(base, config.dataDirectory));
if (!dataDir.startsWith(base + sep) || !(await stat(resolve(dataDir, 'storage.sqlite'))).isFile())
  throw Error('별도 로컬 사본의 데이터 경로를 확인해 주세요.');
// macOS Unix sockets have a short path limit; keep IPC outside the long checkout path.
const ipcDir = await mkdtemp('/tmp/anotar-copy-');
process.on('exit', () => rmSync(ipcDir, { recursive: true, force: true }));
const env = {
  PATH: process.env.PATH, LANG: process.env.LANG || 'en_US.UTF-8',
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8788',
  DATA_DIR: dataDir, AUTH_MODE: 'disabled', BACKGROUND_WORKERS_ENABLED: 'false',
  COMMENT_SOCKET_PATH: resolve(ipcDir, 'comments.sock'),
  AI_RUNNER_KIND: 'disabled', AI_OPENCODE_ENABLED: 'false',
  DEV_PORT: '5174', DEV_API_PORT: '8788', PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: '8791',
  PUBLIC_SHARE_ORIGIN: 'http://127.0.0.1:8791',
  HOSTED_SITES_DIR: resolve(base, 'hosted-sites'),
};
const commands = [
  ['--watch', 'server/index.mjs'], ['--watch', 'server/public.mjs'],
  ['node_modules/vite/bin/vite.js', '--strictPort'],
];
const children = commands.map(args => spawn(process.execPath, args, { env, stdio: 'inherit' }));
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
console.log('서버 원본·기존 data/와 분리되어 있으며 AI·OCR·예약 백업은 실행하지 않습니다.');
