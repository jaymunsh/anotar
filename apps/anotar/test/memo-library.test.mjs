import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

const template = {
  id: 'research-brief',
  name: 'URL 리서치',
  description: '',
  kind: 'research',
  body: 'URL {{url}}\n{{content}}',
  archived: false,
  version: 1,
  revisionId: 'ed7c27a5-891d-409f-8550-f6c8e395ad86',
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memo-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store };
}

test('AI requests retain their submitted prompt after source edits and database restart', async (t) => {
  const { dir, store } = await fixture(t);
  const item = store.createCapture({
    kind: 'link',
    text: '핵심만 확인 {{url}}',
    url: 'https://example.com/research',
    aiRequest: { template, additional: '근거를 붙여주세요' },
  });
  assert.equal(
    item.aiRequest?.prompt,
    'URL https://example.com/research\n핵심만 확인 {{url}}\n\n추가 요청:\n근거를 붙여주세요',
  );
  assert.equal(item.aiRequest.status, 'prepared');
  assert.equal(item.aiRequest.template.revisionId, template.revisionId);
  store.updateCapture({
    id: item.id,
    text: '달라진 원본',
    url: 'https://example.org/new',
    expectedVersion: 1,
  });
  const second = openStore(dir);
  try {
    assert.equal(second.getCapture(item.id).text, '달라진 원본');
    assert.deepEqual(second.getCapture(item.id).aiRequest, item.aiRequest);
  } finally {
    second.close();
  }
});

test('memo and AI scope filters apply before the limit and search includes stored requests', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '예약 번호를 확인하기' });
  for (let index = 0; index < 101; index++)
    store.createCapture({
      kind: 'note',
      text: '생각 ' + index,
      aiRequest: { template: null, additional: '비교 근거를 확인해 주세요' },
    });
  assert.deepEqual(
    store.listCaptures({ scope: 'memo' }).map((item) => item.id),
    [memo.id],
  );
  assert.equal(store.listCaptures({ scope: 'ai', query: '비교 근거' }).length, 100);
  assert.deepEqual(store.captureCounts(), { memo: 1, ai: 101 });
});

test('search finds the original request input when the template omits it and the source is edited', async (t) => {
  const { store } = await fixture(t);
  const item = store.createCapture({
    kind: 'link',
    text: '미니PC 메모 저장',
    url: 'https://example.com/old',
    aiRequest: { template: { ...template, body: '조사할 URL: {{url}}' }, additional: '' },
  });
  store.updateCapture({
    id: item.id,
    text: '여행 준비',
    url: 'https://example.org/new',
    expectedVersion: 1,
  });
  assert.equal(store.listCaptures({ scope: 'ai', query: '미니PC' })[0]?.id, item.id);
});

test('invalid AI settings and attachment failures do not leave a partial capture', async (t) => {
  const { store } = await fixture(t);
  assert.throws(() =>
    store.createCapture({
      kind: 'note',
      text: '남지 않아야 함',
      aiRequest: { template: null, additional: 'x'.repeat(1001) },
    }),
  );
  assert.throws(() =>
    store.createCapture({
      kind: 'note',
      text: '남지 않아야 함',
      aiRequest: { template: { ...template, body: '{{unknown}}' }, additional: '' },
    }),
  );
  assert.throws(() =>
    store.createCapture({
      kind: 'note',
      text: '남지 않아야 함',
      aiRequest: { template: null, additional: '' },
      files: [{ key: null, name: 'broken.txt', mime: 'text/plain', size: 1 }],
    }),
  );
  assert.equal(store.listCaptures().length, 0);
});

test('sample reseeding reuses a capture and retains user edits', async (t) => {
  const { store } = await fixture(t);
  const first = store.createCapture({ kind: 'note', text: '샘플 원문', sampleKey: 'memo.demo.v1' });
  store.updateCapture({ id: first.id, text: '사용자가 고친 예시', expectedVersion: 1 });
  const again = store.createCapture({
    kind: 'note',
    text: '덮어쓸 내용',
    sampleKey: 'memo.demo.v1',
  });
  assert.equal(again.id, first.id);
  assert.equal(again.text, '사용자가 고친 예시');
  assert.equal(again.isSample, true);
  assert.equal(store.listCaptures().length, 1);
});

test('existing captures migrate as ordinary memos without changing their content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-memo-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  db.exec(
    'CREATE TABLE captures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO captures VALUES (?, ?, ?, ?, ?)').run(
    'legacy',
    'note',
    '기존 메모',
    null,
    '2026-09-26T03:00:00Z',
  );
  db.close();
  const store = openStore(dir);
  try {
    const item = store.getCapture('legacy');
    assert.equal(item.text, '기존 메모');
    assert.equal(item.aiRequest, null);
    assert.equal(item.isSample, false);
    assert.equal(store.listCaptures({ scope: 'memo' }).length, 1);
  } finally {
    store.close();
  }
});
