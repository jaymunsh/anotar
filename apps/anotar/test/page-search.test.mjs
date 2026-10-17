import test from 'node:test';
import assert from 'node:assert/strict';
import { pagePath, searchPages } from '../src/pages/pageSearch.ts';

const pages = [
  { id: 'trip', title: '교토 여행', icon: '', parentId: null, updatedAt: '2026-10-01' },
  { id: 'pack', title: '준비물', icon: '', parentId: 'trip', updatedAt: '2026-10-03' },
  { id: 'pack2', title: '준비물', icon: '', parentId: 'camp', updatedAt: '2026-10-02' },
  { id: 'camp', title: '캠핑', icon: '', parentId: null, updatedAt: '2026-09-01' },
  { id: 'loop', title: 'loop', icon: '', parentId: 'loop', updatedAt: '2026-08-01' },
];

test('pagePath shows ancestors and survives cycles', () => {
  const byId = new Map(pages.map((p) => [p.id, p]));
  assert.equal(pagePath(pages[1], byId), '교토 여행');
  assert.equal(pagePath(pages[0], byId), '');
  assert.equal(pagePath(pages[4], byId), '');
});

test('searchPages: recent first when empty, title hits before path hits', () => {
  assert.deepEqual(searchPages(pages, '', 3).map((r) => r.page.id), ['pack', 'pack2', 'trip']);
  assert.deepEqual(searchPages(pages, '교토').map((r) => r.page.id), ['trip', 'pack']);
  assert.deepEqual(searchPages(pages, '준비물 캠핑').map((r) => r.page.id), ['pack2']);
  assert.deepEqual(searchPages(pages, '없는'), []);
});
