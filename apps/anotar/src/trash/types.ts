export type TrashEntry = {
  id: string;
  kind: 'capture' | 'page';
  targetId: string;
  label: string;
  preview: string;
  icon: string;
  isAi: boolean;
  count: number;
  deletedAt: string;
  restoredAt: string | null;
};
export type TrashRequest = { path: string; body: Record<string, unknown> };
