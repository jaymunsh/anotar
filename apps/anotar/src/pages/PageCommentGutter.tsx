import { useEffect, useState, type RefObject } from 'react';
import { MessageCircle, MessageCirclePlus, Check } from 'lucide-react';
import type { CommentSummary } from './pageComments';

type Position = { id: string; top: number };

export default function PageCommentGutter({
  containerRef,
  selectedBlockId,
  hoveredBlockId,
  summaries,
  onSelectBlock,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  selectedBlockId: string | null;
  hoveredBlockId: string | null;
  summaries: CommentSummary[];
  onSelectBlock: (id: string) => void;
}) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const editor = container?.querySelector('.bn-editor');
    if (!container || !editor) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const parentTop = container.getBoundingClientRect().top;
        const next = Array.from(editor.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]'))
          .map((node) => {
            const content = node.querySelector<HTMLElement>('.bn-block-content');
            const surface = content?.querySelector<HTMLElement>('.itinerary-block, .map-block') || content || node;
            return { id: node.dataset.id || '', top: surface.getBoundingClientRect().top - parentTop + (surface.matches('.itinerary-block, .map-block') ? 12 : 0) };
          })
          .filter((item) => item.id);
        setPositions(next);
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(editor);
    const mutation = new MutationObserver(measure);
    mutation.observe(editor, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef]);

  return (
    <div
      className="page-comment-gutter"
      aria-label="블록 댓글 표시"
      onMouseMove={(event) => event.stopPropagation()}
    >
      {positions.map(({ id, top }) => {
        const summary = summaries.find((entry) => entry.blockId === id);
        const commented = Boolean(summary);
        const visible = commented || id === selectedBlockId || id === hoveredBlockId;
        return (
          <button
            type="button"
            key={id}
            data-comment-block={id}
            className={`page-comment-gutter-button${visible ? ' is-visible' : ''}${id === selectedBlockId ? ' is-selected' : ''}${commented ? ' has-comment' : ''}${summary?.resolved ? ' is-resolved' : ''}`}
            style={{ top }}
            aria-label={
              summary
                ? `${summary.resolved ? '해결된 ' : ''}댓글 ${summary.count}개가 있는 블록 보기`
                : '블록에 댓글 달기'
            }
            aria-hidden={!visible}
            tabIndex={visible ? 0 : -1}
            onClick={() => onSelectBlock(id)}
          >
            {summary?.resolved ? (
              <Check size={17} />
            ) : commented ? (
              <MessageCircle size={17} />
            ) : (
              <MessageCirclePlus size={17} />
            )}
            {summary && <span>{summary.count > 99 ? '99+' : summary.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
