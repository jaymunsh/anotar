import { useEffect, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { collectHeadings } from './TocBlock';

export default function PageOutline({ editor }: { editor: BlockNoteEditor<any, any, any> }) {
  const [entries, setEntries] = useState(() => collectHeadings(editor));
  const [activeId, setActiveId] = useState('');
  useEffect(() => {
    setEntries(collectHeadings(editor));
    return editor.onChange(() => setEntries(collectHeadings(editor)));
  }, [editor]);
  useEffect(() => {
    const root = editor.domElement;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const scroller = root.closest('.content-area');
      const top = Math.max(0, scroller?.getBoundingClientRect().top ?? 0) + 96;
      let current = entries[0]?.id || '';
      for (const entry of entries) {
        const element = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(entry.id)}"]`);
        if (element && element.getBoundingClientRect().top <= top) current = entry.id;
      }
      setActiveId(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    update();
    return () => { cancelAnimationFrame(frame); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [editor, entries]);
  const minimum = entries.reduce((level, entry) => Math.min(level, entry.level), 6);
  return (
    <nav className="page-outline" aria-label="페이지 목차">
      {!entries.length && <p>제목 블록을 추가하면 여기에 목차가 나타나요.</p>}
      {entries.map((entry) => (
        <button
          key={entry.id}
          title={entry.text || '빈 제목'}
          type="button"
          aria-current={activeId === entry.id ? 'location' : undefined}
          style={{ paddingInlineStart: 12 + (entry.level - minimum) * 14 }}
          onClick={() => {
            setActiveId(entry.id);
            const target = editor.domElement?.querySelector<HTMLElement>(
              `[data-id="${CSS.escape(entry.id)}"]`,
            );
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          {entry.text || '빈 제목'}
        </button>
      ))}
    </nav>
  );
}
