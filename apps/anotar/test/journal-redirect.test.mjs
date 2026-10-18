import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t, env = {}) {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), 'leneu-journal-redirect-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      ...env,
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { base };
}

test('GET /journal 302-redirects to the default harukan address', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/journal', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://harukan.leneu.store/app');
});

test('GET /journal/sub-path also redirects so old bookmarks keep working', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/journal/2026-10-18', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://harukan.leneu.store/app');
});

test('HARUKAN_URL env overrides the redirect target and trailing slash is trimmed', async (t) => {
  const { base } = await fixture(t, { HARUKAN_URL: 'http://127.0.0.1:5175/app/' });
  const response = await fetch(base + '/journal', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'http://127.0.0.1:5175/app');
});
