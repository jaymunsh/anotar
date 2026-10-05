import type { SearchBatch, SearchItem, SearchType } from './types';

function isItem(item: SearchItem) {
  return (
    item &&
    ['memo', 'page', 'file', 'ai', 'task', 'result', 'ocr'].includes(item.type) &&
    ['id', 'label', 'snippet', 'icon', 'kind', 'createdAt', 'updatedAt', 'context'].every(
      (key) => typeof item[key as keyof SearchItem] === 'string',
    ) &&
    typeof item.href === 'string' &&
    /^(?:\/(?:pages|captures)\/[a-f0-9-]+(?:\?(?:aiJob=[a-f0-9-]+|ocrAsset=[a-f0-9-]+&ocrJob=[a-f0-9-]+))?|\/tasks\?taskId=[a-f0-9-]+)$/.test(
      item.href,
    )
  );
}

export async function fetchSearch(
  query: string,
  type: SearchType,
  cursor: string | null,
  signal: AbortSignal,
): Promise<SearchBatch> {
  if(navigator.onLine===false)return (await import('../offline/search')).searchLocalWorkspace({query,kinds:type});
  const parameters = new URLSearchParams({ q: query, type });
  if (cursor) parameters.set('cursor', cursor);
  let response:Response;
  try {response=await fetch('/api/search?' + parameters, { signal });}catch(error){if(signal.aborted)throw error;return (await import('../offline/search')).searchLocalWorkspace({query,kinds:type});}
  if (!response.ok) throw new Error('검색을 불러오지 못했어요.');
  let batch: SearchBatch;
  try {
    batch = (await response.json()) as SearchBatch;
  } catch {
    throw new Error('검색을 불러오지 못했어요.');
  }
  if (
    !batch ||
    !Array.isArray(batch.items) ||
    batch.items.length > 20 ||
    !batch.items.every(isItem) ||
    (batch.nextCursor !== null && typeof batch.nextCursor !== 'string') ||
    typeof batch.reset !== 'boolean' ||
    (batch.reason !== null && batch.reason !== 'short_query')
  )
    throw new Error('검색을 불러오지 못했어요.');
  return batch;
}
