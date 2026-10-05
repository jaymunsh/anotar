import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const profile = await mkdtemp(join(tmpdir(), 'leneu-offline-profile-'));
let context;
const output = await build({
  stdin: {
    contents:
      "import * as repo from './src/sync/repository.ts'; import {writeAttachmentDraft} from './src/drafts/attachmentDraft.ts'; window.repo=repo; window.writeLegacyFiles=writeAttachmentDraft;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/test.js' ? output.outputFiles[0].text : '<script src="/test.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const p = await context.newPage();
  await p.goto(base);
  return p;
}
try {
  let page = await launch();
  await page.evaluate(async () => {
    await repo.saveLocalEntity({
      workspaceId: 'w1',
      kind: 'capture',
      id: 'one',
      value: { text: '한글 원문' },
      blobs: [
        {
          id: 'b1',
          blob: new Blob(['exact bytes']),
          name: 'a.txt',
          mime: 'text/plain',
          hash: 'hash',
        },
      ],
    });
    localStorage.setItem(
      'leneu:capture-draft:v1:legacy',
      JSON.stringify({ schemaVersion: 1, value: { input: { text: 'legacy' }, fileCount: 1 } }),
    );
    await writeLegacyFiles('legacy', [
      new File(['legacy exact bytes'], 'old.txt', { type: 'text/plain' }),
    ]);
    localStorage.setItem('leneu:capture-submit:v1:legacy', '{"receipt":"keep"}');
    const first = await repo.migrateLegacyDrafts({ workspaceId: 'w1' }),
      second = await repo.migrateLegacyDrafts({ workspaceId: 'w1' });
    if (first.migrated !== 2 || second.migrated !== 0) throw Error('legacy duplicate migration');
    const archive = await repo.readRecord('meta', 'w1', 'legacy', 'leneu:capture-draft:v1:legacy');
    if ((await archive.files[0].text()) !== 'legacy exact bytes')
      throw Error('legacy attachment loss');
    if (!localStorage.getItem('leneu:capture-submit:v1:legacy')) throw Error('legacy receipt loss');
  });
  await context.close();
  page = await launch();
  const saved = await page.evaluate(async () => ({
    entity: await repo.readLocalEntity({ workspaceId: 'w1', kind: 'capture', id: 'one' }),
    other: await repo.readLocalEntity({ workspaceId: 'w2', kind: 'capture', id: 'one' }),
    bytes: await (await repo.readLocalBlob('w1', 'b1')).blob.text(),
  }));
  assert.equal(saved.entity.current.text, '한글 원문');
  assert.equal(saved.entity.localRevision, 1);
  assert.equal(saved.other, undefined);
  assert.equal(saved.bytes, 'exact bytes');
  const aborted = await page.evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('fixture quota', 'QuotaExceededError');
    };
    let failed = false;
    try {
      await repo.saveLocalEntity({
        workspaceId: 'w1',
        kind: 'capture',
        id: 'failed',
        value: { text: 'must not save' },
      });
    } catch {
      failed = true;
    }
    localStorage.setItem(
      'leneu:page-draft:v1:blocked',
      '{"schemaVersion":1,"value":{"text":"keep"}}',
    );
    const migrated = await repo.migrateLegacyDrafts({ workspaceId: 'w1' });
    IDBObjectStore.prototype.put = original;
    return {
      failed,
      missing: !(await repo.readLocalEntity({ workspaceId: 'w1', kind: 'capture', id: 'failed' })),
      preserved: !!localStorage.getItem('leneu:page-draft:v1:blocked'),
      migrationFailed: migrated.failed,
    };
  });
  assert.deepEqual(aborted, { failed: true, missing: true, preserved: true, migrationFailed: 1 });
  console.log(
    'PASS repository: persistent profile restart, exact Blob, partitions, duplicate-safe legacy migration, abort/quota preservation',
  );
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
