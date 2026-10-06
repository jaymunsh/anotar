import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from '../scripts/seed-architecture.mjs';
import { renderSharedPage } from '../server/publicPage.mjs';

test('architecture is an editable native page that can use the ordinary public renderer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-architecture-'));
  const store = openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const page = await ensureArchitecturePage(store);
  assert.equal(page.document.schemaVersion, 1);
  for (const type of ['heading', 'table', 'tableOfContents', 'codeBlock', 'callout'])
    assert.ok(page.document.blocks.some(b => b.type === type), type);
  const html = renderSharedPage(page, 'fixture', new Map());
  for (const term of ['현재 운영 구조', 'server/index.mjs', 'OpenCode', 'IndexedDB', '블록 JSON'])
    assert.ok(html.includes(term), term);
  assert.ok(!html.includes('app.example.com'));
  const edited = store.updatePage({ ...page, title: '내가 수정한 구조 문서', expectedVersion: page.version });
  const preserved = await ensureArchitecturePage(store);
  assert.equal(preserved.title, edited.title);
  assert.equal(preserved.version, edited.version);
  assert.equal(store.listPages().length, 1);
});
