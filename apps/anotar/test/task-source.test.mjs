import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

test('tasks remember a wiki source and can be listed by it, open or done', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-task-source-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const requestId = randomUUID();
  const source = 'wiki:my-memory:Cloudflare Pages 배포';
  const task = store.createTask({ title: 'Cloudflare Pages 배포', requestId, source });
  assert.equal(task.source, source);
  assert.equal(store.createTask({ title: 'Cloudflare Pages 배포', requestId, source }).id, task.id);
  store.createTask({ title: '그냥 할 일' });
  store.updateTask({ id: task.id, expectedVersion: task.version, status: 'done' });
  const listed = store.listTasksBySource('wiki:');
  assert.deepEqual(listed.map((item) => [item.source, item.status]), [[source, 'done']]);
  assert.throws(() => store.createTask({ title: 'x', source: 'evil' }), /출처/);
  assert.throws(() => store.listTasksBySource('pages:'), /출처/);
});
