import { randomUUID, randomBytes } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  matchTotp,
  digest,
  token,
} from './crypto.mjs';
const HOUR = 3600000,
  DAY = 24 * HOUR;
export const authError = (status, code, message) => Object.assign(Error(message), { status, code });
const invalid = () =>
  authError(401, 'invalid_credentials', '비밀번호와 인증 코드를 확인해 주세요.');
export function createAuthenticator({ store, key, clock = Date.now, secure = true }) {
  if (!/^[a-f0-9]{64}$/i.test(key ?? '')) throw Error('AUTH_SECRET_KEY 설정을 확인해 주세요.');
  const db = store.auth;
  let hashing = false;
  const epoch = () => store.syncSession().epoch;
  function throttle(peer) {
    for (const id of ['owner', 'ip:' + digest(peer)]) {
      const row = db.attempt(id);
      if (row && row.failures >= 5 && clock() - row.started_at < 900000)
        throw authError(429, 'login_limited', '로그인 시도가 많아요. 15분 뒤 다시 시도해 주세요.');
    }
  }
  function fail(peer) {
    db.fail('owner', clock());
    db.fail('ip:' + digest(peer), clock());
  }
  function consumeCode(code) {
    const owner = db.owner();
    if (!owner) return null;
    const step = matchTotp(decryptSecret(owner.secret_cipher, key), code, clock(), owner.last_step);
    if (step !== null && db.consumeStep(step)) return 'totp';
    if (
      typeof code === 'string' &&
      /^[a-f0-9]{24}$/i.test(code) &&
      db.consumeRecovery(digest(code.toLowerCase()))
    )
      return 'recovery';
    return null;
  }
  function sessionFor(device, mfaAt = 0) {
    const sessionToken = token(),
      expiresAt = Math.min(clock() + 12 * HOUR, device.expires_at);
    db.addSession({
      hash: digest(sessionToken),
      device_id: device.id,
      expires_at: expiresAt,
      mfa_at: mfaAt,
      epoch: epoch(),
    });
    return { sessionToken, sessionExpires: expiresAt };
  }
  const api = {
    secure,
    configured: () => Boolean(db.owner()),
    async provision({ password, secret }) {
      if (db.owner()) throw authError(409, 'owner_exists', '이미 개인 계정이 설정되어 있어요.');
      const hash = await hashPassword(password),
        cipher = encryptSecret(secret, key);
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex'));
      db.transaction(() => {
        if (db.owner()) throw authError(409, 'owner_exists', '이미 개인 계정이 설정되어 있어요.');
        db.provision(hash, cipher, recoveryCodes.map(digest));
      });
      return { recoveryCodes };
    },
    async login({ password, code, remember = false, deviceName = '이 브라우저' }, peer = 'local') {
      throttle(peer);
      if (hashing)
        throw authError(
          429,
          'login_busy',
          '다른 로그인 확인이 진행 중이에요. 잠시 뒤 시도해 주세요.',
        );
      hashing = true;
      try {
        const owner = db.owner();
        if (!owner) throw authError(503, 'auth_unconfigured', '개인 계정 설정이 필요해요.');
        if (!(await verifyPassword(password, owner.password_hash))) {
          fail(peer);
          throw invalid();
        }
        return (
          db.transaction(() => {
            const kind = consumeCode(code);
            if (!kind) {
              fail(peer);
              return null;
            }
            db.clearAttempts('owner');
            db.clearAttempts('ip:' + digest(peer));
            db.cleanup(clock(), epoch());
            while (db.devices().length >= 20) db.deleteDevice(db.devices().at(-1).id);
            const trusted = remember === true && kind === 'totp',
              deviceToken = trusted ? token() : undefined;
            const device = {
              id: randomUUID(),
              name: String(deviceName).trim().slice(0, 60) || '이 브라우저',
              trust_hash: trusted ? digest(deviceToken) : null,
              created_at: clock(),
              last_used: clock(),
              expires_at: clock() + (trusted ? 30 * DAY : 12 * HOUR),
              epoch: epoch(),
            };
            db.addDevice(device);
            return {
              ...sessionFor(device, clock()),
              deviceToken,
              deviceExpires: device.expires_at,
            };
          }) ??
          (() => {
            throw invalid();
          })()
        );
      } finally {
        hashing = false;
      }
    },
    authenticate({ sessionToken, deviceToken } = {}) {
      db.cleanup(clock(), epoch());
      const session =
        typeof sessionToken === 'string' && /^[a-f0-9]{64}$/.test(sessionToken)
          ? db.session(digest(sessionToken))
          : null;
      if (session) {
        db.touch(session.device_id, clock());
        return { session };
      }
      const device =
        typeof deviceToken === 'string' && /^[a-f0-9]{64}$/.test(deviceToken)
          ? db.trust(digest(deviceToken))
          : null;
      if (!device) return null;
      db.touch(device.id, clock());
      const issued = sessionFor(device);
      return { ...issued, session: db.session(digest(issued.sessionToken)) };
    },
    devices(session) {
      db.cleanup(clock(), epoch());
      return db
        .devices()
        .map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.created_at,
          lastUsedAt: d.last_used,
          expiresAt: d.expires_at,
          remembered: Boolean(d.trust_hash),
          current: d.id === session.device_id,
        }));
    },
    logout(session) {
      if (session) db.deleteDevice(session.device_id);
    },
    reauthenticate(session, code) {
      throttle('reauth');
      const accepted = db.transaction(() => {
        if (!consumeCode(code)) {
          fail('reauth');
          return false;
        }
        db.clearAttempts('owner');
        db.clearAttempts('ip:' + digest('reauth'));
        const device = db.device(session.device_id);
        db.deleteSession(session.hash);
        const issued = sessionFor(device, clock());
        return { ...issued, session: db.session(digest(issued.sessionToken)) };
      });
      if (!accepted) throw invalid();
      return accepted;
    },
    revoke(session, id) {
      const current = db.session(session.hash);
      if (!current) throw authError(401, 'authentication_required', '다시 로그인해 주세요.');
      if (id !== session.device_id && clock() - current.mfa_at > 5 * 60000)
        throw authError(403, 'reauth_required', '인증 코드를 다시 확인해 주세요.');
      if (id === 'all') db.deleteDevices();
      else db.deleteDevice(id);
    },
    recoveryCount: () => db.recoveryCount(),
  };
  return api;
}
