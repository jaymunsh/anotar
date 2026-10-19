import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Local wiki build (apps/memory build.py), served by the API like production.
process.env.MEMORY_DATA_FILE ||= resolve('../../data/memory/site/data.json');

const commands = [
  ['node', ['--watch', 'server/index.mjs']],
  ['node', ['--watch', 'server/sites.mjs']],
  ['node', ['node_modules/vite/bin/vite.js']],
];
const children = commands.map(([command, args]) =>
  spawn(command, args, { stdio: 'inherit', env: process.env }),
);
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
