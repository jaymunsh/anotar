export function createAuthStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_owner (
      id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL,
      secret_cipher TEXT NOT NULL, last_step INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS auth_recovery (hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS auth_devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, trust_hash TEXT UNIQUE,
      created_at INTEGER NOT NULL, last_used INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      epoch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES auth_devices(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, mfa_at INTEGER NOT NULL, epoch TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_session_device ON auth_sessions(device_id);
    CREATE TABLE IF NOT EXISTS auth_attempts (id TEXT PRIMARY KEY, failures INTEGER NOT NULL, started_at INTEGER NOT NULL);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  return {
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    owner: () => get('SELECT * FROM auth_owner WHERE id=1'),
    provision(hash, cipher, recovery) {
      run('INSERT INTO auth_owner(id,password_hash,secret_cipher) VALUES(1,?,?)', hash, cipher);
      for (const code of recovery) run('INSERT INTO auth_recovery(hash) VALUES(?)', code);
    },
    consumeStep(step) {
      return (
        run('UPDATE auth_owner SET last_step=? WHERE id=1 AND last_step<?', step, step).changes ===
        1
      );
    },
    consumeRecovery(hash) {
      return run('DELETE FROM auth_recovery WHERE hash=?', hash).changes === 1;
    },
    recoveryCount: () => get('SELECT COUNT(*) AS n FROM auth_recovery').n,
    attempt: (id) => get('SELECT * FROM auth_attempts WHERE id=?', id),
    fail(id, now) {
      run('DELETE FROM auth_attempts WHERE started_at<=?', now - 900000);
      run(
        'INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET failures=failures+1',
        id,
        now,
      );
    },
    clearAttempts(id) {
      run('DELETE FROM auth_attempts WHERE id=?', id);
    },
    device: (id) => get('SELECT * FROM auth_devices WHERE id=?', id),
    trust: (hash) => get('SELECT * FROM auth_devices WHERE trust_hash=?', hash),
    devices: () => db.prepare('SELECT * FROM auth_devices ORDER BY created_at DESC,id').all(),
    addDevice(d) {
      run(
        'INSERT INTO auth_devices VALUES(?,?,?,?,?,?,?)',
        d.id,
        d.name,
        d.trust_hash,
        d.created_at,
        d.last_used,
        d.expires_at,
        d.epoch,
      );
    },
    touch(id, now) {
      run('UPDATE auth_devices SET last_used=? WHERE id=?', now, id);
    },
    session: (hash) => get('SELECT * FROM auth_sessions WHERE hash=?', hash),
    addSession(s) {
      run(
        'INSERT INTO auth_sessions VALUES(?,?,?,?,?)',
        s.hash,
        s.device_id,
        s.expires_at,
        s.mfa_at,
        s.epoch,
      );
    },
    deleteSession(hash) {
      run('DELETE FROM auth_sessions WHERE hash=?', hash);
    },
    deleteDevice(id) {
      run('DELETE FROM auth_devices WHERE id=?', id);
    },
    deleteDevices() {
      run('DELETE FROM auth_devices');
    },
    mfa(hash, now) {
      run('UPDATE auth_sessions SET mfa_at=? WHERE hash=?', now, hash);
    },
    cleanup(now, epoch) {
      run(
        'DELETE FROM auth_devices WHERE expires_at<=? OR epoch<>? OR (trust_hash IS NOT NULL AND last_used<=?)',
        now,
        epoch,
        now - 7 * 86400000,
      );
      run('DELETE FROM auth_sessions WHERE expires_at<=? OR epoch<>?', now, epoch);
    },
  };
}
