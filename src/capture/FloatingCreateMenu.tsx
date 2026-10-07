import { useEffect, useRef, useState } from 'react';
import { FileText, Pencil, X } from 'lucide-react';
import './floatingCreate.css';

export default function FloatingCreateMenu({ hasDraft, onMemo, onPage }: {
  hasDraft: boolean;
  onMemo: () => void;
  onPage: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      const active = document.activeElement;
      const typing = active instanceof HTMLElement && (
        active.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])') || active.isContentEditable
      );
      // Browser chrome and pinch zoom also shrink visualViewport without a keyboard.
      setKeyboardOpen(media.matches && typing);
      setFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) dialog.current?.close();
    };
    update();
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    viewport?.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      viewport?.removeEventListener('resize', update);
      media.removeEventListener('change', update);
    };
  }, []);
  function choose(action: () => void) {
    dialog.current?.close();
    action();
  }
  return <>
    <button className="mobile-create-button" hidden={keyboardOpen || fullscreen}
      type="button" aria-label="작성 메뉴 열기" aria-haspopup="dialog"
      aria-description={hasDraft ? '보관하지 않은 메모 초안이 있어요' : undefined}
      title={hasDraft ? '작성 중인 메모 있음 · 이어쓰기' : '새로 작성'}
      onClick={() => dialog.current?.showModal()}>
      <Pencil size={20} aria-hidden="true" />
      {hasDraft && <span className="mobile-create-draft" aria-label="작성 중인 초안 있음" />}
    </button>
    <dialog ref={dialog} className="mobile-create-menu" aria-label="새로 작성"
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="mobile-create-sheet">
        <header><h2>새로 작성</h2><button type="button" aria-label="작성 메뉴 닫기" onClick={() => dialog.current?.close()}><X size={19} /></button></header>
        <button type="button" aria-label="빠른 메모" onClick={() => choose(onMemo)}>
          <Pencil size={21} aria-hidden="true" />
          <span><strong>{hasDraft ? '메모 이어쓰기' : '빠른 메모'}</strong><small>{hasDraft ? '보관하지 않은 메모 초안이 있어요' : '떠오른 생각부터 가볍게 적어요'}</small></span>
        </button>
        <button type="button" aria-label="새 페이지" onClick={() => choose(onPage)}>
          <FileText size={21} aria-hidden="true" />
          <span><strong>새 페이지</strong><small>내용을 정리할 문서를 만들어요</small></span>
        </button>
      </div>
    </dialog>
  </>;
}
