import { workspaceFetch } from '../sync/runtime';
import { useContext, useEffect, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReactBlockSpec } from '@blocknote/react';
import { FileText } from 'lucide-react';
import { PageNavContext } from './pageNav';
import { subscribeRecordChanges } from '../trash/events';

type AnyEditor = BlockNoteEditor<any, any, any>;

function PageLinkView({ block }: { block: { props: { pageId: string; title: string } } }) {
  const navigate = useContext(PageNavContext);
  const pageId = block.props.pageId;
  const [title, setTitle] = useState(block.props.title || '제목 없음');
  const [icon, setIcon] = useState('');
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => subscribeRecordChanges(() => setRetry((value) => value + 1)), []);

  useEffect(() => {
    if (!pageId) return;
    const controller = new AbortController();
    let active = true;
    workspaceFetch(`/api/pages/${pageId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 404) setMissing(true);
        else if (response.ok) {
          const { item } = (await response.json()) as {
            item: { title: string; icon?: string };
          };
          if (active) {
            setMissing(false);
            setTitle(item.title);
            setIcon(item.icon || '');
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [pageId, retry]);

  // Reset only for a different destination. Background refreshes retain the
  // last confirmed title/icon until a new response arrives.
  useEffect(() => {
    setTitle(block.props.title || '제목 없음');
    setIcon('');
    setMissing(false);
  }, [pageId]);

  const path = `/pages/${pageId}`;
  return (
    <a
      className={'page-link-block' + (missing ? ' is-missing' : '')}
      href={path}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(path);
      }}
    >
      <span className="page-link-icon" aria-hidden>
        {icon || <FileText size={16} />}
      </span>
      <span className="page-link-title">{missing ? '페이지를 찾을 수 없어요' : title}</span>
    </a>
  );
}

export const createPageLinkBlockSpec = createReactBlockSpec(
  {
    type: 'page',
    propSchema: {
      pageId: { default: '' },
      title: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => (
      <PageLinkView block={block as { props: { pageId: string; title: string } }} />
    ),
  },
);

export function getPageLinkSlashMenuItems(editor: AnyEditor, parentId?: string) {
  if (!('page' in editor.schema.blockSchema)) return [];
  return [
    {
      title: '페이지',
      subtext: '이 페이지 안에 새 하위 페이지를 연결합니다',
      aliases: ['페이지', 'page', '하위', 'sub'],
      group: '고급',
      icon: <FileText size={18} />,
      onItemClick: () => {
        void (async () => {
          try {
            const response = await workspaceFetch('/api/pages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: '제목 없음', parentId: parentId ?? null }),
            });
            if (!response.ok) return;
            const { item } = (await response.json()) as {
              item: { id: string; title: string };
            };
            insertOrUpdateBlockForSlashMenu(editor, {
              type: 'page',
              props: { pageId: item.id, title: item.title },
            } as any);
          } catch {
            /* 서버가 응답하지 않으면 블록을 만들지 않습니다. */
          }
        })();
      },
    },
  ];
}
