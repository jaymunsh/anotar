import { open, lstat, realpath } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, extname, sep } from 'node:path';
import { mimeTypes, safeFilePath } from './store.mjs';
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'",
};
function reply(response, status, text) {
  response.writeHead(status, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(text);
}
export async function serveHostedSite(request, response, store) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return reply(response, 405, 'GET 또는 HEAD 요청만 사용할 수 있어요.');
  }
  let file;
  try {
    const raw = (request.url || '/').split('?')[0];
    if (raw === '/health') {
      response.writeHead(200, {
        ...headers,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      return response.end(request.method === 'HEAD' ? undefined : '{"ok":true}');
    }
    let path;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return reply(response, 404, '사이트를 찾을 수 없어요.');
    }
    const match = /^\/([a-z0-9][a-z0-9-]{0,63})(\/.*)?$/.exec(path);
    if (!match) return reply(response, 404, '사이트를 찾을 수 없어요.');
    const site = store.read(match[1]);
    if (!site?.enabled) return reply(response, 404, '사이트를 찾을 수 없어요.');
    if (!match[2]) {
      response.writeHead(308, {
        ...headers,
        Location: `/${site.slug}/`,
        'Cache-Control': 'no-store',
      });
      return response.end();
    }
    let relative = match[2].slice(1);
    if (!relative) relative = site.entry;
    else if (relative.endsWith('/')) relative += 'index.html';
    if (!safeFilePath(relative) || !Object.hasOwn(site.files, relative))
      return reply(response, 404, '파일을 찾을 수 없어요.');
    const bundles = join(store.root, 'bundles'),
      base = join(bundles, site.bundle),
      target = join(base, relative);
    const bundlesInfo = await lstat(bundles),
      baseInfo = await lstat(base);
    if (
      !bundlesInfo.isDirectory() ||
      bundlesInfo.isSymbolicLink() ||
      !baseInfo.isDirectory() ||
      baseInfo.isSymbolicLink()
    )
      return reply(response, 404, '파일을 찾을 수 없어요.');
    let component = base;
    for (const segment of relative.split('/').slice(0, -1)) {
      component = join(component, segment);
      const directory = await lstat(component);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        return reply(response, 404, '파일을 찾을 수 없어요.');
    }
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink())
      return reply(response, 404, '파일을 찾을 수 없어요.');
    const canonicalBase = await realpath(base),
      canonical = await realpath(target);
    if (!canonical.startsWith(canonicalBase + sep))
      return reply(response, 404, '파일을 찾을 수 없어요.');
    const record = site.files[relative];
    if (info.size !== record.bytes) return reply(response, 503, '사이트 파일을 확인해 주세요.');
    const etag = `"${record.sha256}"`;
    // Revalidation makes publish/stop take effect even for already visited sites.
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('ETag', etag);
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }
    file = await open(canonical, 'r');
    response.writeHead(200, {
      ...headers,
      'Content-Type': mimeTypes[extname(relative).toLowerCase()],
      'Content-Length': record.bytes,
    });
    if (request.method === 'HEAD') return response.end();
    await pipeline(file.createReadStream({ autoClose: false }), response);
  } catch (error) {
    if (!response.headersSent) reply(response, error.status || 503, '사이트를 불러오지 못했어요.');
    else response.destroy();
  } finally {
    await file?.close().catch(() => {});
  }
}
