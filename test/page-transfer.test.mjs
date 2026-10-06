import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createPageChange, applyPageChange } from '../scripts/page-transfer.mjs';

test('one-page transfer preserves unrelated data, rejects concurrent edits and is safe to retry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anotar-transfer-'));
  const targetDir = join(root, 'target'), baseline = join(root, 'base'), localDir = join(root, 'local');
  await Promise.all([targetDir, baseline, localDir].map(d => mkdir(d)));
  let target = openStore(targetDir);
  const original = target.createPage({ title: 'original' });
  const unrelated = target.createPage({ title: 'unrelated' });
  target.close();
  await copyFile(join(targetDir, 'storage.sqlite'), join(baseline, 'storage.sqlite'));
  await copyFile(join(targetDir, 'storage.sqlite'), join(localDir, 'storage.sqlite'));
  const local = openStore(localDir); target = openStore(targetDir);
  t.after(async () => { local.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  local.updatePage({ ...original, title: 'local edit', expectedVersion: original.version });
  const change = createPageChange(baseline, localDir, original.id);
  const dry = applyPageChange(target, change, { dryRun: true });
  assert.equal(dry.title, 'local edit');
  assert.equal(target.getPage(original.id).title, 'original');
  const applied = applyPageChange(target, change);
  assert.equal(applied.title, 'local edit');
  assert.equal(applied.version, original.version + 1);
  assert.equal(applyPageChange(target, change).version, applied.version);
  assert.deepEqual(target.getPage(unrelated.id), unrelated);
  target.updatePage({ ...applied, title: 'server edit', expectedVersion: applied.version });
  assert.throws(() => applyPageChange(target, change), /먼저 수정|충돌/);
  assert.equal(target.getPage(original.id).title, 'server edit');
});

test('new-page transfer refuses absent attachments before creating any page', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anotar-transfer-new-'));
  const targetDir = join(root, 'target'), baseline = join(root, 'base'), localDir = join(root, 'local');
  await Promise.all([targetDir, baseline, localDir].map(d => mkdir(d)));
  let target = openStore(targetDir); target.close();
  await copyFile(join(targetDir, 'storage.sqlite'), join(baseline, 'storage.sqlite'));
  const local = openStore(localDir); target = openStore(targetDir);
  t.after(async () => { local.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  const page = local.createPage({ title: 'new document' });
  const change = createPageChange(baseline, localDir, page.id);
  for (const [type, prop, message] of [
    ['page', 'pageId', /연결할 페이지/],
    ['captureRef', 'captureId', /원본 메모/],
  ]) {
    const missingReference = structuredClone(change);
    missingReference.page.document.blocks = [{ id: 'reference-block', type, props: { [prop]: 'f3c58ea3-9b03-4a3f-949c-e944d128e79e' }, children: [] }];
    for (const dryRun of [true, false])
      assert.throws(() => applyPageChange(target, missingReference, { dryRun }), message);
    assert.equal(target.listPages().length, 0);
  }
  const missing = structuredClone(change);
  missing.page.document.blocks = [{ id: 'file-block', type: 'asset', props: { assetId: 'f3c58ea3-9b03-4a3f-949c-e944d128e79e' }, children: [] }];
  assert.throws(() => applyPageChange(target, missing), /첨부/);
  assert.equal(target.listPages().length, 0);
  const file = target.createCapture({ kind: 'file', files: [{ key: 'fixture-text', name: 'note.txt', mime: 'text/plain', size: 1 }] });
  const nonImage = structuredClone(change);
  nonImage.page.document.blocks = [{ id: 'map-block', type: 'map', props: { latitude: 0, longitude: 0, zoom: 5, label: 'fixture', assetId: file.files[0].id }, children: [] }];
  for (const dryRun of [true, false])
    assert.throws(() => applyPageChange(target, nonImage, { dryRun }), /이미지 파일/);
  assert.equal(target.listPages().length, 0);
  const selfLink = structuredClone(change);
  selfLink.page.document.blocks = [{ id: 'self-link', type: 'page', props: { pageId: page.id }, children: [] }];
  assert.equal(applyPageChange(target, selfLink, { dryRun: true }).id, page.id);
  const created = applyPageChange(target, change);
  assert.equal(created.id, page.id);
  assert.equal(applyPageChange(target, change).version, created.version);
});
