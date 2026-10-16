import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPageMarkdown } from '../shared/pageMarkdown.ts';
test('saved Markdown preview is pure, handles table/diagram/children, and omits private reference metadata', () => {
  const blocks = [
    {
      type: 'captureRef',
      props: { captureId: 'private-id' },
      children: [
        {
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '작성한 자식', styles: { bold: true } }],
          children: [],
        },
      ],
    },
    { type: 'asset', props: { assetId: 'secret-file' }, children: [] },
    { type: 'diagram', props: {}, content: 'graph TD\n A-->B', children: [] },
    {
      type: 'table',
      props: {},
      content: {
        rows: [
          { cells: [[{ type: 'text', text: '제목', styles: {} }]] },
          { cells: [[{ type: 'text', text: '값', styles: {} }]] },
        ],
      },
      children: [],
    },
  ];
  const output = renderPageMarkdown(blocks);
  assert.match(output, /\*\*작성한 자식\*\*/);
  assert.match(output, /```mermaid\ngraph TD/);
  assert.match(output, /\| 제목 \|\n\| --- \|\n\| 값 \|/);
  assert.doesNotMatch(output, /private-id|secret-file/);
});

test('explicit page export retains attachment and page references without leaking them into AI snapshots', () => {
  const blocks = [
    { type: 'asset', props: { assetId: 'image-reference', display: 'image' }, children: [] },
    {
      type: 'paragraph',
      props: {},
      content: [],
      children: [
        { type: 'asset', props: { assetId: 'file-reference', display: 'file' }, children: [] },
      ],
    },
    { type: 'page', props: { pageId: 'child-page', title: '하위 페이지' }, children: [] },
    {
      type: 'map',
      props: { latitude: 37.58, longitude: 126.98, label: '방문 장소', assetId: 'map-image' },
      children: [],
    },
    { type: 'captureRef', props: { captureId: 'private-source' }, children: [] },
  ];
  const exported = renderPageMarkdown(blocks, 0, { includeAppReferences: true });
  assert.match(exported, /첨부 이미지.*image-reference/);
  assert.match(exported, /첨부 파일.*file-reference/);
  assert.match(exported, /하위 페이지.*child-page/);
  assert.match(exported, /지도 이미지.*map-image/);
  assert.match(exported, /google\.com\/maps/);
  assert.doesNotMatch(exported, /private-source/);
  assert.doesNotMatch(
    renderPageMarkdown(blocks),
    /image-reference|file-reference|child-page|map-image/,
  );
});
