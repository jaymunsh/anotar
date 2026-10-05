import { useState } from 'react';
import { resolveConflict, type ConflictRecord } from './conflicts';
import type { Value } from './repository';
function plain(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.day) return plain(v.day);
    if (v.priorities) return [`핵심 할 일\n${plain(v.priorities)}`,`시간 계획\n${plain(v.plan)}`,`하루 돌아보기\n${plain(v.feedback)}`,`아이디어\n${plain(v.idea)}`,`머릿속 생각\n${plain(v.brain)}`].join('\n\n');
    if (v.title) {
      const hm=(minutes:unknown)=>`${String(Math.floor(Number(minutes)/60)).padStart(2,'0')}:${String(Number(minutes)%60).padStart(2,'0')}`;
      return (typeof v.start==='number' ? `${hm(v.start)}–${hm(v.end)} ` : '') + String(v.title) + (v.missed ? ' · 미이행' : '');
    }
    if (typeof v.done==='boolean' && typeof v.text==='string') return `${v.done?'✓':'○'} ${v.text}`;
    return plain(v.text ?? v.content ?? v.blocks ?? '');
  }
  return '';
}
export default function ConflictPanel({
  conflict,
  local,
  onResolved,
}: {
  conflict: ConflictRecord;
  local: Value | null;
  onResolved: (result: { pageId: string; item: Value | null }) => void;
}) {
  const [view, setView] = useState<'local' | 'server' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const value = view === 'local' ? local : conflict.server;
  async function choose(choice: 'server' | 'local' | 'fork') {
    setBusy(true);
    setError('');
    try {
      onResolved(
        await resolveConflict({
          id: conflict.operationId,
          choice,
          expectedRemoteVersion: (conflict.server?.version as number) ?? null,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '변경을 처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob(
        [JSON.stringify({ base: conflict.base, local, server: conflict.server }, null, 2)],
        { type: 'application/json' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'leneu-변경-사본.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="sync-conflict" aria-label="변경 충돌 확인">
      <strong>다른 기기에서 수정했어요</strong>
      <p>
        {conflict.tombstone
          ? '서버에서 삭제한 자료예요. 내 변경은 기기에 남아 있어요.'
          : '양쪽 내용을 보존했어요. 확인 후 사용할 내용을 선택해 주세요.'}
      </p>
      <div className="sync-conflict-actions">
        <button onClick={() => setView('server')}>서버 내용 보기</button>
        <button onClick={() => setView('local')}>내 변경 보기</button>
        <button onClick={download}>사본 내려받기</button>
      </div>
      {view && (
        <div className="sync-conflict-preview">
          <strong>{String(value?.title ?? value?.date ?? (view === 'server' ? '삭제된 자료' : '내 변경'))}</strong>
          <pre>{plain(value?.document ?? value?.text ?? value)}</pre>
        </div>
      )}
      <div className="sync-conflict-actions">
        <button disabled={busy} onClick={() => void choose('server')}>
          {conflict.tombstone ? '내 변경 보관 후 닫기' : '서버 내용 사용'}
        </button>
        <button disabled={busy || conflict.tombstone} onClick={() => void choose('local')}>
          내 변경으로 반영
        </button>
        {conflict.entityKind === 'page' && (
          <button disabled={busy} onClick={() => void choose('fork')}>
            새 페이지로 보관
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
