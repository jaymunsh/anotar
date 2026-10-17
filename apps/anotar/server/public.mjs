import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { readCommentJson, requestSharedCommentBroker } from './sharedCommentBroker.mjs';
import { renderSharedPage } from './publicPage.mjs';
import { FONT_FILES } from './fontFiles.mjs';

const dataDir = resolve(
  process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)),
);
// Only snapshots the private app published (shareSnapshots.mjs); never the personal DB or blobs.
// Same default as shareSnapshotDir() in shareSnapshots.mjs (not imported: keeps private code out).
const sharesDir = resolve(process.env.PUBLIC_SHARES_DIR || join(dataDir, 'public-shares'));
async function readSnapshot(token) {
  const hash = createHash('sha256').update(token).digest('hex');
  const snapshot = await readFile(join(sharesDir, hash + '.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  // Expiry is re-checked here so a link closes on time even between private refreshes.
  if (!snapshot || (snapshot.expiresAt && snapshot.expiresAt <= new Date().toISOString())) return null;
  return snapshot;
}
const host = process.env.PUBLIC_HOST || '127.0.0.1';
const port = Number(process.env.PUBLIC_PORT || 8790);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const viewerAssets = {
  '/share-assets/share-code.js': [join(appRoot, 'dist', 'share-code.js'), 'text/javascript; charset=utf-8'],
  '/share-assets/document.css': [join(appRoot, 'dist', 'document.css'), 'text/css; charset=utf-8'],
  '/share-assets/document-fonts.css': [join(appRoot, 'dist', 'document-fonts.css'), 'text/css; charset=utf-8'],
  '/share-assets/diagram.css': [join(appRoot, 'dist', 'diagram.css'), 'text/css; charset=utf-8'],
  '/share-assets/callout.css': [join(appRoot, 'dist', 'callout.css'), 'text/css; charset=utf-8'],
  '/share-assets/favicon.png': [join(appRoot, 'dist', 'favicon.png'), 'image/png'],
  '/share-assets/itinerary-timetable.css': [
    join(appRoot, 'dist', 'itinerary-timetable.css'),
    'text/css; charset=utf-8',
  ],
  '/share-assets/share-theme.js': [
    join(appRoot, 'dist', 'share-theme.js'),
    'text/javascript; charset=utf-8',
  ],
  '/share-assets/share-theme.css': [
    join(appRoot, 'dist', 'share-theme.css'),
    'text/css; charset=utf-8',
  ],
  '/share-assets/share-comments.js': [
    join(appRoot, 'dist', 'share-comments.js'),
    'text/javascript; charset=utf-8',
  ],
  '/share-assets/share-comments.css': [
    join(appRoot, 'dist', 'share-comments.css'),
    'text/css; charset=utf-8',
  ],
  '/share-assets/share-plan.js': [
    join(appRoot, 'dist', 'share-plan.js'),
    'text/javascript; charset=utf-8',
  ],
  '/share-assets/share-plan.css': [
    join(appRoot, 'dist', 'share-plan.css'),
    'text/css; charset=utf-8',
  ],
};
for (const file of FONT_FILES)
  viewerAssets[`/fonts/${file}`] = [join(appRoot, 'dist', 'fonts', file), file.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'font/woff2'];

function missing(response) {
  response.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('공유 페이지를 찾을 수 없습니다.');
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (path === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    try {
      if (!(await stat(sharesDir)).isDirectory()) throw new Error();
      response.writeHead(200, { ...securityHeaders, 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : '{"ok":true}');
    } catch {
      response.writeHead(503, securityHeaders);
      response.end();
    }
    return;
  }
  // Only the separate reader build is public; no private app chunks or arbitrary files.
  if (['GET', 'HEAD'].includes(request.method) && /^\/share-viewer\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.js$/.test(path)) {
    const data = await readFile(join(appRoot, 'dist', 'share-viewer', path.slice('/share-viewer/'.length))).catch(() => null);
    if (!data) return missing(response);
    response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': data.length });
    return response.end(request.method === 'HEAD' ? undefined : data);
  }
  if (['GET', 'HEAD'].includes(request.method) && Object.hasOwn(viewerAssets, path)) {
    const [file, mime] = viewerAssets[path];
    const data = await readFile(file).catch(() => null);
    if (!data) return missing(response);
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': mime,
      'Content-Length': data.length,
      ...(path.startsWith('/fonts/') ? { 'Cache-Control': 'public, max-age=86400' } : {}),
    });
    return response.end(request.method === 'HEAD' ? undefined : data);
  }
  const commentMatch = /^\/s\/([A-Za-z0-9_-]{43})\/comments$/.exec(path);
  if (commentMatch && ['GET', 'POST'].includes(request.method)) {
    const send = (status, body) => {
      response.writeHead(status, {
        ...securityHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(body));
    };
    try {
      let body;
      if (request.method === 'POST') {
        let expectedOrigin;
        try {
          expectedOrigin = process.env.PUBLIC_SHARE_ORIGIN
            ? new URL(process.env.PUBLIC_SHARE_ORIGIN).origin
            : new URL('http://' + request.headers.host).origin;
        } catch {
          return send(403, { error: '공유 주소를 확인해 주세요.' });
        }
        if (
          request.headers.origin !== expectedOrigin ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          return send(403, { error: '같은 공유 페이지에서 댓글을 남겨 주세요.' });
        body = await readCommentJson(request);
      }
      const result = await requestSharedCommentBroker({
        socketPath: process.env.COMMENT_SOCKET_PATH || join(dataDir, 'share-comments.sock'),
        method: request.method,
        path,
        body,
        clientAddress: request.socket.remoteAddress || 'unknown',
      });
      return send(result.status, result.body);
    } catch (error) {
      return send(error.status || 500, {
        error: error.status ? error.message : '댓글을 처리하지 못했어요.',
      });
    }
  }
  const match = /^\/s\/([A-Za-z0-9_-]{43})(?:\/assets\/([a-f0-9-]+))?$/.exec(path);
  if (!match || !['GET', 'HEAD'].includes(request.method)) return missing(response);
  try {
    const snapshot = await readSnapshot(match[1]);
    if (!snapshot) return missing(response);
    const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
    if (match[2]) {
      const asset = assets.get(match[2]);
      if (!asset) return missing(response);
      const file = join(sharesDir, 'assets', asset.id);
      const stats = await stat(file).catch(() => null);
      if (!stats?.isFile()) return missing(response);
      const inline = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(
        asset.mime,
      );
      response.writeHead(200, {
        ...securityHeaders,
        'Content-Type': inline ? asset.mime : 'application/octet-stream',
        'Content-Length': stats.size,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      });
      if (request.method === 'HEAD') return response.end();
      return await pipeline(createReadStream(file), response);
    }
    const html = renderSharedPage(snapshot.page, match[1], assets, {
      commentsEnabled: snapshot.commentsEnabled,
      planTasks: snapshot.planTasks,
    });
    response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) missing(response);
  }
});

server.listen(port, host, () => console.log(`Public shares: http://${host}:${port}`));
function shutdown() {
  server.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
