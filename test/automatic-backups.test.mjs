import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAutomaticBackups } from '../server/automaticBackups.mjs';
import { handleBackupRoute } from '../server/backupRoutes.mjs';
import { createBackup, verifyBackup } from '../server/backups.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'leneu-automatic-backup-')));
  const dataDir = join(root, 'data');
  const backupDir = join(root, 'backups');
  await mkdir(join(dataDir, 'blobs'), { recursive: true });
  await writeFile(join(dataDir, 'blobs', 'photo'), 'photo');
  const store = new DatabaseSync(join(dataDir, 'storage.sqlite'));
  store.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE assets (storage_key TEXT, size INTEGER); INSERT INTO assets VALUES ('photo', 5);",
  );
  const managers = [];
  const manager = () => {
    const item = createAutomaticBackups({ dataDir, backupDir });
    managers.push(item);
    return item;
  };
  t.after(async () => {
    await Promise.all(managers.map((item) => item.stop()));
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, dataDir, backupDir, store, manager };
}

test('defaults are off with KST 04:00 and seven verified snapshots', async (t) => {
  const { manager } = await fixture(t);
  const status = await manager().status();
  assert.deepEqual(status.settings, {
    enabled: false,
    hour: 4,
    minute: 0,
    retention: 7,
    timeZone: 'Asia/Seoul',
  });
  assert.equal(status.running, false);
  assert.equal(status.nextRunAt, null);
  assert.equal(status.lastGood, null);
});

test('settings persist across restart and reject invalid or unrecognized fields', async (t) => {
  const { manager } = await fixture(t);
  const first = manager();
  await first.configure({ enabled: true, hour: 23, minute: 59, retention: 60 });
  await first.stop();
  assert.deepEqual((await manager().status()).settings, {
    enabled: true,
    hour: 23,
    minute: 59,
    retention: 60,
    timeZone: 'Asia/Seoul',
  });
  for (const config of [
    { retention: 0 },
    { retention: 61 },
    { hour: 24 },
    { minute: -1 },
    { minute: 1.5 },
    { enabled: 'true' },
    { directory: '../data' },
    {},
  ]) {
    await assert.rejects(first.configure(config), { status: 400 });
  }
});

test('KST schedule crosses UTC midnight and fires once on the local day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T14:59:00Z') });
  const { manager } = await fixture(t);
  const item = manager();
  await item.configure({ enabled: true, hour: 0, minute: 0, retention: 7 });
  assert.equal((await item.status()).nextRunAt, '2026-09-30T15:00:00.000Z');
  await item.start();
  await item.stop();
  assert.equal((await item.status()).history.length, 0);
  t.mock.timers.setTime(new Date('2026-09-30T15:00:00Z').getTime());
  await item.start();
  await item.stop();
  assert.equal((await item.status()).lastGood.trigger, 'scheduled');
  assert.equal((await item.status()).history.length, 1);
  await item.start();
  await item.stop();
  assert.equal((await item.status()).history.length, 1);
});

test('restart runs the most recent missed schedule once and persists the attempted day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-29T18:00:00Z') });
  const { manager } = await fixture(t);
  const first = manager();
  await first.configure({ enabled: true, hour: 4, minute: 0, retention: 7 });
  await first.stop();
  t.mock.timers.setTime(new Date('2026-10-02T00:00:00Z').getTime());
  const second = manager();
  await second.start();
  await second.stop();
  assert.equal((await second.status()).history.length, 1);
  const third = manager();
  await third.start();
  await third.stop();
  assert.equal((await third.status()).history.length, 1);
});

test('manual execution accepts immediately, conflicts during work, and stop waits for verification', async (t) => {
  const { manager } = await fixture(t);
  const item = manager();
  const accepted = await item.runNow();
  assert.equal(accepted.running, true);
  await assert.rejects(item.runNow(), { status: 409 });
  await assert.rejects(item.configure({ enabled: true }), { status: 409 });
  await item.stop();
  const done = await item.status();
  assert.equal(done.running, false);
  assert.equal(done.lastGood.status, 'succeeded');
  assert.equal(done.lastGood.available, true);
  await verifyBackup(done.lastGood.path);
});

test('shutdown waits for a manual request that is still accepting its job', async (t) => {
  const { manager } = await fixture(t);
  const item = manager();
  const accepting = item.runNow();
  await item.stop();
  await accepting;
  const status = await item.status();
  assert.equal(status.running, false);
  assert.equal(status.lastGood?.status, 'succeeded');
});

test('shutdown cancels an initializing scheduler before a missed job or timer can start', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-09-29T18:00:00Z') });
  const { manager } = await fixture(t);
  const first = manager();
  await first.configure({ enabled: true, hour: 4, minute: 0, retention: 7 });
  await first.stop();
  t.mock.timers.setTime(new Date('2026-10-02T00:00:00Z').getTime());
  const fresh = manager();
  const startup = fresh.start();
  await fresh.stop();
  await startup;
  assert.equal((await fresh.status()).running, false);
  assert.equal((await fresh.status()).history.length, 0);
  t.mock.timers.tick(2 * 86_400_000);
  await Promise.resolve();
  assert.equal((await fresh.status()).running, false);
  assert.equal((await fresh.status()).history.length, 0);
  await fresh.start();
  await fresh.stop();
  assert.equal((await fresh.status()).history.length, 1);
});

test('restart marks an unfinished job failed and preserves the previous good snapshot', async (t) => {
  const { backupDir, manager } = await fixture(t);
  const item = manager();
  await item.runNow();
  await item.stop();
  const good = (await item.status()).lastGood;
  const path = join(backupDir, 'automatic-backups.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const id = randomUUID();
  saved.history.unshift({
    id,
    name: `automatic-20260930T000000-${id}`,
    trigger: 'scheduled',
    startedAt: '2026-09-30T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    error: null,
    available: false,
  });
  await writeFile(path, JSON.stringify(saved));
  const recovered = await manager().status();
  assert.equal(recovered.running, false);
  assert.equal(recovered.history[0].status, 'failed');
  assert.match(recovered.error, /재시작/);
  assert.equal(recovered.lastGood.id, good.id);
  await verifyBackup(good.path);
});

test('settings metadata symlinks are refused without changing the target', async (t) => {
  const { root, backupDir, manager } = await fixture(t);
  await manager().status();
  const target = join(root, 'protected.json');
  await writeFile(target, 'protected contents');
  await symlink(target, join(backupDir, 'automatic-backups.json'));
  await assert.rejects(manager().status());
  assert.equal(await readFile(target, 'utf8'), 'protected contents');
});

test('failed settings persistence leaves the previous active settings intact', async (t) => {
  const { root, backupDir, manager } = await fixture(t);
  const item = manager();
  await item.configure({ retention: 1 });
  const target = join(root, 'protected-settings');
  await writeFile(target, 'protected contents');
  await rm(join(backupDir, 'automatic-backups.json'));
  await symlink(target, join(backupDir, 'automatic-backups.json'));
  await assert.rejects(item.configure({ enabled: true, retention: 2 }));
  assert.equal((await item.status()).settings.enabled, false);
  assert.equal((await item.status()).settings.retention, 1);
  assert.equal(await readFile(target, 'utf8'), 'protected contents');
});

test('bounded failed history never loses the last good snapshot registration', async (t) => {
  const { dataDir, manager } = await fixture(t);
  const item = manager();
  await item.runNow();
  await item.stop();
  const good = (await item.status()).lastGood;
  await rm(join(dataDir, 'blobs', 'photo'));
  for (let index = 0; index < 102; index += 1) {
    await item.runNow();
    await item.stop();
  }
  const status = await item.status();
  assert.equal(status.lastGood?.id, good.id);
  assert.equal(status.history.length, 100);
  await verifyBackup(good.path);
});

test('failed snapshot verification preserves the last good snapshot and records a retryable error', async (t) => {
  const { dataDir, manager } = await fixture(t);
  const item = manager();
  await item.configure({ retention: 1 });
  await item.runNow();
  await item.stop();
  const good = (await item.status()).lastGood;
  await writeFile(join(dataDir, 'blobs', 'photo'), 'wrong bytes');
  await item.runNow();
  await item.stop();
  const failed = await item.status();
  assert.equal(failed.lastGood.id, good.id);
  assert.equal(failed.history[0].status, 'failed');
  assert.ok(failed.error);
  await verifyBackup(good.path);
  await writeFile(join(dataDir, 'blobs', 'photo'), 'photo');
  await item.runNow();
  await item.stop();
  assert.equal((await item.status()).error, null);
});

test('retention deletes only registered verified snapshots and preserves corrupt and arbitrary directories', async (t) => {
  const { backupDir, dataDir, manager } = await fixture(t);
  const item = manager();
  await item.configure({ retention: 1 });
  await item.runNow();
  await item.stop();
  const first = (await item.status()).lastGood;
  await writeFile(join(first.path, 'blobs', 'photo'), 'tampered');
  await createBackup(dataDir, join(backupDir, 'external-snapshot'));
  await mkdir(join(backupDir, 'automatic-unregistered'));
  await writeFile(join(backupDir, 'automatic-unregistered', 'keep'), 'keep');
  await item.runNow();
  await item.stop();
  const second = (await item.status()).lastGood;
  await item.runNow();
  await item.stop();
  await assert.rejects(readFile(join(second.path, 'manifest.json')), { code: 'ENOENT' });
  assert.equal(await readFile(join(first.path, 'blobs', 'photo'), 'utf8'), 'tampered');
  await verifyBackup(join(backupDir, 'external-snapshot'));
  assert.equal(await readFile(join(backupDir, 'automatic-unregistered', 'keep'), 'utf8'), 'keep');
});

test('unsafe live-data paths and symlink ancestors are rejected before making directories', async (t) => {
  const { root, dataDir } = await fixture(t);
  const inside = join(dataDir, 'never', 'backups');
  const linked = join(root, 'alias');
  await symlink(dataDir, linked);
  for (const backupDir of [inside, dataDir, join(linked, 'never'), linked]) {
    const manager = createAutomaticBackups({ dataDir, backupDir });
    await assert.rejects(manager.status());
  }
  assert.equal((await readdir(dataDir)).includes('never'), false);
});

test('retention cannot delete live data configured from a managed snapshot', async (t) => {
  const { backupDir, manager } = await fixture(t);
  const first = manager();
  await first.configure({ retention: 1 });
  await first.runNow();
  await first.stop();
  const source = (await first.status()).lastGood;
  const restored = createAutomaticBackups({ dataDir: source.path, backupDir });
  t.after(() => restored.stop());
  await assert.rejects(restored.runNow(), /백업 경로/);
  await restored.stop();
  await verifyBackup(source.path);
  assert.ok((await readFile(join(source.path, 'storage.sqlite'))).length > 0);
});

test('a backup directory containing the live data directory is rejected without writing settings', async (t) => {
  const { root, dataDir } = await fixture(t);
  const manager = createAutomaticBackups({ dataDir, backupDir: root });
  await assert.rejects(manager.status(), /백업 경로/);
  assert.equal((await readdir(root)).includes('automatic-backups.json'), false);
  assert.ok((await readFile(join(dataDir, 'storage.sqlite'))).length > 0);
});

test('the filesystem root is rejected as a backup directory before initializing it', async (t) => {
  const { dataDir } = await fixture(t);
  const backupDir = parse(dataDir).root;
  const manager = createAutomaticBackups({ dataDir, backupDir });
  await assert.rejects(manager.status(), /백업 경로/);
  assert.ok((await readFile(join(dataDir, 'storage.sqlite'))).length > 0);
});

test('a replaced managed snapshot symlink never participates in retention', async (t) => {
  const { backupDir, root, manager } = await fixture(t);
  const item = manager();
  await item.configure({ retention: 1 });
  await item.runNow();
  await item.stop();
  const old = (await item.status()).lastGood;
  const relocated = join(root, 'protected-snapshot');
  await rename(old.path, relocated);
  await symlink(relocated, old.path);
  await item.runNow();
  await item.stop();
  await verifyBackup(relocated);
  assert.ok((await readdir(backupDir)).includes(old.name));
});

test('private API returns accepted status, validates bounded JSON and reports conflicts', async (t) => {
  const { manager } = await fixture(t);
  const item = manager();
  const server = createServer(async (req, res) => {
    if (!(await handleBackupRoute(req, res, new URL(req.url, 'http://localhost'), item))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = await fetch(`${base}/api/backups`);
  assert.equal(get.status, 200);
  assert.equal((await get.json()).settings.enabled, false);
  for (const body of [
    '{"retention":0}',
    '{bad json',
    JSON.stringify({ enabled: true, extra: 'x'.repeat(10_000) }),
  ]) {
    assert.equal(
      (
        await fetch(`${base}/api/backups`, {
          method: 'PUT',
          body,
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
      400,
    );
  }
  const simultaneous = await Promise.all([
    fetch(`${base}/api/backups/run`, { method: 'POST' }),
    fetch(`${base}/api/backups/run`, { method: 'POST' }),
  ]);
  assert.deepEqual(simultaneous.map((response) => response.status).sort(), [202, 409]);
  const accepted = simultaneous.find((response) => response.status === 202);
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).running, true);
  await item.stop();
  assert.equal((await fetch(`${base}/api/backups/run`, { method: 'GET' })).status, 405);
  assert.equal((await fetch(`${base}/api/unrelated`)).status, 404);
});
