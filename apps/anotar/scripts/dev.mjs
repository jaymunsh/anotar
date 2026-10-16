import { spawn } from 'node:child_process';

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
