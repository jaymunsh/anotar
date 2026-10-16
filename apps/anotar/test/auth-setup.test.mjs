import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const setup = await import('../server/auth/setup.mjs').catch(() => ({}));
test('setup saves a protected auth key, preserves unrelated environment and never changes an existing key', async (t) => {
  assert.equal(typeof setup.prepareAuthEnvironment, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '.env');
  await writeFile(path, 'GEOAPIFY_API_KEY=fixture-only\nAUTH_MODE=disabled\n', { mode: 0o644 });
  const key = await setup.prepareAuthEnvironment({ path, env: { HOST: '127.0.0.1' } });
  assert.match(key, /^[a-f0-9]{64}$/);
  const text = await readFile(path, 'utf8');
  assert.match(text, /GEOAPIFY_API_KEY=fixture-only/);
  assert.match(text, /AUTH_MODE=required/);
  assert.match(text, /AUTH_COOKIE_SECURE=false/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(
    await setup.prepareAuthEnvironment({
      path,
      env: { HOST: '0.0.0.0', NODE_ENV: 'production', AUTH_SECRET_KEY: key },
    }),
    key,
  );
  assert.match(await readFile(path, 'utf8'), /AUTH_COOKIE_SECURE=true/);
  const before = await readFile(path, 'utf8');
  await assert.rejects(() =>
    setup.prepareAuthEnvironment({ path, env: { AUTH_SECRET_KEY: 'wrong' } }),
  );
  assert.equal(await readFile(path, 'utf8'), before);
});
test('setup refuses a missing key when an account already exists and requires a confirmed TOTP before provisioning', async (t) => {
  assert.equal(typeof setup.provisionConfirmedOwner, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    () => setup.prepareAuthEnvironment({ path: join(dir, '.env'), env: {}, ownerExists: true }),
    /AUTH_SECRET_KEY/,
  );
  const { openStore } = await import('../server/store.mjs');
  const store = openStore(dir);
  t.after(() => store.close());
  const key = 'aa'.repeat(32),
    secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    now = 59000;
  await assert.rejects(() =>
    setup.provisionConfirmedOwner({
      store,
      key,
      password: 'setup fixture password!',
      secret,
      code: '000000',
      clock: () => now,
    }),
  );
  assert.equal(store.auth.owner(), undefined);
  const { totp } = await import('../server/auth/crypto.mjs');
  const result = await setup.provisionConfirmedOwner({
    store,
    key,
    password: 'setup fixture password!',
    secret,
    code: totp(secret, now),
    clock: () => now,
  });
  assert.equal(result.recoveryCodes.length, 10);
  assert.ok(store.auth.owner());
  await assert.rejects(
    () =>
      setup.provisionConfirmedOwner({
        store,
        key,
        password: 'second setup password!',
        secret,
        code: totp(secret, now),
        clock: () => now,
      }),
    /이미/,
  );
});
test('setup works with copied example env loaded by Node, including an empty key', async (t) => {
  const { parseEnv } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-env-example-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '.env'),
    example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile(path, example);
  const env = { ...parseEnv(example), HOST: '127.0.0.1' };
  assert.equal(env.AUTH_SECRET_KEY, '');
  const key = await setup.prepareAuthEnvironment({ path, env });
  assert.match(key, /^[a-f0-9]{64}$/);
  const saved = parseEnv(await readFile(path, 'utf8'));
  assert.equal(saved.AUTH_SECRET_KEY, key);
  assert.equal(saved.AUTH_MODE, 'required');
});
test('environment updates horizontal whitespace without swallowing neighboring lines', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-env-tabs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '.env');
  await writeFile(path, 'AUTH_MODE\t=disabled\nAUTH_SECRET_KEY=\nKEEP=fixture\n');
  await setup.prepareAuthEnvironment({ path, env: { AUTH_SECRET_KEY: '' } });
  const value = await readFile(path, 'utf8');
  assert.match(value, /KEEP=fixture/);
  assert.equal(value.match(/AUTH_MODE/g).length, 1);
  assert.match(value, /AUTH_MODE=required/);
});
