import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import type { PageDocument } from './types';
import { createDocumentHeadingBlockSpec } from './HeadingBlock';

// Loaded only when the user explicitly turns a result into a page.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createDocumentHeadingBlockSpec(),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
  },
});

export function parsePageMarkdown(markdown: string): PageDocument {
  const editor = BlockNoteEditor.create({ schema });
  try {
    const blocks = editor.tryParseMarkdownToBlocks(markdown);
    const convert = (items: typeof blocks): unknown[] =>
      items.map((block) => {
        const children = convert(block.children);
        if (block.type === 'codeBlock' && block.props.language === 'mermaid')
          return { ...block, type: 'diagram', props: {}, children };
        return { ...block, children };
      });
    return { schemaVersion: 1, blocks: convert(blocks) };
  } finally {
    editor._tiptapEditor.destroy();
  }
}
