import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

test('saved notes survive reopening and can be found by their text', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const first = openStore(dir);
  const saved = first.createCapture({
    kind: 'note',
    text: '교토 여행 항공권 확인',
    url: null,
    files: [],
  });
  first.close();

  const reopened = openStore(dir);
  t.after(() => reopened.close());
  assert.equal(reopened.getCapture(saved.id)?.text, '교토 여행 항공권 확인');
  assert.equal(reopened.listCaptures({ query: '항공권', kind: 'all' })[0]?.id, saved.id);
});

test('file metadata remains attached to its capture', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());

  const saved = store.createCapture({
    kind: 'image',
    text: '다음에 읽기',
    url: null,
    files: [{ key: 'stored-image', name: 'screenshot.png', mime: 'image/png', size: 14 }],
  });

  assert.deepEqual(
    store.getCapture(saved.id)?.files.map(({ name, size }) => ({ name, size })),
    [{ name: 'screenshot.png', size: 14 }],
  );
  const edited = store.updateCapture({
    id: saved.id,
    text: '설명을 고쳤다',
    expectedVersion: saved.version,
  });
  assert.equal(edited.text, '설명을 고쳤다');
  assert.equal(edited.createdAt, saved.createdAt);
  assert.deepEqual(edited.files, saved.files);
});

test('existing capture rows gain an edit version without losing their timestamps', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-old-captures-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const legacy = new DatabaseSync(join(dir, 'storage.sqlite'));
  legacy.exec(`CREATE TABLE captures (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
    url TEXT, created_at TEXT NOT NULL
  )`);
  legacy
    .prepare('INSERT INTO captures VALUES (?, ?, ?, ?, ?)')
    .run('old-note', 'note', '남겨 둔 메모', null, '2026-09-26T03:30:00.000Z');
  legacy.close();

  const store = openStore(dir);
  t.after(() => store.close());
  const item = store.getCapture('old-note');
  assert.equal(item.text, '남겨 둔 메모');
  assert.equal(item.version, 1);
  assert.equal(item.updatedAt, item.createdAt);
});
