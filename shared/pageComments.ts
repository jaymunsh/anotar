export type CommentSummary = { blockId: string; count: number; resolved: boolean };
export type PreviewComment = {
  id: string;
  text: string;
  createdAt: number;
  name?: string;
  isOwner?: boolean;
};
export type PreviewThread = {
  id: string;
  version: number;
  excerpt: string;
  orphaned: boolean;
  blockId: string;
  resolved: boolean;
  comments: PreviewComment[];
};

type PreviewBlock = {
  id?: unknown;
  type?: unknown;
  content?: unknown;
  props?: Record<string, unknown>;
  children?: PreviewBlock[];
};

function plainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(' ');
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (typeof node.text === 'string') return node.text;
  if (node.content) return plainText(node.content);
  return '';
}

export function getBlockExcerpt(blocks: unknown[], blockId: string): string {
  function find(items: PreviewBlock[]): PreviewBlock | null {
    for (const block of items) {
      if (block.id === blockId) return block;
      const child = find(Array.isArray(block.children) ? block.children : []);
      if (child) return child;
    }
    return null;
  }
  const block = find(blocks as PreviewBlock[]);
  if (!block) return '선택한 블록을 찾을 수 없어요.';
  const text = plainText(block.content).replace(/\s+/g, ' ').trim();
  if (text) return text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;
  if (block.type === 'itinerary') {
    try {
      const data =
        typeof block.props?.data === 'string' ? JSON.parse(block.props.data) : block.props?.data;
      if (typeof data?.title === 'string' && data.title.trim())
        return `일정 · ${data.title.trim().slice(0, 140)}`;
    } catch {}
    return '일정';
  }
  if (block.type === 'divider') return '구분선';
  if (block.type === 'table') return '표';
  if (block.type === 'map')
    return `지도 · ${typeof block.props?.label === 'string' ? block.props.label : '장소'}`;
  if (block.type === 'diagram') return 'Mermaid 다이어그램';
  if (block.type === 'asset') return '첨부 파일';
  if (block.type === 'page') return '연결된 페이지';
  return '빈 블록';
}

export function listCommentableBlocks(blocks: unknown[]): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  function visit(items: PreviewBlock[]) {
    for (const block of items) {
      if (typeof block.id === 'string') {
        const excerpt = getBlockExcerpt([block], block.id);
        result.push({ id: block.id, label: excerpt });
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  }
  visit(blocks as PreviewBlock[]);
  return result;
}

/** Public placeholders and their descendants must never become comment targets. */
export function listSharedCommentableBlocks(blocks: unknown[]): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  const supported = new Set([
    'paragraph',
    'heading',
    'bulletListItem',
    'numberedListItem',
    'checkListItem',
    'quote',
    'callout',
    'codeBlock',
    'diagram',
    'divider',
    'table',
    'asset',
    'map',
    'itinerary',
  ]);
  function visit(items: PreviewBlock[]) {
    for (const block of items) {
      if (['captureRef', 'page', 'tableOfContents'].includes(String(block.type))) continue;
      if (
        typeof block.id === 'string' &&
        (supported.has(String(block.type)) || plainText(block.content))
      )
        result.push({ id: block.id, label: getBlockExcerpt([block], block.id) });
      if (Array.isArray(block.children)) visit(block.children);
    }
  }
  visit(blocks as PreviewBlock[]);
  return result;
}
