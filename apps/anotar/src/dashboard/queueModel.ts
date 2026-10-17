// 정리할 것: what is waiting on the user, in the order worth handling.
export const MEMO_WAIT_DAYS = 3;

type Memo = { id: string; kind: string; text: string; url?: string | null; createdAt: string };
type Task = { id: string; title: string; dueDate: string | null; version: number };
type AiResult = { id: string; preview: string; sourceTitle: string; href: string; finishedAt: string | null };

export type QueueItem =
  | { kind: 'task'; id: string; title: string; dueDate: string; task: Task }
  | { kind: 'ai'; id: string; title: string; href: string }
  | { kind: 'memo'; id: string; title: string; waitedDays: number; memo: Memo };

const dayMs = 864e5;

/** Overdue tasks (oldest due first), then unreviewed AI results, then memos left in 입력함 for days (oldest first). */
export function buildQueue({ memos, tasks, ai, today, now }: { memos: Memo[]; tasks: Task[]; ai: AiResult[]; today: string; now: number }) {
  const overdue: QueueItem[] = tasks
    .filter((task) => task.dueDate && task.dueDate < today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map((task) => ({ kind: 'task', id: task.id, title: task.title, dueDate: task.dueDate!, task }));
  const results: QueueItem[] = ai.map((job) => ({
    kind: 'ai',
    id: job.id,
    title: job.preview || job.sourceTitle || 'AI 결과',
    href: job.href,
  }));
  const waiting: QueueItem[] = memos
    .map((memo) => ({ memo, waitedDays: Math.floor((now - Date.parse(memo.createdAt)) / dayMs) }))
    .filter(({ waitedDays }) => waitedDays >= MEMO_WAIT_DAYS)
    .sort((a, b) => b.waitedDays - a.waitedDays)
    .map(({ memo, waitedDays }) => ({
      kind: 'memo',
      id: memo.id,
      title: memo.text.trim() || memo.url || '첨부 메모',
      waitedDays,
      memo,
    }));
  return [...overdue, ...results, ...waiting];
}
