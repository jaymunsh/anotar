import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-batch-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}
function source(store, text) {
  return store.createCapture({ kind: 'note', text, url: null, files: [] });
}
function selection(capture) {
  return {
    captureId: capture.id,
    expectedVersion: capture.version,
    operationId: randomUUID(),
    copyContent: true,
    assetIds: [],
  };
}
function request(captures, extra = {}) {
  return {
    operationId: randomUUID(),
    title: '프로젝트 자료',
    items: captures.map(selection),
    ...extra,
  };
}

test('batch creates one editable page, preserves originals and replays without duplicate blocks', async (t) => {
  const s = await fixture(t),
    a = source(s, '첫 메모'),
    b = source(s, '두 번째 메모');
  const input = request([a, b]);
  const result = s.organizeCaptures(input);
  assert.equal(result.replayed, false);
  assert.equal(result.item.document.blocks.length, 2);
  assert.equal(result.blockIds.length, 2);
  assert.equal(s.pageOrigins(result.item.id).length, 2);
  for (const original of [a, b]) {
    const current = s.getCapture(original.id);
    assert.equal(current.text, original.text);
    assert.equal(current.version, original.version);
    assert.equal(current.organizedPageId, result.item.id);
  }
  const replay = s.organizeCaptures(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.id, result.item.id);
  assert.equal(s.listPages().length, 1);
  assert.equal(s.getPage(result.item.id).document.blocks.length, 2);
  assert.throws(() => s.organizeCaptures({ ...input, title: '다른 제목' }), /같은|선택|달라/);
});

test('stale source rejects the complete batch without a new page or organization', async (t) => {
  const s = await fixture(t),
    a = source(s, '처음'),
    b = source(s, '변경 전'),
    input = request([a, b]);
  s.updateCapture({ id: b.id, expectedVersion: b.version, text: '변경 후', url: null });
  assert.throws(() => s.organizeCaptures(input), /변경|버전/);
  assert.equal(s.listPages().length, 0);
  assert.equal(s.getCapture(a.id).organizedAt, null);
  assert.equal(s.getCapture(b.id).organizedAt, null);
});

test('existing page version and document size failure roll back all source states', async (t) => {
  const s = await fixture(t),
    a = source(s, '메모'),
    p = s.createPage({ title: '대상' });
  assert.throws(
    () => s.organizeCaptures(request([a], { pageId: p.id, expectedPageVersion: p.version + 1 })),
    /변경|버전/,
  );
  assert.equal(s.getCapture(a.id).organizedAt, null);
  const blocks = Array.from({ length: 1000 }, () => ({
    id: randomUUID(),
    type: 'paragraph',
    props: {},
    content: [],
    children: [],
  }));
  const full = s.updatePage({
    ...p,
    expectedVersion: p.version,
    document: { schemaVersion: 1, blocks },
  });
  assert.throws(
    () => s.organizeCaptures(request([a], { pageId: p.id, expectedPageVersion: full.version })),
    /블록|1000|1,000/,
  );
  assert.equal(s.getPage(p.id).version, full.version);
  assert.equal(s.getCapture(a.id).organizedAt, null);
  assert.equal(s.pageOrigins(p.id).length, 0);
});

test('batch respects existing unorganize and rejects duplicate/empty/too many selections', async (t) => {
  const s = await fixture(t),
    a = source(s, '메모'),
    input = request([a]);
  const result = s.organizeCaptures(input);
  const current = s.getCapture(a.id);
  s.unorganizeCapture({
    id: a.id,
    operationId: randomUUID(),
    expectedOrganizedOperationId: current.organizedOperationId,
  });
  assert.equal(s.getCapture(a.id).organizedAt, null);
  assert.equal(s.getPage(result.item.id).document.blocks.length, 1);
  assert.equal(s.organizeCaptures(input).replayed, true);
  assert.equal(s.getCapture(a.id).organizedAt, null);
  assert.throws(() => s.organizeCaptures(request([a, a])), /중복|한 번/);
  assert.throws(() => s.organizeCaptures(request([])), /선택|1~20/);
  assert.throws(() => s.organizeCaptures(request(Array.from({ length: 21 }, () => a))), /20/);
  assert.throws(
    () => s.organizeCaptures({ ...request([a]), items: [{ ...selection(a), copyContent: false }] }),
    /내용|첨부/,
  );
});

test('foreign attachments reject the full batch and valid attachments preserve their owner and bytes', async (t) => {
  const s = await fixture(t),
    a = source(s, '첫 메모');
  const b = s.createCapture({
    kind: 'file',
    text: '자료',
    url: null,
    files: [
      { id: randomUUID(), key: 'original.txt', name: '원본.txt', mime: 'text/plain', size: 6 },
    ],
  });
  assert.throws(
    () =>
      s.organizeCaptures({
        ...request([a, b]),
        items: [{ ...selection(a), assetIds: [b.files[0].id] }, selection(b)],
      }),
    /속한/,
  );
  assert.equal(s.listPages().length, 0);
  assert.equal(s.getCapture(a.id).organizedAt, null);
  const result = s.organizeCaptures({
    ...request([a, b]),
    items: [selection(a), { ...selection(b), assetIds: [b.files[0].id] }],
  });
  assert.ok(
    result.item.document.blocks.some(
      (block) => block.type === 'asset' && block.props.assetId === b.files[0].id,
    ),
  );
  assert.ok(result.item.document.blocks.every((block) => block.type !== 'captureRef'));
  assert.equal(s.getAsset(b.files[0].id).captureId, b.id);
  assert.equal(s.getAsset(b.files[0].id).key, 'original.txt');
});

test('file-only memo cannot be organized with a nonexistent text selection', async (t) => {
  const s = await fixture(t);
  const file = s.createCapture({
    kind: 'file',
    text: '',
    url: null,
    files: [{ key: 'still.txt', name: '자료.txt', mime: 'text/plain', size: 10 }],
  });
  assert.throws(() => s.organizeCaptures(request([file])), /내용|첨부/);
  assert.equal(s.listPages().length, 0);
  assert.equal(s.getCapture(file.id).organizedAt, null);
});
