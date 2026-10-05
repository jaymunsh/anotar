import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { AI_OUTPUT_LIMIT, AiExecutionError } from './contracts.mjs';
const TERMINATION_GRACE_MS = 200;
export function runProcess(executable, args, options, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const ownsGroup = process.platform !== 'win32';
    const { input, ...spawnOptions } = options;
    const child = spawn(executable, args, {
      ...spawnOptions,
      detached: ownsGroup,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    let failure = null,
      killTimer = null,
      bytes = 0;
    const stdout = [];
    function killOwned(signalName) {
      if (!child.pid) return;
      try {
        if (ownsGroup) process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          try {
            child.kill(signalName);
          } catch {}
        }
      }
    }
    function terminate(error) {
      if (failure) return;
      failure = error;
      killOwned('SIGTERM');
      killTimer = setTimeout(() => killOwned('SIGKILL'), TERMINATION_GRACE_MS);
    }
    const abort = () => terminate(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    for (const [stream, collect] of [
      [child.stdout, true],
      [child.stderr, false],
    ]) {
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > AI_OUTPUT_LIMIT) terminate(new AiExecutionError('invalid_result'));
        else if (collect && !failure) stdout.push(chunk);
      });
    }
    child.on('error', (error) => {
      failure ||= new AiExecutionError(
        ['ENOENT', 'EACCES'].includes(error.code) ? 'runner_unavailable' : 'runner_failed',
      );
    });
    // The close event follows actual child exit and pipe closure. Abort never settles early.
    child.on('close', (code) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      // Also remove background descendants if the CLI leader exits before the grace timer.
      if (ownsGroup) killOwned('SIGKILL');
      if (failure) reject(failure);
      else if (code !== 0) reject(new AiExecutionError('runner_failed'));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
export function executablePath(env, key = 'AI_DEVIN_BIN', fallback = 'devin') {
  const name = env[key] || fallback;
  const candidates = isAbsolute(name)
    ? [name]
    : (env.PATH || process.env.PATH || '').split(delimiter).map((path) => join(path, name));
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {}
  }
  return null;
}
