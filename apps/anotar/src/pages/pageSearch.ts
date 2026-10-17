// Page lookup for pickers: title match, parent path, recent pages first.
type PageLike = { id: string; title: string; icon: string; parentId: string | null; updatedAt: string };

/** "상위 / 그 위" path of a page's ancestors, nearest last; '' for top-level pages. */
export function pagePath(page: PageLike, byId: Map<string, PageLike>) {
  const names: string[] = [];
  const seen = new Set([page.id]);
  for (let parent = page.parentId && byId.get(page.parentId); parent && !seen.has(parent.id); parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
    seen.add(parent.id);
    names.unshift(parent.title || '제목 없음');
  }
  return names.join(' / ');
}

/** Empty query: most recently updated. Otherwise every term must appear in the title or path. */
export function searchPages<T extends PageLike>(pages: T[], query: string, limit = 8) {
  const byId = new Map(pages.map((page) => [page.id, page as PageLike]));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return pages
    .map((page) => ({ page, path: pagePath(page, byId) }))
    .filter(({ page, path }) => {
      const hay = `${page.title} ${path}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    })
    .sort((a, b) => {
      // Title hits before path-only hits, then newest first.
      const titleHit = (x: { page: T }) => terms.every((t) => x.page.title.toLowerCase().includes(t));
      return Number(titleHit(b)) - Number(titleHit(a)) || b.page.updatedAt.localeCompare(a.page.updatedAt);
    })
    .slice(0, limit);
}
