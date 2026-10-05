import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memo-api-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { base, dir };
}

test('multipart saves request settings and scope keeps AI entries out of the memo list', async (t) => {
  const { base } = await fixture(t);
  const body = new FormData();
  body.set('kind', 'note');
  body.set('text', '가격 비교하기');
  body.set('url', '');
  body.set('aiRequest', JSON.stringify({ template: null, additional: '확인한 근거를 남겨주세요' }));
  const response = await fetch(base + '/api/captures', { method: 'POST', body });
  assert.equal(response.status, 201);
  const { item } = await response.json();
  assert.equal(item.aiRequest?.prompt, '가격 비교하기\n\n추가 요청:\n확인한 근거를 남겨주세요');
  const memo = await (await fetch(base + '/api/captures?scope=memo')).json();
  assert.equal(memo.items.length, 0);
  assert.deepEqual(memo.counts, { memo: 0, ai: 1 });
  assert.equal(
    (await (await fetch(base + '/api/captures?scope=ai&q=근거')).json()).items[0].id,
    item.id,
  );
  assert.equal((await fetch(base + '/api/captures?scope=unknown')).status, 400);
});

test('malformed or null request settings reject the upload and remove its file bytes', async (t) => {
  const { base, dir } = await fixture(t);
  for (const settings of [
    '{broken',
    'null',
    JSON.stringify({ template: null, additional: 'x'.repeat(1001) }),
  ]) {
    const body = new FormData();
    body.set('kind', 'file');
    body.set('text', '잘못된 요청');
    body.set('url', '');
    body.set('aiRequest', settings);
    body.append('files', new Blob(['actual bytes']), 'sample.txt');
    const response = await fetch(base + '/api/captures', { method: 'POST', body });
    assert.equal(response.status, 400);
    assert.equal((await (await fetch(base + '/api/captures')).json()).items.length, 0);
    assert.deepEqual(await readdir(join(dir, 'blobs')), []);
  }
});
