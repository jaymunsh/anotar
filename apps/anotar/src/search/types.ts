export type SearchType = 'all' | 'memo' | 'page' | 'file' | 'ai' | 'task' | 'result' | 'ocr';
export type SearchItem = {
  id: string;
  type: Exclude<SearchType, 'all'>;
  label: string;
  snippet: string;
  icon: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  href: string;
  context: string;
};
export type SearchBatch = {
  scope?: 'local' | 'server';
  items: SearchItem[];
  nextCursor: string | null;
  reset: boolean;
  reason: 'short_query' | null;
};
