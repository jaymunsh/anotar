import { useRef, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { publishRecordChange } from '../trash/events';
import type { AiJob } from './types';
type Candidate = { title: string; dueDate: string; selected: boolean };
export default function AiTaskAdoption({ job }: { job: AiJob }) {
  const [candidates, setCandidates] = useState<Candidate[]>(() => {
    try {
      const attempt = JSON.parse(
        sessionStorage.getItem(`leneu:ai-task-adoption:${job.id}`) || 'null',
      );
      if (attempt?.payload) {
        const tasks = JSON.parse(attempt.payload);
        if (
          Array.isArray(tasks) &&
          tasks.length <= 50 &&
          tasks.every((t) => typeof t.title === 'string' && t.title.length <= 500)
        )
          return tasks.map((t) => ({ title: t.title, dueDate: t.dueDate || '', selected: true }));
      }
    } catch {}
    return (job.result?.markdown.match(/^\s*[-*+]\s+\[ \]\s+.+$/gm) || [])
      .slice(0, 50)
      .map((line) => ({
        title: line.replace(/^\s*[-*+]\s+\[ \]\s+/, '').slice(0, 500),
        dueDate: '',
        selected: false,
      }));
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const key = `leneu:ai-task-adoption:${job.id}`;
  const pending = useRef<{ payload: string; requestId: string } | null>(
    (() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || 'null');
      } catch {
        return null;
      }
    })(),
  );
  function patch(index: number, value: Partial<Candidate>) {
    setCandidates((c) => c.map((t, i) => (i === index ? { ...t, ...value } : t)));
    setMessage('');
  }
  async function submit() {
    const tasks = candidates
      .filter((c) => c.selected)
      .map(({ title, dueDate }) => ({ title, dueDate: dueDate || null }));
    if (!tasks.length || busy) return;
    const payload = JSON.stringify(tasks);
    if (pending.current?.payload !== payload)
      pending.current = { payload, requestId: crypto.randomUUID() };
    try {
      sessionStorage.setItem(key, JSON.stringify(pending.current));
    } catch {
      setError('등록 요청을 브라우저에 보관하지 못했어요. 저장 공간을 확인해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/ai-jobs/${job.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, requestId: pending.current.requestId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(`${result.items.length}개 할 일을 등록했어요.`);
      setCandidates((c) => c.map((t) => ({ ...t, selected: false })));
      pending.current = null;
      sessionStorage.removeItem(key);
      publishRecordChange('ai-tasks');
    } catch (e) {
      setError(e instanceof Error ? e.message : '할 일을 등록하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="ai-task-adoption">
      <summary>결과에서 할 일 등록</summary>
      <p>등록할 내용을 선택하고 다듬어 주세요. 선택한 항목만 할 일 목록에 추가합니다.</p>
      <fieldset disabled={busy}>
        {candidates.map((c, i) => (
          <div className="ai-task-candidate" key={i}>
            <input
              type="checkbox"
              aria-label={`할 일 ${i + 1} 선택`}
              checked={c.selected}
              onChange={(e) => patch(i, { selected: e.target.checked })}
            />
            <input
              aria-label={`할 일 ${i + 1} 내용`}
              maxLength={500}
              value={c.title}
              onChange={(e) => patch(i, { title: e.target.value })}
            />
            <input
              type="date"
              aria-label={`할 일 ${i + 1} 기한`}
              value={c.dueDate}
              onChange={(e) => patch(i, { dueDate: e.target.value })}
            />
          </div>
        ))}
        <div className="ai-job-actions">
          <button
            disabled={candidates.length >= 50}
            onClick={() => setCandidates((c) => [...c, { title: '', dueDate: '', selected: true }])}
          >
            <Plus size={14} />
            직접 추가
          </button>
          <button
            disabled={
              !candidates.some((c) => c.selected) ||
              candidates.some((c) => c.selected && !c.title.trim())
            }
            onClick={() => void submit()}
          >
            <Check size={14} />
            {busy ? '등록 중…' : '선택한 할 일 등록'}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="ai-job-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
