import test from 'node:test';
import assert from 'node:assert/strict';
import { editablePageBlocks, preserveLegacyCaptureRefs } from '../shared/pageDocuments.ts';
const p = (id, children = []) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: id, styles: {} }],
  children,
});
const ref = (id, children = []) => ({
  id,
  type: 'captureRef',
  props: { captureId: 'private' },
  children,
});
test('legacy references are absent from editable/Markdown blocks while their children remain editable', () => {
  const original = [p('parent', [ref('hidden', [p('inside')]), p('sibling')]), ref('tail')];
  const visible = editablePageBlocks(original);
  assert.deepEqual(visible, [p('parent', [p('inside'), p('sibling')])]);
  assert.deepEqual(preserveLegacyCaptureRefs(original, visible), original);
  visible[0].children[0].content[0].text = 'edited';
  const saved = preserveLegacyCaptureRefs(original, visible);
  assert.equal(saved[0].children[0].type, 'captureRef');
  assert.equal(saved[0].children[0].children[0].content[0].text, 'edited');
  assert.equal(saved[1].id, 'tail');
  assert.equal(original[0].children[0].children[0].content[0].text, 'inside');
});
