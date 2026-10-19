// Serves the memory wiki build (apps/memory build.py → site/data.json) to the signed-in owner.
//
// Topology (see AGENTS.md "위키" + infra/edge/Caddyfile):
//   - Local dev: the edge Caddy intercepts /memory before anotar, forward_auth's /api/auth/check,
//     and reverse_proxies to the memory container. This route never runs there.
//   - Production (Oracle, B안): there is no edge and no memory container, so anotar serves the file
//     directly. The server builds it: leneu-memory-sync.timer pulls the memory-data repo hourly with a
//     read-only deploy key and swaps the file at MEMORY_DATA_FILE, mounted read-only (see compose.oracle.yaml
//     and deploy/memory-sync.sh). The Mac only pushes memory-data.
//
// No PUT/upload endpoint: uploads happen over SSH, not through the app.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const MAX_BYTES = 20 * 1024 * 1024; // 20MB guard against a runaway/corrupt build.

function fail(response, status, error) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify({ error }));
}

/**
 * Handle GET/HEAD /memory/data.json. Returns true when the request was handled.
 *
 * @param request  incoming http request
 * @param response http response
 * @param url      parsed URL
 * @param deps     { authorize(req): boolean, dataFile?: string }
 */
export async function handleMemoryDataRoute(request, response, url, { authorize, dataFile }) {
  if (url.pathname !== '/memory/data.json') return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    fail(response, 405, '허용되지 않은 방법이에요.');
    return true;
  }

  // Same session gate as the other private APIs: no session → 401, no app redirect here.
  if (!authorize(request)) {
    request.resume();
    fail(response, 401, '다시 로그인해 주세요.');
    return true;
  }

  // MEMORY_DATA_FILE is required; without it there is nothing to serve.
  if (!dataFile) {
    request.resume();
    fail(response, 404, '위키 데이터 경로가 설정되지 않았어요.');
    return true;
  }

  let info;
  try {
    info = await stat(dataFile);
  } catch {
    request.resume();
    fail(response, 404, '위키 데이터를 찾을 수 없어요.');
    return true;
  }
  if (!info.isFile()) {
    request.resume();
    fail(response, 404, '위키 데이터를 찾을 수 없어요.');
    return true;
  }
  if (info.size > MAX_BYTES) {
    request.resume();
    fail(response, 500, '위키 데이터가 너무 커요.');
    return true;
  }

  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    request.resume();
    response.end();
    return true;
  }
  // Stream the file as-is; the Mac build is the source of truth for the JSON shape.
  await new Promise((resolve, reject) => {
    const stream = createReadStream(dataFile);
    stream.on('error', reject);
    response.on('close', () => stream.destroy());
    stream.pipe(response);
    stream.on('end', resolve);
  });
  return true;
}
