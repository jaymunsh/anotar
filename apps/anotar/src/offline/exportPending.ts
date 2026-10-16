import { transaction, idbRequest } from '../sync/db';
import {
  writeRecord,
  type Entity,
  type Pending,
  type LocalBlob,
  type Value,
} from '../sync/repository';
import { attachmentReferences } from './references';
import { storedZip } from './zip';
import { flushLocalEdits } from './update';
export const pendingSignature = (entities: Entity[], outbox: Pending[]) =>
  JSON.stringify({
    entities: entities
      .filter((e) => e.dirty)
      .map((e) => [e.key, e.localRevision])
      .sort(),
    operations: outbox.map((p) => [p.key, p.state, p.attempt]).sort(),
  });
export async function exportPendingWorkspace(workspaceId: string) {
  await flushLocalEdits();
  const snapshot = await transaction(
    ['entities', 'outbox', 'blobs', 'conflicts', 'meta'],
    'readonly',
    async (tx) => {
      const get = <T>(name: 'entities' | 'outbox' | 'blobs' | 'conflicts' | 'meta') =>
        idbRequest<T[]>(tx.objectStore(name).index('workspace').getAll(workspaceId));
      const [all, outbox, blobs, conflicts, meta] = await Promise.all([
        get<Entity>('entities'),
        get<Pending>('outbox'),
        get<LocalBlob>('blobs'),
        get<Value>('conflicts'),
        get<Value>('meta'),
      ]);
      const entities = all.filter(
        (e) =>
          e.dirty ||
          outbox.some((p) => p.operation.entityId === e.id) ||
          conflicts.some((c) => c.entityId === e.id && !c.resolvedAt),
      );
      return { entities, outbox, blobs, conflicts, meta };
    },
  );
  const archivalMeta = snapshot.meta.filter((record) =>
    /"(legacy|legacyJournalCollision|recoveryArchive|sync|rejectedWorkflow|localEditConflict|rejectedWrite)"/.test(
      String(record.key),
    ),
  );
  const {
    ids: refs,
    uploadIds: uploads,
    requiredIds,
  } = attachmentReferences(snapshot.entities, snapshot.outbox, snapshot.conflicts, archivalMeta);
  const files = snapshot.blobs.filter((b) => refs.has(b.id) || uploads.has(b.uploadId ?? ''));
  const missing = [...refs].filter((id) => !snapshot.blobs.some((b) => b.id === id));
  if (
    missing.some((id) => requiredIds.has(id)) ||
    [...uploads].some((id) => !snapshot.blobs.some((b) => b.uploadId === id))
  )
    throw Error(
      '필요한 첨부 일부가 기기에 없어요. 자료는 유지했어요. 서버 연결 후 첨부를 보관하고 다시 내보내 주세요.',
    );
  const entries: { name: string; blob: Blob }[] = [],
    fileDescriptors: Value[] = [],
    unique = new Map<string, string>();
  async function addFile(
    file: Pick<LocalBlob, 'blob' | 'name' | 'mime'>,
    id: string,
    expectedHash?: string,
    uploadId?: string,
  ) {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await file.blob.arrayBuffer())),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    if (expectedHash && hash !== expectedHash)
      throw Error('첨부의 원본 바이트를 확인하지 못했어요. 자료를 유지했어요.');
    const path = unique.get(hash) ?? 'blobs/' + hash;
    if (!unique.has(hash)) {
      entries.push({ name: path, blob: file.blob });
      unique.set(hash, path);
    }
    fileDescriptors.push({
      id,
      name: file.name,
      mime: file.mime,
      size: file.blob.size,
      hash,
      path,
      ...(uploadId ? { uploadId } : {}),
    });
    return { id, path, hash, name: file.name, mime: file.mime, size: file.blob.size };
  }
  for (const file of files) await addFile(file, file.id, file.hash, file.uploadId);
  const meta = [];
  for (const record of snapshot.meta) {
    if (
      !String(record.key).includes('"legacy"') &&
      !String(record.key).includes('"legacyJournalCollision"') &&
      !String(record.key).includes('"recoveryArchive"') &&
      !String(record.key).includes('"sync"') &&
      !String(record.key).includes('"rejectedWorkflow"') &&
      !String(record.key).includes('"localEditConflict"') &&
      !String(record.key).includes('"rejectedWrite"')
    )
      continue;
    const value = { ...record };
    if (Array.isArray(value.files)) {
      const legacyFiles = value.files as File[];
      value.files = [];
      for (let i = 0; i < legacyFiles.length; i++)
        (value.files as Value[]).push(
          await addFile(
            { blob: legacyFiles[i], name: legacyFiles[i].name, mime: legacyFiles[i].type },
            'legacy:' + record.key + ':' + i,
          ),
        );
    }
    meta.push(value);
  }
  const manifest = {
    schemaVersion: 1,
    format: 'leneu-pending-workspace',
    workspaceId,
    createdAt: new Date().toISOString(),
    entities: snapshot.entities,
    outbox: snapshot.outbox,
    conflicts: snapshot.conflicts,
    meta,
    files: fileDescriptors,
    complete: missing.length === 0,
    missingAssets: missing,
  };
  entries.unshift({
    name: 'manifest.json',
    blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  });
  const blob = await storedZip(entries);
  await writeRecord('meta', workspaceId, ['lastPendingExport'], {
    signature: pendingSignature(snapshot.entities, snapshot.outbox),
    createdAt: manifest.createdAt,
  });
  return { blob, manifest, filename: 'leneu-pending-' + manifest.createdAt.slice(0, 10) + '.zip' };
}
export async function canResetLocalWorkspace(workspaceId: string) {
  return transaction(['entities', 'outbox', 'conflicts'], 'readonly', async (tx) => {
    const [entities, outbox, conflicts] = await Promise.all(
      ['entities', 'outbox', 'conflicts'].map((name) =>
        idbRequest<any[]>(tx.objectStore(name).index('workspace').getAll(workspaceId)),
      ),
    );
    return (
      !entities.some((e) => e.dirty) && !outbox.length && !conflicts.some((c) => !c.resolvedAt)
    );
  });
}
