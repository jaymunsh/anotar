import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
const primitives = await import('../server/auth/crypto.mjs').catch(() => ({}));
const service = await import('../server/auth/service.mjs').catch(() => ({}));
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const key = 'ab'.repeat(32);

test('RFC6238 SHA1 vectors and encryption reject tampering', async () => {
  assert.equal(typeof primitives.totp, 'function', 'TOTP implementation missing');
  for (const [seconds, want] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])
    assert.equal(primitives.totp(secret, seconds * 1000, 8), want);
  const cipher = primitives.encryptSecret(secret, key);
  assert.equal(primitives.decryptSecret(cipher, key), secret);
  assert.throws(() => primitives.decryptSecret(cipher, 'cd'.repeat(32)));
  assert.ok(!cipher.includes(secret));
});
test('password hashing validates long passphrases without plaintext storage', async () => {
  assert.equal(typeof primitives.hashPassword, 'function', 'password hashing missing');
  const hash = await primitives.hashPassword('correct horse 배터리 staple');
  assert.ok(!hash.includes('correct'));
  assert.equal(await primitives.verifyPassword('correct horse 배터리 staple', hash), true);
  assert.equal(await primitives.verifyPassword('incorrect password', hash), false);
  await assert.rejects(primitives.hashPassword('short'));
  await assert.rejects(primitives.hashPassword('1234567'));
  const eight = await primitives.hashPassword('aB7!xy9?');
  assert.equal(await primitives.verifyPassword('aB7!xy9?', eight), true);
});
async function fixture(t) {
  assert.equal(typeof service.createAuthenticator, 'function', 'auth service missing');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-auth-'));
  const store = openStore(dir);
  let now = 1_700_000_000_000;
  const auth = service.createAuthenticator({ store, key, clock: () => now });
  const recovery = await auth.provision({ password: 'A good private passphrase!', secret });
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    auth,
    store,
    dir,
    recovery,
    advance: (ms) => (now += ms),
    code: () => primitives.totp(secret, now),
  };
}
test('TOTP cannot be replayed, trusted browser renews short session then expires absolutely', async (t) => {
  const f = await fixture(t);
  const login = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true, deviceName: '내 PC' },
    'local',
  );
  assert.ok(f.auth.authenticate(login));
  await assert.rejects(
    f.auth.login({ password: 'A good private passphrase!', code: f.code() }, 'local'),
    (e) => e.status === 401,
  );
  f.advance(13 * 3600000);
  const renewed = f.auth.authenticate(login);
  assert.ok(renewed?.sessionToken);
  assert.notEqual(renewed.sessionToken, login.sessionToken);
  for (let day = 0; day < 29; day++) {
    f.advance(24 * 3600000);
    f.auth.authenticate({ ...login, sessionToken: renewed.sessionToken });
  }
  f.advance(24 * 3600000);
  assert.equal(f.auth.authenticate(login), null);
});
test('unremembered and idle devices expire and logout revokes trust', async (t) => {
  const f = await fixture(t);
  const plain = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code() },
    'local',
  );
  f.advance(13 * 3600000);
  assert.equal(f.auth.authenticate(plain), null);
  const remembered = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true },
    'local',
  );
  f.advance(8 * 86400000);
  assert.equal(f.auth.authenticate(remembered), null);
  f.advance(30000);
  const active = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true },
    'local',
  );
  f.auth.logout(f.auth.authenticate(active).session);
  assert.equal(f.auth.authenticate(active), null);
});
test('recovery codes are one-use, do not issue trust, and database contains no raw credentials', async (t) => {
  const f = await fixture(t);
  const login = await f.auth.login(
    { password: 'A good private passphrase!', code: f.recovery.recoveryCodes[0], remember: true },
    'local',
  );
  assert.equal(login.deviceToken, undefined);
  await assert.rejects(
    f.auth.login(
      { password: 'A good private passphrase!', code: f.recovery.recoveryCodes[0] },
      'local',
    ),
    (e) => e.status === 401,
  );
  assert.equal(f.auth.devices(f.auth.authenticate(login).session)[0].remembered, false);
  assert.equal(JSON.stringify(f.store.auth.owner()).includes(secret), false);
  const bytes = (await readFile(join(f.dir, 'storage.sqlite-wal'))).toString('latin1');
  for (const value of [
    secret,
    login.sessionToken,
    f.recovery.recoveryCodes[0],
    'A good private passphrase!',
  ])
    assert.ok(!bytes.includes(value));
  await assert.rejects(
    f.auth.provision({ password: 'replacement password!', secret }),
    (e) => e.status === 409,
  );
});
test('other device revocation requires fresh MFA and revokes both sessions and remember cookies', async (t) => {
  const f = await fixture(t);
  const first = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true },
    'local',
  );
  f.advance(30000);
  const other = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true },
    'local',
  );
  f.advance(6 * 60000);
  const session = f.auth.authenticate(first).session;
  const list = f.auth.devices(session);
  assert.equal(list.length, 2);
  assert.equal(JSON.stringify(list).includes(other.deviceToken), false);
  const id = list.find((d) => !d.current).id;
  assert.throws(
    () => f.auth.revoke(session, id),
    (e) => e.code === 'reauth_required',
  );
  const checked = f.auth.reauthenticate(session, f.code());
  f.auth.revoke(checked.session, id);
  assert.equal(f.auth.authenticate(other), null);
  assert.ok(f.auth.authenticate({ ...first, ...checked }));
});
test('failed login throttling persists across authenticator recreation', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      f.auth.login({ password: 'incorrect passphrase!', code: '000000' }, 'local'),
      (e) => e.status === 401,
    );
  // Same wall clock after process recreation; must not evade persisted limit.
  const restarted = service.createAuthenticator({
    store: f.store,
    key,
    clock: () => 1_700_000_000_000,
  });
  await assert.rejects(
    restarted.login({ password: 'A good private passphrase!', code: f.code() }, 'local'),
    (e) => e.status === 429,
  );
});
test('re-authentication rotates the session token and restored workspace invalidates old devices', async (t) => {
  const f = await fixture(t);
  const login = await f.auth.login(
    { password: 'A good private passphrase!', code: f.code(), remember: true },
    'local',
  );
  const session = f.auth.authenticate(login).session;
  f.advance(30000);
  const rechecked = f.auth.reauthenticate(session, f.code());
  assert.ok(rechecked.sessionToken, 're-authentication must rotate session');
  assert.equal(f.auth.authenticate({ sessionToken: login.sessionToken }), null);
  assert.ok(f.auth.authenticate(rechecked));
  const original = f.store.syncSession;
  f.store.syncSession = () => ({ ...original(), epoch: 'restored-epoch' });
  assert.equal(f.auth.authenticate({ ...login, ...rechecked }), null);
});
