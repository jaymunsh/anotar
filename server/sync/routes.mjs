import { stageUpload } from './uploads.mjs';
import { getSyncSession, syncDatabase } from './store.mjs';
import { bootstrapSync, readSyncChanges, readSyncEntity } from './feed.mjs';
import { applySyncOperation, SYNC_CAPABILITIES, SyncError } from './operations.mjs';
function send(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new SyncError(415, 'content_type', 'JSON 형식으로 보내 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1100 * 1024) throw new SyncError(413, 'too_large', '작업 내용이 너무 커요.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SyncError(422, 'invalid_json', 'JSON 형식이 올바르지 않아요.');
  }
}
export async function handleSyncRequest(request, response, { store, blobDir, onAiQueued }) {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/sync/')) return false;
  try {
    const path = url.pathname.slice('/api/sync/'.length),
      db = syncDatabase(store);
    if (request.method === 'PUT' && /^uploads\/[a-f0-9-]{36}$/i.test(path)) {
      let name;
      try {
        name = decodeURIComponent(request.headers['x-leneu-file-name'] ?? '');
      } catch {
        throw new SyncError(422, 'invalid_upload', '파일명이 올바르지 않아요.');
      }
      if (!blobDir)
        throw new SyncError(503, 'uploads_unavailable', '첨부 저장 경로를 준비하지 못했어요.');
      send(
        response,
        200,
        await stageUpload(store, {
          uploadId: path.split('/')[1],
          operationId: request.headers['x-leneu-operation-id'],
          metadata: {
            name,
            mime: request.headers['content-type'],
            hash: request.headers['x-leneu-content-sha256'],
          },
          stream: request,
          blobDir,
        }),
      );
    } else if (request.method === 'GET' && path === 'session')
      send(response, 200, getSyncSession(db, SYNC_CAPABILITIES));
    else if (request.method === 'GET' && path === 'bootstrap')
      send(
        response,
        200,
        bootstrapSync(store, {
          kind: url.searchParams.get('kind'),
          afterId: url.searchParams.get('afterId') || '',
          limit: Number(url.searchParams.get('limit') || 100),
        }),
      );
    else if (request.method === 'GET' && path === 'changes')
      send(
        response,
        200,
        readSyncChanges(db, {
          after: Number(url.searchParams.get('after') || 0),
          limit: Number(url.searchParams.get('limit') || 100),
        }),
      );
    else if (
      request.method === 'GET' &&
      /^entities\/(capture|page|task|journal)\/[a-f0-9-]{36}$/i.test(path)
    ) {
      const [, kind, id] = path.split('/');
      send(
        response,
        200,
        readSyncEntity(store, kind, id, { metadata: url.searchParams.get('metadata') === '1' }),
      );
    } else if (request.method === 'POST' && path === 'operations') {
      const result = applySyncOperation(store, await body(request));
      send(response, 200, result);
      if (result.workflow?.kind === 'ai.submit') onAiQueued?.();
    } else send(response, 404, { error: '동기화 경로를 찾을 수 없어요.' });
  } catch (error) {
    send(response, error.status || 500, {
      error: error.status ? error.message : '동기화 작업을 처리하지 못했어요.',
      code: error.code || 'internal_error',
      ...(error.current !== undefined
        ? { current: error.current, tombstone: error.tombstone }
        : {}),
    });
  }
  return true;
}
