import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
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
async function fixture(t, configured = true, secretKey = key) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-api-'));
  const store = openStore(dir);
  let recovery;
  if (configured)
    recovery = await createAuthenticator({ store, key }).provision({
      password: 'My private fixture password!',
      secret,
    });
  store.close();
  const socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AUTH_MODE: 'required',
      AUTH_SECRET_KEY: secretKey,
      AUTH_COOKIE_SECURE: 'false',
      AI_RUNNER_KIND: 'disabled',
      OCR_RUNNER_URL: '',
      PRIVATE_ALLOWED_ORIGINS: '',
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
  const post = (path, body, cookie = '', origin = base) =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  return { base, dir, recovery, post };
}
function cookies(response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
test('required auth guards every private API and upload before writing, but health/status/shell remain usable', async (t) => {
  const f = await fixture(t);
  const status = await fetch(f.base + '/api/auth/status');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { enabled: true, configured: true, authenticated: false });
  for (const path of [
    '/api/captures',
    '/api/pages',
    '/api/tasks',
    '/api/sync/session',
    '/api/backups',
    '/api/ai/activity',
    '/api/assets/missing',
    '/api/document-blueprints',
    '/api/search?q=hello',
  ])
    assert.equal((await fetch(f.base + path)).status, 401, path);
  assert.equal((await f.post('/api/tasks', { title: 'blocked' })).status, 401);
  const body = new FormData();
  body.set('kind', 'note');
  body.set('text', 'blocked');
  body.append('files', new Blob(['private bytes']), 'private.txt');
  assert.equal(
    (await fetch(f.base + '/api/captures', { method: 'POST', headers: { Origin: f.base }, body }))
      .status,
    401,
  );
  assert.deepEqual(await readdir(join(f.dir, 'blobs')), []);
  assert.equal(
    (await fetch(f.base + '/api/auth/register', { method: 'POST', headers: { Origin: f.base } }))
      .status,
    401,
  );
});
test('password plus TOTP issues protected cookies; foreign Origin cannot login or mutate authenticated data', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.post(
        '/api/auth/login',
        { password: 'My private fixture password!', code: totp(secret) },
        '',
        'https://foreign.invalid',
      )
    ).status,
    403,
  );
  const login = await f.post('/api/auth/login', {
    password: 'My private fixture password!',
    code: totp(secret),
    remember: true,
    deviceName: 'Fixture browser',
  });
  assert.equal(login.status, 200);
  const cookie = cookies(login);
  assert.match(cookie, /leneu_session=/);
  assert.match(cookie, /leneu_device=/);
  for (const value of login.headers.getSetCookie()) {
    assert.match(value, /HttpOnly/);
    assert.match(value, /SameSite=Strict/);
    assert.ok(!value.includes('Domain='));
  }
  assert.equal(JSON.stringify(await login.json()).includes(secret), false);
  assert.equal(
    (await fetch(f.base + '/api/sync/session', { headers: { Cookie: cookie } })).status,
    200,
  );
  const listed = await (
    await fetch(f.base + '/api/auth/devices', { headers: { Cookie: cookie } })
  ).json();
  assert.equal(listed.items[0].name, 'Fixture browser');
  assert.equal(listed.items[0].current, true);
  assert.ok(!JSON.stringify(listed).includes(cookie.split('=')[1]));
  assert.equal(
    (await f.post('/api/tasks', { title: 'blocked' }, cookie, 'https://foreign.invalid')).status,
    403,
  );
  assert.equal((await f.post('/api/auth/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(f.base + '/api/tasks', { headers: { Cookie: cookie } })).status, 401);
});
test('missing account or key is fail-closed and oversized login is bounded', async (t) => {
  const f = await fixture(t, false, '');
  assert.equal((await fetch(f.base + '/api/pages')).status, 503);
  const status = await (await fetch(f.base + '/api/auth/status')).json();
  assert.equal(status.configured, false);
  assert.equal(status.enabled, true);
  assert.equal((await f.post('/api/auth/login', { password: 'not registered' })).status, 503);
  const configured = await fixture(t);
  assert.equal(
    (await configured.post('/api/auth/login', { password: 'x'.repeat(5000) })).status,
    413,
  );
});
test('chunked oversized login returns a bounded rejection instead of resetting the response', async (t) => {
  const f = await fixture(t),
    { request } = await import('node:http');
  const status = await new Promise((resolveStatus, reject) => {
    const req = request(
      f.base + '/api/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.base } },
      (res) => {
        res.resume();
        res.on('end', () => resolveStatus(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write('{"password":"');
    req.write('x'.repeat(5000));
    req.end('"}');
  });
  assert.equal(status, 413);
});
test('production defaults to required auth and Secure cookies carry host-only prefixes', async (t) => {
  const { createAuthHttp } = await import('../server/auth/routes.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-prod-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const guard = createAuthHttp({ store, env: { NODE_ENV: 'production', HOST: '0.0.0.0' } });
  assert.equal(guard.enabled, true);
  assert.throws(
    () =>
      createAuthHttp({
        store,
        env: { NODE_ENV: 'production', HOST: '0.0.0.0', AUTH_COOKIE_SECURE: 'false' },
      }),
    /Insecure/,
  );
  await createAuthenticator({ store, key }).provision({
    password: 'Secure cookie fixture password!',
    secret,
  });
  const protectedGuard = createAuthHttp({
    store,
    env: { NODE_ENV: 'production', HOST: '0.0.0.0', AUTH_SECRET_KEY: key },
  });
  const { Readable } = await import('node:stream');
  const req = Readable.from([
    Buffer.from(
      JSON.stringify({
        password: 'Secure cookie fixture password!',
        code: totp(secret),
        remember: true,
      }),
    ),
  ]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', origin: 'https://app.example.invalid' };
  req.socket = { remoteAddress: 'local' };
  req.setTimeout = () => {};
  const headers = {};
  const res = { setHeader: (k, v) => (headers[k] = v), writeHead: () => {}, end: () => {} };
  await protectedGuard.handle(req, res, new URL('https://app.example.invalid/api/auth/login'));
  assert.equal(headers['Set-Cookie'].length, 2);
  for (const c of headers['Set-Cookie']) {
    assert.match(c, /^__Host-leneu_(?:session|device)=/);
    assert.match(c, /; Secure;/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.doesNotMatch(c, /Domain=/);
  }
});
