import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

const paragraph = (id, text, children = []) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children,
});
const doc = (...blocks) => ({ schemaVersion: 1, blocks });
const selection = { template: null, additional: '간결하게 정리' };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-page-lifecycle-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, dir };
}
function ready(store, page, blockIds) {
  const job = store.enqueuePageAiJob({
    pageId: page.id,
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: selection,
    blockIds,
  });
  const run = store.claimAiJob();
  assert.equal(run.id, job.id);
  store.completeAiJob(run.id, run.runToken, { markdown: 'AI 결과', sources: [], usage: null });
  return store.getAiJob(job.id);
}
test('organize transfer, provenance and search/file routing commit together; restore and legacy replay are durable', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({
    kind: 'note',
    text: '원본 검색고유어',
    files: [{ key: 'retained', name: '첨부고유어.txt', mime: 'text/plain', size: 1 }],
  });
  const operationId = randomUUID();
  const args = {
    title: '정리 문서',
    captureImport: {
      operationId,
      captureId: capture.id,
      copyContent: true,
      assetIds: capture.files.map((x) => x.id),
      disposition: 'organize',
    },
  };
  const result = store.createPageWithCapture(args);
  assert.equal(result.replayed, false);
  assert.equal(
    result.item.document.blocks.some((b) => b.type === 'captureRef'),
    false,
  );
  const original = store.getCapture(capture.id);
  assert.equal(original.organizedOperationId, operationId);
  assert.equal(original.organizedPageId, result.item.id);
  assert.equal(original.version, capture.version);
  assert.equal(original.updatedAt, capture.updatedAt);
  assert.equal(store.listCaptures().length, 0);
  assert.equal(store.captureCounts().memo, 0);
  assert.equal(store.listCaptures({ organization: 'organized' }).length, 1);
  assert.equal(store.searchRecords({ query: '검색고유어', type: 'memo' }).items.length, 0);
  assert.equal(
    store.searchRecords({ query: '첨부고유어', type: 'file' }).items[0].href,
    '/pages/' + result.item.id,
  );
  assert.equal(store.pageOrigins(result.item.id)[0].capture.id, capture.id);
  const restore = {
    id: capture.id,
    operationId: randomUUID(),
    expectedOrganizedOperationId: operationId,
  };
  assert.equal(store.unorganizeCapture(restore).replayed, false);
  assert.equal(store.unorganizeCapture(restore).replayed, true);
  assert.equal(store.createPageWithCapture(args).replayed, true);
  assert.equal(store.getCapture(capture.id).organizedAt, null);
  assert.equal(store.listCaptures().length, 1);
  const again = store.createPageWithCapture({
    ...args,
    captureImport: { ...args.captureImport, operationId: randomUUID() },
  });
  assert.equal(store.unorganizeCapture(restore).replayed, true);
  assert.equal(store.getCapture(capture.id).organizedPageId, again.item.id);
  assert.throws(
    () => store.unorganizeCapture({ ...restore, operationId: randomUUID() }),
    /정리|변경/,
  );
  const legacy = store.createPageWithCapture({
    title: '복사',
    captureImport: {
      operationId: randomUUID(),
      captureId: capture.id,
      copyContent: false,
      assetIds: [],
    },
  });
  assert.equal(legacy.item.document.blocks[0].type, 'captureRef');
  assert.equal(store.pageOrigins(legacy.item.id)[0].capture.id, capture.id);
});
test('organization rolls back with provenance/receipt and unreferenced organized files disappear from default search', async (t) => {
  const { store, dir } = await fixture(t);
  const capture = store.createCapture({
    kind: 'note',
    text: '원본',
    files: [{ key: 'retained', name: '비공개고유어.txt', mime: 'text/plain', size: 1 }],
  });
  const external = new DatabaseSync(join(dir, 'storage.sqlite'));
  external.exec(
    "CREATE TRIGGER reject_origin BEFORE INSERT ON page_origins BEGIN SELECT RAISE(ABORT, 'origin rollback'); END",
  );
  assert.throws(
    () =>
      store.createPageWithCapture({
        captureImport: {
          operationId: randomUUID(),
          captureId: capture.id,
          copyContent: true,
          assetIds: [],
          disposition: 'organize',
        },
      }),
    /origin rollback/,
  );
  assert.equal(store.listPages().length, 0);
  assert.equal(store.getCapture(capture.id).organizedAt, null);
  external.exec('DROP TRIGGER reject_origin');
  const result = store.createPageWithCapture({
    captureImport: {
      operationId: randomUUID(),
      captureId: capture.id,
      copyContent: true,
      assetIds: [],
      disposition: 'organize',
    },
  });
  assert.equal(store.searchRecords({ query: '비공개고유어', type: 'file' }).items.length, 0);
  store.trashRecord({
    kind: 'page',
    id: result.item.id,
    operationId: randomUUID(),
    expectedVersion: result.item.version,
  });
  assert.equal(store.getCapture(capture.id).text, capture.text);
  assert.equal(store.getCapture(capture.id).files[0].key, 'retained');
  external.close();
});
test('Page jobs use saved immutable Markdown, skip private references, replay after edits, and retry the old snapshot', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '비밀 원문' });
  let page = store.createPage({ title: '저장한 제목' });
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: doc(paragraph('one', '저장한 본문'), {
      id: 'hidden',
      type: 'captureRef',
      props: { captureId: capture.id },
      children: [],
    }),
  });
  const body = {
    pageId: page.id,
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: selection,
  };
  const job = store.enqueuePageAiJob(body);
  assert.equal(job.captureId, null);
  assert.equal(job.pageId, page.id);
  assert.deepEqual(job.targetBlockIds, []);
  assert.match(job.request.input.content, /저장한 제목.*\n.*저장한 본문/s);
  assert.doesNotMatch(job.request.input.content, /비밀|captureRef|hidden/);
  assert.deepEqual(job.sourceDocument, page.document);
  page = store.updatePage({ ...page, title: '새 제목', expectedVersion: page.version });
  assert.equal(store.enqueuePageAiJob(body).id, job.id);
  assert.throws(
    () => store.enqueuePageAiJob({ ...body, aiRequest: { ...selection, additional: '다름' } }),
    /다른/,
  );
  const run = store.claimAiJob();
  store.failAiJob(run.id, run.runToken, 'timeout');
  const retry = store.enqueuePageAiJob({
    pageId: page.id,
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: selection,
    retryOf: job.id,
  });
  assert.equal(retry.sourceVersion, job.sourceVersion);
  assert.deepEqual(retry.sourceDocument, job.sourceDocument);
  assert.equal(retry.request.prompt, job.request.prompt);
});
test('append and undo are atomic, replay safely, and refuse intervening edits', async (t) => {
  const { store, dir } = await fixture(t);
  let page = store.createPage({ title: '문서' });
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: doc(paragraph('keep', '보존')),
  });
  const job = ready(store, page);
  page = store.updatePage({ ...page, title: '직접 수정', expectedVersion: page.version });
  const body = {
    pageId: page.id,
    operationId: randomUUID(),
    expectedVersion: page.version,
    jobId: job.id,
    mode: 'append',
    document: doc(paragraph('keep', '결과')),
  };
  const external = new DatabaseSync(join(dir, 'storage.sqlite'));
  external.exec(
    "CREATE TRIGGER reject_apply BEFORE INSERT ON page_ai_applies BEGIN SELECT RAISE(ABORT, 'apply rollback'); END",
  );
  assert.throws(() => store.applyPageAiJob(body), /apply rollback/);
  assert.deepEqual(store.getPage(page.id), page);
  external.exec('DROP TRIGGER reject_apply');
  const applied = store.applyPageAiJob(body);
  assert.equal(applied.item.document.blocks[0].id, 'keep');
  assert.notEqual(applied.item.document.blocks[1].id, 'keep');
  assert.equal(store.applyPageAiJob(body).replayed, true);
  const undo = {
    pageId: page.id,
    applyOperationId: body.operationId,
    operationId: randomUUID(),
    expectedVersion: applied.item.version,
  };
  const undone = store.undoPageAiApply(undo);
  assert.deepEqual(undone.item.document, page.document);
  assert.equal(undone.item.title, '직접 수정');
  assert.equal(store.undoPageAiApply(undo).replayed, true);
  assert.equal(store.getAiJob(job.id).result.markdown, 'AI 결과');
  const second = store.applyPageAiJob({
    ...body,
    operationId: randomUUID(),
    expectedVersion: undone.item.version,
  });
  store.updatePage({ ...second.item, title: '새 편집', expectedVersion: second.item.version });
  assert.throws(
    () =>
      store.undoPageAiApply({
        ...undo,
        applyOperationId: second.operationId,
        operationId: randomUUID(),
        expectedVersion: second.item.version,
      }),
    /수정|버전/,
  );
  external.close();
});
test('selected nested replacement preserves siblings and refuses stale pages; child leaves source untouched', async (t) => {
  const { store } = await fixture(t);
  let page = store.createPage();
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: doc(
      paragraph('parent', '상위', [paragraph('selected', '선택'), paragraph('sibling', '형제')]),
      paragraph('other', '다른 블록'),
    ),
  });
  const job = ready(store, page, ['selected']);
  assert.match(job.request.input.content, /선택/);
  assert.doesNotMatch(job.request.input.content, /상위|형제|다른 블록/);
  const body = {
    pageId: page.id,
    operationId: randomUUID(),
    expectedVersion: page.version,
    jobId: job.id,
    mode: 'replace',
    document: doc(paragraph('new', '교체')),
  };
  const result = store.applyPageAiJob(body);
  assert.equal(result.item.document.blocks[0].children[1].id, 'sibling');
  assert.equal(result.item.document.blocks[1].id, 'other');
  assert.throws(
    () =>
      store.applyPageAiJob({
        ...body,
        expectedVersion: result.item.version,
        operationId: randomUUID(),
      }),
    /수정|버전/,
  );
  const child = store.applyPageAiJob({
    ...body,
    expectedVersion: result.item.version,
    operationId: randomUUID(),
    mode: 'child',
    title: '결과 하위',
  });
  assert.equal(child.item.parentId, page.id);
  assert.deepEqual(store.getPage(page.id), result.item);
  assert.throws(
    () =>
      store.undoPageAiApply({
        pageId: page.id,
        applyOperationId: child.operationId,
        operationId: randomUUID(),
        expectedVersion: result.item.version,
      }),
    /휴지통|하위/,
  );
});
test('legacy ai_jobs migration preserves UUIDs, retries, snapshots and run tokens, and upgrades search triggers once', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-lifecycle-migration-'));
  let store = openStore(dir);
  const capture = store.createCapture({ kind: 'note', text: '기존 입력', aiRequest: selection });
  let run = store.claimAiJob();
  store.failAiJob(run.id, run.runToken, 'timeout');
  const retryArgs = {
    captureId: capture.id,
    requestId: randomUUID(),
    expectedVersion: 1,
    retryOf: run.id,
  };
  const retry = store.enqueueAiJob(retryArgs);
  run = store.claimAiJob();
  const original = store.getAiJob(run.id);
  store.close();
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  // Build an actual pre-extension fixture: these triggers did not exist in v2.
  for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'search_extra_%'").all()) db.exec(`DROP TRIGGER ${name}`);
  db.exec("DELETE FROM search_schema_migrations WHERE name='results-tasks-ocr-v1'");
  db.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE legacy_jobs (
      id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,
      capture_id TEXT NOT NULL REFERENCES captures(id),source_version INTEGER NOT NULL,
      request_json TEXT NOT NULL,retry_of TEXT REFERENCES ai_jobs(id),status TEXT NOT NULL,
      run_token TEXT,runner_json TEXT,result_json TEXT,error_code TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,finished_at TEXT
    );
    INSERT INTO legacy_jobs SELECT id,request_id,fingerprint,capture_id,source_version,request_json,retry_of,status,run_token,runner_json,result_json,error_code,created_at,updated_at,started_at,finished_at FROM ai_jobs;
    DROP TABLE ai_jobs; ALTER TABLE legacy_jobs RENAME TO ai_jobs;
    UPDATE search_meta SET version=2;
    DROP TRIGGER search_capture_update;
    CREATE TRIGGER search_capture_update AFTER UPDATE OF text,url,ai_request,deleted_at ON captures BEGIN UPDATE search_state SET revision=revision+1; END;`);
  db.close();
  store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(store.getAiJob(retry.id), original);
  assert.equal(store.enqueueAiJob(retryArgs).id, retry.id);
  assert.equal(
    store.completeAiJob(run.id, run.runToken, {
      markdown: '기존 실행 결과',
      sources: [],
      usage: null,
    }),
    true,
  );
  const page = store.createPageWithCapture({
    captureImport: {
      operationId: randomUUID(),
      captureId: capture.id,
      copyContent: true,
      assetIds: [],
      disposition: 'organize',
    },
  });
  assert.equal(store.searchRecords({ query: '기존 입력', type: 'ai' }).items.length, 0);
  const inspect = new DatabaseSync(join(dir, 'storage.sqlite'));
  assert.equal(inspect.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(inspect.prepare('SELECT version FROM search_meta').get().version, 3);
  const revision = inspect.prepare('SELECT revision FROM search_state').get().revision;
  inspect.close();
  const reopened = openStore(dir);
  assert.equal(reopened.pageOrigins(page.item.id)[0].capture.id, capture.id);
  const after = new DatabaseSync(join(dir, 'storage.sqlite'));
  assert.equal(after.prepare('SELECT revision FROM search_state').get().revision, revision);
  after.close();
  reopened.close();
});
test('overlapping selected parent/child IDs are recorded exactly, emitted once, and replaced once', async (t) => {
  const { store } = await fixture(t);
  let page = store.createPage();
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: doc(
      paragraph('parent', '上위', [paragraph('child', '중복 방지')]),
      paragraph('keep', '보존'),
    ),
  });
  const job = ready(store, page, ['parent', 'child']);
  assert.deepEqual(job.targetBlockIds, ['parent', 'child']);
  assert.equal(job.request.input.content.split('중복 방지').length, 2);
  const result = store.applyPageAiJob({
    pageId: page.id,
    operationId: randomUUID(),
    expectedVersion: page.version,
    jobId: job.id,
    mode: 'replace',
    document: doc(paragraph('result', '제안')),
  });
  assert.equal(result.item.document.blocks.length, 2);
  assert.equal(result.item.document.blocks[1].id, 'keep');
});
test('legacy origins stay available from Page info after replacing their hidden parent block', async (t) => {
  const { store, dir } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '보존할 원본' });
  let page = store.createPage();
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: doc(
      paragraph('parent', '선택할 상위', [
        { id: 'legacy', type: 'captureRef', props: { captureId: capture.id }, children: [] },
      ]),
    ),
  });
  const reopened = openStore(dir);
  const job = ready(reopened, page, ['parent']);
  reopened.applyPageAiJob({
    pageId: page.id,
    operationId: randomUUID(),
    expectedVersion: page.version,
    jobId: job.id,
    mode: 'replace',
    document: doc(paragraph('result', '선택 결과')),
  });
  assert.equal(reopened.pageOrigins(page.id)[0].capture.id, capture.id);
  reopened.close();
});
test('organizing an explicitly empty choice creates an empty editable page without source cards', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '선택하지 않은 본문' });
  const result = store.createPageWithCapture({
    captureImport: {
      operationId: randomUUID(),
      captureId: capture.id,
      copyContent: false,
      assetIds: [],
      disposition: 'organize',
    },
  });
  assert.equal(result.item.document.blocks.length, 1);
  assert.equal(result.item.document.blocks[0].type, 'paragraph');
  assert.deepEqual(result.item.document.blocks[0].content, []);
  assert.equal(store.listCaptures().length, 0);
});
