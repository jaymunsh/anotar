import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { openStore } from '../server/store.mjs';
import { createAuthenticator } from '../server/auth/service.mjs';
import { totp } from '../server/auth/crypto.mjs';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  key = 'ac'.repeat(32);

async function freePort() {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  return port;
}

// Boots the real server with auth required. memoryDataFile may be omitted to exercise the 404 path.
async function fixture(t, { memoryDataFile, authMode = 'required' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memory-'));
  const store = openStore(dir);
  await createAuthenticator({ store, key }).provision({
    password: 'My private fixture password!',
    secret,
  });
  store.close();
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AUTH_MODE: authMode,
      AUTH_SECRET_KEY: key,
      AUTH_COOKIE_SECURE: 'false',
      AI_RUNNER_KIND: 'disabled',
      OCR_RUNNER_URL: '',
      PRIVATE_ALLOWED_ORIGINS: '',
      ...(memoryDataFile ? { MEMORY_DATA_FILE: memoryDataFile } : { MEMORY_DATA_FILE: '' }),
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    const exit = once(child, 'exit');
    child.kill();
    await exit;
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, dir };
}

async function login(base) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ password: 'My private fixture password!', code: totp(secret) }),
  });
  assert.equal(response.status, 200, 'login should succeed');
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

test('GET /memory/data.json requires a session (401 when signed out)', async (t) => {
  const f = await fixture(t, {});
  const response = await fetch(f.base + '/memory/data.json', { headers: { Accept: 'application/json' } });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok((await response.json()).error);
});

test('GET /memory/data.json is open like /api only when AUTH_MODE=disabled', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memory-file-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'data.json');
  await writeFile(file, '{"wiki":[]}');
  const f = await fixture(t, { memoryDataFile: file, authMode: 'disabled' });
  const response = await fetch(f.base + '/memory/data.json');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { wiki: [] });
});

test('GET /memory/data.json returns 404 when MEMORY_DATA_FILE is unset', async (t) => {
  const f = await fixture(t, {});
  const cookie = await login(f.base);
  const response = await fetch(f.base + '/memory/data.json', { headers: { Cookie: cookie } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.ok((await response.json()).error);
});

test('GET /memory/data.json returns 404 when the file is missing on disk', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memory-file-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = join(dir, 'data.json');
  const f = await fixture(t, { memoryDataFile: missing });
  const cookie = await login(f.base);
  const response = await fetch(f.base + '/memory/data.json', { headers: { Cookie: cookie } });
  assert.equal(response.status, 404);
  assert.ok((await response.json()).error);
});

test('GET /memory/data.json streams the file to a signed-in owner with no-store', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memory-file-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'data.json');
  const payload = { wiki: [{ slug: 'a', title: 'A', tldr: '', updated: '2026-01-01', body: '' }], sessions: [], builtAt: '2026-01-01T00:00:00Z' };
  await writeFile(file, JSON.stringify(payload));
  const f = await fixture(t, { memoryDataFile: file });
  const cookie = await login(f.base);
  const response = await fetch(f.base + '/memory/data.json', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), payload);
});

test('/memory/data.json is a fixed path: traversal-style siblings do not leak files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memory-file-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'data.json');
  await writeFile(file, JSON.stringify({ wiki: [], sessions: [] }));
  // A secret sibling next to the configured file must never be reachable.
  await writeFile(join(dir, 'secret.json'), JSON.stringify({ secret: true }));
  const f = await fixture(t, { memoryDataFile: file });
  const cookie = await login(f.base);
  // Only the exact /memory/data.json path is served; anything else falls through to the SPA/404.
  for (const path of ['/memory/secret.json', '/memory/../data.json', '/memory/data.json/../secret.json']) {
    const response = await fetch(f.base + path, { headers: { Cookie: cookie }, redirect: 'manual' });
    const body = response.status === 200 ? await response.text() : '';
    assert.doesNotMatch(body, /"secret"\s*:\s*true/, `${path} must not leak secret.json`);
  }
});
