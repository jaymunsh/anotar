import { createHostingRoutes } from './hosting/routes.mjs';
import { createPrivateRequestGuard } from './privateRequests.mjs';
import { createAuthHttp } from './auth/routes.mjs';
import { handleSyncRequest } from './sync/routes.mjs';
import { createSharedCommentBroker } from './sharedCommentBroker.mjs';
import { createOcrWorker } from './ocr.mjs';
import { Readable } from 'node:stream';
import { preparePageExport, zipEntries } from './pageExport.mjs';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { CaptureConflictError, CaptureValidationError, openStore } from './store.mjs';
import { PageConflictError, PageValidationError } from './pages.mjs';
import { PageImportConflictError, PageImportNotFoundError } from './pageConnections.mjs';
import { TaskConflictError, TaskValidationError } from './tasks.mjs';
import { PromptConflictError, PromptValidationError } from './prompts.mjs';
import { TrashConflictError, TrashNotFoundError, TrashValidationError } from './trash.mjs';
import { SearchValidationError } from './search.mjs';
import { ShareValidationError } from './shares.mjs';
import { referencedAssetIds } from './publicPage.mjs';
import { AiValidationError, AiConflictError, AiNotFoundError } from './ai/contracts.mjs';
import { fetchOpenCodeModels } from './ai/modelCatalog.mjs';
import { createAiExecutionService } from './ai/execution.mjs';
import { createAiWorker } from './ai/worker.mjs';
import { createServiceNotifier } from './serviceNotifications.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { createAutomaticBackups } from './automaticBackups.mjs';
import { handleBackupRoute } from './backupRoutes.mjs';
import { handleDocumentBlueprintRoute } from './documentBlueprints.mjs';
import { cleanGoogleMapsKey } from '../shared/googleItinerary.mjs';
import { createGeoapifyMapService, MapImageError } from './geoapifyMaps.mjs';
import { createBookmarkService } from './bookmarks.mjs';

const privateRequestAllowed = createPrivateRequestGuard(process.env.PRIVATE_ALLOWED_ORIGINS);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const blobDir = join(dataDir, 'blobs');
const distDir = join(root, 'dist');
mkdirSync(blobDir, { recursive: true });
const store = openStore(dataDir);
const authHttp = createAuthHttp({store});
const mapImages = createGeoapifyMapService({ store, blobDir });
const bookmarks = createBookmarkService();
const commentBroker = createSharedCommentBroker({
  store,
  socketPath: process.env.COMMENT_SOCKET_PATH || join(dataDir, 'share-comments.sock'),
});
await commentBroker.start();
const ocrWorker = createOcrWorker({ store, dataDir });
const backups = createAutomaticBackups({
  dataDir,
  backupDir: resolve(
    process.env.BACKUP_DIR || join(dirname(realpathSync(dataDir)), basename(dataDir) + '-backups'),
  ),
});
const aiRunner = createAiExecutionService({store});
const serviceNotifier = createServiceNotifier();
const aiWorker = createAiWorker({ store, runner: aiRunner, notifier: serviceNotifier });
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const publicShareOrigin = (
  process.env.PUBLIC_SHARE_ORIGIN || `http://127.0.0.1:${process.env.PUBLIC_PORT || 8790}`
).replace(/\/$/, '');
const handleHostingRoute = createHostingRoutes({
  directory: resolve(process.env.HOSTED_SITES_DIR || join(root, 'hosted-sites')),
  origin: process.env.PUBLIC_SITES_ORIGIN || 'http://127.0.0.1:8792',
});
const maxFileSize = 25 * 1024 * 1024;
const maxTotalSize = 100 * 1024 * 1024;

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readPromptJson(request, importing = false) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new PromptValidationError('JSON 형식으로 보내 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > (importing ? 16 * 1024 * 1024 : 64 * 1024))
      throw new PromptValidationError(
        importing ? '가져올 파일은 16MB까지 받을 수 있어요.' : '템플릿 요청이 너무 커요.',
      );
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new PromptValidationError('템플릿 JSON 형식이 올바르지 않아요.');
  }
}

async function readPageJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new PageValidationError('JSON 형식으로 보내 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1100 * 1024) throw new PageValidationError('페이지는 최대 1MB까지 저장합니다.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new PageValidationError('올바른 JSON 본문이 아닙니다.');
  }
}

async function readCaptureJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new CaptureValidationError('JSON 형식으로 보내 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new CaptureValidationError('수정 내용이 너무 깁니다.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new CaptureValidationError('올바른 JSON 본문이 아닙니다.');
  }
}

async function readTaskJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new TaskValidationError('JSON 형식으로 보내 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new TaskValidationError('할 일 내용이 너무 깁니다.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new TaskValidationError('올바른 JSON 본문이 아닙니다.');
  }
}

function parseUpload(request) {
  return new Promise((resolveUpload, rejectUpload) => {
    const files = [];
    const paths = [];
    const writes = [];
    const fields = {};
    let total = 0;
    let failure;
    const fail = (error) => {
      failure ||= error;
    };
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        limits: { files: 8, fields: 5, fileSize: maxFileSize, fieldSize: 1024 * 1024, parts: 13 },
      });
    } catch (error) {
      rejectUpload(error);
      return;
    }

    parser.on('field', (name, value, info) => {
      if (info.valueTruncated || info.nameTruncated)
        fail(new CaptureValidationError('입력 내용이 너무 깁니다.'));
      fields[name] = value;
    });
    parser.on('fieldsLimit', () => fail(new CaptureValidationError('입력 항목이 너무 많습니다.')));
    parser.on('file', (_field, stream, info) => {
      const key = randomUUID();
      const path = join(blobDir, key);
      const name = (info.filename || '첨부 파일').slice(0, 255);
      paths.push(path);
      let size = 0;
      const digest = createHash('sha256');
      const file = {
        key,
        name,
        mime: info.mimeType || 'application/octet-stream',
        size: 0,
        sha256: '',
      };
      files.push(file);
      stream.on('data', (chunk) => {
        digest.update(chunk);
        size += chunk.length;
        total += chunk.length;
        if (total > maxTotalSize) fail(new Error('한 번에 최대 100MB까지 업로드할 수 있습니다.'));
      });
      stream.on('limit', () => fail(new Error('파일 하나는 최대 25MB까지 업로드할 수 있습니다.')));
      writes.push(
        pipeline(stream, createWriteStream(path)).then(() => {
          file.size = size;
          file.sha256 = digest.digest('hex');
        }),
      );
    });
    parser.on('filesLimit', () => fail(new Error('파일은 한 번에 8개까지 첨부할 수 있습니다.')));
    parser.on('partsLimit', () => fail(new Error('업로드 항목이 너무 많습니다.')));
    parser.on('error', fail);
    parser.on('close', async () => {
      try {
        await Promise.all(writes);
        if (failure) throw failure;
        resolveUpload({ fields, files, paths });
      } catch (error) {
        await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
        rejectUpload(error);
      }
    });
    request.pipe(parser);
  });
}

const mimeByExtension = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  if (!privateRequestAllowed(request)) {
    request.resume();
    return json(response, 403, { error: '허용된 개인 주소에서 다시 요청해 주세요.' });
  }
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (await authHttp.handle(request, response, url)) return;
    if (await handleHostingRoute(request, response, url)) return;
    if (await handleSyncRequest(request, response, { store, blobDir, onAiQueued:()=>aiWorker.wake() })) return;
    if (await handleBackupRoute(request, response, url, backups)) return;
    if (handleDocumentBlueprintRoute(request, response, url)) return;
    if (request.method === 'POST' && url.pathname === '/api/bookmarks/preview') {
      const body = await readPageJson(request);
      if (typeof body.url !== 'string' || body.url.length > 2048)
        return json(response, 422, { error: 'HTTP 또는 HTTPS 주소를 입력해 주세요.' });
      try { return json(response, 200, { item: await bookmarks.read(body.url) }); }
      catch { return json(response, 422, { error: '사이트 정보를 불러오지 못했어요. 링크는 그대로 사용할 수 있어요.' }); }
    }
    const backlinksMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/backlinks$/);
    if (request.method === 'GET' && backlinksMatch) {
      if (!store.getPage(backlinksMatch[1])) return json(response, 404, { error: '페이지를 찾을 수 없어요.' });
      return json(response, 200, store.listPageBacklinks(backlinksMatch[1], { offset: Number(url.searchParams.get('offset') || 0) }));
    }
    if (request.method === 'POST' && url.pathname === '/capture/share') {
      request.resume();
      response.writeHead(303, { Location: '/capture?shareError=unsupported', 'Cache-Control': 'no-store' });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/api/health')
      return json(response, 200, { ok: store.healthy() });
    if (request.method === 'GET' && url.pathname === '/api/share-config')
      return json(response, 200, { origin: publicShareOrigin });
    if (request.method === 'GET' && url.pathname === '/api/maps/config')
      return json(response, 200, {
        googleMapsKey: cleanGoogleMapsKey(process.env.GOOGLE_MAPS_DEMO_KEY),
        geoapifyEnabled: mapImages.enabled,
      });
    const mapImageMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/map-images$/);
    if (mapImageMatch && request.method === 'POST') {
      const body = await readPageJson(request);
      return json(response, 200, await mapImages.generate({ ...body, pageId: mapImageMatch[1] }));
    }
    if (request.method === 'GET' && url.pathname === '/api/ocr/status')
      return json(response, 200, { enabled: ocrWorker.enabled });
    const ocrJobMatch = url.pathname.match(/^\/api\/ocr-jobs\/([a-f0-9-]+)$/);
    if (request.method === 'GET' && ocrJobMatch) {
      const item = store.getOcr(ocrJobMatch[1]);
      return json(
        response,
        item ? 200 : 404,
        item ? { item } : { error: '이미지 인식 결과를 찾을 수 없어요.' },
      );
    }
    const ocrMatch = url.pathname.match(/^\/api\/assets\/([a-f0-9-]+)\/ocr$/);
    if (ocrMatch) {
      if (request.method === 'GET')
        return json(response, 200, { items: store.listAssetOcr(ocrMatch[1]) });
      if (request.method === 'POST') {
        if (!ocrWorker.enabled)
          throw new AiConflictError('이미지 인식 실행기를 먼저 연결해 주세요.');
        const item = store.requestOcr({ ...(await readPageJson(request)), assetId: ocrMatch[1] });
        ocrWorker.wake();
        return json(response, 201, { item });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/ai/models/opencode') {
      try { return json(response,200,await fetchOpenCodeModels()); }
      catch { return json(response,502,{error:'공식 모델 목록을 가져오지 못했어요. 기존 목록은 유지돼요.'}); }
    }
    if (url.pathname === '/api/ai/settings') {
      if (request.method === 'GET') return json(response,200,aiRunner.settings());
      if (request.method === 'PUT') return json(response,200,aiRunner.update(await readPageJson(request)));
    }
    if (request.method === 'GET' && url.pathname === '/api/ai/status') {
      const settings = aiRunner.settings(), profile = settings.profiles.find(p=>p.id===(url.searchParams.get('profile')||settings.defaultProfile));
      return json(response,200,{enabled:profile?.enabled??false,runner:profile?aiRunner.metadataFor({execution:{profileId:profile.id,model:profile.model}}):null,supports:['text','research'],researchModes:profile?.researchModes??[],attachments:false,...settings});
    }
    if (request.method === 'GET' && url.pathname === '/api/ai/activity')
      return json(
        response,
        200,
        store.listAiActivity({
          status: url.searchParams.get('status') || 'all',
          compact: url.searchParams.get('view') === 'compact',
        }),
      );
    if (request.method === 'GET' && url.pathname === '/api/ai-jobs')
      return json(response, 200, {
        items: store.aiJobSummaries((url.searchParams.get('ids') || '').split(',')),
      });
    const pageAiJobsMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/ai-jobs$/);
    if (pageAiJobsMatch && request.method === 'GET') {
      const items = store.listPageAiJobs(pageAiJobsMatch[1]);
      return json(
        response,
        items ? 200 : 404,
        items ? { items } : { error: '페이지를 찾을 수 없어요.' },
      );
    }
    if (pageAiJobsMatch && request.method === 'POST') {
      const body = await readPageJson(request);
      const item = store.enqueuePageAiJob({ ...body, pageId: pageAiJobsMatch[1] });
      json(response, 201, { item });
      aiWorker.wake();
      return;
    }
    const pageApplyMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/ai-applies$/);
    if (pageApplyMatch && request.method === 'POST')
      return json(
        response,
        200,
        store.applyPageAiJob({ ...(await readPageJson(request)), pageId: pageApplyMatch[1] }),
      );
    const pageUndoMatch = url.pathname.match(
      /^\/api\/pages\/([a-f0-9-]+)\/ai-applies\/([a-f0-9-]+)\/undo$/,
    );
    if (pageUndoMatch && request.method === 'POST')
      return json(
        response,
        200,
        store.undoPageAiApply({
          ...(await readPageJson(request)),
          pageId: pageUndoMatch[1],
          applyOperationId: pageUndoMatch[2],
        }),
      );
    if (url.pathname === '/api/workspace/pages' && request.method === 'GET')
      return json(response, 200, store.listWorkspacePages());
    const workspaceMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/workspace$/);
    if (workspaceMatch && request.method === 'POST')
      return json(response, 200, store.setPageWorkspace({ ...(await readTaskJson(request)), pageId: workspaceMatch[1] }));
    if (url.pathname === '/api/capture-batches/organize' && request.method === 'POST')
      return json(response, 200, store.organizeCaptures(await readPageJson(request)));
    const originsMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/origins$/);
    if (originsMatch && request.method === 'GET') {
      const items = store.pageOrigins(originsMatch[1]);
      return json(
        response,
        items ? 200 : 404,
        items ? { items } : { error: '페이지를 찾을 수 없어요.' },
      );
    }
    const unorganizeMatch = url.pathname.match(/^\/api\/captures\/([a-f0-9-]+)\/unorganize$/);
    if (unorganizeMatch && request.method === 'POST')
      return json(
        response,
        200,
        store.unorganizeCapture({ ...(await readCaptureJson(request)), id: unorganizeMatch[1] }),
      );
    const aiJobsMatch = url.pathname.match(/^\/api\/captures\/([a-f0-9-]+)\/ai-jobs$/);
    if (aiJobsMatch && request.method === 'GET') {
      const items = store.listAiJobs(aiJobsMatch[1]);
      return json(
        response,
        items ? 200 : 404,
        items ? { items } : { error: '원본 메모를 찾을 수 없어요.' },
      );
    }
    if (aiJobsMatch && request.method === 'POST') {
      const body = await readCaptureJson(request);
      const item = store.enqueueAiJob({
        captureId: aiJobsMatch[1],
        requestId: body.requestId,
        expectedVersion: body.expectedVersion,
        retryOf: body.retryOf,
        selection: body.selection,
      });
      json(response, 201, { item });
      aiWorker.wake();
      return;
    }
    const adoptMatch = url.pathname.match(/^\/api\/ai-jobs\/([a-f0-9-]+)\/tasks$/);
    if (request.method === 'POST' && adoptMatch)
      return json(
        response,
        200,
        store.adoptAiTasks({ ...(await readPageJson(request)), jobId: adoptMatch[1] }),
      );
    const aiJobMatch = url.pathname.match(/^\/api\/ai-jobs\/([a-f0-9-]+)$/);
    if (aiJobMatch && request.method === 'GET') {
      const item = store.getAiJob(aiJobMatch[1]);
      return json(
        response,
        item ? 200 : 404,
        item ? { item } : { error: 'AI 요청을 찾을 수 없어요.' },
      );
    }
    if (request.method === 'GET' && url.pathname === '/api/trash')
      return json(
        response,
        200,
        store.listTrash({
          type: url.searchParams.get('type') ?? 'all',
          cursor: url.searchParams.get('cursor'),
        }),
      );
    const trashMatch = url.pathname.match(/^\/api\/(captures|pages)\/([a-f0-9-]+)\/trash$/);
    if (request.method === 'POST' && trashMatch) {
      const body = await readCaptureJson(request);
      return json(
        response,
        200,
        store.trashRecord({
          kind: trashMatch[1] === 'captures' ? 'capture' : 'page',
          id: trashMatch[2],
          operationId: body.operationId,
          expectedVersion: body.expectedVersion,
        }),
      );
    }
    const restoreMatch = url.pathname.match(/^\/api\/trash\/([a-f0-9-]+)\/restore$/);
    if (request.method === 'POST' && restoreMatch) {
      const body = await readCaptureJson(request);
      return json(
        response,
        200,
        store.restoreTrash({ id: restoreMatch[1], operationId: body.operationId }),
      );
    }
    if (url.pathname === '/api/tasks') {
      if (request.method === 'GET')
        return json(
          response,
          200,
          store.listTasks({
            status: url.searchParams.get('status') ?? 'open',
            stage: url.searchParams.get('stage'),
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50,
            cursor: url.searchParams.get('cursor'),
          }),
        );
      if (request.method === 'POST') {
        const body = await readTaskJson(request);
        return json(response, 201, {
          item: store.createTask({
            title: body.title,
            dueDate: body.dueDate,
            requestId: body.requestId,
          }),
        });
      }
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
    if (taskMatch && (request.method === 'GET' || request.method === 'PATCH')) {
      const id = taskMatch[1];
      const body = request.method === 'PATCH' ? await readTaskJson(request) : null;
      const item = body
        ? store.updateTask({
            id,
            expectedVersion: body.expectedVersion,
            title: body.title,
            dueDate: body.dueDate,
            status: body.status,
            stage: body.stage,
          })
        : store.getTask(id);
      return json(
        response,
        item ? 200 : 404,
        item ? { item } : { error: '할 일을 찾을 수 없습니다.' },
      );
    }
    if (url.pathname === '/api/prompt-templates/import' && request.method === 'POST') {
      const body = await readPromptJson(request, true);
      if (body.schemaVersion !== 1)
        throw new PromptValidationError('지원하지 않는 템플릿 파일 형식이에요.');
      return json(response, 200, store.importPromptTemplates(body.items));
    }
    if (url.pathname === '/api/prompt-templates') {
      if (request.method === 'GET') return json(response, 200, store.listPromptTemplates());
      if (request.method === 'POST')
        return json(response, 201, {
          item: store.createPromptTemplate(await readPromptJson(request)),
        });
    }
    const promptHistoryMatch = url.pathname.match(
      /^\/api\/prompt-templates\/([a-z0-9-]{1,80})\/revisions$/,
    );
    if (request.method === 'GET' && promptHistoryMatch) {
      const items = store.listPromptRevisions(promptHistoryMatch[1]);
      return json(
        response,
        items ? 200 : 404,
        items ? { items } : { error: '템플릿을 찾을 수 없어요.' },
      );
    }
    const promptMatch = url.pathname.match(/^\/api\/prompt-templates\/([a-z0-9-]{1,80})$/);
    if (promptMatch && ['GET', 'PUT', 'PATCH'].includes(request.method)) {
      const id = promptMatch[1];
      let item = store.getPromptTemplate(id);
      if (!item) return json(response, 404, { error: '템플릿을 찾을 수 없어요.' });
      if (request.method !== 'GET') {
        const body = await readPromptJson(request);
        item = store.updatePromptTemplate(
          request.method === 'PATCH'
            ? {
                ...item,
                id,
                archived: body.archived,
                expectedVersion: body.expectedVersion,
                expectedRevisionId: body.expectedRevisionId,
              }
            : { ...body, id },
        );
      }
      return json(response, 200, { item });
    }
    if (url.pathname === '/api/pages/staging') {
      if (request.method === 'GET') return json(response, 200, { item: store.getStagingPage() });
      if (request.method === 'POST')
        return json(response, 200, { item: store.ensureStagingPage() });
    }
    if (request.method === 'GET' && url.pathname === '/api/search')
      return json(
        response,
        200,
        store.searchRecords({
          query: url.searchParams.get('q') || '',
          type: url.searchParams.get('type') || 'all',
          cursor: url.searchParams.get('cursor'),
        }),
      );
    if (request.method === 'GET' && url.pathname === '/api/pages/search')
      return json(
        response,
        200,
        store.searchPages({
          query: url.searchParams.get('q') || '',
          cursor: url.searchParams.get('cursor'),
        }),
      );
    const exportMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/export$/);
    if (request.method === 'GET' && exportMatch) {
      const entries = preparePageExport({
        store,
        pageId: exportMatch[1],
        expectedVersion: Number(url.searchParams.get('version')),
        dataDir,
      });
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="leneu-page.zip"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      try {
        await pipeline(Readable.from(zipEntries(entries)), response);
      } catch (error) {
        if (!response.destroyed) response.destroy(error);
      }
      return;
    }
    if (url.pathname === '/api/shared-comments' && request.method === 'GET')
      return json(response, 200, store.listSharedCommentInbox({
        view: url.searchParams.get('view') || 'all',
        limit: url.searchParams.get('limit') || 20,
        cursor: url.searchParams.get('cursor'),
      }));
    const sharedReadMatch = url.pathname.match(/^\/api\/shared-comments\/([a-f0-9-]+)\/read$/);
    if (sharedReadMatch && request.method === 'POST')
      return json(response, 200, store.markSharedCommentRead({
        ...(await readTaskJson(request)), threadId: sharedReadMatch[1],
      }));
    const planConnectionsMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/plan-connections(\/options)?$/);
    if (planConnectionsMatch) {
      const pageId = planConnectionsMatch[1];
      if (request.method === 'GET')
        return json(response, 200, planConnectionsMatch[2]
          ? store.listPlanConnectionOptions(pageId, { kind: url.searchParams.get('kind') || 'task', q: url.searchParams.get('q') || '' })
          : store.listPlanConnections(pageId));
      if (request.method === 'POST' && !planConnectionsMatch[2])
        return json(response, 200, store.changePlanConnection({ ...(await readTaskJson(request)), pageId }));
    }
    const sharedCommentsMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/shared-comments$/);
    if (sharedCommentsMatch) {
      if (request.method === 'GET')
        return json(response, 200, {
          items:
            url.searchParams.get('view') === 'summary'
              ? store.listSharedCommentSummary(sharedCommentsMatch[1])
              : store.listSharedComments(sharedCommentsMatch[1]),
        });
      if (request.method === 'POST')
        return json(
          response,
          200,
          store.changeSharedComment({
            ...(await readPageJson(request)),
            pageId: sharedCommentsMatch[1],
          }),
        );
    }
    const commentsMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/comments$/);
    if (commentsMatch) {
      if (request.method === 'GET')
        return json(response, 200, {
          items:
            url.searchParams.get('view') === 'summary'
              ? store.listPageCommentSummary(commentsMatch[1])
              : store.listPageComments(commentsMatch[1]),
        });
      if (request.method === 'POST')
        return json(
          response,
          200,
          store.changePageComment({ ...(await readPageJson(request)), pageId: commentsMatch[1] }),
        );
    }
    const importMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/capture-imports$/);
    if (request.method === 'POST' && importMatch) {
      const body = await readPageJson(request);
      return json(response, 200, store.importCaptureIntoPage({ ...body, pageId: importMatch[1] }));
    }
    if (url.pathname === '/api/page-templates') {
      if (request.method === 'GET')
        return json(response, 200, { items: store.listPageTemplates() });
      if (request.method === 'POST')
        return json(response, 201, store.savePageTemplate(await readPageJson(request)));
    }
    const templateMatch = url.pathname.match(/^\/api\/page-templates\/([a-f0-9-]+)(\/pages)?$/);
    if (templateMatch) {
      if (request.method === 'POST' && templateMatch[2])
        return json(
          response,
          201,
          store.createPageFromTemplate({
            ...(await readPageJson(request)),
            templateId: templateMatch[1],
          }),
        );
      if (request.method === 'DELETE' && !templateMatch[2])
        return json(response, 200, store.deletePageTemplate({ templateId: templateMatch[1] }));
    }
    const toolsMatch = url.pathname.match(
      /^\/api\/pages\/([a-f0-9-]+)\/(duplicate|block-moves|assets|revisions)(?:\/(\d+)(\/restore)?)?$/,
    );
    if (toolsMatch) {
      const pageId = toolsMatch[1],
        action = toolsMatch[2],
        revisionVersion = Number(toolsMatch[3]);
      if (request.method === 'GET' && action === 'revisions') {
        if (!store.getPage(pageId)) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
        const result = toolsMatch[3] ? store.getPageRevision(pageId, revisionVersion) : null;
        if (toolsMatch[3] && !result) throw new PageToolsNotFoundError('수정본을 찾을 수 없어요.');
        return json(
          response,
          200,
          toolsMatch[3] ? { item: result } : { items: store.listPageRevisions(pageId) },
        );
      }
      if (request.method === 'POST' && action === 'assets' && !toolsMatch[3]) {
        const { fields, files, paths } = await parseUpload(request);
        try {
          const result = store.attachPageFiles({
            pageId,
            operationId: fields.operationId,
            expectedVersion: Number(fields.expectedVersion),
            files,
          });
          if (result.replayed) await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
          return json(response, 200, result);
        } catch (error) {
          await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
          throw error;
        }
      }
      if (request.method === 'POST') {
        const body = await readPageJson(request);
        if (action === 'duplicate' && !toolsMatch[3])
          return json(response, 201, store.duplicatePage({ ...body, pageId }));
        if (action === 'block-moves' && !toolsMatch[3])
          return json(response, 200, store.movePageBlocks({ ...body, pageId }));
        if (action === 'revisions' && toolsMatch[4])
          return json(
            response,
            200,
            store.restorePageRevision({ ...body, pageId, revisionVersion }),
          );
      }
    }
    if (url.pathname === '/api/pages') {
      if (request.method === 'GET')
        return json(response, 200, {
          items: store.listPages(),
          stagingPageId: store.getStagingPage()?.id ?? null,
        });
      if (request.method === 'POST') {
        const body = await readPageJson(request);
        if (body.captureImport !== undefined)
          return json(response, 201, store.createPageWithCapture(body));
        return json(response, 201, {
          item: store.createPage({
            title: body.title ?? '제목 없음',
            icon: body.icon,
            parentId: body.parentId,
          }),
        });
      }
    }
    const pageSharesMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/shares$/);
    if (pageSharesMatch && request.method === 'GET') {
      const items = store.listPageShares(pageSharesMatch[1]);
      if (!items) return json(response, 404, { error: '페이지를 찾을 수 없어요.' });
      const page = store.getPage(pageSharesMatch[1]);
      const assets = [...referencedAssetIds(page.document)]
        .map((id) => store.getAsset(id))
        .filter(Boolean)
        .map(({ id, name, mime, size }) => ({ id, name, mime, size }));
      return json(response, 200, { items, scope: { assets } });
    }
    if (pageSharesMatch && request.method === 'POST') {
      const body = await readPageJson(request);
      const result = store.createPageShare(pageSharesMatch[1], body);
      return json(response, result ? 201 : 404, result || { error: '페이지를 찾을 수 없어요.' });
    }
    const shareLinkMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/shares\/([a-f0-9-]+)\/link$/);
    if (shareLinkMatch && request.method === 'GET') {
      try {
        const token=store.getPageShareToken(shareLinkMatch[1],shareLinkMatch[2]);
        return json(response,token?200:404,token?{url:`${publicShareOrigin}/s/${token}`}:{error:'다시 확인할 수 있는 공유 링크가 없어요.'});
      } catch {return json(response,409,{error:'공유 링크를 읽지 못했어요. 백업의 공유 링크 키를 확인해 주세요.'});}
    }
    const shareMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/shares\/([a-f0-9-]+)$/);
    if (shareMatch && request.method === 'PATCH') {
      const item = store.updatePageShare(shareMatch[1], shareMatch[2], await readPageJson(request));
      return json(
        response,
        item ? 200 : 404,
        item ? { item } : { error: '공유 링크를 찾을 수 없어요.' },
      );
    }
    if (shareMatch && request.method === 'DELETE') {
      const revoked = store.revokePageShare(shareMatch[1], shareMatch[2]);
      return json(
        response,
        revoked ? 200 : 404,
        revoked ? { revoked: true } : { error: '공유 링크를 찾을 수 없어요.' },
      );
    }
    const pageLockMatch=url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/lock$/);
    if(pageLockMatch && ['GET','PUT'].includes(request.method)) {
      const id=pageLockMatch[1];
      if(request.method==='PUT') {
        const body=await readPageJson(request);
        if(Object.keys(body).some(key=>!['locked','expectedLockVersion','expectedVersion'].includes(key)))
          throw new PageValidationError('페이지 잠금 설정을 확인해 주세요.');
        store.setPageLock({id,...body});
      }
      const item=store.getPageLock(id);
      return json(response,item?200:404,item?{item}:{error:'페이지를 찾을 수 없어요.'});
    }
    const pageMatch = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)$/);
    if (pageMatch) {
      const id = pageMatch[1];
      if (request.method === 'GET') {
        const item = store.getPage(id);
        return json(
          response,
          item ? 200 : 404,
          item ? { item } : { error: '페이지를 찾을 수 없습니다.' },
        );
      }
      if (request.method === 'PATCH') {
        const body = await readPageJson(request);
        const item = store.movePage({ id, parentId: body.parentId, position: body.position });
        return json(
          response,
          item ? 200 : 404,
          item ? { item } : { error: '페이지를 찾을 수 없습니다.' },
        );
      }
      if (request.method === 'PUT') {
        const body = await readPageJson(request);
        try {
          const item = store.updatePage({
            id,
            title: body.title,
            document: body.document,
            expectedVersion: body.expectedVersion,
            icon: body.icon,
          });
          return json(
            response,
            item ? 200 : 404,
            item ? { item } : { error: '페이지를 찾을 수 없습니다.' },
          );
        } catch (error) {
          if (error instanceof PageConflictError)
            return json(response, 409, { error: error.message, current: store.getPage(id) });
          throw error;
        }
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/captures') {
      const kind = url.searchParams.get('kind') || 'all';
      if (!['all', 'note', 'link', 'image', 'file'].includes(kind))
        return json(response, 400, { error: '올바르지 않은 필터입니다.' });
      return json(response, 200, {
        items: store.listCaptures({
          kind,
          query: url.searchParams.get('q') || '',
          scope: url.searchParams.get('scope') || 'all',
          organization: url.searchParams.get('organization') || 'inbox',
        }),
        counts: store.captureCounts({
          organization: url.searchParams.get('organization') || 'inbox',
        }),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/captures') {
      if (!request.headers['content-type']?.startsWith('multipart/form-data'))
        return json(response, 415, { error: '올바른 업로드 형식이 아닙니다.' });
      const { fields, files, paths } = await parseUpload(request);
      const kind = fields.kind;
      const content = (fields.text || '').trim();
      const link = (fields.url || '').trim();
      let error;
      if (!['note', 'link', 'image', 'file'].includes(kind))
        error = '올바른 메모 종류를 선택해 주세요.';
      else if (content.length > 10000) error = '메모는 10,000자까지 입력할 수 있습니다.';
      else if (kind === 'link') {
        try {
          if (!/^https?:$/.test(new URL(link).protocol))
            error = 'http 또는 https 링크를 입력해 주세요.';
        } catch {
          error = '올바른 링크 주소를 입력해 주세요.';
        }
      } else if (kind === 'note' && !content && !files.length) error = '내용을 입력해 주세요.';
      else if ((kind === 'image' || kind === 'file') && !files.length)
        error = '파일을 첨부해 주세요.';
      if (error) {
        await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
        return json(response, 400, { error });
      }
      try {
        let aiRequest = null;
        if (fields.aiRequest !== undefined) {
          try {
            aiRequest = JSON.parse(fields.aiRequest);
            if (!aiRequest || typeof aiRequest !== 'object' || Array.isArray(aiRequest))
              throw new Error();
          } catch {
            throw new CaptureValidationError('AI 요청 설정을 읽지 못했어요. 다시 확인해 주세요.');
          }
        }
        const { item, replayed } = store.saveCapture({
          kind,
          text: content,
          url: link || null,
          files,
          aiRequest,
          requestId: fields.requestId ?? null,
        });
        if (replayed) await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
        const aiJob = fields.requestId
          ? store.submissionAiJob(item.id, fields.requestId)
          : item.latestAiJob
            ? store.getAiJob(item.latestAiJob.id)
            : null;
        json(response, replayed ? 200 : 201, { item, aiJob });
        aiWorker.wake();
        return;
      } catch (saveError) {
        await Promise.all(paths.map((path) => unlink(path).catch(() => {})));
        throw saveError;
      }
    }
    const capturePagesMatch = url.pathname.match(/^\/api\/captures\/([a-f0-9-]+)\/pages$/);
    if (request.method === 'GET' && capturePagesMatch) {
      if (!store.getCapture(capturePagesMatch[1]))
        return json(response, 404, { error: '원본 메모를 찾을 수 없습니다.' });
      return json(response, 200, { items: store.linkedPages(capturePagesMatch[1]) });
    }
    const captureMatch = url.pathname.match(/^\/api\/captures\/([a-f0-9-]+)$/);
    if (captureMatch) {
      const id = captureMatch[1];
      if (request.method === 'GET') {
        const item = store.getCapture(id);
        return json(
          response,
          item ? 200 : 404,
          item ? { item } : { error: '항목을 찾을 수 없습니다.' },
        );
      }
      if (request.method === 'PATCH') {
        try {
          const body = await readCaptureJson(request);
          const item = store.updateCapture({
            id,
            text: body.text,
            url: body.url,
            expectedVersion: body.expectedVersion,
          });
          return json(
            response,
            item ? 200 : 404,
            item ? { item } : { error: '항목을 찾을 수 없습니다.' },
          );
        } catch (error) {
          if (error instanceof CaptureValidationError)
            return json(response, 400, { error: error.message });
          if (error instanceof CaptureConflictError)
            return json(response, 409, { error: error.message, current: store.getCapture(id) });
          throw error;
        }
      }
    }
    const assetInfoMatch = url.pathname.match(/^\/api\/assets\/([a-f0-9-]+)\/info$/);
    if (request.method === 'GET' && assetInfoMatch) {
      const asset = store.getAsset(assetInfoMatch[1]);
      if (!asset || !existsSync(join(blobDir, asset.key)))
        return json(response, 404, { error: '파일을 찾을 수 없습니다.' });
      return json(response, 200, {
        item: { id: asset.id, name: asset.name, mime: asset.mime, size: asset.size },
      });
    }
    const assetMatch = url.pathname.match(/^\/api\/assets\/([a-f0-9-]+)$/);
    if (request.method === 'GET' && assetMatch) {
      const asset = store.getAsset(assetMatch[1]);
      if (!asset) return json(response, 404, { error: '파일을 찾을 수 없습니다.' });
      const path = join(blobDir, asset.key);
      if (!existsSync(path)) return json(response, 404, { error: '파일을 찾을 수 없습니다.' });
      const inline = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(
        asset.mime,
      );
      response.writeHead(200, {
        'Content-Type': inline ? asset.mime : 'application/octet-stream',
        'Content-Length': asset.size,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      });
      return pipeline((await import('node:fs')).createReadStream(path), response);
    }
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      !url.pathname.startsWith('/api/') &&
      existsSync(distDir)
    ) {
      const target = resolve(distDir, `.${url.pathname}`);
      const file =
        target.startsWith(`${distDir}/`) && existsSync(target) && (await stat(target)).isFile()
          ? target
          : join(distDir, 'index.html');
      response.writeHead(200, {
        'Content-Type': mimeByExtension[extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      return response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    }
    return json(response, 404, { error: '경로를 찾을 수 없습니다.' });
  } catch (error) {
    if (error instanceof MapImageError) return json(response, error.status, { error: error.message });
    if (error instanceof PageToolsNotFoundError)
      return json(response, 404, { error: error.message });
    if (error instanceof PageConflictError) return json(response, 409, { error: error.message });
    if (error instanceof AiConflictError) return json(response, 409, { error: error.message });
    if (error instanceof AiValidationError) return json(response, 400, { error: error.message });
    if (error instanceof AiNotFoundError) return json(response, 404, { error: error.message });
    if (error instanceof SearchValidationError)
      return json(response, 400, { error: error.message });
    if (error instanceof ShareValidationError) return json(response, 400, { error: error.message });
    if (error instanceof TrashConflictError) return json(response, 409, { error: error.message });
    if (error instanceof TrashValidationError) return json(response, 400, { error: error.message });
    if (error instanceof TrashNotFoundError) return json(response, 404, { error: error.message });
    if (error instanceof PageImportConflictError)
      return json(response, 409, { error: error.message });
    if (error instanceof PageImportNotFoundError)
      return json(response, 404, { error: error.message });
    if (error instanceof CaptureValidationError)
      return json(response, 400, { error: error.message });
    if (error instanceof PromptConflictError)
      return json(response, 409, { error: error.message, current: error.current });
    if (error instanceof PromptValidationError)
      return json(response, 400, { error: error.message });
    if (error instanceof TaskConflictError)
      return json(response, 409, { error: error.message, current: error.current });
    if (error instanceof TaskValidationError) return json(response, 400, { error: error.message });
    const message = error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.';
    const badRequest =
      error instanceof PageValidationError ||
      error instanceof TypeError ||
      /업로드|파일|parts|Unexpected end/i.test(message);
    if (!response.headersSent)
      json(response, badRequest ? 400 : 500, {
        error: badRequest ? message : '저장 중 문제가 발생했습니다.',
      });
    console.error(error);
  }
});

server.listen(port, host, () => {
  // Local copies can explicitly enable AI without starting OCR or scheduled backups.
  const backgroundEnabled = process.env.BACKGROUND_WORKERS_ENABLED !== 'false';
  if (backgroundEnabled || process.env.AI_WORKER_ENABLED === 'true') aiWorker.start();
  else void aiWorker.stop();
  if (backgroundEnabled) {
    ocrWorker.start();
    void backups.start().catch((error) => console.error('백업 초기화 실패:', error.message));
  } else {
    void ocrWorker.stop();
  }
  console.log(`Storage API: http://${host}:${port}`);
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await aiWorker.stop();
  await serviceNotifier.close();
  await ocrWorker.stop();
  await backups.stop();
  await commentBroker.stop();
  server.close(() => store.close());
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
