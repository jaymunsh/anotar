import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, FileText, Link, X } from 'lucide-react';
import './bookmark.css';
export default function UrlPasteChoice({
  url,
  internalPage = false,
  onChoose,
}: {
  url: string;
  internalPage?: boolean;
  onChoose: (kind: 'link' | 'bookmark' | 'page') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="url-paste-choice"
      aria-label="URL 붙여넣기 방식"
      onCancel={(event) => {
        event.preventDefault();
        onChoose('link');
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onChoose('link');
      }}
    >
      <header>
        <strong>어떻게 붙여넣을까요?</strong>
        <button type="button" aria-label="일반 링크로 붙이고 닫기" onClick={() => onChoose('link')}>
          <X size={16} />
        </button>
      </header>
      <p title={url}>{url}</p>
      <button type="button" autoFocus onClick={() => onChoose('link')}>
        <Link size={16} />
        <span>
          일반 링크<small>주소만 본문에 넣기</small>
        </span>
      </button>
      <button type="button" onClick={() => onChoose(internalPage ? 'page' : 'bookmark')}>
        {internalPage ? <FileText size={16} /> : <Bookmark size={16} />}
        <span>
          {internalPage ? '페이지 링크' : '북마크'}
          <small>
            {internalPage
              ? '페이지 제목으로 이동 링크 넣기'
              : '사이트 제목·설명과 대표 이미지 카드'}
          </small>
        </span>
      </button>
    </dialog>,
    document.body,
  );
}
