import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shared from '../shared/pageValidation.mjs';
import * as server from '../server/pages.mjs';
const paragraph = (id, text = '') => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] });
const document = (blocks) => ({ schemaVersion: 1, blocks });

test('server exports the shared validators and error classes without wrappers', () => {
  assert.deepEqual(Object.keys(server), Object.keys(shared));
  for (const name of Object.keys(shared)) assert.equal(server[name], shared[name]);
  assert.equal(shared.cleanPageTitle('  '), '제목 없음');
  assert.equal(shared.cleanPageIcon(undefined), '');
  assert.equal(shared.cleanPageParentId(null), null);
});

test('shared preflight preserves block count, string length, links and table bounds', () => {
  const reject = (value, message) => {
    assert.throws(() => shared.serializePageDocument(value), (error) => error instanceof server.PageValidationError && error.message === message);
  };
  assert.doesNotThrow(() => shared.serializePageDocument(document(Array.from({ length: 1000 }, (_, i) => paragraph(String(i))))));
  reject(document(Array.from({ length: 1001 }, (_, i) => paragraph(String(i)))), '페이지는 최대 1,000개 블록까지 저장합니다.');
  assert.doesNotThrow(() => shared.serializePageDocument(document([paragraph('a', '가'.repeat(50000))])));
  reject(document([paragraph('a', '가'.repeat(50001))]), '한 블록의 내용이 너무 깁니다.');
  for (const href of ['javascript:alert(1)', '//evil.example', 'data:text/html,test']) {
    const block = paragraph('a'); block.content = [{ type: 'link', href, content: [] }];
    reject(document([block]), '사용할 수 없는 링크가 포함돼 있습니다.');
  }
  const table = (rows, columns) => document([{ id: 't', type: 'table', props: {}, content: { type: 'tableContent', rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: columns }, () => []) })) }, children: [] }]);
  assert.doesNotThrow(() => shared.serializePageDocument(table(200, 30)));
  reject(table(201, 1), '표 데이터가 올바르지 않습니다.');
  reject(table(1, 31), '표 데이터가 올바르지 않습니다.');
  reject(table(1, 0), '표 데이터가 올바르지 않습니다.');
});

test('portable UTF8 byte limit matches Node Buffer for multibyte documents', () => {
  const below = document(Array.from({ length: 6 }, (_, i) => paragraph(String(i), '가'.repeat(50000))));
  const serialized = shared.serializePageDocument(below);
  assert.equal(new TextEncoder().encode(serialized).byteLength, Buffer.byteLength(serialized));
  assert.ok(Buffer.byteLength(serialized) < 1024 * 1024);
  const above = document(Array.from({ length: 8 }, (_, i) => paragraph(String(i), '가'.repeat(50000))));
  assert.ok(Buffer.byteLength(JSON.stringify(above)) > 1024 * 1024);
  assert.throws(() => shared.serializePageDocument(above), /페이지는 최대 1MB까지 저장합니다/);
});
