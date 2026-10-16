import type { CommentInboxBatch, CommentInboxCounts, CommentInboxView } from './types';
function validCounts(value: CommentInboxCounts) {
  return (
    value &&
    ['all', 'unread', 'open', 'resolved'].every(
      (key) =>
        Number.isSafeInteger(value[key as keyof CommentInboxCounts]) &&
        value[key as keyof CommentInboxCounts] >= 0,
    )
  );
}
export async function fetchCommentInbox(
  view: CommentInboxView,
  limit: number,
  cursor: string | null,
  signal: AbortSignal,
): Promise<CommentInboxBatch> {
  const params = new URLSearchParams({ view, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch('/api/shared-comments?' + params, { signal });
  if (!response.ok) throw new Error('공유 댓글을 불러오지 못했어요.');
  const batch = (await response.json()) as CommentInboxBatch;
  if (
    !batch ||
    !Array.isArray(batch.items) ||
    batch.items.length > limit ||
    !validCounts(batch.counts) ||
    (batch.nextCursor !== null && typeof batch.nextCursor !== 'string') ||
    !batch.items.every(
      (item) =>
        item &&
        ['threadId', 'blockId', 'excerpt', 'pageId', 'pageTitle', 'pageIcon', 'name', 'text'].every(
          (key) => typeof item[key as keyof typeof item] === 'string',
        ) &&
        /^[a-f0-9-]{36}$/.test(item.pageId) &&
        /^[a-f0-9-]{36}$/.test(item.threadId) &&
        typeof item.unread === 'boolean' &&
        typeof item.resolved === 'boolean' &&
        typeof item.isOwner === 'boolean' &&
        Number.isFinite(item.createdAt) &&
        (item.lastGuestMessageId === null || typeof item.lastGuestMessageId === 'string'),
    )
  )
    throw new Error('공유 댓글 응답을 읽지 못했어요.');
  return batch;
}
export async function markCommentThreadRead(
  threadId: string,
  lastGuestMessageId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/shared-comments/${threadId}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastGuestMessageId }),
    signal,
  });
  if (!response.ok) throw new Error('읽음 상태를 저장하지 못했어요.');
}
