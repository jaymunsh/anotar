type ChildPage = { id: string; parentId: string | null; title: string; position: number };
type Block = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

// Parent metadata owns the hierarchy. An explicit link anywhere in the body
// satisfies it; generated fallbacks fill only the missing direct children.
export function reconcileChildPageLinks(blocks: unknown[], parentId: string, pages: ChildPage[]): unknown[] {
  const children = pages.filter(page => page.parentId === parentId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const childIds = new Set(children.map(page => page.id));
  const managed = (block: Block) => block.type === 'page' && block.id === 'child-page-' + block.props?.pageId;
  const explicit = new Set<string>();
  const scan = (items: Block[]) => {
    for (const block of items) {
      if (block.type === 'page' && !managed(block) && typeof block.props?.pageId === 'string') explicit.add(block.props.pageId);
      scan(block.children || []);
    }
  };
  scan(blocks as Block[]);
  const linked = new Set(explicit);
  const clean = (items: Block[]): Block[] => {
    let changed = false;
    const result: Block[] = [];
    for (const block of items) {
      if (managed(block)) {
        const id = String(block.props?.pageId);
        // A user may have nested their own content under this link. Keep it
        // as a regular reference rather than discarding that content.
        if ((!childIds.has(id) || linked.has(id)) && !block.children?.length) { changed = true; continue; }
        linked.add(id);
      }
      const nested = block.children ? clean(block.children) : undefined;
      const next = nested && nested !== block.children ? { ...block, children: nested } : block;
      if (next !== block) changed = true;
      result.push(next);
    }
    return changed ? result : items;
  };
  const result = clean(blocks as Block[]);
  const missing = children.filter(child => !linked.has(child.id)).map(child => ({
    id: 'child-page-' + child.id,
    type: 'page',
    props: { pageId: child.id, title: child.title },
    children: [],
  }));
  if (!missing.length) return result.length ? result : [{
    id: 'child-pages-empty-' + parentId, type: 'paragraph', props: {}, content: [], children: [],
  }];
  const last = result.at(-1);
  const trailingBlank = last?.type === 'paragraph' && Array.isArray(last.content) && !last.content.length && !last.children?.length;
  const index = trailingBlank ? result.length - 1 : result.length;
  return [...result.slice(0, index), ...missing, ...result.slice(index)];
}
