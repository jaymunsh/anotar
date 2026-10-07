import { useState } from 'react';
import { createReactBlockSpec, useEditorState } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { Bookmark, ExternalLink, Link, RefreshCw } from 'lucide-react';
import { webBookmarkUrl } from '../../shared/bookmarks';
import './bookmark.css';
type AnyEditor = BlockNoteEditor<any, any, any>;
export type BookmarkProps = { url: string; title: string; description: string; imageData: string };
export async function readBookmark(url: string, signal?: AbortSignal): Promise<BookmarkProps> {
  const response = await fetch('/api/bookmarks/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '사이트 정보를 불러오지 못했어요.');
  return data.item;
}
export async function refreshBookmark(
  editor: AnyEditor,
  blockId: string,
  url: string,
): Promise<boolean> {
  const props = await readBookmark(url);
  const current = editor.getBlock(blockId);
  if (
    !editor.isEditable ||
    current?.type !== 'bookmark' ||
    webBookmarkUrl(current.props.url) !== webBookmarkUrl(url)
  )
    return false;
  editor.updateBlock(blockId, { props });
  return true;
}
function BookmarkView({
  block,
  editor,
}: {
  block: { id: string; props: BookmarkProps };
  editor: AnyEditor;
}) {
  const editable = useEditorState({ editor, on: 'change', selector: ({ editor }) => editor.isEditable });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const props = block.props,
    url = webBookmarkUrl(props.url);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const applied = await refreshBookmark(editor, block.id, url);
      if (!applied) setError('편집 위치가 변경되어 정보 반영을 취소했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '링크 정보 확인 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-bookmark-block" contentEditable={false}>
      <a className="saved-bookmark" href={url} target="_blank" rel="noopener noreferrer">
        <span className="bookmark-copy">
          <strong>{props.title || (url ? new URL(url).hostname : '북마크')}</strong>
          {props.description && <span>{props.description}</span>}
          <small>
            <Bookmark size={12} />
            {url ? new URL(url).hostname : ''}
            <ExternalLink size={12} />
          </small>
        </span>
        {props.imageData && <img src={props.imageData} alt="" loading="lazy" />}
      </a>
      {editable && (
        <div className="bookmark-actions">
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={12} />
            {busy ? '정보 확인 중…' : '정보 새로고침'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              editor.updateBlock(block.id, {
                type: 'paragraph',
                content: [
                  { type: 'link', href: url, content: [{ type: 'text', text: url, styles: {} }] },
                ],
                props: {},
              })
            }
          >
            <Link size={12} />
            일반 링크로
          </button>
        </div>
      )}
      {error && (
        <p className="bookmark-error" role="status">
          {error} URL은 보존되어 있어요.
        </p>
      )}
    </div>
  );
}
export const createBookmarkBlockSpec = createReactBlockSpec(
  {
    type: 'bookmark',
    propSchema: {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      imageData: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => <BookmarkView block={block as any} editor={editor} />,
    toExternalHTML: ({ block }) => (
      <a href={block.props.url}>
        {block.props.title || block.props.url}
        {block.props.description && <span> — {block.props.description}</span>}
      </a>
    ),
  },
);
