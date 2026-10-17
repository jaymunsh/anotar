// Highlights #태그 in the page editor; ⌘/Ctrl+click opens search on that tag.
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import { openTagSearch } from '../search/openSearch';
import { tagPattern } from '../../shared/tags';

function decorate(doc: Node) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text?.includes('#') || node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')) return;
    // Text nodes split at marks, so look one character back for the word boundary.
    const before = pos > 0 ? doc.textBetween(pos - 1, pos, '\n', '\n') : '';
    const lead = !before || /[\s(\[]/.test(before) ? ' ' : 'x';
    for (const match of (lead + node.text).matchAll(tagPattern)) {
      const from = pos + match.index! - 1;
      decorations.push(Decoration.inline(from, from + match[0].length, { class: 'page-tag', title: '⌘ 클릭: 이 태그 모아 보기' }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const tagHighlightPlugin = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
    handleClick(_view, _pos, event) {
      const tag = (event.target as HTMLElement | null)?.closest('.page-tag');
      if (!tag || !(event.metaKey || event.ctrlKey)) return false;
      openTagSearch(tag.textContent || '');
      return true;
    },
  },
});
