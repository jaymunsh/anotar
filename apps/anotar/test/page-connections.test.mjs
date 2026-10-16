import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { registerSearchFunctions } from '../server/searchText.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-connections-'));
  const store = openStore(dir);
  t.after(() => {
    store.close();
    return rm(dir, { recursive: true, force: true });
  });
  return { store, dir };
}
const paragraph = (text, id = randomUUID()) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
const request = (captureId, options = {}) => ({
  operationId: randomUUID(),
  captureId,
  copyContent: true,
  assetIds: [],
  ...options,
});

function completedResult(store, text = '조사할 내용') {
  const capture = store.createCapture({
    kind: 'note',
    text,
    aiRequest: { template: null, additional: '' },
  });
  const job = store.claimAiJob({ label: '검증 실행기', mode: 'test' });
  store.completeAiJob(job.id, job.runToken, {
    markdown: '## 조사 결과\n\n찾아낸 사실',
    sources: [],
    usage: null,
  });
  return { capture: store.getCapture(capture.id), job: store.getAiJob(job.id) };
}

test('a chosen AI result becomes editable page blocks while source and result stay intact', async (t) => {
  const { store } = await fixture(t);
  const { capture, job } = completedResult(store);
  const page = store.createPage({ title: '조사 노트' });
  const document = {
    schemaVersion: 1,
    blocks: [
      { ...paragraph('조사 결과'), type: 'heading', props: { level: 2 } },
      paragraph('찾아낸 사실'),
    ],
  };
  const input = request(capture.id, { copyContent: false, aiResult: { jobId: job.id, document } });
  const adopted = store.importCaptureIntoPage({ pageId: page.id, ...input });
  assert.equal(adopted.item.document.blocks.at(-2).type, 'heading');
  assert.equal(adopted.item.document.blocks.at(-1).content[0].text, '찾아낸 사실');
  assert.deepEqual(store.getCapture(capture.id), capture);
  assert.deepEqual(store.getAiJob(job.id), job);
  assert.deepEqual(store.importCaptureIntoPage({ pageId: page.id, ...input }), {
    ...adopted,
    replayed: true,
  });
  assert.throws(
    () =>
      store.importCaptureIntoPage({
        pageId: page.id,
        ...input,
        aiResult: {
          jobId: job.id,
          document: { schemaVersion: 1, blocks: [paragraph('달라진 내용')] },
        },
      }),
    { name: 'PageImportConflictError' },
  );
  const second = store.importCaptureIntoPage({
    pageId: page.id,
    ...input,
    operationId: randomUUID(),
  });
  assert.equal(second.item.document.blocks.filter((block) => block.type === 'heading').length, 2);
  assert.equal(
    new Set(second.item.document.blocks.map((block) => block.id)).size,
    second.item.document.blocks.length,
  );
  assert.ok(
    store
      .searchRecords({ query: '찾아낸 사실', type: 'page' })
      .items.some((item) => item.id === page.id),
  );
});

test('AI child creation replays after restart and source edits without copying changed text', async (t) => {
  const { store, dir } = await fixture(t);
  const { capture, job } = completedResult(store);
  const parent = store.createPage({ title: '리서치' });
  const input = {
    title: '정리한 문서',
    parentId: parent.id,
    captureImport: request(capture.id, {
      copyContent: false,
      aiResult: {
        jobId: job.id,
        document: { schemaVersion: 1, blocks: [paragraph('정리된 결과')] },
      },
    }),
  };
  const result = store.createPageWithCapture(input);
  assert.equal(result.item.parentId, parent.id);
  store.updateCapture({ id: capture.id, text: '수정한 원문', expectedVersion: 1 });
  const reopened = openStore(dir);
  try {
    assert.deepEqual(reopened.createPageWithCapture(input), { ...result, replayed: true });
    assert.equal(reopened.listPages().length, 2);
    assert.equal(result.item.document.blocks.at(-1).content[0].text, '정리된 결과');
    assert.equal(reopened.getAiJob(job.id).result.markdown, job.result.markdown);
  } finally {
    reopened.close();
  }
});

test('AI adoption rejects other captures and unfinished jobs atomically', async (t) => {
  const { store } = await fixture(t);
  const { capture, job } = completedResult(store);
  const other = store.createCapture({ kind: 'note', text: '다른 메모' });
  const queued = store.enqueueAiJob({
    captureId: capture.id,
    requestId: randomUUID(),
    expectedVersion: 1,
  });
  for (const [captureId, jobId] of [
    [other.id, job.id],
    [capture.id, queued.id],
    [capture.id, randomUUID()],
  ]) {
    assert.throws(
      () =>
        store.createPageWithCapture({
          title: '만들면 안 됨',
          captureImport: request(captureId, {
            aiResult: { jobId, document: { schemaVersion: 1, blocks: [paragraph('결과')] } },
          }),
        }),
      /AI 결과/,
    );
    assert.equal(store.listPages().length, 0);
    assert.deepEqual(store.linkedPages(captureId), []);
  }
});

test('AI import validation rejects unsafe links, private references, and over-limit documents without changing a page', async (t) => {
  const { store } = await fixture(t);
  const { capture, job } = completedResult(store);
  const page = store.createPage({ title: '자료' });
  for (const blocks of [
    [
      {
        ...paragraph('위험'),
        content: [
          {
            type: 'link',
            href: 'javascript:alert(1)',
            content: [{ type: 'text', text: '위험', styles: {} }],
          },
        ],
      },
    ],
    [{ id: randomUUID(), type: 'captureRef', props: { captureId: capture.id }, children: [] }],
    Array.from({ length: 1000 }, () => paragraph('한도')),
  ]) {
    assert.throws(() =>
      store.importCaptureIntoPage({
        pageId: page.id,
        ...request(capture.id, {
          copyContent: false,
          aiResult: { jobId: job.id, document: { schemaVersion: 1, blocks } },
        }),
      }),
    );
    assert.deepEqual(store.getPage(page.id), page);
    assert.deepEqual(store.linkedPages(capture.id), []);
  }
});

test('all pages and deep ancestry remain findable, and moves reject missing parents', async (t) => {
  const { store } = await fixture(t);
  let parent = null;
  for (let i = 0; i < 210; i++)
    parent = store.createPage({ title: `자료 ${i}`, parentId: i < 12 ? parent?.id : null });
  assert.equal(store.listPages().length, 210);
  const found = store.searchPages({ query: '자료 11' });
  assert.equal(found.items[0].path.length, 12);
  assert.ok(store.searchPages({ query: '자료 209' }).items.some((item) => item.id === parent.id));
  assert.throws(
    () => store.movePage({ id: parent.id, parentId: randomUUID(), position: 0 }),
    /상위 페이지/,
  );
  let cursor = null;
  const ids = new Set();
  do {
    const batch = store.searchPages({ query: '', cursor });
    batch.items.forEach((item) => ids.add(item.id));
    cursor = batch.nextCursor;
  } while (cursor);
  assert.equal(ids.size, 210);
  assert.throws(
    () => store.searchPages({ query: 'changed', cursor: store.searchPages({}).nextCursor }),
    /커서/,
  );
});

test('imports plain lines, a clickable URL and only chosen assets without changing the source', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({
    kind: 'link',
    text: '# 제목 그대로\n\n- 항목 그대로',
    url: 'https://example.com/a',
    files: [
      { key: 'one.png', name: '사진.png', mime: 'image/png', size: 12 },
      { key: 'two.md', name: '준비.md', mime: 'text/markdown', size: 18 },
    ],
  });
  const page = store.createPage({ title: '여행' });
  const result = store.importCaptureIntoPage({
    pageId: page.id,
    ...request(capture.id, { assetIds: [capture.files[0].id] }),
  });
  const added = result.item.document.blocks.slice(1);
  assert.equal(added[0].type, 'captureRef');
  assert.deepEqual(added[0].props, { captureId: capture.id });
  assert.deepEqual(
    added.filter((b) => b.type === 'paragraph').map((b) => b.content[0]?.text ?? ''),
    ['# 제목 그대로', '', '- 항목 그대로', ''],
  );
  assert.equal(added.at(-2).content[0].href, capture.url);
  assert.deepEqual(added.at(-1).props, { assetId: capture.files[0].id, display: 'image' });
  assert.equal(result.item.version, 2);
  assert.deepEqual(store.getCapture(capture.id), capture);
  assert.equal(store.linkedPages(capture.id)[0].id, page.id);
  assert.equal(JSON.stringify(result.item.document).includes('one.png'), false);
  const other = store.createPage({ title: '다른 여행' });
  store.importCaptureIntoPage({ pageId: other.id, ...request(capture.id, { copyContent: false }) });
  assert.equal(store.linkedPages(capture.id).length, 2);
  store.updatePage({
    ...result.item,
    document: { schemaVersion: 1, blocks: [paragraph('수정한 사본')] },
    expectedVersion: result.item.version,
  });
  assert.deepEqual(store.getCapture(capture.id), capture);
  assert.deepEqual(
    store.linkedPages(capture.id).map((p) => p.id),
    [other.id],
  );
});

test('a lost response retries once even after source edits and another store reopens', async (t) => {
  const { store, dir } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '처음 메모' });
  const page = store.createPage({ title: '정리' });
  const payload = { pageId: page.id, ...request(capture.id) };
  const result = store.importCaptureIntoPage(payload);
  store.updateCapture({ id: capture.id, text: '바뀐 원본', expectedVersion: 1 });
  const reopened = openStore(dir);
  try {
    assert.deepEqual(reopened.importCaptureIntoPage(payload), { ...result, replayed: true });
    assert.equal(reopened.getPage(page.id).version, 2);
    assert.throws(() => reopened.importCaptureIntoPage({ ...payload, copyContent: false }), {
      name: 'PageImportConflictError',
    });
    assert.throws(() => reopened.updatePage({ ...page, expectedVersion: 1 }), {
      name: 'PageConflictError',
    });
    assert.equal(reopened.linkedPages(capture.id).length, 1);
  } finally {
    reopened.close();
  }
});

test('child creation plus import is atomic and keeps its original parent on retry', async (t) => {
  const { store } = await fixture(t);
  const parent = store.createPage({ title: '여행 계획' });
  const capture = store.createCapture({ kind: 'note', text: '첫날 일정' });
  const payload = { title: '예약', parentId: parent.id, captureImport: request(capture.id) };
  const result = store.createPageWithCapture(payload);
  assert.equal(result.item.parentId, parent.id);
  assert.equal(result.item.document.blocks[0].type, 'captureRef');
  assert.deepEqual(store.createPageWithCapture(payload), { ...result, replayed: true });
  assert.equal(store.listPages().length, 2);
  assert.throws(() => store.createPageWithCapture({ ...payload, parentId: null }), {
    name: 'PageImportConflictError',
  });
  assert.deepEqual(store.getPage(parent.id), parent);
  assert.throws(
    () =>
      store.createPageWithCapture({
        title: '실패',
        captureImport: request(capture.id, { assetIds: [randomUUID()] }),
      }),
    /파일/,
  );
  assert.equal(store.listPages().length, 2);
});

test('invalid assets, operation IDs, missing targets and block limits leave no partial changes', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '원본' });
  const other = store.createCapture({
    kind: 'file',
    files: [{ key: 'x', name: 'x.txt', mime: 'text/plain', size: 1 }],
  });
  const page = store.createPage({ title: '정리' });
  for (const options of [
    { assetIds: [other.files[0].id] },
    { operationId: 'bad' },
    { copyContent: 'yes' },
  ]) {
    assert.throws(() =>
      store.importCaptureIntoPage({ pageId: page.id, ...request(capture.id, options) }),
    );
    assert.deepEqual(store.getPage(page.id), page);
    assert.deepEqual(store.linkedPages(capture.id), []);
  }
  assert.throws(
    () => store.importCaptureIntoPage({ pageId: randomUUID(), ...request(capture.id) }),
    { name: 'PageImportNotFoundError' },
  );
  assert.throws(() => store.importCaptureIntoPage({ pageId: page.id, ...request(randomUUID()) }), {
    name: 'PageImportNotFoundError',
  });
  const full = store.updatePage({
    ...page,
    expectedVersion: 1,
    document: { schemaVersion: 1, blocks: Array.from({ length: 1000 }, () => paragraph('x')) },
  });
  assert.throws(
    () => store.importCaptureIntoPage({ pageId: page.id, ...request(capture.id) }),
    /1,000/,
  );
  assert.deepEqual(store.getPage(page.id), full);
  assert.deepEqual(store.linkedPages(capture.id), []);
});

test('new references validate targets while existing missing references allow unrelated edits', async (t) => {
  const { store, dir } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '원본' });
  const page = store.createPage({ title: '페이지' });
  const result = store.importCaptureIntoPage({
    pageId: page.id,
    ...request(capture.id, { copyContent: false }),
  });
  const connection = new DatabaseSync(join(dir, 'storage.sqlite'));
  connection.prepare('DELETE FROM captures WHERE id = ?').run(capture.id);
  connection.close();
  const edited = store.updatePage({ ...result.item, title: '다른 부분 수정', expectedVersion: 2 });
  assert.equal(edited.version, 3);
  assert.throws(
    () =>
      store.updatePage({
        ...edited,
        expectedVersion: 3,
        document: {
          schemaVersion: 1,
          blocks: [
            ...edited.document.blocks,
            {
              id: randomUUID(),
              type: 'captureRef',
              props: { captureId: randomUUID() },
              children: [],
            },
          ],
        },
      }),
    /원본/,
  );
  assert.throws(
    () =>
      store.updatePage({
        ...edited,
        expectedVersion: 3,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: randomUUID(),
              type: 'asset',
              props: { assetId: '../secret', display: 'image' },
              children: [],
            },
          ],
        },
      }),
    /첨부/,
  );
});

test('legacy page links are indexed on migration and removed in the same save as their block', async (t) => {
  const { store, dir } = await fixture(t);
  const child = store.createPage({ title: '하위' });
  const page = store.createPage({ title: '상위' });
  const document = {
    schemaVersion: 1,
    blocks: [{ id: 'page-link', type: 'page', props: { pageId: child.id }, children: [] }],
  };
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.prepare('UPDATE pages SET document = ? WHERE id = ?').run(JSON.stringify(document), page.id);
  db.exec('DROP TABLE page_references; DROP TABLE page_connection_migrations;');
  db.close();
  const reopened = openStore(dir);
  try {
    const check = new DatabaseSync(join(dir, 'storage.sqlite'));
    assert.equal(
      check.prepare('SELECT target_id FROM page_references WHERE page_id = ?').get(page.id)
        .target_id,
      child.id,
    );
    reopened.updatePage({
      ...reopened.getPage(page.id),
      expectedVersion: 1,
      document: { schemaVersion: 1, blocks: [paragraph('새 본문')] },
    });
    assert.equal(
      check.prepare('SELECT COUNT(*) AS n FROM page_references WHERE page_id = ?').get(page.id).n,
      0,
    );
    check.close();
  } finally {
    reopened.close();
  }
});
