import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, operation } from './fixtures/sync.mjs';
import { stageUpload } from '../server/sync/uploads.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';
import { syncDatabase } from '../server/sync/store.mjs';
const sha = (value) => createHash('sha256').update(value).digest('hex');
test('fixed upload identity and exact bytes attach once; receipt replay precedes stage lookup', async (t) => {
  const store = await fixture(t),
    dir = await mkdtemp(join(tmpdir(), 'leneu-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const op = operation(store);
  const bytes = Buffer.from('exact 한글 bytes'),
    uploadId = randomUUID(),
    metadata = { name: '../../photo.txt', mime: 'text/plain', hash: sha(bytes) };
  const args = { uploadId, operationId: op.operationId, metadata, blobDir: dir };
  const saved = await stageUpload(store, { ...args, stream: Readable.from([bytes]) });
  assert.deepEqual(await readFile(join(dir, saved.storageKey)), bytes);
  assert.deepEqual(await stageUpload(store, { ...args, stream: Readable.from([bytes]) }), saved);
  await assert.rejects(
    stageUpload(store, {
      ...args,
      metadata: { ...metadata, hash: sha('other') },
      stream: Readable.from(['other']),
    }),
    (e) => e.status === 409,
  );
  op.payload.uploadIds = [uploadId];
  const result = applySyncOperation(store, op);
  assert.equal(result.item.files.length, 1);
  assert.equal(result.item.files[0].name, 'photo.txt');
  syncDatabase(store).prepare('DELETE FROM sync_uploads WHERE upload_id=?').run(uploadId);
  assert.equal(applySyncOperation(store, op).replayed, true);
});
test('hash, per-file size, aggregate count/size, foreign upload owner and invalid memo preserve source', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store),
    dir = await mkdtemp(join(tmpdir(), 'leneu-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const op = operation(store),
    uploadId = randomUUID();
  await assert.rejects(
    stageUpload(store, {
      uploadId,
      operationId: op.operationId,
      metadata: { name: 'x', mime: 'text/plain', hash: sha('wrong') },
      stream: Readable.from(['actual']),
      blobDir: dir,
    }),
    (e) => e.status === 422,
  );
  await assert.rejects(
    stageUpload(store, {
      uploadId,
      operationId: op.operationId,
      metadata: { name: 'x', mime: 'text/plain', hash: sha('x') },
      stream: Readable.from([Buffer.alloc(25 * 1024 * 1024 + 1)]),
      blobDir: dir,
    }),
    (e) => e.status === 413,
  );
  for (let i = 0; i < 8; i++)
    db.prepare(
      'INSERT INTO sync_uploads(upload_id,operation_id,content_hash,size,name,mime,storage_key) VALUES(?,?,?,?,?,?,?)',
    ).run(randomUUID(), op.operationId, sha('x'), 1, 'x', 'text/plain', `fixture${i}`);
  await assert.rejects(
    stageUpload(store, {
      uploadId,
      operationId: op.operationId,
      metadata: { name: 'x', mime: 'text/plain', hash: sha('x') },
      stream: Readable.from(['x']),
      blobDir: dir,
    }),
    (e) => e.status === 413,
  );
  db.prepare('UPDATE sync_uploads SET size=?').run(25 * 1024 * 1024);
  db.prepare('DELETE FROM sync_uploads WHERE rowid>4').run();
  await assert.rejects(
    stageUpload(store, {
      uploadId,
      operationId: op.operationId,
      metadata: { name: 'x', mime: 'text/plain', hash: sha('x') },
      stream: Readable.from(['x']),
      blobDir: dir,
    }),
    (e) => e.status === 413,
  );
  op.payload.uploadIds = Array(9).fill(randomUUID());
  assert.throws(
    () => applySyncOperation(store, op),
    (e) => e.status === 413,
  );
  op.payload.uploadIds = [db.prepare('SELECT upload_id AS id FROM sync_uploads LIMIT 1').get().id];
  const other = { ...op, operationId: randomUUID() };
  assert.throws(
    () => applySyncOperation(store, other),
    (e) => e.status === 422,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 0);
});
test('simultaneous identical stage requests converge to one stable file record', async (t) => {
  const store = await fixture(t),
    dir = await mkdtemp(join(tmpdir(), 'leneu-concurrent-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const op = operation(store),
    bytes = Buffer.from('same'),
    args = {
      uploadId: randomUUID(),
      operationId: op.operationId,
      metadata: { name: 'a.txt', mime: 'text/plain', hash: sha(bytes) },
      blobDir: dir,
    };
  const results = await Promise.all([
    stageUpload(store, { ...args, stream: Readable.from([bytes]) }),
    stageUpload(store, { ...args, stream: Readable.from([bytes]) }),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(syncDatabase(store).prepare('SELECT count(*) AS n FROM sync_uploads').get().n, 1);
});
