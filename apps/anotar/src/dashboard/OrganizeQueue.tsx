import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, FileText, Sparkles } from 'lucide-react';
import { workspaceFetch } from '../sync/runtime';
import { onlineActionFetch } from '../sync/onlineActions';
import { publishRecordChange, subscribeRecordChanges } from '../trash/events';
import { kstToday, parseDueDate } from '../tasks/dueDate';
import { buildQueue, MEMO_WAIT_DAYS, type QueueItem } from './queueModel';

const PREVIEW = 5;
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
async function ok(response: Response) {
  if (response.ok) return response;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error || '처리하지 못했어요. 다시 시도해 주세요.');
}

/** Home panel: what is waiting on you, with one-tap actions. Nothing here deletes. */
export default function OrganizeQueue({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [memos, tasks, ai] = await Promise.all([
        workspaceFetch('/api/captures?organization=inbox&scope=memo').then(ok).then((r) => r.json()),
        fetch('/api/tasks?status=open&limit=50').then(ok).then((r) => r.json()),
        fetch('/api/ai/activity?status=result_ready').then(ok).then((r) => r.json()),
      ]);
      setItems(buildQueue({ memos: memos.items, tasks: tasks.items, ai: ai.items, today: kstToday(), now: Date.now() }));
    } catch {
      setItems((current) => current ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
    return subscribeRecordChanges(() => void load());
  }, [load]);

  async function act(item: QueueItem, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(item.id);
    setError('');
    try {
      await action();
      publishRecordChange('organize');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리하지 못했어요.');
    } finally {
      setBusy('');
    }
  }
  const archive = (id: string) =>
    onlineActionFetch(`/api/captures/${id}/archive`, json('POST', { operationId: crypto.randomUUID() })).then(ok);
  const patchTask = (item: Extract<QueueItem, { kind: 'task' }>, change: object) =>
    fetch(`/api/tasks/${item.id}`, json('PATCH', { expectedVersion: item.task.version, ...change })).then(ok);

  if (!items) return null;
  const shown = expanded ? items : items.slice(0, PREVIEW);
  return (
    <section className="organize-queue" aria-labelledby="organize-queue-title">
      <header>
        <h2 id="organize-queue-title">
          정리할 것 <span>{items.length}</span>
        </h2>
        <p>기한 지난 할 일 · 확인 안 한 AI 결과 · {MEMO_WAIT_DAYS}일 넘게 둔 메모</p>
      </header>
      {!items.length && <p className="organize-queue-empty">지금은 정리할 것이 없어요.</p>}
      <ul>
        {shown.map((item) => {
          const disabled = !!busy;
          return (
            <li key={item.kind + item.id} aria-busy={busy === item.id}>
              <span className={`organize-queue-icon is-${item.kind}`} aria-hidden>
                {item.kind === 'task' ? <AlarmClock size={15} /> : item.kind === 'ai' ? <Sparkles size={15} /> : <FileText size={15} />}
              </span>
              <span className="organize-queue-text">
                <strong title={item.title}>{item.title}</strong>
                <small>
                  {item.kind === 'task'
                    ? `기한 ${item.dueDate.slice(5).replace('-', '/')} 지남`
                    : item.kind === 'ai'
                      ? 'AI 결과 · 아직 안 봄'
                      : `메모 · ${item.waitedDays}일째 입력함`}
                </small>
              </span>
              <span className="organize-queue-actions">
                {item.kind === 'task' && (
                  <>
                    <button disabled={disabled} onClick={() => void act(item, () => patchTask(item, { dueDate: kstToday() }))}>오늘로</button>
                    <button disabled={disabled} onClick={() => void act(item, () => patchTask(item, { status: 'done' }))}>완료</button>
                  </>
                )}
                {item.kind === 'ai' && (
                  <button disabled={disabled} onClick={() => onNavigate(item.href)}>결과 보기</button>
                )}
                {item.kind === 'memo' && (
                  <>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void act(item, async () => {
                          const title = item.title.replace(/\s+/g, ' ').slice(0, 500);
                          await fetch('/api/tasks', json('POST', { title, dueDate: parseDueDate(title, kstToday()), requestId: crypto.randomUUID() })).then(ok);
                          await archive(item.id);
                        })
                      }
                    >
                      할 일로
                    </button>
                    <button disabled={disabled} onClick={() => onNavigate(`/captures/${item.id}`)}>페이지로</button>
                    <button disabled={disabled} onClick={() => void act(item, () => archive(item.id))}>보관</button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > PREVIEW && (
        <button className="organize-queue-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '접기' : `더 보기 (${items.length - PREVIEW})`}
        </button>
      )}
      {error && <p className="organize-queue-error" role="alert">{error}</p>}
    </section>
  );
}
