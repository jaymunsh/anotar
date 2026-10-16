import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../server/store.mjs';

test('seed-examples fills an empty workspace once and never overwrites', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-seed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = () =>
    JSON.parse(execFileSync(process.execPath, ['scripts/seed-examples.mjs', dir], { encoding: 'utf8' }));
  assert.equal(run().created.length, 4);
  let store = openStore(dir);
  const pages = store.listPages();
  const guide = pages.find((p) => p.title.includes('Markdown'));
  assert.ok(guide && guide.parentId);
  const arch = store.getPage('546e1325-762b-4ea4-9ce5-a37e4c43d2b5');
  assert.ok(arch.document.blocks.length > 100);
  // Edited pages survive a second run.
  store.updatePage({ id: arch.id, title: 'edited', document: arch.document, expectedVersion: arch.version });
  store.close();
  const second = run();
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 3);
  store = openStore(dir);
  assert.equal(store.getPage(arch.id).title, 'edited');
  assert.equal(store.listPages().length, 4);
  store.close();
});
