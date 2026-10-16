import { useState } from 'react';
import { getWorkspaceRuntime } from '../sync/runtime';
import {
  listJournalMigrationCollisions,
  resolveJournalMigration,
  type JournalMigrationCollision,
} from './migration';
import type { JournalDay } from '../../shared/journal.mjs';

function readable(day: JournalDay) {
  const hm = (time: number) =>
    `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
  return [
    '핵심 할 일\n' +
      day.priorities
        .filter((p) => p.text.trim())
        .map((p) => `${p.done ? '✓' : '○'} ${p.text}`)
        .join('\n'),
    '시간 계획\n' +
      day.plan
        .map((p) => `${hm(p.start)}–${hm(p.end)} ${p.title}${p.missed ? ' · 미이행' : ''}`)
        .join('\n'),
    '하루 돌아보기\n' + day.feedback,
    '아이디어\n' + day.idea,
    '머릿속 생각\n' + day.brain,
  ].join('\n\n');
}
export default function LegacyJournalReview({ initial }: { initial: JournalMigrationCollision[] }) {
  const [copies, setCopies] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function choose(key: string, choice: 'existing' | 'legacy') {
    setBusy(true);
    setError('');
    try {
      await resolveJournalMigration(key, choice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '사본을 선택하지 못했어요.');
    } finally {
      try {
        const { workspaceId } = await getWorkspaceRuntime();
        setCopies(await listJournalMigrationCollisions(workspaceId));
      } finally {
        setBusy(false);
      }
    }
  }
  function download(copy: JournalMigrationCollision) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `anotar-일지-이관-${copy.date}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!copies.length) return null;
  return (
    <section
      className="sync-conflict"
      style={{ margin: '16px clamp(16px,3vw,40px)' }}
      aria-label="이전 기기 일지 이관 확인"
    >
      <strong>현재 일지와 이전 저장소 일지가 달라요</strong>
      <p>
        현재 기기 내용과 기존 전송을 유지했어요. 사용할 사본을 직접 선택하고, 두 원본은 이관 기록에
        보관해요.
      </p>
      {copies.map((copy) => (
        <details key={copy.key}>
          <summary>{copy.date} 일지 사본 비교</summary>
          <div className="sync-conflict-preview">
            <strong>현재 기기 일지</strong>
            <pre>{readable(copy.existing.day as JournalDay)}</pre>
          </div>
          <div className="sync-conflict-preview">
            <strong>이전 저장소 일지</strong>
            <pre>{readable(copy.legacyDay)}</pre>
          </div>
          <div className="sync-conflict-actions">
            <button disabled={busy} onClick={() => void choose(copy.key, 'existing')}>
              현재 기기 내용 유지
            </button>
            <button disabled={busy} onClick={() => void choose(copy.key, 'legacy')}>
              이전 일지로 사용
            </button>
            <button onClick={() => download(copy)}>두 사본 내려받기</button>
          </div>
        </details>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
