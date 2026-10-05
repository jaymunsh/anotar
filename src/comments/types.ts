export type CommentInboxView = 'all' | 'unread' | 'open' | 'resolved';
export type CommentInboxItem = {
  threadId: string;
  blockId: string;
  excerpt: string;
  resolved: boolean;
  version: number;
  pageId: string;
  pageTitle: string;
  pageIcon: string;
  lastGuestMessageId: string | null;
  unread: boolean;
  name: string;
  text: string;
  isOwner: boolean;
  createdAt: number;
};
export type CommentInboxCounts = { all: number; unread: number; open: number; resolved: number };
export type CommentInboxBatch = {
  items: CommentInboxItem[];
  counts: CommentInboxCounts;
  nextCursor: string | null;
};
export function commentThreadHref(item: Pick<CommentInboxItem, 'pageId' | 'threadId' | 'blockId'>) {
  return `/pages/${item.pageId}?${new URLSearchParams({ commentThread: item.threadId, commentBlock: item.blockId })}`;
}
