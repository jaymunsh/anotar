import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileChildPageLinks } from '../shared/childPageLinks.ts';
import { openStore } from '../server/store.mjs';

const parent = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const one = { id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', parentId: parent, title: '첫 문서', position: 0 };
const two = { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', parentId: parent, title: '둘째 문서', position: 1 };
const blank = { id: 'blank', type: 'paragraph', props: {}, content: [], children: [] };
const link = { id: 'manual', type: 'page', props: { pageId: one.id, title: one.title }, children: [] };

test('missing direct children appear once before the trailing writing paragraph; existing nested link keeps its position', () => {
  const existing = { id: 'nested', type: 'toggleListItem', props: {}, content: [], children: [link] };
  const blocks = [existing, blank];
  const pages = [two, one, { ...two, id: 'grandchild', parentId: one.id }];
  const result = reconcileChildPageLinks(blocks, parent, pages);
  assert.equal(result[0], existing);
  assert.equal(result[1].props.pageId, two.id);
  assert.equal(result[2], blank);
  assert.equal(reconcileChildPageLinks(result, parent, pages), result);
  assert.deepEqual(blocks, [existing, blank]);
});

test('deleted mandatory links return; moved children remove only managed links; manual links remain references', () => {
  const result = reconcileChildPageLinks([blank], parent, [one, two]);
  assert.deepEqual(result.slice(0, 2).map(b => b.props.pageId), [one.id, two.id]);
  assert.deepEqual(reconcileChildPageLinks(result.filter(b => b.props?.pageId !== two.id), parent, [one, two]), result);
  const moved = reconcileChildPageLinks([...result, link], parent, [{ ...one, parentId: null }, two]);
  assert.equal(moved.some(b => b.id === 'child-page-' + one.id), false);
  assert.ok(moved.includes(link));
  const explicit = reconcileChildPageLinks([result[0], link, blank], parent, [one]);
  assert.deepEqual(explicit, [link, blank], 'An explicit link replaces a generated fallback without duplication');
  const withNotes = { ...result[0], children: [{ ...blank, id: 'personal-notes', content: [{ type: 'text', text: '보존할 메모', styles: {} }] }] };
  assert.deepEqual(reconcileChildPageLinks([withNotes], parent, []), [withNotes], 'Reparenting must not discard user content nested under a generated link');
});

test('saving and restoring snapshots cannot omit live child links or overwrite other content; lock still rejects writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anotar-child-links-'));
  const store = openStore(dir);
  try {
    const p = store.createPage({ title: '상위 문서' });
    const a = store.createPage({ title: '하위 하나', parentId: p.id });
    const b = store.createPage({ title: '하위 둘', parentId: p.id });
    const updated = store.updatePage({ ...p, expectedVersion: p.version, document: { schemaVersion: 1, blocks: [blank] } });
    assert.deepEqual(updated.document.blocks.filter(x => x.type === 'page').map(x => x.props.pageId), [a.id, b.id]);
    assert.equal(updated.document.blocks.at(-1).id, blank.id);
    const restored = store.restorePageRevision({ pageId: p.id, expectedVersion: updated.version, revisionVersion: p.version, operationId: crypto.randomUUID() }).item;
    assert.deepEqual(restored.document.blocks.filter(x => x.type === 'page').map(x => x.props.pageId), [a.id, b.id]);
    store.setPageLock({ id: p.id, locked: true, expectedLockVersion: 0, expectedVersion: restored.version });
    assert.throws(() => store.updatePage({ ...restored, expectedVersion: restored.version, document: { schemaVersion: 1, blocks: [blank] } }), /잠금/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('removing the final generated link leaves a valid writing paragraph', () => {
  const generated = reconcileChildPageLinks([], parent, [one]);
  const result = reconcileChildPageLinks(generated, parent, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'paragraph');
  assert.deepEqual(result[0].content, []);
});
