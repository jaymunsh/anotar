import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PageSummary } from './types';

type Props = {
  pageId: string;
  pages: PageSummary[];
  excludedIds: Set<string>;
  onMove: (parentId: string | null, position: number) => Promise<boolean>;
  onClose: () => void;
};
export default function WorkspaceMovePicker({
  pageId,
  pages,
  excludedIds,
  onMove,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [parent, setParent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const item = pages.find((page) => page.id === pageId);
  const destinations = useMemo(
    () => pages.filter((page) => !excludedIds.has(page.id)),
    [pages, excludedIds],
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector('select')?.focus();
    return () => {
      node?.close();
      const target = previous?.isConnected
        ? previous
        : document.querySelector<HTMLElement>(`[data-workspace-move="${CSS.escape(pageId)}"]`);
      target?.focus();
    };
  }, []);
  async function submit() {
    if (pending) return;
    setPending(true);
    setError('');
    const parentId = parent || null;
    const siblings = pages.filter((page) => page.parentId === parentId && page.id !== pageId);
    const position = siblings.reduce((last, page) => Math.max(last, page.position), 0) + 1;
    const success = await onMove(parentId, position);
    setPending(false);
    if (success) onClose();
    else setError('페이지를 옮기지 못했어요. 목적지를 유지했으니 다시 시도해 주세요.');
  }
  return (
    <dialog
      ref={dialog}
      className="workspace-move-picker"
      aria-labelledby="workspace-move-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2 id="workspace-move-title">페이지 이동</h2>
          <button type="button" aria-label="페이지 이동 닫기" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        <p className="workspace-move-page">{item?.title ?? '페이지'}</p>
        <label htmlFor="workspace-move-parent">목적지</label>
        <select
          id="workspace-move-parent"
          value={parent}
          onChange={(event) => setParent(event.target.value)}
          disabled={pending}
          autoFocus
        >
          <option value="">내 페이지 최상위</option>
          {destinations.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
        <p className="workspace-move-help">
          선택한 페이지의 맨 아래로 옮깁니다. 하위 페이지도 함께 이동합니다.
        </p>
        {error && (
          <p className="workspace-move-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="submit" className="workspace-move-submit" disabled={pending}>
            {pending ? '이동 중…' : error ? '다시 이동' : '여기로 이동'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
