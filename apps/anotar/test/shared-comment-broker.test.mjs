import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import {
  createSharedCommentBroker,
  requestSharedCommentBroker,
} from '../server/sharedCommentBroker.mjs';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-comment-broker-')),
    store = openStore(dir),
    socketPath = join(dir, 'comments.sock');
  const page = store.createPage();
  const link = store.createPageShare(page.id, { commentsEnabled: true });
  const broker = createSharedCommentBroker({ store, socketPath });
  await broker.start();
  try {
    await fn({ dir, store, page, link, socketPath, broker });
  } finally {
    await broker.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const body = (blockId, extra = {}) => ({
  requestId: randomUUID(),
  action: 'create',
  name: '친구',
  text: '질문',
  blockId,
  ...extra,
});

test('Unix broker permits only fixed public routes and revalidates capabilities', () =>
  fixture(async ({ store, page, link, socketPath }) => {
    const req = (method, path, payload) =>
      requestSharedCommentBroker({
        socketPath,
        method,
        path,
        body: payload,
        clientAddress: 'fixture',
      });
    const path = '/s/' + link.token + '/comments';
    assert.equal((await req('GET', '/api/pages')).status, 404);
    assert.equal((await req('DELETE', path)).status, 404);
    assert.equal((await req('GET', path)).status, 200);
    const first = await req('POST', path, body(page.document.blocks[0].id));
    assert.equal(first.status, 200);
    const thread = first.body.items[0];
    assert.equal(thread.comments[0].isOwner, false);
    assert.equal(
      (
        await req(
          'POST',
          path,
          body(page.document.blocks[0].id, {
            action: 'delete',
            threadId: thread.id,
            expectedVersion: thread.version,
          }),
        )
      ).status,
      400,
    );
    store.updatePageShare(page.id, link.item.id, { commentsEnabled: false });
    assert.equal((await req('GET', path)).status, 404);
  }));

test('broker body and rate bounds cannot be bypassed by caller identity and stop unlinks socket', () =>
  fixture(async ({ page, link, socketPath, broker }) => {
    const req = (payload, address = 'test') =>
      requestSharedCommentBroker({
        socketPath,
        method: 'POST',
        path: '/s/' + link.token + '/comments',
        body: payload,
        clientAddress: address,
      });
    assert.equal(
      (await req(body(page.document.blocks[0].id, { text: 'x'.repeat(10000) }), 'oversize')).status,
      413,
    );
    const chunked = await new Promise((resolve) => {
      const request = httpRequest(
        {
          socketPath,
          path: '/s/' + link.token + '/comments',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-comment-peer': 'chunked' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', () => resolve('connection-reset'));
      request.write('x'.repeat(10000));
      request.end();
    });
    assert.equal(chunked, 413);
    for (let i = 0; i < 10; i++)
      assert.notEqual(
        (await req(body(page.document.blocks[0].id, { action: 'delete' }))).status,
        429,
      );
    assert.equal((await req(body(page.document.blocks[0].id))).status, 429);
    await broker.stop();
    assert.equal(
      (
        await requestSharedCommentBroker({
          socketPath,
          method: 'GET',
          path: '/s/' + link.token + '/comments',
        })
      ).status,
      503,
    );
  }));

test('public HTTP server writes through broker with same-origin JSON only and exposes no private API', () =>
  fixture(async ({ dir, store, page, link, socketPath }) => {
    const port = 18000 + Math.floor(Math.random() * 1000),
      base = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, ['server/public.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PUBLIC_PORT: String(port),
        PUBLIC_HOST: '127.0.0.1',
        COMMENT_SOCKET_PATH: socketPath,
        PUBLIC_SHARE_ORIGIN: base,
      },
      stdio: 'pipe',
    });
    try {
      let response;
      for (let i = 0; i < 80; i++) {
        try {
          response = await fetch(base + '/health');
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      assert.equal(response?.status, 200);
      const path = base + '/s/' + link.token + '/comments';
      const post = (data, origin = base, type = 'application/json') =>
        fetch(path, {
          method: 'POST',
          headers: { 'content-type': type, ...(origin ? { origin } : {}) },
          body: JSON.stringify(data),
        });
      assert.equal(
        (await post(body(page.document.blocks[0].id), 'https://other.invalid')).status,
        403,
      );
      assert.equal((await post(body(page.document.blocks[0].id), null)).status, 403);
      assert.equal((await post(body(page.document.blocks[0].id), base, 'text/plain')).status, 415);
      assert.equal(
        (await post(body(page.document.blocks[0].id, { text: 'x'.repeat(10000) }))).status,
        413,
      );
      const req = body(page.document.blocks[0].id, {
        name: '<script>x</script>',
        text: '<img src=x onerror=alert(1)>',
      });
      const saved = await post(req);
      assert.equal(saved.status, 200);
      assert.equal((await saved.json()).items[0].comments[0].name, req.name);
      assert.equal((await post(req)).status, 200);
      assert.equal((await (await fetch(path)).json()).items[0].comments.length, 1);
      assert.equal((await fetch(base + '/api/pages/' + page.id + '/shared-comments')).status, 404);
      const html = await (await fetch(base + '/s/' + link.token)).text();
      assert.ok(!html.includes('<img src=x onerror'));
      assert.match(
        (await fetch(base + '/s/' + link.token)).headers.get('content-security-policy'),
        /connect-src 'self'/,
      );
      store.revokePageShare(page.id, link.item.id);
      assert.equal((await fetch(path)).status, 404);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  }));

test('broker does not remove live sockets or unrelated files and can restart', () =>
  fixture(async ({ dir, store, socketPath, broker }) => {
    const { writeFile, readFile } = await import('node:fs/promises');
    const duplicate = createSharedCommentBroker({ store, socketPath });
    await assert.rejects(() => duplicate.start(), /사용 중/);
    const file = join(dir, 'ordinary');
    await writeFile(file, 'keep');
    const unsafe = createSharedCommentBroker({ store, socketPath: file });
    await assert.rejects(() => unsafe.start(), /다른 파일/);
    assert.equal(await readFile(file, 'utf8'), 'keep');
    await broker.stop();
    await broker.start();
    assert.equal(
      (await requestSharedCommentBroker({ socketPath, method: 'GET', path: '/private' })).status,
      404,
    );
  }));

test('owner HTTP policy updates and shared replies use server identity; socket restarts cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-owner-comments-')),
    socketPath = join(dir, 'owner.sock');
  let seed = openStore(dir);
  const page = seed.createPage(),
    link = seed.createPageShare(page.id, { commentsEnabled: true });
  seed.close();
  const port = 19500 + Math.floor(Math.random() * 500),
    base = 'http://127.0.0.1:' + port;
  async function start() {
    const child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PORT: String(port),
        HOST: '127.0.0.1',
        COMMENT_SOCKET_PATH: socketPath,
        AI_RUNNER: 'disabled',
        OCR_ENDPOINT: '',
        BACKUP_DIR: join(dir, 'backups'),
      },
      stdio: 'pipe',
    });
    let out = '';
    child.stderr.on('data', (x) => (out += x));
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + '/api/health');
        if (r.ok) return child;
      } catch {}
      if (child.exitCode !== null) throw new Error(out);
      await new Promise((r) => setTimeout(r, 30));
    }
    child.kill();
    throw new Error('owner startup: ' + out);
  }
  let child;
  try {
    child = await start();
    const comments = base + '/api/pages/' + page.id + '/shared-comments';
    const req = body(page.document.blocks[0].id, { isOwner: false, name: 'fake' });
    const saved = await fetch(comments, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    assert.equal(saved.status, 200);
    const t = (await saved.json()).items[0];
    assert.equal(t.comments[0].name, '나');
    assert.equal(t.comments[0].isOwner, true);
    const sum = await (await fetch(comments + '?view=summary')).json();
    assert.deepEqual(sum.items, [{ blockId: t.blockId, count: 1, resolved: false }]);
    const patch = await fetch(base + '/api/pages/' + page.id + '/shares/' + link.item.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{"commentsEnabled":false}',
    });
    assert.equal((await patch.json()).item.commentsEnabled, false);
    assert.equal(
      (
        await requestSharedCommentBroker({
          socketPath,
          method: 'GET',
          path: '/s/' + link.token + '/comments',
        })
      ).status,
      404,
    );
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    child = null;
    child = await start();
    assert.equal((await (await fetch(comments)).json()).items[0].comments.length, 1);
    assert.equal(
      (await (await fetch(base + '/api/pages/' + page.id)).json()).item.version,
      page.version,
    );
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
