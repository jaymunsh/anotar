import Busboy from 'busboy';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHostingStore, HostingError, limits, safeFilePath } from './store.mjs';
function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let bytes = 0,
    parts = [];
  for await (const part of request) {
    bytes += part.length;
    if (bytes > 4096) throw new HostingError(413, '설정 내용이 너무 커요.');
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new HostingError(422, '설정 형식을 확인해 주세요.');
  }
}
async function receiveFolder(request, root) {
  await mkdir(root, { recursive: true });
  if (Number(request.headers['content-length'] || 0) > limits.siteBytes + 2 * 1024 * 1024)
    throw new HostingError(413, '사이트 전체 용량은 50MB까지 등록할 수 있어요.');
  const temporary = await mkdtemp(join(root, '.incoming-'));
  const writes = [];
  let failure;
  try {
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        preservePath: true,
        defParamCharset: 'utf8',
        limits: {
          files: limits.files,
          fileSize: limits.fileBytes + 1,
          fields: 3,
          fieldSize: 512,
          parts: limits.files + 4,
        },
      });
    } catch {
      throw new HostingError(422, '사이트 폴더를 선택해 주세요.');
    }
    const fields = Object.create(null),
      names = new Set();
    let bytes = 0;
    const fail = (message, status = 422) => {
      failure ??= new HostingError(status, message);
    };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        fail('등록 시간이 초과됐어요. 폴더를 다시 선택해 주세요.', 408);
        request.unpipe(parser);
        parser.destroy();
        request.resume();
        reject(failure);
      }, 60_000);
      let receivedBytes = 0;
      const countRaw = (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > limits.siteBytes + 2 * 1024 * 1024) {
          fail('사이트 전체 용량은 50MB까지 등록할 수 있어요.', 413);
          request.unpipe(parser);
          parser.destroy(failure);
          request.resume();
        }
      };
      request.on('data', countRaw);
      const end = () => {
        clearTimeout(timeout);
        request.off('data', countRaw);
      };
      parser.on('field', (name, value, info) => {
        if (
          !['name', 'slug', 'entry'].includes(name) ||
          Object.hasOwn(fields, name) ||
          info.valueTruncated
        )
          fail('사이트 설정을 확인해 주세요.');
        else fields[name] = value;
      });
      parser.on('file', (_name, stream, { filename }) => {
        stream.on('error', () => fail('폴더 등록이 중단됐어요.'));
        if (!safeFilePath(filename) || names.has(filename)) {
          fail('지원하지 않거나 중복된 파일 경로가 있어요.');
          stream.resume();
          return;
        }
        names.add(filename);
        const chunks = [];
        let length = 0;
        stream.on('limit', () => fail('개별 파일은 25MB까지 등록할 수 있어요.', 413));
        stream.on('data', (chunk) => {
          bytes += chunk.length;
          length += chunk.length;
          if (bytes > limits.siteBytes) fail('사이트 전체 용량은 50MB까지 등록할 수 있어요.', 413);
          if (!failure) chunks.push(chunk);
        });
        const pending = new Promise((r) => {
          let ended = false;
          stream.on('close', () => {
            if (!ended) {
              fail('폴더 등록이 중단됐어요.');
              r();
            }
          });
          stream.on('error', () => {
            fail('파일을 읽지 못했어요. 다시 시도해 주세요.');
            r();
          });
          stream.on('end', () => {
            ended = true;
            if (failure) {
              r();
              return;
            }
            const target = join(temporary, filename);
            mkdir(dirname(target), { recursive: true })
              .then(() => writeFile(target, Buffer.concat(chunks, length), { flag: 'wx' }))
              .catch(() => fail('파일을 저장하지 못했어요. 다시 시도해 주세요.'))
              .finally(r);
          });
        });
        writes.push(pending);
      });
      for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'])
        parser.on(event, () => fail('파일이나 설정 항목이 너무 많아요.', 413));
      parser.on('error', () => {
        end();
        reject(failure || new HostingError(422, '폴더를 읽지 못했어요. 다시 시도해 주세요.'));
      });
      request.once('aborted', () => {
        end();
        parser.destroy();
        reject(new HostingError(400, '폴더 등록이 중단됐어요.'));
      });
      request.once('error', () => {
        end();
        parser.destroy();
        reject(new HostingError(400, '폴더 등록이 중단됐어요.'));
      });
      parser.once('close', () => {
        end();
        resolve();
      });
      request.pipe(parser);
    });
    await Promise.all(writes);
    if (failure) throw failure;
    return { temporary, fields };
  } catch (error) {
    await Promise.all(writes);
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
export function createHostingRoutes({ directory, origin }) {
  const store = createHostingStore(directory);
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
    throw new Error('PUBLIC_SITES_ORIGIN에는 경로 없는 HTTP(S) 주소를 입력해 주세요.');
  let importing = false;
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/hosting')) return false;
    try {
      if (request.method === 'GET' && url.pathname === '/api/hosting') {
        json(response, 200, { ...store.list(), origin });
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/hosting') {
        if (importing) {
          request.resume();
          throw new HostingError(
            409,
            '다른 폴더 등록이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
          );
        }
        importing = true;
        let folder, item;
        try {
          folder = await receiveFolder(request, store.root);
          item = await store.importDirectory({ source: folder.temporary, ...folder.fields });
        } finally {
          if (folder) await rm(folder.temporary, { recursive: true, force: true });
          importing = false;
        }
        json(response, 201, { item });
        return true;
      }
      const match = /^\/api\/hosting\/([a-z0-9-]+)$/.exec(url.pathname);
      if (request.method === 'PATCH' && match) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new HostingError(422, '설정 형식을 확인해 주세요.');
        json(response, 200, { item: store.update(match[1], body) });
        return true;
      }
      request.resume();
      json(response, 404, { error: '호스팅 기능을 찾을 수 없어요.' });
    } catch (error) {
      request.resume();
      json(response, error.status || 500, {
        error: error.status
          ? error.message
          : '사이트 요청을 처리하지 못했어요. 다시 시도해 주세요.',
      });
    }
    return true;
  };
}
