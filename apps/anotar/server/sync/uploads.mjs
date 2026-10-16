import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { syncDatabase } from './store.mjs';
import { SyncError } from './operations.mjs';
import { pageTransaction } from '../pageConnections.mjs';
const uuid = (value) => typeof value === 'string' && /^[a-f\d-]{36}$/i.test(value);
export async function stageUpload(store, { uploadId, operationId, metadata, stream, blobDir }) {
  if (
    !uuid(uploadId) ||
    !uuid(operationId) ||
    !metadata ||
    !/^[a-f\d]{64}$/.test(metadata.hash) ||
    typeof metadata.name !== 'string' ||
    typeof metadata.mime !== 'string'
  )
    throw new SyncError(422, 'invalid_upload', '첨부 정보를 확인해 주세요.');
  const name =
    basename(metadata.name.replaceAll('\\', '/'))
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 180) || 'attachment';
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(metadata.mime)
    ? metadata.mime
    : 'application/octet-stream';
  const db = syncDatabase(store),
    previous = db.prepare('SELECT * FROM sync_uploads WHERE upload_id=?').get(uploadId);
  if (
    previous &&
    (previous.operation_id !== operationId ||
      previous.content_hash !== metadata.hash ||
      previous.name !== name ||
      previous.mime !== mime)
  )
    throw new SyncError(409, 'upload_mismatch', '같은 첨부 식별자에 다른 파일이 담겨 있어요.');
  await mkdir(blobDir, { recursive: true });
  const storageKey = previous?.storage_key ?? randomUUID(),
    temporary = join(blobDir, randomUUID() + '.stage');
  let file,
    resolvedKey = storageKey;
  try {
    file = await open(temporary, 'wx');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 25 * 1024 * 1024)
        throw new SyncError(413, 'file_too_large', '파일 하나는 25MB까지 저장할 수 있어요.');
      hash.update(chunk);
      await file.write(chunk);
    }
    await file.close();
    file = null;
    if (hash.digest('hex') !== metadata.hash)
      throw new SyncError(
        422,
        'hash_mismatch',
        '첨부 바이트가 일치하지 않아요. 다시 전송해 주세요.',
      );
    if (previous && previous.size !== size)
      throw new SyncError(409, 'upload_mismatch', '같은 첨부 식별자의 크기가 달라요.');
    if (!previous) {
      const totals = db
        .prepare(
          'SELECT count(*) AS count,coalesce(sum(size),0) AS size FROM sync_uploads WHERE operation_id=?',
        )
        .get(operationId);
      if (totals.count >= 8 || totals.size + size > 100 * 1024 * 1024)
        throw new SyncError(413, 'upload_limits', '첨부는 8개·전체 100MB까지 저장할 수 있어요.');
      // Recheck identity and aggregate limits after streaming/rename: requests can interleave while awaiting filesystem work.
      await rename(temporary, join(blobDir, storageKey));
      try {
        pageTransaction(db, () => {
          const raced = db.prepare('SELECT * FROM sync_uploads WHERE upload_id=?').get(uploadId);
          if (raced) {
            if (
              raced.operation_id !== operationId ||
              raced.content_hash !== metadata.hash ||
              raced.name !== name ||
              raced.mime !== mime ||
              raced.size !== size
            )
              throw new SyncError(
                409,
                'upload_mismatch',
                '같은 첨부 식별자에 다른 파일이 담겨 있어요.',
              );
            resolvedKey = raced.storage_key;
            return;
          }
          const current = db
            .prepare(
              'SELECT count(*) AS count,coalesce(sum(size),0) AS size FROM sync_uploads WHERE operation_id=?',
            )
            .get(operationId);
          if (current.count >= 8 || current.size + size > 100 * 1024 * 1024)
            throw new SyncError(413, 'upload_limits', '첨부 한도를 넘었어요.');
          db.prepare(
            'INSERT INTO sync_uploads(upload_id,operation_id,content_hash,size,name,mime,storage_key) VALUES(?,?,?,?,?,?,?)',
          ).run(uploadId, operationId, metadata.hash, size, name, mime, storageKey);
        });
      } catch (error) {
        await unlink(join(blobDir, storageKey)).catch(() => {});
        throw error;
      }
    }
    if (resolvedKey !== storageKey) await unlink(join(blobDir, storageKey)).catch(() => {});
    return {
      uploadId,
      operationId,
      hash: metadata.hash,
      size,
      name,
      mime,
      storageKey: resolvedKey,
    };
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
