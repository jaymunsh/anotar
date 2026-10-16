import { useEffect, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReactBlockSpec } from '@blocknote/react';
import { List } from 'lucide-react';

type AnyEditor = BlockNoteEditor<any, any, any>;

export type TocEntry = { id: string; level: number; text: string };

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item: any) => {
      if (item?.type === 'text') return item.text ?? '';
      if (item?.type === 'link' && Array.isArray(item.content)) return inlineText(item.content);
      return '';
    })
    .join('');
}

export function collectHeadings(editor: AnyEditor): TocEntry[] {
  const entries: TocEntry[] = [];
  editor.forEachBlock((block) => {
    if (block.type === 'heading')
      entries.push({
        id: block.id,
        level: typeof block.props.level === 'number' ? block.props.level : 1,
        text: inlineText(block.content),
      });
    return true;
  });
  return entries;
}

function TableOfContentsView({
  editor,
  maxLevel = 4,
}: {
  editor: AnyEditor;
  maxLevel?: number;
}) {
  const [entries, setEntries] = useState<TocEntry[]>(() => collectHeadings(editor));
  useEffect(() => {
    setEntries(collectHeadings(editor));
    return editor.onChange(() => setEntries(collectHeadings(editor)));
  }, [editor]);
  const visibleEntries = entries.filter(entry => entry.level <= maxLevel);
  const minLevel = visibleEntries.reduce((min, entry) => Math.min(min, entry.level), 6);

  if (!entries.length)
    return (
      <nav className="page-toc" aria-label="목차">
        <div className="page-toc-title">목차</div>
        <div className="page-toc-empty">제목 블록을 추가하면 목차가 만들어집니다.</div>
      </nav>
    );

  return (
    <nav className="page-toc" aria-label="목차" data-layout="list">
      <div className="page-toc-title">목차</div>
      {visibleEntries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="page-toc-item"
          style={{ paddingInlineStart: `${(entry.level - minLevel) * 18 + 8}px` }}
          onClick={() => {
            const target = editor.domElement?.querySelector(
              `[data-id="${entry.id}"]`,
            ) as HTMLElement | null;
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          {entry.text || '빈 제목'}
        </button>
      ))}
    </nav>
  );
}

export const createTableOfContentsBlockSpec = createReactBlockSpec(
  {
    type: 'tableOfContents',
    // Keep legacy properties readable; all TOCs use the existing single-column card.
    propSchema: { compact: { default: false }, maxLevel: { default: 4, values: [1, 2, 3, 4, 5, 6] as const } },
    content: 'none',
  },
  {
    render: ({ editor, block }) => (
      <TableOfContentsView editor={editor as AnyEditor} maxLevel={block.props.maxLevel} />
    ),
  },
);

export function getTableOfContentsSlashMenuItems(editor: AnyEditor) {
  if (!('tableOfContents' in editor.schema.blockSchema)) return [];
  return [
    {
      title: '목차',
      subtext: '페이지 안의 제목을 모아 보여줍니다',
      aliases: ['목차', 'toc', 'table of contents', '차례'],
      group: '고급',
      icon: <List size={18} />,
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: 'tableOfContents' } as any),
    },
  ];
}
