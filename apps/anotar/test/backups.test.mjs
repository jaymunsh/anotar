import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../server/store.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../server/backups.mjs';

const run = promisify(execFile);

async function fixture(t, { missing = false, linked = false, key = 'photo-123' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'leneu-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'live');
  const blobs = join(data, 'blobs');
  await mkdir(blobs, { recursive: true });
  if (linked) {
    const outside = join(root, 'outside-photo');
    await writeFile(outside, 'image bytes');
    await symlink(outside, join(blobs, key));
  } else if (!missing) {
    await writeFile(join(blobs, key), 'image bytes');
  }
  const store = openStore(data);
  t.after(() => store.close());
  const capture = store.createCapture({
    kind: 'image',
    text: '교토 스크린샷',
    files: [{ key, name: 'photo.png', mime: 'image/png', size: 11 }],
  });
  const page = store.createPage({ title: '교토 일정' });
  return { root, data, blobs, key, store, capture, page };
}

test('an open WAL store and its referenced blob restore together', async (t) => {
  const { root, data, capture, page, store } = await fixture(t);
  const destination = join(root, 'snapshot');
  const manifest = await createBackup(data, destination);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.files.length, 1);
  assert.equal((await readFile(join(destination, 'blobs', 'photo-123'))).toString(), 'image bytes');
  await verifyBackup(destination);
  store.updateCapture({ id: capture.id, text: '백업 이후 수정', expectedVersion: capture.version });

  const restoredDir = join(root, 'restored');
  await restoreBackup(destination, restoredDir);
  const restored = openStore(restoredDir);
  t.after(() => restored.close());
  assert.equal(restored.getCapture(capture.id)?.text, '교토 스크린샷');
  assert.equal(restored.getPage(page.id)?.title, '교토 일정');
  assert.equal((await readFile(join(restoredDir, 'blobs', 'photo-123'))).toString(), 'image bytes');
});

test('generated map image keys with extensions survive backup and restore', async (t) => {
  const key = '584fc464-d791-48d1-a068-0862cb50c9c4.png';
  const { root, data, capture } = await fixture(t, { key });
  const snapshot = join(root, 'map-snapshot');
  const manifest = await createBackup(data, snapshot);
  assert.equal(manifest.files[0].key, key);
  await verifyBackup(snapshot);
  const restoredDir = join(root, 'map-restored');
  await restoreBackup(snapshot, restoredDir);
  assert.equal((await readFile(join(restoredDir, 'blobs', key))).toString(), 'image bytes');
  const restored = openStore(restoredDir);
  t.after(() => restored.close());
  assert.equal(restored.getCapture(capture.id).files[0].key, key);
});

test('allowing file extensions still refuses traversal and hidden blob keys', async (t) => {
  const unsafe = [
    '../outside.png',
    'folder/image.png',
    'folder\\image.png',
    '.hidden',
    'photo..png',
    'photo.png\0',
    'a'.repeat(256),
  ];
  for (const [index, key] of unsafe.entries()) {
    const { root, data, store } = await fixture(t);
    store.createCapture({
      kind: 'file',
      text: 'invalid fixture',
      files: [{ key, name: 'file.png', mime: 'image/png', size: 1 }],
    });
    await assert.rejects(
      createBackup(data, join(root, 'unsafe-' + index)),
      /안전하지 않은 첨부 저장 키/,
    );
  }
});

test('missing or linked source blobs never publish a complete backup', async (t) => {
  for (const mode of ['missing', 'linked']) {
    const { root, data } = await fixture(t, { [mode]: true });
    const destination = join(root, 'snapshot');
    await assert.rejects(createBackup(data, destination));
    await assert.rejects(readFile(join(destination, 'manifest.json')));
  }
});

test('verification rejects changed blobs and restore never overwrites a target', async (t) => {
  const { root, data } = await fixture(t);
  const destination = join(root, 'snapshot');
  await createBackup(data, destination);
  const existing = join(root, 'existing');
  await mkdir(existing);
  await writeFile(join(existing, 'keep'), 'keep me');
  await assert.rejects(restoreBackup(destination, existing));
  assert.equal((await readFile(join(existing, 'keep'))).toString(), 'keep me');

  await writeFile(join(destination, 'blobs', 'photo-123'), 'changed');
  await assert.rejects(verifyBackup(destination));
  await assert.rejects(restoreBackup(destination, join(root, 'should-not-exist')));
});

test('verification rejects a changed database and unsafe stored keys', async (t) => {
  const { root, data, store } = await fixture(t);
  const destination = join(root, 'snapshot');
  await createBackup(data, destination);
  await writeFile(join(destination, 'storage.sqlite'), 'broken database');
  await assert.rejects(verifyBackup(destination));

  store.createCapture({
    kind: 'file',
    text: '위험한 키',
    files: [{ key: '../outside', name: 'bad.txt', mime: 'text/plain', size: 1 }],
  });
  await assert.rejects(createBackup(data, join(root, 'unsafe')));
});

test('backup paths inside live data and existing destinations are rejected', async (t) => {
  const { root, data } = await fixture(t);
  await assert.rejects(createBackup(data, join(data, 'backup')));
  const destination = join(root, 'snapshot');
  await createBackup(data, destination);
  await assert.rejects(createBackup(data, destination));
  await verifyBackup(destination);
  const parentAlias = join(root, 'source-alias');
  await symlink(data, parentAlias);
  await assert.rejects(createBackup(data, join(parentAlias, 'backup')));
  const backupAlias = join(root, 'backup-alias');
  await symlink(destination, backupAlias);
  await assert.rejects(restoreBackup(destination, join(backupAlias, 'restore')));
});

test('CLI create, verify and restore operate on isolated data directories', async (t) => {
  const { root, data, capture } = await fixture(t);
  const snapshot = join(root, 'cli-snapshot');
  const restoredDir = join(root, 'cli-restored');
  const script = join(process.cwd(), 'scripts', 'backup-data.mjs');
  assert.match(
    (await run(process.execPath, [script, 'create', data, snapshot])).stdout,
    /create 완료/,
  );
  assert.match((await run(process.execPath, [script, 'verify', snapshot])).stdout, /verify 완료/);
  assert.match(
    (await run(process.execPath, [script, 'restore', snapshot, restoredDir])).stdout,
    /restore 완료/,
  );
  const restored = openStore(restoredDir);
  t.after(() => restored.close());
  assert.equal(restored.getCapture(capture.id)?.text, '교토 스크린샷');
});
