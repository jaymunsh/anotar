import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSharedPage } from '../server/publicPage.mjs';
const make = (id, type, text = '', children = []) => ({
  id,
  type,
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children,
});
const page = {
  title: '공유',
  updatedAt: Date.now(),
  commentsEnabled: true,
  document: {
    blocks: [
      make('visible', 'paragraph', '안녕 "<script>"'),
      make('private', 'page', '비공개', [make('hidden-child', 'paragraph', '숨김')]),
      make('capture', 'captureRef', '비공개 메모'),
      make('toc', 'tableOfContents', '목차'),
    ],
  },
};
test('public comments are explicit opt-in and omitted from offline/default rendering', () => {
  const html = renderSharedPage(page, 'abc');
  assert.doesNotMatch(html, /share-comments|data-comment-block-id/);
});
test('comments only decorate visible public blocks with escaped metadata', () => {
  const html = renderSharedPage(page, 'abc', new Map(), { commentsEnabled: true });
  assert.match(html, /data-share-comments="\/s\/abc\/comments"/);
  assert.match(html, /data-comment-block-id="visible"/);
  assert.match(html, /data-comment-excerpt="안녕 &quot;&lt;script&gt;&quot;"/);
  assert.doesNotMatch(html, /data-comment-block-id="(?:private|hidden-child|capture|toc)"/);
  assert.match(html, /share-comments\.js/);
  assert.match(html, /share-comments\.css/);
});

test('shared rich lists preserve inline order, line breaks and escaping', () => {
  const rich = {
    id: 'trip-day',
    type: 'bulletListItem',
    props: {},
    children: [],
    content: [
      { type: 'text', text: '10.5 (월) · 오사카', styles: { bold: true } },
      { type: 'text', text: '\n인천 → 난바\n<script>입국 후 휴식</script>', styles: {} },
    ],
  };
  const html = renderSharedPage({ ...page, document: { blocks: [rich] } }, 'trip');
  const body = html.match(/<p class="list-item">(.*?)<\/p>/s)?.[1];
  assert.match(
    body,
    /<span class="list-item-content"><strong>10\.5 \(월\) · 오사카<\/strong><br>인천 → 난바<br>&lt;script&gt;입국 후 휴식&lt;\/script&gt;<\/span>/,
  );
  assert.doesNotMatch(body, /<script>/);
});
