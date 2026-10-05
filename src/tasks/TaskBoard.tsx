import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { Task, TaskList, TaskStage } from './types';

export const taskStages: TaskStage[] = ['todo', 'doing', 'done'];
export const taskStageLabels: Record<TaskStage, string> = {
  todo: '대기',
  doing: '진행 중',
  done: '완료',
};
export type TaskColumns = Record<TaskStage, TaskList>;
export const emptyTaskList = (): TaskList => ({
  items: [],
  counts: { open: 0, done: 0 },
  nextCursor: null,
});
export const emptyTaskColumns = (): TaskColumns => ({
  todo: emptyTaskList(),
  doing: emptyTaskList(),
  done: emptyTaskList(),
});

type Props = {
  columns: TaskColumns;
  counts: Record<TaskStage, number>;
  pinned: Task[];
  renderTask: (task: Task) => ReactNode;
  onMove: (task: Task, stage: TaskStage) => void;
  onMore: (stage: TaskStage, cursor: string) => void;
  locked: boolean;
  loading: boolean;
  activeTask: Task | null;
};

export default function TaskBoard({
  columns,
  counts,
  pinned,
  renderTask,
  onMove,
  onMore,
  locked,
  loading,
  activeTask,
}: Props) {
  const [active, setActive] = useState<TaskStage>('todo');
  const [over, setOver] = useState<TaskStage | null>(null);
  useEffect(() => {
    if (activeTask) setActive(activeTask.stage);
  }, [activeTask?.id, activeTask?.stage]);
  const all = new Map<string, Task>();
  for (const stage of taskStages) for (const task of columns[stage].items) all.set(task.id, task);
  for (const task of pinned) all.set(task.id, task);
  const icons = { todo: Circle, doing: CircleDot, done: CheckCircle2 };
  return (
    <div className="task-board-surface">
      <div className="task-board-tabs task-tabs" aria-label="보드 상태">
        {taskStages.map((stage) => (
          <button
            key={stage}
            aria-pressed={active === stage}
            disabled={locked}
            onClick={() => setActive(stage)}
          >
            {taskStageLabels[stage]} <span>{counts[stage]}</span>
          </button>
        ))}
      </div>
      <div className="task-board" aria-busy={loading} onDragEnd={() => setOver(null)}>
        {taskStages.map((stage) => {
          const Icon = icons[stage];
          const tasks = [...all.values()].filter((task) => task.stage === stage);
          return (
            <section
              key={stage}
              className={`task-board-column ${active === stage ? 'is-active' : ''} ${over === stage ? 'is-drop-target' : ''}`}
              data-task-stage={stage}
              aria-label={`${taskStageLabels[stage]} 할 일`}
              onDragOver={(event) => {
                if (locked || !event.dataTransfer.types.includes('application/x-leneu-task'))
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOver(stage);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                if (locked) return;
                const task = all.get(event.dataTransfer.getData('application/x-leneu-task'));
                if (task && task.stage !== stage) onMove(task, stage);
              }}
            >
              <header className="task-board-column-heading">
                <Icon size={15} aria-hidden="true" />
                <h2>{taskStageLabels[stage]}</h2>
                <span>{counts[stage]}</span>
              </header>
              <ul className="task-list task-board-cards">{tasks.map(renderTask)}</ul>
              {!tasks.length && (
                <p className="task-board-empty">
                  {loading
                    ? '불러오는 중…'
                    : stage === 'done'
                      ? '마무리한 일이 여기에 모여요.'
                      : stage === 'doing'
                        ? '시작한 일을 이곳으로 옮겨보세요.'
                        : '새로운 할 일을 추가해보세요.'}
                </p>
              )}
              {columns[stage].nextCursor && (
                <button
                  className="task-text-button task-board-more"
                  disabled={locked || loading}
                  onClick={() => onMore(stage, columns[stage].nextCursor!)}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                  {stage === 'done' ? '이전 완료 보기' : '더 보기'}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
