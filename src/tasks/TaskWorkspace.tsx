import { workspaceFetch } from '../sync/runtime';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { subscribeRecordChanges } from '../trash/events';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Columns3, FileText, List, ListTodo, Pencil, Plus } from 'lucide-react';
import type { Task, TaskList, TaskStatus, TaskStage } from './types';
import type { PageSummary } from '../pages/types';
import TaskBoard, {
  emptyTaskColumns,
  taskStages,
  taskStageLabels,
  type TaskColumns,
} from './TaskBoard';
import './tasks.css';

type Props = {
  mode: 'panel' | 'full' | 'hidden';
  panelTarget: HTMLDivElement | null;
  onOpenAll: () => void;
  onNavigate: (path: string) => void;
};
type Write = { server: Task; desired: TaskStage; running: boolean };
type Edit = {
  base: Task;
  title: string;
  dueDate: string;
  stage: TaskStage;
  pageId: string;
  busy: boolean;
  error: string;
  current: Task | null;
};
class RequestError extends Error {
  current: Task | null;
  constructor(message: string, current: Task | null = null) {
    super(message);
    this.current = current;
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await workspaceFetch(path, init);
  } catch {
    throw new RequestError('연결을 확인한 뒤 다시 시도해 주세요.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new RequestError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!body || typeof body !== 'object')
    throw new RequestError('서버 응답을 받지 못했어요. 다시 시도해 주세요.');
  if (!response.ok)
    throw new RequestError(body.error || '저장하지 못했어요. 다시 시도해 주세요.', body.current);
  return body;
}
const jsonRequest = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
function koreanToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dateLabel(date: string, today: string) {
  if (date === today) return '오늘까지';
  const [year, month, day] = date.split('-').map(Number);
  const label = `${year !== Number(today.slice(0, 4)) ? `${year}년 ` : ''}${month}월 ${day}일`;
  return date < today ? `기한 지남 · ${label}` : label;
}

export default function TaskWorkspace({ mode, panelTarget, onOpenAll, onNavigate }: Props) {
  const linkedTaskId =
    mode === 'full' ? new URLSearchParams(window.location.search).get('taskId') : null;
  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const [linkedError, setLinkedError] = useState('');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [view, setView] = useState<'list' | 'board'>(() => {
    try {
      return localStorage.getItem('leneu:tasks:view') === 'list' ? 'list' : 'board';
    } catch {
      return 'board';
    }
  });
  const board = mode === 'full' && view === 'board';
  const [columns, setColumns] = useState<TaskColumns>(emptyTaskColumns);

  const [list, setList] = useState<TaskList>({
    items: [],
    counts: { open: 0, done: 0 },
    nextCursor: null,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [pageError, setPageError] = useState('');
  const [pageReload, setPageReload] = useState(0);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [today, setToday] = useState(koreanToday);
  const writes = useRef(new Map<string, Write>());
  const createAttempt = useRef<{ title: string; requestId: string } | null>(null);
  const addingRef = useRef(false);
  const generation = useRef(0);
  const resolvedLink = useRef<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const limit = mode === 'full' ? 50 : mobile ? 3 : 5;

  useEffect(() => {
    if (mode === 'hidden') return;
    let active = true, generation = 0;
    const loadPages = async () => {
      const current = ++generation;
      try {
        const data = await request<{ items: PageSummary[] }>('/api/pages');
        if (!active || current !== generation) return;
        setPages(data.items);
        setPageError('');
      } catch {
        if (active && current === generation) setPageError('페이지 목록을 불러오지 못했어요.');
      }
    };
    void loadPages();
    const unsubscribe = subscribeRecordChanges(() => void loadPages());
    return () => { active = false; unsubscribe(); };
  }, [mode, pageReload]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    const timer = window.setInterval(() => setToday(koreanToday()), 60_000);
    return () => {
      media.removeEventListener('change', update);
      window.clearInterval(timer);
    };
  }, []);

  const load = useCallback(
    async (cursor: string | null = null, stage?: TaskStage) => {
      if (mode === 'hidden') return;
      const sequence = ++generation.current;
      setLoading(true);
      setListError('');
      const refreshLinked = async () => {
        if (!linkedTaskId) return;
        try {
          const { item } = await request<{ item: Task }>(`/api/tasks/${linkedTaskId}`);
          if (sequence !== generation.current) return;
          if (!writes.current.get(item.id)?.running && editRef.current?.base.id !== item.id) {
            setLinkedTask(item);
            if (resolvedLink.current !== item.id) {
              resolvedLink.current = item.id;
              setStatus(item.status);
            }
          }
          setLinkedError('');
        } catch {
          if (sequence === generation.current)
            setLinkedError('검색한 할 일을 불러오지 못했어요. 다시 검색해 주세요.');
        }
      };
      try {
        if (board) {
          const readStages = (stages: TaskStage[], nextCursor: string | null = null) =>
            Promise.all(
              stages.map(async (value) => {
                const query = new URLSearchParams({
                  stage: value,
                  limit: value === 'done' ? '10' : '20',
                });
                if (nextCursor) query.set('cursor', nextCursor);
                return [value, await request<TaskList>(`/api/tasks?${query}`)] as const;
              }),
            );
          let results = await readStages(stage ? [stage] : taskStages, stage ? cursor : null);
          const resetBoard = !!stage && !!results[0][1].reset;
          if (resetBoard) results = await readStages(taskStages);
          await refreshLinked();
          if (sequence !== generation.current) return;
          setColumns((previous) => {
            const next = { ...previous };
            for (const [value, result] of results)
              next[value] = {
                ...result,
                items:
                  cursor && !resetBoard && !result.reset
                    ? [
                        ...previous[value].items,
                        ...result.items.filter(
                          (task) => !previous[value].items.some((item) => item.id === task.id),
                        ),
                      ]
                    : result.items,
              };
            return next;
          });
          const result = results[0][1];
          setList((previous) => ({
            ...previous,
            counts: result.counts,
            stageCounts: result.stageCounts,
          }));
          return;
        }
        const query = new URLSearchParams({ status, limit: String(limit) });
        if (cursor) query.set('cursor', cursor);
        const result = await request<TaskList>(`/api/tasks?${query}`);
        await refreshLinked();
        if (sequence !== generation.current) return;
        result.items = result.items.map((task) => {
          const write = writes.current.get(task.id);
          return write?.running ? withStage(task, write.desired) : task;
        });
        setList((previous) => ({
          ...result,
          items:
            cursor && !result.reset
              ? [
                  ...previous.items,
                  ...result.items.filter(
                    (task) => !previous.items.some((item) => item.id === task.id),
                  ),
                ]
              : result.items,
        }));
      } catch (error) {
        if (sequence === generation.current)
          setListError(error instanceof Error ? error.message : '목록을 불러오지 못했어요.');
      } finally {
        if (sequence === generation.current) setLoading(false);
      }
    },
    [status, limit, mode, board, linkedTaskId],
  );
  const currentView = useRef({ load, status });
  currentView.current = { load, status };

  // One mounted workspace owns both presentations and their drafts.
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load, today]);

  useEffect(
    () =>
      subscribeRecordChanges((source) => {
        if (source === 'local-sync' || source === 'ai-tasks' || source === 'external' || source === 'focus')
          void currentView.current.load();
      }),
    [],
  );

  useEffect(() => {
    if (!linkedTaskId) {
      resolvedLink.current = null;
      setLinkedTask(null);
      setLinkedError('');
    }
  }, [linkedTaskId]);
  useEffect(() => {
    if (!linkedTask || editRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(
        `[data-task-id="${CSS.escape(linkedTask.id)}"]`,
      ) as HTMLElement | null;
      element?.scrollIntoView({ block: 'nearest' });
      element?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [linkedTask?.id, status]);
  function withStage(task: Task, stage: TaskStage): Task {
    return { ...task, stage, status: stage === 'done' ? 'done' : 'open' };
  }
  function replaceTask(task: Task) {
    setColumns((previous) => {
      const next = { ...previous };
      const old = taskStages.find((value) =>
        previous[value].items.some((item) => item.id === task.id),
      );
      for (const value of taskStages)
        next[value] = {
          ...previous[value],
          items: previous[value].items.filter((item) => item.id !== task.id),
        };
      if (old === task.stage)
        next[task.stage].items = previous[task.stage].items.map((item) =>
          item.id === task.id ? task : item,
        );
      else next[task.stage].items = [task, ...next[task.stage].items];
      return next;
    });
    setLinkedTask((previous) => (previous?.id === task.id ? task : previous));
    setList((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === task.id ? task : item)),
    }));
  }

  async function moveStage(task: Task, desired: TaskStage) {
    const write = writes.current.get(task.id) || { server: task, desired, running: false };
    write.desired = desired;
    writes.current.set(task.id, write);
    replaceTask(withStage(write.server, desired));
    setRowErrors((previous) => ({ ...previous, [task.id]: '' }));
    if (write.running) return;
    write.running = true;
    generation.current++;
    setPending((previous) => ({ ...previous, [task.id]: true }));
    let failed = false;
    try {
      // New gestures only update desired; each PATCH consumes the previous version.
      while (write.server.stage !== write.desired) {
        const target = write.desired;
        const { item } = await request<{ item: Task }>(
          `/api/tasks/${task.id}`,
          jsonRequest('PATCH', { stage: target, expectedVersion: write.server.version }),
        );
        write.server = item;
        replaceTask(withStage(item, write.desired));
      }
      writes.current.delete(task.id);
    } catch (error) {
      failed = true;
      if (error instanceof RequestError && error.current) write.server = error.current;
      replaceTask(write.server);
      setRowErrors((previous) => ({
        ...previous,
        [task.id]: error instanceof Error ? error.message : '저장하지 못했어요.',
      }));
    } finally {
      write.running = false;
      setPending((previous) => ({ ...previous, [task.id]: false }));
      if (!failed && ![...writes.current.values()].some((value) => value.running))
        void currentView.current.load();
      else setLoading(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddError('');
    if (createAttempt.current?.title !== cleanTitle)
      createAttempt.current = { title: cleanTitle, requestId: crypto.randomUUID() };
    try {
      await request<{ item: Task }>('/api/tasks', jsonRequest('POST', createAttempt.current));
      setTitle('');
      createAttempt.current = null;
      if (currentView.current.status === 'open') await currentView.current.load();
      else setStatus('open');
    } catch (error) {
      setAddError(error instanceof Error ? error.message : '추가하지 못했어요.');
    } finally {
      addingRef.current = false;
      setAdding(false);
      window.requestAnimationFrame(() => addInput.current?.focus());
    }
  }

  function startEdit(task: Task) {
    setEdit({
      base: task,
      title: task.title,
      dueDate: task.dueDate || '',
      stage: task.stage,
      pageId: task.pageId || '',
      busy: false,
      error: '',
      current: null,
    });
  }
  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || edit.busy) return;
    const draft = edit;
    setEdit({ ...draft, busy: true, error: '' });
    generation.current++;
    try {
      const { item } = await request<{ item: Task }>(
        `/api/tasks/${draft.base.id}`,
        jsonRequest('PATCH', {
          title: draft.title,
          dueDate: draft.dueDate || null,
          stage: draft.stage,
          pageId: draft.pageId || null,
          expectedVersion: draft.base.version,
        }),
      );
      replaceTask(item);
      setEdit(null);
      void currentView.current.load();
    } catch (error) {
      setEdit({
        ...draft,
        busy: false,
        error: error instanceof Error ? error.message : '수정하지 못했어요.',
        current: error instanceof RequestError ? error.current : null,
      });
      setLoading(false);
    }
  }
  function cancelEdit() {
    if (edit?.current) replaceTask(edit.current);
    setEdit(null);
    void load();
  }
  function changeStatus(next: TaskStatus) {
    if (next === status || edit || Object.values(pending).some(Boolean)) return;
    setStatus(next);
    setList((previous) => ({ ...previous, items: [], nextCursor: null }));
  }

  const full = mode === 'full';
  if (mode === 'hidden') return null;
  const pinned = [
    ...(full &&
    linkedTask &&
    linkedTask.id === linkedTaskId &&
    (board || linkedTask.status === status)
      ? [linkedTask]
      : []),
    ...(edit ? [edit.base] : []),
    ...[...writes.current.values()]
      .filter((write) => write.running || rowErrors[write.server.id])
      .map((write) => ({
        ...withStage(write.server, write.running ? write.desired : write.server.stage),
      })),
  ];
  const pinnedIds = new Set(pinned.map((task) => task.id));
  const visibleItems = full ? [...list.items] : list.items.slice(0, limit);
  for (const task of pinned) {
    if (visibleItems.some((item) => item.id === task.id)) continue;
    if (!full && visibleItems.length >= limit) {
      for (let index = visibleItems.length - 1; index >= 0; index--) {
        if (!pinnedIds.has(visibleItems[index].id)) {
          visibleItems.splice(index, 1);
          break;
        }
      }
    }
    visibleItems.push(task);
  }
  const renderTask = (task: Task) => (
    <li
      key={task.id}
      className={`task-row ${task.status === 'done' ? 'task-done' : ''} ${full && task.id === linkedTaskId ? 'task-linked' : ''}`}
      tabIndex={full && task.id === linkedTaskId ? -1 : undefined}
      data-task-id={task.id}
      draggable={board && !mobile && !edit && !pending[task.id] && !rowErrors[task.id]}
      onDragStart={(event) => {
        if (!board || edit || pending[task.id]) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('application/x-leneu-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <label className="task-check">
        <input
          type="checkbox"
          checked={task.status === 'done'}
          disabled={edit?.base.id === task.id}
          aria-label={`${task.title} ${task.status === 'done' ? '완료 취소' : '완료'}`}
          onChange={(event) => void moveStage(task, event.target.checked ? 'done' : 'todo')}
        />
        <Check size={13} strokeWidth={2.6} aria-hidden="true" />
      </label>
      <div className="task-row-content">
        {full && task.id === linkedTaskId && (
          <small className="task-linked-label">검색한 할 일</small>
        )}
        {edit?.base.id === task.id ? (
          <form className="task-edit" onSubmit={saveEdit}>
            <input
              aria-label="할 일 내용"
              autoFocus
              value={edit.title}
              maxLength={500}
              required
              disabled={edit.busy}
              onChange={(event) => setEdit({ ...edit, title: event.target.value })}
            />
            <label className="task-date-field">
              <span>기한</span>
              <input
                type="date"
                aria-label="기한"
                value={edit.dueDate}
                min="0001-01-01"
                max="9999-12-31"
                disabled={edit.busy}
                onChange={(event) => setEdit({ ...edit, dueDate: event.target.value })}
              />
            </label>
            {full && (
              <label className="task-edit-stage">
                <span>상태</span>
                <select
                  aria-label="할 일 상태"
                  value={edit.stage}
                  disabled={edit.busy}
                  onChange={(event) => setEdit({ ...edit, stage: event.target.value as TaskStage })}
                >
                  {taskStages.map((value) => (
                    <option key={value} value={value}>
                      {taskStageLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="task-page-field">
              <span>참조 페이지</span>
              <select
                aria-label="참조 페이지"
                value={edit.pageId}
                disabled={edit.busy}
                onChange={(event) => setEdit({ ...edit, pageId: event.target.value })}
              >
                <option value="">연결 안 함</option>
                {edit.pageId && !pages.some((page) => page.id === edit.pageId) && (
                  <option value={edit.pageId}>연결된 페이지 · 목록에서 확인할 수 없어요</option>
                )}
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>{page.title || '제목 없음'}</option>
                ))}
              </select>
            </label>
            {pageError && (
              <div className="task-error" role="alert">
                <span>{pageError}</span>
                <button type="button" className="task-text-button" onClick={() => setPageReload(value => value + 1)}>다시 불러오기</button>
              </div>
            )}
            {edit.error && (
              <div className="task-error" role="alert">
                <span>{edit.error}</span>
                {edit.current && (
                  <button
                    type="button"
                    className="task-text-button"
                    onClick={() => {
                      replaceTask(edit.current!);
                      startEdit(edit.current!);
                    }}
                  >
                    최신 내용 불러오기
                  </button>
                )}
              </div>
            )}
            <div className="task-edit-actions">
              <button type="button" disabled={edit.busy} onClick={cancelEdit}>
                취소
              </button>
              <button type="submit" disabled={edit.busy || !edit.title.trim()}>
                {edit.busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <button
              className="task-title-button"
              title={task.title}
              aria-label={`${task.title} 수정`}
              disabled={!!edit || pending[task.id]}
              onClick={() => startEdit(task)}
            >
              <span>{task.title}</span>
              <Pencil size={12} aria-hidden="true" />
            </button>
            {task.dueDate && (
              <time
                className={`task-due ${task.status === 'open' && task.dueDate < today ? 'task-overdue' : ''}`}
                dateTime={task.dueDate}
              >
                {dateLabel(task.dueDate, today)}
              </time>
            )}
            {task.pageId && (
              <a
                className="task-page-link"
                href={`/pages/${task.pageId}`}
                draggable={false}
                title={pages.find(page => page.id === task.pageId)?.title || '참조 페이지 열기'}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(`/pages/${task.pageId}`);
                }}
              >
                <FileText size={13} aria-hidden="true" />
                <span>{pages.find(page => page.id === task.pageId)?.title || '연결된 페이지'}</span>
                <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            )}
            {full && !board ? (
              <label className="task-stage-control">
                <span>상태</span>
                <select
                  aria-label={`${task.title} 상태`}
                  value={task.stage}
                  disabled={!!edit || pending[task.id]}
                  onChange={(event) => void moveStage(task, event.target.value as TaskStage)}
                >
                  {taskStages.map((value) => (
                    <option key={value} value={value}>
                      {taskStageLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
            ) : !full && task.stage === 'doing' ? (
              <span className="task-stage-tag">진행 중</span>
            ) : null}
            {pending[task.id] && (
              <span className="task-saving" role="status">
                저장 중…
              </span>
            )}
            {rowErrors[task.id] && (
              <div className="task-error" role="alert">
                <span>{rowErrors[task.id]}</span>
                <button
                  className="task-text-button"
                  onClick={() => {
                    const write = writes.current.get(task.id);
                    if (write) void moveStage(write.server, write.desired);
                  }}
                >
                  다시 시도
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
  const addForm = (
    <>
      <form className="task-add" onSubmit={add}>
        <input
          ref={addInput}
          aria-label="새 할 일"
          placeholder="할 일 추가…"
          value={title}
          maxLength={500}
          disabled={adding}
          onChange={(event) => {
            setTitle(event.target.value);
            setAddError('');
          }}
        />
        <button type="submit" aria-label="할 일 추가" disabled={adding || !title.trim()}>
          <Plus size={19} aria-hidden="true" />
        </button>
      </form>
      {addError && (
        <div className="task-error" role="alert">
          {addError}
          <span>입력한 내용은 남아 있어요. 추가 버튼으로 다시 시도해 주세요.</span>
        </div>
      )}
    </>
  );
  const content = (
    <section
      className={`task-workspace ${full ? 'task-workspace-full' : 'task-panel'}`}
      aria-label="할 일"
    >
      {full ? (
        <WorkspaceToolbar title="할 일">
          <div className="task-view-switch" aria-label="할 일 보기 방식">
            {(['list', 'board'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={view === value}
                disabled={!!edit || Object.values(pending).some(Boolean)}
                onClick={() => {
                  setView(value);
                  try {
                    localStorage.setItem('leneu:tasks:view', value);
                  } catch {
                    /* Keep the current view available without browser storage. */
                  }
                }}
              >
                {value === 'list' ? (
                  <List size={15} aria-hidden="true" />
                ) : (
                  <Columns3 size={15} aria-hidden="true" />
                )}
                {value === 'list' ? '목록' : '보드'}
              </button>
            ))}
          </div>
          <button
            className="toolbar-primary toolbar-icon-mobile"
            aria-label="새 할 일 작성"
            title="새 할 일 작성"
            disabled={adding}
            onClick={() => {
              addInput.current?.scrollIntoView({ block: 'center' });
              addInput.current?.focus();
            }}
          >
            <Plus size={16} />
            <span>새 할 일</span>
          </button>
        </WorkspaceToolbar>
      ) : (
        <div className="task-heading">
          <div className="task-heading-title">
            <ListTodo size={19} aria-hidden="true" />
            <h2>할 일</h2>
          </div>
          <button className="task-text-button task-open-all" onClick={onOpenAll}>
            전체 보기 <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {!board && (
        <div className="task-tabs" aria-label="할 일 상태">
          {(['open', 'done'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={status === value}
              disabled={!!edit || Object.values(pending).some(Boolean)}
              onClick={() => changeStatus(value)}
            >
              {value === 'open' ? '할 일' : '완료'} <span>{list.counts[value]}</span>
            </button>
          ))}
        </div>
      )}
      {linkedError && (
        <p className="task-error" role="alert">
          {linkedError}
        </p>
      )}
      {listError && (
        <div className="task-error" role="alert">
          <span>{listError}</span>
          <button className="task-text-button" onClick={() => void load()}>
            목록 다시 불러오기
          </button>
        </div>
      )}
      {board && <div className="task-board-add">{addForm}</div>}
      {board ? (
        <TaskBoard
          columns={columns}
          counts={list.stageCounts || { todo: list.counts.open, doing: 0, done: list.counts.done }}
          pinned={pinned}
          renderTask={renderTask}
          onMove={(task, stage) => void moveStage(task, stage)}
          onMore={(stage, cursor) => void load(cursor, stage)}
          locked={!!edit || Object.values(pending).some(Boolean)}
          loading={loading}
          activeTask={edit?.base || linkedTask}
        />
      ) : (
        <ul className="task-list" aria-busy={loading}>
          {visibleItems.map(renderTask)}
        </ul>
      )}
      {!board && !visibleItems.length && !listError && (
        <div className="task-empty">
          {loading ? (
            '불러오는 중…'
          ) : status === 'done' ? (
            '완료한 할 일이 여기에 모여요.'
          ) : (
            <>
              <strong>작은 일부터 하나씩.</strong>
              <span>아래에 할 일을 적어보세요.</span>
            </>
          )}
        </div>
      )}
      {!board && addForm}
      {!board && list.nextCursor && (
        <button
          className="task-more task-text-button"
          disabled={loading || !!edit || Object.values(pending).some(Boolean)}
          onClick={full ? () => void load(list.nextCursor) : onOpenAll}
        >
          {full
            ? '더 보기'
            : `나머지 ${Math.max(0, list.counts[status] - visibleItems.length)}개 보기`}{' '}
          <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
  return full ? content : panelTarget ? createPortal(content, panelTarget) : null;
}
