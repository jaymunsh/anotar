import { createHash } from 'node:crypto';
import { syncDatabase, getSyncSession } from './store.mjs';
import { readSyncEntity } from './feed.mjs';
import { pageTransaction } from '../pageConnections.mjs';
import { journalId, validateJournalDay } from '../../shared/journal.mjs';
export const SYNC_CAPABILITIES = [
  'journal.create',
  'journal.update',
  'capture.create',
  'capture.update',
  'task.create',
  'task.update',
  'page.create',
  'page.update',
  'capture.organize',
  'ai.submit',
];
export class SyncError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableJSON(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const operationHash = (op) => createHash('sha256').update(stableJSON(op)).digest('hex');
function validateEnvelope(op, session) {
  if (!op || typeof op !== 'object' || Array.isArray(op))
    throw new SyncError(422, 'invalid_operation', '올바른 작업을 보내 주세요.');
  if (op.protocolVersion !== 1)
    throw new SyncError(426, 'protocol_mismatch', '앱을 업데이트해 주세요.');
  for (const key of ['workspaceId', 'epoch', 'operationId', 'deviceId', 'entityId'])
    if (!uuid(op[key])) throw new SyncError(422, 'invalid_id', '작업 식별자가 올바르지 않아요.');
  if (op.workspaceId !== session.workspaceId)
    throw new SyncError(409, 'workspace_mismatch', '다른 작업 공간이에요.');
  if (op.epoch !== session.epoch)
    throw new SyncError(409, 'epoch_mismatch', '서버가 복원됐어요. 기기 자료를 확인해 주세요.');
  if (!SYNC_CAPABILITIES.includes(op.kind))
    throw new SyncError(422, 'unsupported_operation', '아직 지원하지 않는 작업이에요.');
  if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload))
    throw new SyncError(422, 'invalid_payload', '작업 내용이 올바르지 않아요.');
  if (op.baseOperationId !== undefined && !uuid(op.baseOperationId))
    throw new SyncError(422, 'invalid_dependency', '앞선 저장 작업을 확인해 주세요.');
  const create = op.kind.endsWith('.create');
  if (
    create ? op.baseVersion !== null : !Number.isSafeInteger(op.baseVersion) || op.baseVersion < 1
  )
    throw new SyncError(422, 'invalid_version', '자료 버전이 올바르지 않아요.');
  if (Buffer.byteLength(JSON.stringify(op)) > 1100 * 1024)
    throw new SyncError(413, 'too_large', '작업 내용이 너무 커요.');
}
function capturePayload(p, create = false) {
  if (typeof p.text !== 'string' || p.text.length > 10000)
    throw new SyncError(422, 'invalid_text', '메모는 10,000자까지 입력할 수 있어요.');
  if (create) {
    if (
      !['note', 'link', 'image', 'file'].includes(p.kind) ||
      p.aiRequest !== null ||
      !Array.isArray(p.uploadIds)
    )
      throw new SyncError(422, 'invalid_capture', '메모 종류와 첨부를 확인해 주세요.');
    if (p.uploadIds.length > 8 || new Set(p.uploadIds).size !== p.uploadIds.length)
      throw new SyncError(413, 'upload_limits', '첨부는 8개까지 저장할 수 있어요.');
    if (['image', 'file'].includes(p.kind) && !p.uploadIds.length)
      throw new SyncError(422, 'missing_attachment', '첨부 파일을 선택해 주세요.');
    if (!p.text.trim() && p.kind !== 'link' && !p.uploadIds.length)
      throw new SyncError(422, 'empty_capture', '내용을 입력해 주세요.');
    if (p.kind === 'link') {
      try {
        if (!/^https?:$/.test(new URL(p.url).protocol)) throw new Error();
      } catch {
        throw new SyncError(422, 'invalid_url', 'http 또는 https 링크를 입력해 주세요.');
      }
    } else if (p.url !== null)
      throw new SyncError(422, 'invalid_url', '이 메모에는 링크를 지정할 수 없어요.');
  }
}
export function applySyncOperation(store, op) {
  const db = syncDatabase(store);
  validateEnvelope(op, getSyncSession(db));
  const hash = operationHash(op);
  return pageTransaction(db, () => {
    const receipt = db
      .prepare(
        'SELECT request_hash,result_json FROM sync_receipts WHERE workspace_id=? AND operation_id=?',
      )
      .get(op.workspaceId, op.operationId);
    if (receipt) {
      if (receipt.request_hash !== hash)
        throw new SyncError(409, 'payload_mismatch', '같은 작업에 다른 내용이 담겨 있어요.');
      return { ...JSON.parse(receipt.result_json), replayed: true };
    }
    const dependencyVersion = (id, entityId) => {
      if (!uuid(id))
        throw new SyncError(422, 'invalid_dependency', '앞선 저장 작업을 확인해 주세요.');
      const receipt = db
        .prepare('SELECT result_json FROM sync_receipts WHERE workspace_id=? AND operation_id=?')
        .get(op.workspaceId, id);
      if (!receipt)
        throw new SyncError(409, 'dependency_missing', '앞선 저장 작업이 아직 반영되지 않았어요.');
      const result = JSON.parse(receipt.result_json);
      if (result.item?.id !== entityId || !Number.isSafeInteger(result.version))
        throw new SyncError(422, 'invalid_dependency', '다른 자료의 저장 작업이에요.');
      return result.version;
    };
    if (op.kind === 'ai.submit' && !['capture', 'page'].includes(op.payload.sourceKind))
      throw new SyncError(422, 'invalid_source', 'AI 원본을 확인해 주세요.');
    const kind = op.kind === 'ai.submit' ? op.payload.sourceKind : op.kind.split('.')[0],
      entity = readSyncEntity(store, kind, op.entityId),
      create = op.kind.endsWith('.create'),
      expectedVersion = op.payload.sourceOperationId
        ? dependencyVersion(op.payload.sourceOperationId, op.entityId)
        : op.baseOperationId
          ? dependencyVersion(op.baseOperationId, op.entityId)
          : op.baseVersion;
    if (create && !entity.missing)
      throw new SyncError(409, 'entity_exists', '같은 식별자의 자료가 이미 있어요.', {
        current: entity.item,
        tombstone: entity.tombstone,
      });
    if (!create && (entity.tombstone || entity.version !== expectedVersion))
      throw new SyncError(409, 'version_conflict', '서버와 기기 양쪽 내용을 확인해 주세요.', {
        current: entity.item,
        tombstone: entity.tombstone,
      });
    const p = op.payload;
    if (op.kind === 'capture.organize' || op.kind === 'ai.submit') {
      if (!p.sourceSnapshot || typeof p.sourceSnapshot !== 'object')
        throw new SyncError(422, 'invalid_snapshot', '요청 당시 원본을 확인해 주세요.');
      const proof =
        kind === 'capture'
          ? { text: entity.item.text, url: entity.item.url }
          : { title: entity.item.title, document: entity.item.document };
      if (stableJSON(proof) !== stableJSON(p.sourceSnapshot))
        throw new SyncError(
          409,
          'version_conflict',
          '요청 당시 원본과 현재 내용이 달라요. 다시 확인해 주세요.',
          { current: entity.item, tombstone: false },
        );
      let output;
      try {
        if (op.kind === 'ai.submit') {
          if (!['capture', 'page'].includes(kind))
            throw new SyncError(422, 'invalid_source', 'AI 원본을 확인해 주세요.');
          output = {
            item:
              kind === 'capture'
                ? store.enqueueAiJob({
                    captureId: op.entityId,
                    requestId: op.operationId,
                    expectedVersion,
                    selection: p.request,
                    retryOf: p.retryOf ?? null,
                  })
                : store.enqueuePageAiJob({
                    pageId: op.entityId,
                    requestId: op.operationId,
                    expectedVersion,
                    aiRequest: p.request,
                    blockIds: p.blockIds ?? [],
                    retryOf: p.retryOf ?? null,
                  }),
          };
        } else {
          const target = p.target;
          if (!target || typeof target !== 'object')
            throw new SyncError(422, 'invalid_target', '담을 페이지를 확인해 주세요.');
          if (target.pageId) {
            const page = store.getPage(target.pageId),
              targetVersion = target.operationId
                ? dependencyVersion(target.operationId, target.pageId)
                : target.expectedVersion;
            if (!page || page.version !== targetVersion)
              throw new SyncError(
                409,
                'target_conflict',
                '담을 페이지가 바뀌었어요. 다시 선택해 주세요.',
                { current: entity.item, tombstone: false },
              );
          }
          const input = {
            operationId: op.operationId,
            captureId: op.entityId,
            disposition: 'organize',
            copyContent: p.copyContent,
            assetIds: p.assetIds,
            ...(p.aiResult ? { aiResult: p.aiResult } : {}),
          };
          if (p.sourceOperationId && Array.isArray(p.localAssetIds)) {
            const saved = JSON.parse(
              db
                .prepare(
                  'SELECT result_json FROM sync_receipts WHERE workspace_id=? AND operation_id=?',
                )
                .get(op.workspaceId, p.sourceOperationId).result_json,
            ).item;
            input.assetIds = p.assetIds.map((id) => {
              const index = p.localAssetIds.indexOf(id);
              return index >= 0 ? (saved.files?.[index]?.id ?? id) : id;
            });
          }
          output = target.pageId
            ? store.importCaptureIntoPage({ pageId: target.pageId, ...input })
            : store.createPageWithCapture({
                title: target.title,
                icon: target.icon ?? '',
                parentId: target.parentId ?? null,
                syncId: target.newPageId,
                captureImport: input,
              });
        }
      } catch (error) {
        if (error instanceof SyncError) throw error;
        const name = error.constructor.name;
        if (name.includes('Validation')) throw new SyncError(422, 'validation', error.message);
        if (name.includes('NotFound')) throw new SyncError(404, 'not_found', error.message);
        if (name.includes('Conflict'))
          throw new SyncError(409, 'version_conflict', error.message, {
            current: entity.item,
            tombstone: false,
          });
        throw error;
      }
      const current = readSyncEntity(store, kind, op.entityId).item;
      const result = {
        status: 'applied',
        operationId: op.operationId,
        replayed: false,
        item: current,
        version: current.version,
        workflow: { kind: op.kind, ...output },
      };
      db.prepare(
        'INSERT INTO sync_receipts(workspace_id,operation_id,device_id,request_hash,result_json) VALUES(?,?,?,?,?)',
      ).run(op.workspaceId, op.operationId, op.deviceId, hash, JSON.stringify(result));
      return result;
    }
    if (
      op.kind.startsWith('page.') &&
      (typeof p.title !== 'string' ||
        typeof p.icon !== 'string' ||
        !p.document ||
        (create && !(p.parentId === null || uuid(p.parentId))))
    )
      throw new SyncError(422, 'invalid_page', '페이지 제목·본문·상위 페이지를 확인해 주세요.');
    if (
      op.kind.startsWith('task.') &&
      (typeof p.title !== 'string' ||
        !(p.dueDate === null || typeof p.dueDate === 'string') ||
        !(p.pageId === undefined || p.pageId === null || uuid(p.pageId)) ||
        (op.kind === 'task.update' && !['todo', 'doing', 'done'].includes(p.stage)))
    )
      throw new SyncError(422, 'invalid_task', '할 일 내용·기한·상태를 확인해 주세요.');
    if (
      p.clientCreatedAt !== undefined &&
      (!create ||
        typeof p.clientCreatedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT/.test(p.clientCreatedAt) ||
        !Number.isFinite(Date.parse(p.clientCreatedAt)))
    )
      throw new SyncError(422, 'invalid_timestamp', '작성 시각이 올바르지 않아요.');
    let item;
    try {
      switch (op.kind) {
        case 'journal.create':
        case 'journal.update':
          if (journalId(op.workspaceId,p.date) !== op.entityId)
            throw new SyncError(422,'invalid_journal_id','일지 날짜와 식별자를 확인해 주세요.');
          validateJournalDay(p.day);
          item = create
            ? store.createJournal({ id:op.entityId,workspaceId:op.workspaceId,date:p.date,day:p.day })
            : store.updateJournal({ id:op.entityId,workspaceId:op.workspaceId,date:p.date,day:p.day,expectedVersion });
          break;
        case 'page.create':
          item = store.createPage({
            title: p.title,
            icon: p.icon,
            parentId: p.parentId,
            document: p.document,
            syncId: op.entityId,
          });
          break;
        case 'page.update':
          item = store.updatePage({
            id: op.entityId,
            title: p.title,
            icon: p.icon,
            document: p.document,
            expectedVersion,
          });
          break;
        case 'capture.create': {
          capturePayload(p, true);
          const uploads = p.uploadIds.map((id) =>
            db
              .prepare(
                "SELECT * FROM sync_uploads WHERE upload_id=? AND operation_id=? AND state='staged'",
              )
              .get(id, op.operationId),
          );
          if (uploads.some((x) => !x))
            throw new SyncError(422, 'upload_missing', '첨부를 다시 준비해 주세요.');
          if (uploads.reduce((total, x) => total + x.size, 0) > 100 * 1024 * 1024)
            throw new SyncError(413, 'upload_limits', '첨부는 전체 100MB까지 저장할 수 있어요.');
          item = store.createCapture({
            kind: p.kind,
            text: p.text,
            url: p.url,
            syncId: op.entityId,
            files: uploads.map((x) => ({
              key: x.storage_key,
              name: x.name,
              mime: x.mime,
              size: x.size,
            })),
          });
          for (const id of p.uploadIds)
            db.prepare("UPDATE sync_uploads SET state='consumed' WHERE upload_id=?").run(id);
          break;
        }
        case 'capture.update':
          capturePayload(p);
          item = store.updateCapture({
            id: op.entityId,
            text: p.text,
            url: p.url,
            expectedVersion,
          });
          break;
        case 'task.create':
          item = store.createTask({ title: p.title, dueDate: p.dueDate, pageId: p.pageId, syncId: op.entityId });
          break;
        case 'task.update':
          item = store.updateTask({
            id: op.entityId,
            title: p.title,
            dueDate: p.dueDate,
            stage: p.stage,
            pageId: p.pageId,
            expectedVersion,
          });
          break;
      }
    } catch (error) {
      if (error.name.includes('Validation') || error.constructor.name.includes('Validation'))
        throw new SyncError(422, 'validation', error.message);
      throw error;
    }
    if (create && p.clientCreatedAt)
      db.prepare(
        `UPDATE ${kind === 'capture' ? 'captures' : kind === 'page' ? 'pages' : kind === 'journal' ? 'journal_days' : 'tasks'} SET client_created_at=? WHERE id=?`,
      ).run(p.clientCreatedAt, op.entityId);
    item = readSyncEntity(store, kind, op.entityId).item;
    const result = {
      status: 'applied',
      operationId: op.operationId,
      replayed: false,
      item,
      version: item.version,
    };
    db.prepare(
      'INSERT INTO sync_receipts(workspace_id,operation_id,device_id,request_hash,result_json) VALUES(?,?,?,?,?)',
    ).run(op.workspaceId, op.operationId, op.deviceId, hash, JSON.stringify(result));
    return result;
  });
}
