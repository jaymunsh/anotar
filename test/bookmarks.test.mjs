import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBookmarkMetadata,
  createBookmarkService,
  safeBookmarkImage,
} from '../server/bookmarks.mjs';
import { webBookmarkUrl } from '../shared/bookmarks.ts';
import { serializePageDocument } from '../shared/pageValidation.mjs';
import { pageSearchText } from '../server/searchText.mjs';
import { renderPageMarkdown } from '../shared/pageMarkdown.ts';
import { renderSharedPage } from '../server/publicPage.mjs';
const html = `<title>Fallback</title><meta content="A &amp; B" property="og:title"><meta name='description' content='Readable summary'><meta property="og:image" content="/cover.png">`;
test('metadata reads reordered attributes, entities and relative image; strips dangerous schemes', () => {
  assert.deepEqual(parseBookmarkMetadata(html, 'https://example.org/path'), {
    url: 'https://example.org/path',
    title: 'A & B',
    description: 'Readable summary',
    imageUrl: 'https://example.org/cover.png',
  });
  assert.equal(
    parseBookmarkMetadata(
      '<meta property="og:image" content="javascript:alert(1)">',
      'https://example.org',
    ).imageUrl,
    '',
  );
});
test('fetch delegates address/redirect controls; image errors do not discard useful metadata', async () => {
  const calls = [];
  const service = createBookmarkService({
    collect: async (url, _signal, options) => {
      calls.push(url);
      if (calls.length > 1) throw Error('image unavailable');
      return options.transformResponse({ url, body: Buffer.from(html), contentType: 'text/html' });
    },
  });
  const result = await service.read('https://example.org/path');
  assert.equal(result.title, 'A & B');
  assert.equal(result.imageData, '');
  assert.equal(calls.length, 2);
});
test('bounded raster signature accepts PNG and rejects SVG/mismatched formats', () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
  assert.match(safeBookmarkImage(png, 'image/png'), /^data:image\/png;base64,/);
  assert.equal(safeBookmarkImage(Buffer.from('<svg/>'), 'image/svg+xml'), '');
  assert.equal(safeBookmarkImage(png, 'image/jpeg'), '');
  assert.equal(safeBookmarkImage(Buffer.alloc(100000), 'image/png'), '');
});
const block = {
  id: 'bookmark-1',
  type: 'bookmark',
  props: {
    url: 'https://example.org/read',
    title: 'Travel notes',
    description: 'Readable <script> text',
    imageData: '',
  },
  children: [],
};
const document = { schemaVersion: 1, blocks: [block] };
test('bookmark persists/searches/exports/renders escaped metadata without external image request', () => {
  assert.doesNotThrow(() => serializePageDocument(document));
  assert.match(pageSearchText(document), /Travel notes/);
  assert.match(renderPageMarkdown(document.blocks), /https:\/\/example.org\/read/);
  const rendered = renderSharedPage({
    title: 'Test',
    document,
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
  });
  assert.match(rendered, /Travel notes/);
  assert(!rendered.includes('Readable <script>'));
  assert.match(rendered, /noopener/);
});
test('bookmark stored values reject non-web URL, credential URL and executable image', () => {
  for (const props of [
    { url: 'javascript:alert(1)' },
    { url: 'https://user:secret@example.org' },
    { imageData: 'data:image/svg+xml;base64,PHN2Zz4=' },
  ])
    assert.throws(() =>
      serializePageDocument({
        schemaVersion: 1,
        blocks: [{ ...block, props: { ...block.props, ...props } }],
      }),
    );
});

test('paste accepts exactly one URL and preserves multiline clipboard for normal paste', () => {
  assert.equal(webBookmarkUrl('https://one.example\nhttps://two.example'), '');
  assert.equal(webBookmarkUrl(' https://example.org/read '), 'https://example.org/read');
});
