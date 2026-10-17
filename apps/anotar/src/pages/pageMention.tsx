// [[ in the editor: pick a page, insert an inline /pages/<id> link (page_backlinks indexes it).
import { FileText } from 'lucide-react';
import { workspaceFetch } from '../sync/runtime';
import { searchPages } from './pageSearch';
import type { PageSummary } from './types';

let cache: { at: number; pages: Promise<PageSummary[]> } | null = null;
function loadPages() {
  // One fetch per menu session, not per keystroke.
  if (!cache || Date.now() - cache.at > 10_000)
    cache = {
      at: Date.now(),
      pages: workspaceFetch('/api/pages')
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((data: { items: PageSummary[] }) => data.items)
        .catch(() => []),
    };
  return cache.pages;
}

type LinkEditor = { insertInlineContent: (content: any[]) => void };

export async function getPageMentionItems(editor: LinkEditor, query: string, currentPageId: string) {
  const pages = (await loadPages()).filter((page) => page.id !== currentPageId);
  return searchPages(pages, query).map(({ page, path }) => {
    const title = page.title || '제목 없음';
    return {
      title,
      subtext: path || undefined,
      icon: page.icon ? <span aria-hidden>{page.icon}</span> : <FileText size={18} />,
      onItemClick: () =>
        editor.insertInlineContent([
          { type: 'link', href: `/pages/${page.id}`, content: title },
          ' ',
        ]),
    };
  });
}
