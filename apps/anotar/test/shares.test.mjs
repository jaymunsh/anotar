import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { referencedAssetIds, renderSharedPage } from '../server/publicPage.mjs';

const block = (type, content = [], props = {}) => ({
  id: randomUUID(),
  type,
  props,
  content,
  children: [],
});

test('share tokens expose only an active page on the public server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-share-'));
  const store = openStore(dir);
  const page = store.createPage({ title: '여행 <script>비공개</script>' });
  const privatePage = store.createPage({ title: '비공개 하위 문서' });
  await mkdir(join(dir, 'blobs'));
  await writeFile(join(dir, 'blobs', 'shared-file'), 'public');
  await writeFile(join(dir, 'blobs', 'private-file'), 'secret');
  const sharedCapture = store.createCapture({
    kind: 'file',
    text: '공유',
    url: null,
    files: [{ key: 'shared-file', name: '일정.txt', mime: 'text/plain', size: 6 }],
  });
  const privateCapture = store.createCapture({
    kind: 'file',
    text: '비공개',
    url: null,
    files: [{ key: 'private-file', name: '비밀.txt', mime: 'text/plain', size: 6 }],
  });
  const sharedAsset = store.getCapture(sharedCapture.id).files[0];
  const privateAsset = store.getCapture(privateCapture.id).files[0];
  const document = {
    schemaVersion: 1,
    blocks: [
      block('paragraph', [{ type: 'text', text: '공유 일정', styles: {} }]),
      block('page', [], { pageId: privatePage.id, title: privatePage.title }),
      block('map', [], { latitude: 35.0037, longitude: 135.7788, zoom: 15, label: '철학의 길' }),
      block('asset', [], { assetId: sharedAsset.id, display: 'file' }),
    ],
  };
  document.blocks[1].children.push(
    block('asset', [], { assetId: privateAsset.id, display: 'file' }),
  );
  store.updatePage({ id: page.id, title: page.title, document, expectedVersion: page.version });
  store.trashRecord({ kind: 'capture', id: sharedCapture.id, expectedVersion: sharedCapture.version, operationId: randomUUID() });
  assert.ok(store.getAsset(sharedAsset.id), 'The active page keeps its attached file visible after source trash');
  const first = store.createPageShare(page.id, { expiresInDays: 1 });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.listPageShares(page.id)[0].token, undefined);
  assert.deepEqual([...referencedAssetIds(document)], [sharedAsset.id]);
  const rendered = renderSharedPage(
    { title: page.title, document, updatedAt: new Date().toISOString() },
    first.token,
  );
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes(privatePage.title));
  assert.match(rendered, /철학의 길/);
  const second = store.createPageShare(page.id, { expiresInDays: null });
  assert.ok(store.listPageShares(page.id).find((share) => share.id === first.item.id).revokedAt);
  store.publishShareSnapshots();
  store.close();
  // The public server gets only the snapshot folder; its DATA_DIR has no personal DB or blobs.
  const publicDataDir = await mkdtemp(join(tmpdir(), 'leneu-share-public-'));

  const port = 8800 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['server/public.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: publicDataDir,
      PUBLIC_SHARES_DIR: join(dir, 'public-shares'),
      PUBLIC_PORT: String(port),
      PUBLIC_HOST: '127.0.0.1',
    },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let response;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        response = await fetch(base + '/s/' + second.token);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(response?.status, 200);
    const body = await response.text();
    assert.match(body, /공유 일정/);
    assert.ok(!body.includes(privatePage.title));
    assert.equal((await fetch(base + '/s/' + first.token)).status, 404);
    assert.equal((await fetch(base + '/api/pages')).status, 404);
    assert.equal((await fetch(base + '/api/sync/session')).status, 404);
    assert.equal((await fetch(base + '/api/sync/operations', {method:'POST',body:'{}'})).status, 404);
    assert.equal(
      (await fetch(base + '/s/' + second.token + '/assets/' + randomUUID())).status,
      404,
    );
    assert.equal(
      await (await fetch(base + '/s/' + second.token + '/assets/' + sharedAsset.id)).text(),
      'public',
    );
    assert.equal(
      (await fetch(base + '/s/' + second.token + '/assets/' + privateAsset.id)).status,
      404,
    );
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    db.prepare('UPDATE page_shares SET expires_at = ? WHERE id = ?').run(
      '2000-01-01T00:00:00.000Z',
      second.item.id,
    );
    db.close();
    const reopened = openStore(dir);
    reopened.publishShareSnapshots();
    reopened.close();
    assert.equal((await fetch(base + '/s/' + second.token)).status, 404);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
    await rm(publicDataDir, { recursive: true, force: true });
  }
});

test('share snapshots follow edits and vanish on revoke or trash', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'leneu-share-snap-'));
  const store = openStore(dir);
  try {
    await mkdir(join(dir, 'blobs'));
    await writeFile(join(dir, 'blobs', 'k1'), 'bytes');
    const capture = store.createCapture({ kind: 'file', text: 'f', url: null, files: [{ key: 'k1', name: 'a.txt', mime: 'text/plain', size: 5 }] });
    const assetId = store.getCapture(capture.id).files[0].id;
    let page = store.createPage({ title: '공유 문서' });
    const share = store.createPageShare(page.id);
    const snapshotDir = join(dir, 'public-shares');
    const file = join(snapshotDir, createHash('sha256').update(share.token).digest('hex') + '.json');
    const read = async () => JSON.parse(await readFile(file, 'utf8'));
    store.publishShareSnapshots();
    assert.equal((await read()).page.title, '공유 문서');
    page = store.updatePage({
      id: page.id,
      title: '고친 제목',
      expectedVersion: page.version,
      document: { schemaVersion: 1, blocks: [block('asset', [], { assetId, display: 'file' })] },
    });
    store.publishShareSnapshots();
    assert.equal((await read()).page.title, '고친 제목');
    assert.deepEqual((await read()).assets.map((a) => a.id), [assetId]);
    assert.equal(await readFile(join(snapshotDir, 'assets', assetId), 'utf8'), 'bytes');
    store.trashRecord({ kind: 'page', id: page.id, expectedVersion: page.version, operationId: randomUUID() });
    store.publishShareSnapshots();
    assert.deepEqual(await readdir(snapshotDir), ['assets']);
    assert.deepEqual(await readdir(join(snapshotDir, 'assets')), []);
    const other = store.createPage({ title: '다른 문서' });
    const second = store.createPageShare(other.id);
    store.publishShareSnapshots();
    assert.equal((await readdir(snapshotDir)).length, 2);
    store.revokePageShare(other.id, second.item.id);
    store.publishShareSnapshots();
    assert.deepEqual(await readdir(snapshotDir), ['assets']);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
