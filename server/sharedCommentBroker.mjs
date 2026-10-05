import { createServer, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PageValidationError, PageConflictError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { AiValidationError } from './ai/contracts.mjs';

export const COMMENT_BODY_LIMIT = 8 * 1024;
const route = /^\/s\/([A-Za-z0-9_-]{43})\/comments$/;
function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}
export async function readCommentJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || ''))
    throw Object.assign(new Error('JSON 형식으로 보내 주세요.'), { status: 415 });
  if (Number(request.headers['content-length']) > COMMENT_BODY_LIMIT)
    throw Object.assign(new Error('댓글 요청이 너무 커요.'), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > COMMENT_BODY_LIMIT)
      throw Object.assign(new Error('댓글 요청이 너무 커요.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error('올바른 JSON 본문이 아닙니다.'), { status: 400 });
  }
}
function statusFor(error) {
  return (
    error.status ||
    (error instanceof PageToolsNotFoundError
      ? 404
      : error instanceof PageConflictError
        ? 409
        : error instanceof PageValidationError || error instanceof AiValidationError
          ? 400
          : 500)
  );
}

// Bounded, process-local abuse protection. We deliberately ignore forwarded
// addresses here; the public proxy supplies its actual peer address only.
export function createCommentRateLimit() {
  const windows = new Map();
  return (key, limit) => {
    const now = Date.now();
    for (const [k, v] of windows) if (v.until <= now) windows.delete(k);
    const current = windows.get(key);
    if (current) {
      if (current.count >= limit) return false;
      current.count++;
      return true;
    }
    // Refuse unknown identities when full instead of evicting live counters.
    if (windows.size >= 4096) return false;
    windows.set(key, { count: 1, until: now + 60000 });
    return true;
  };
}
async function prepareSocket(socketPath) {
  await mkdir(dirname(socketPath), { recursive: true });
  const existing = await lstat(socketPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!existing) return;
  if (!existing.isSocket()) throw new Error('댓글 socket 경로에 다른 파일이 있어요.');
  const active = await new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    client.once('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.once('error', (error) => {
      client.destroy();
      if (['ECONNREFUSED', 'ENOENT'].includes(error.code)) resolve(false);
      else reject(error);
    });
    client.setTimeout(1000, () => {
      client.destroy();
      reject(new Error('댓글 socket 상태를 확인할 수 없어요.'));
    });
  });
  if (active) throw new Error('댓글 socket을 사용 중인 서버가 있어요.');
  await unlink(socketPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
export function createSharedCommentBroker({ store, socketPath }) {
  const allowed = createCommentRateLimit();
  let inode = null,
    started = false;
  const server = createServer(async (request, response) => {
    const match = route.exec(request.url || '');
    if (!match || !['GET', 'POST'].includes(request.method))
      return json(response, 404, { error: '공유 댓글 경로를 찾을 수 없어요.' });
    const address = String(request.headers['x-comment-peer'] || 'local').slice(0, 128);
    if (
      !allowed(request.method + ':peer:' + address, request.method === 'POST' ? 10 : 120) ||
      !allowed(request.method + ':token:' + match[1], request.method === 'POST' ? 30 : 240)
    )
      return json(response, 429, { error: '요청이 많아요. 잠시 뒤 다시 시도해 주세요.' });
    try {
      const result =
        request.method === 'GET'
          ? { items: store.listPublicSharedComments(match[1]) }
          : store.changePublicSharedComment(match[1], await readCommentJson(request));
      json(response, 200, result);
    } catch (error) {
      const status = statusFor(error);
      json(response, status, {
        error: status === 500 ? '댓글을 처리하지 못했어요. 다시 시도해 주세요.' : error.message,
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  return {
    async start() {
      if (started) return;
      await prepareSocket(socketPath);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      await chmod(socketPath, 0o600);
      inode = (await lstat(socketPath)).ino;
      started = true;
    },
    async stop() {
      if (!started) return;
      started = false;
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections();
      });
      const current = await lstat(socketPath).catch(() => null);
      if (current?.isSocket() && current.ino === inode) await unlink(socketPath).catch(() => {});
    },
  };
}

export function requestSharedCommentBroker({
  socketPath,
  method,
  path,
  body,
  clientAddress = 'local',
}) {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    const request = httpRequest(
      {
        socketPath,
        path,
        method,
        headers: {
          'x-comment-peer': String(clientAddress).slice(0, 128),
          ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            response.destroy();
            finish({ status: 503, body: { error: '댓글 응답이 너무 커요.' } });
          } else chunks.push(chunk);
        });
        response.on('error', () =>
          finish({ status: 503, body: { error: '댓글 서버에 연결하지 못했어요.' } }),
        );
        response.on('end', () => {
          try {
            finish({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            finish({ status: 503, body: { error: '댓글 응답을 읽지 못했어요.' } });
          }
        });
      },
    );
    request.on('error', () =>
      finish({
        status: 503,
        body: { error: '댓글 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.' },
      }),
    );
    request.setTimeout(10000, () => request.destroy());
    request.end(data);
  });
}
