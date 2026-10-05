import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

test('sample command creates actual files and pages once without replacing edited examples or personal notes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memo-samples-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const personal = store.createCapture({ kind: 'note', text: '내가 저장한 실제 메모' });
  const personalTask = store.createTask({ title: '내가 적은 실제 할 일' });
  function seed() {
    const result = spawnSync(process.execPath, ['scripts/seed-memo-samples.mjs'], {
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  seed();
  const captures = store.listCaptures();
  const sampleTasks = store
    .listTasks({ status: 'open' })
    .items.filter((task) => task.id !== personalTask.id);
  assert.equal(sampleTasks.length, 2, 'sample command should add two real task examples');
  const editedTask = store.updateTask({
    id: sampleTasks[0].id,
    expectedVersion: sampleTasks[0].version,
    title: '내가 고친 예시 할 일',
    status: 'done',
  });
  assert.equal(captures.filter((item) => item.isSample).length, 6);
  assert.equal(captures.filter((item) => item.aiRequest).length, 2);
  const sample = captures.find((item) => item.isSample && item.kind === 'note' && !item.aiRequest);
  store.updateCapture({
    id: sample.id,
    text: '직접 고친 예시 메모',
    expectedVersion: sample.version,
  });
  const pages = store.listPages();
  assert.equal(pages.length, 2);
  const page = store.getPage(pages[0].id);
  store.updatePage({ ...page, title: '직접 고친 예시 제목', expectedVersion: page.version });
  const paths = await readdir(join(dir, 'blobs'));
  assert.equal(paths.length, 2);
  seed();
  assert.equal(store.listCaptures().length, 7);
  assert.equal(store.getCapture(sample.id).text, '직접 고친 예시 메모');
  assert.equal(store.getCapture(personal.id).text, '내가 저장한 실제 메모');
  assert.equal(store.listPages().length, 2);
  assert.equal(store.getPage(page.id).title, '직접 고친 예시 제목');
  assert.equal(store.listTasks({ status: 'open' }).counts.open, 2);
  assert.equal(store.listTasks({ status: 'done' }).counts.done, 1);
  assert.equal(store.getTask(editedTask.id).title, '내가 고친 예시 할 일');
  assert.equal(store.getTask(personalTask.id).title, '내가 적은 실제 할 일');
  assert.deepEqual(await readdir(join(dir, 'blobs')), paths);
});
