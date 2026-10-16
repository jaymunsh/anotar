export type WorkspaceNotice = {
  id: string;
  title: string;
  message: string;
  retry?: () => void | Promise<void>;
};
let snapshot: WorkspaceNotice[] = [];
const listeners = new Set<() => void>();
export const getWorkspaceNotices = () => snapshot;
export function subscribeWorkspaceNotices(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Notices belong to the mounted surface; they are not document data. */
export function setWorkspaceNotice(id: string, notice: Omit<WorkspaceNotice, 'id'> | null) {
  if (!notice && !snapshot.some((item) => item.id === id)) return;
  snapshot = snapshot.filter((item) => item.id !== id);
  if (notice) snapshot = [...snapshot, { ...notice, id }];
  listeners.forEach((listener) => listener());
}
