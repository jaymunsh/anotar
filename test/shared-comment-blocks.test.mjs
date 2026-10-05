import test from 'node:test';
import assert from 'node:assert/strict';
import * as comments from '../shared/pageComments.ts';

test('shared comment targets exclude private placeholder subtrees', () => {
  assert.equal(typeof comments.listSharedCommentableBlocks, 'function');
  const child = { id: 'hidden-child', type: 'paragraph', content: [{ text: 'private' }] };
  const blocks = [
    { id: 'text', type: 'paragraph', content: [{ text: 'visible' }] },
    ...['page', 'captureRef', 'tableOfContents'].map((type) => ({
      id: type,
      type,
      children: [child],
    })),
    {
      id: 'heading',
      type: 'heading',
      children: [{ id: 'nested', type: 'paragraph', content: [{ text: 'nested text' }] }],
    },
  ];
  assert.deepEqual(
    comments.listSharedCommentableBlocks(blocks).map((b) => b.id),
    ['text', 'heading', 'nested'],
  );
});
