export type TaskStatus = 'open' | 'done';
export type TaskStage = 'todo' | 'doing' | 'done';
export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  stage: TaskStage;
  dueDate: string | null;
  pageId?: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
};
export type TaskList = {
  items: Task[];
  counts: { open: number; done: number };
  stageCounts?: Record<TaskStage, number>;
  nextCursor: string | null;
  reset?: boolean;
};
