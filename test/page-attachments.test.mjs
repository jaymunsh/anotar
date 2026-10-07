import test from 'node:test';
import assert from 'node:assert/strict';
import { serializePageDocument } from '../shared/pageValidation.mjs';
import { renderSharedPage, referencedAssetIds } from '../server/publicPage.mjs';
import { renderPageMarkdown } from '../shared/pageMarkdown.ts';
import { pageAiSource } from '../server/pageMarkdown.mjs';

const assetId = '12345678-1234-1234-1234-123456789abc';
const crop = JSON.stringify({
  x: 0.25,
  y: 0.1,
  width: 0.5,
  height: 0.5,
  imageWidth: 800,
  imageHeight: 600,
});
const document = (props) => ({
  schemaVersion: 1,
  blocks: [
    {
      id: 'attachment',
      type: 'asset',
      props: { assetId, display: 'image', ...props },
      children: [],
    },
  ],
});

test('explicit Markdown export includes escaped caption while AI excludes all attachment metadata', () => {
  const doc = document({ caption: '[caption](https://evil.example) <script> & **bold**' });
  const exported = renderPageMarkdown(doc.blocks, 0, { includeAppReferences: true });
  assert.match(exported, /설명: \\\[caption\\\]/);
  assert.match(exported, /&lt;script&gt;/);
  assert.doesNotMatch(exported, /\[caption\]\(https/);
  assert.doesNotMatch(renderPageMarkdown(doc.blocks), /caption|evil|12345678/);
  const ai = pageAiSource({
    title: '기록',
    document: {
      ...doc,
      blocks: [
        ...doc.blocks,
        {
          id: 'text',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '본문', styles: {} }],
          children: [],
        },
      ],
    },
  });
  assert.doesNotMatch(ai.content, /caption|evil|12345678/);
});

test('asset caption and crop survive v1 document validation without changing its reference', () => {
  const doc = document({ caption: '기록한 풍경', crop });
  assert.deepEqual(JSON.parse(serializePageDocument(doc)), doc);
  assert.deepEqual([...referencedAssetIds(doc)], [assetId]);
  assert.doesNotThrow(() => serializePageDocument(document({})));
});

test('asset rejects crop outside original image and oversized or nontext caption', () => {
  for (const value of [
    '{}',
    '<script>',
    JSON.stringify({ x: 0.8, y: 0, width: 0.5, height: 1, imageWidth: 800, imageHeight: 600 }),
    JSON.stringify({ x: 0, y: 0, width: 0, height: 1, imageWidth: 800, imageHeight: 600 }),
  ])
    assert.throws(() => serializePageDocument(document({ crop: value })), /자르기/);
  for (const caption of [42, 'a'.repeat(1001)])
    assert.throws(() => serializePageDocument(document({ caption })), /설명/);
});

test('shared attachment renders escaped caption, crop viewport and original download only', () => {
  const doc = document({ caption: '<script>공유 설명</script>', crop });
  const html = renderSharedPage(
    { title: '첨부', updatedAt: '2026-10-07T00:00:00Z', document: doc },
    'token',
    new Map([[assetId, { id: assetId, name: 'original.png', mime: 'image/png', size: 2048 }]]),
  );
  assert.match(html, /&lt;script&gt;공유 설명&lt;\/script&gt;/);
  assert.match(html, /aspect-ratio:1.3333333333333333/);
  assert.match(html, /left:-50%/);
  assert.match(html, /download="original.png"/);
  assert.doesNotMatch(html, /\/api\/assets\//);
  const file = renderSharedPage(
    {
      title: '파일',
      updatedAt: '2026-10-07T00:00:00Z',
      document: document({ display: 'file', caption: '설명' }),
    },
    'token',
    new Map([[assetId, { id: assetId, name: 'original.png', mime: 'image/png', size: 2048 }]]),
  );
  assert.doesNotMatch(file, /<img[^>]+original/);
  assert.match(file, /2 KB/);
});

test('shared rendering tolerates legacy attachment metadata without size', () => {
  const html = renderSharedPage(
    { title: '자료', updatedAt: '2026-10-07T00:00:00Z', document: document({ display: 'file' }) },
    'token',
    new Map([[assetId, { id: assetId, name: 'notes.txt', mime: 'text/plain' }]]),
  );
  assert.doesNotMatch(html, /NaN|undefined| ·  · /);
  assert.match(html, /notes.txt · 원본 내려받기/);
});
