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
  const visit = blocks => blocks.flatMap(b => [b, ...visit(b.children || [])]);
  const blocks = visit(page.document.blocks);
  for (const type of ['heading', 'table', 'codeBlock', 'callout', 'diagram', 'toggleListItem'])
    assert.ok(blocks.some(b => b.type === type), type);
  assert.equal(blocks.filter(b => b.type === 'tableOfContents').length, 1, 'reuse one native table of contents');
  const html = renderSharedPage(page, 'fixture', new Map());
  assert.equal((html.match(/aria-label="목차"/g) || []).length, 1);
  for (const term of ['전체 구조', 'server/index.mjs', 'OpenCode', 'IndexedDB', '블록 JSON'])
    assert.ok(html.includes(term), term);
  assert.ok(!html.includes('app.example.com'));
  const edited = store.updatePage({ ...page, title: '내가 수정한 구조 문서', expectedVersion: page.version });
  const preserved = await ensureArchitecturePage(store);
  assert.equal(preserved.title, edited.title);
  assert.equal(preserved.version, edited.version);
  assert.equal(store.listPages().length, 1);
  const chapters = blocks.filter(b => b.type === 'heading' && b.props.level === 1);
  assert.ok(blocks.some(b => b.type === 'heading' && b.props.level === 2));
  assert.ok(blocks.some(b => b.type === 'heading' && b.props.level === 3));
  assert.equal((html.match(/class="page-toc-item"/g) || []).length, 9);
  assert.equal(chapters.length, 9, 'the native TOC exposes the nine representative chapters');
  chapters.forEach((b, index) => assert.ok(b.props.level === 1 && b.content.some(c => c.text.startsWith(`${index + 1}. `))));
  assert.ok(!blocks.some(b => b.type === 'page'), 'guide does not depend on separate documents');
});
