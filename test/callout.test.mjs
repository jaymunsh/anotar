import test from 'node:test';
import assert from 'node:assert/strict';
import { serializePageDocument } from '../shared/pageValidation.mjs';
import { renderSharedPage, referencedAssetIds } from '../server/publicPage.mjs';
import { renderPageMarkdown } from '../shared/pageMarkdown.ts';
import { listSharedCommentableBlocks } from '../shared/pageComments.ts';

const block = (props = {}) => ({
  id: 'callout-example', type: 'callout',
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', icon: 'lightbulb', border: true, ...props },
  content: [{ type: 'text', text: '출발 전에 확인 <script>alert(1)</script>', styles: { bold: true } }],
  children: [{ id: 'child', type: 'paragraph', props: {}, content: [{ type: 'text', text: '여권과 예약 내역', styles: {} }], children: [] }],
});
const document = (value) => ({ schemaVersion: 1, blocks: [value] });

test('callouts preserve inline styles, children and all supported appearances in the stored document', () => {
  for (const backgroundColor of ['default','gray','brown','red','orange','yellow','green','blue','purple','pink']) {
    const value = document(block({ backgroundColor, border: false, icon: 'warning' }));
    assert.deepEqual(JSON.parse(serializePageDocument(value)), value);
  }
  assert.doesNotThrow(() => serializePageDocument(document(block({ icon: 'none' }))));
});

test('callout appearance accepts finite values and rejects arbitrary HTML, CSS and unsafe links', () => {
  for (const props of [{ icon: '<img onerror=alert(1)>' }, { backgroundColor: 'url(https://example.com)' }, { textColor: '#fff' }, { border: 'false' }, { textAlignment: 'anything' }, { style: 'position:fixed' }])
    assert.throws(() => serializePageDocument(document(block(props))), /콜아웃/);
  const unsafe = block(); unsafe.content = [{ type: 'link', href: 'javascript:alert(1)', content: [] }];
  assert.throws(() => serializePageDocument(document(unsafe)), /링크/);
});

test('public callouts contain escaped content and nested blocks inside the box, with a stable comment anchor', () => {
  const value = block({ backgroundColor: 'blue', border: false, icon: 'info' });
  const html = renderSharedPage({ title: '콜아웃', updatedAt: '2026-10-05T00:00:00Z', document: document(value) }, 'test-token', new Map(), { commentsEnabled: true });
  assert.match(html, /callout\.css/);
  assert.match(html, /class="callout-box"[^>]*data-background-color="blue"[^>]*data-border="false"/);
  assert.match(html, /data-comment-block-id="callout-example"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /class="callout-children">[\s\S]*여권과 예약 내역[\s\S]*<\/aside>/);
  assert.deepEqual(listSharedCommentableBlocks([value]).map(b => b.id), ['callout-example', 'child']);
});

test('Markdown/AI output keeps callout and child text and attachment scope remains direct', () => {
  const value = block();
  value.children.push({ id: 'image', type: 'asset', props: { assetId: 'direct-asset' }, children: [] });
  value.children.push({ id: 'private', type: 'page', props: { pageId: 'private-page' }, children: [{ id: 'hidden-image', type: 'asset', props: { assetId: 'hidden-asset' }, children: [] }] });
  assert.match(renderPageMarkdown([value]), /^> \*\*출발 전에 확인/);
  assert.match(renderPageMarkdown([value]), /여권과 예약 내역/);
  assert.deepEqual([...referencedAssetIds(document(value))], ['direct-asset']);
});

test('every line of multiline callout text stays quoted in Markdown', () => {
  const value = block(); value.children = [];
  value.content = [{ type: 'text', text: '출발 전\n\n여권 확인\n예약 확인', styles: {} }];
  assert.equal(renderPageMarkdown([value]), '> 출발 전\n> \n> 여권 확인\n> 예약 확인');
});
