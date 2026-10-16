import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, RefreshCw, Play } from 'lucide-react';
import { formatKoreanTime } from '../time';
import { loadBackupStatus, runBackupNow, saveBackupSettings } from './api';
import type { BackupSettings, BackupStatus } from './types';
import './backups.css';

const pad = (value: number) => String(value).padStart(2, '0');
const quoted = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const message = (error: unknown) => error instanceof Error ? error.message : '연결을 확인하고 다시 시도해 주세요.';
const runLabel = { running: '실행 중', succeeded: '완료', failed: '실패' };

export default function BackupWorkspace() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [draft, setDraft] = useState<BackupSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<'settings' | 'run' | null>(null);
  const [notice, setNotice] = useState('');
  const [historyLimit, setHistoryLimit] = useState(10);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const statusRef = useRef<BackupStatus | null>(null);
  const busyRef = useRef(false);
  const edited = useRef(false);

  function apply(next: BackupStatus) {
    statusRef.current = next;
    setStatus(next);
    setCheckedAt(new Date().toISOString());
    if (!edited.current) setDraft({ enabled: next.settings.enabled, hour: next.settings.hour, minute: next.settings.minute, retention: next.settings.retention });
  }

  async function load() {
    if (busyRef.current) return;
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await loadBackupStatus(controller.signal);
      if (!mounted.current || generation.current !== current) return;
      apply(next);
      setLoadError('');
    } catch (error) {
      if (mounted.current && generation.current === current && !controller.signal.aborted)
        setLoadError(message(error));
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void latestLoad.current();
    };
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, statusRef.current?.running ? 2000 : 15_000);
    };
    void latestLoad.current();
    schedule();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      ++generation.current;
      request.current?.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  function edit(next: Partial<BackupSettings>) {
    edited.current = true;
    setNotice('');
    setDraft((previous) => previous ? { ...previous, ...next } : null);
  }

  async function perform(kind: 'settings' | 'run', event?: FormEvent) {
    event?.preventDefault();
    if (busyRef.current || status?.running || !draft) return;
    busyRef.current = true;
    setBusy(kind);
    setActionError('');
    setNotice('');
    ++generation.current;
    request.current?.abort();
    try {
      const next = kind === 'settings' ? await saveBackupSettings(draft) : await runBackupNow();
      if (!mounted.current) return;
      if (kind === 'settings') edited.current = false;
      apply(next);
      setNotice(kind === 'settings' ? '설정을 저장했어요.' : '백업을 시작했어요. 완료 상태를 확인해 주세요.');
    } catch (error) {
      if (mounted.current) setActionError(message(error));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const locked = Boolean(busy || status?.running);
  const dirty = Boolean(draft && status && (draft.enabled !== status.settings.enabled || draft.hour !== status.settings.hour || draft.minute !== status.settings.minute || draft.retention !== status.settings.retention));
  const restorePath = status?.lastGood?.path;

  return (
    <div className="backup-workspace">
      <WorkspaceToolbar title="백업" meta={checkedAt ? `확인 ${formatKoreanTime(checkedAt)}` : undefined}>
        <button type="button" className="toolbar-primary" disabled={locked || !status} onClick={() => void perform('run')}>
          <Play size={15} aria-hidden /><span>{busy === 'run' ? '시작 중…' : status?.running ? '백업 실행 중…' : '지금 백업'}</span>
        </button>
      </WorkspaceToolbar>

      {loading && <p className="backup-muted" role="status">백업 상태를 불러오는 중…</p>}
      {loadError && <div className="backup-error" role="alert">
        <p>{loadError}</p>
        {checkedAt && <p>마지막 확인: {formatKoreanTime(checkedAt)}</p>}
        <button type="button" className="backup-button" disabled={Boolean(busy)} onClick={() => void load()}>다시 불러오기</button>
      </div>}
      {actionError && <div className="backup-error" role="alert"><p>{actionError}</p><button type="button" className="backup-button" onClick={() => void load()}>상태 다시 확인</button></div>}
      {notice && <p className="backup-notice" role="status">{notice}</p>}

      {status && draft && <>
        <section className="backup-section backup-status" aria-label="현재 백업 상태" aria-live="polite">
          <dl>
            <div><dt>자동 백업</dt><dd>{status.running ? '실행 중' : status.settings.enabled ? '켜짐' : '꺼짐'}</dd></div>
            <div><dt>다음 실행 · 한국시간</dt><dd>{status.nextRunAt ? <time dateTime={status.nextRunAt}>{formatKoreanTime(status.nextRunAt)}</time> : '자동 백업을 켜면 표시돼요'}</dd></div>
            <div><dt>최근 성공</dt><dd>{status.lastGood ? <><Check size={14} aria-hidden /><time dateTime={status.lastGood.finishedAt || status.lastGood.startedAt}>{formatKoreanTime(status.lastGood.finishedAt || status.lastGood.startedAt)}</time></> : '아직 백업이 없어요'}</dd></div>
          </dl>
          {status.error && <div className="backup-error" role="alert"><p>{status.error}</p><p>이전에 검증한 백업은 보관해요. 원인을 해결한 뒤 다시 실행해 주세요.</p><button className="backup-button" disabled={locked} onClick={() => void perform('run')}><RefreshCw size={14} aria-hidden />다시 백업</button></div>}
        </section>

        <section className="backup-section" aria-labelledby="backup-settings-title">
          <h2 id="backup-settings-title">자동 백업 설정</h2>
          <form onSubmit={(event) => void perform('settings', event)}>
            <fieldset disabled={locked} className="backup-settings-fields">
              <legend className="backup-visually-hidden">일일 백업 설정</legend>
              <label className="backup-enable"><input type="checkbox" checked={draft.enabled} onChange={(event) => edit({ enabled: event.target.checked })} />매일 자동으로 백업</label>
              <div className="backup-settings-row">
                <label>실행 시각 · 한국시간<input type="time" required value={`${pad(draft.hour)}:${pad(draft.minute)}`} onChange={(event) => { if (event.target.value) { const [hour, minute] = event.target.value.split(':').map(Number); edit({ hour, minute }); } }} /></label>
                <label>보관 개수<input type="number" required min={1} max={60} step={1} value={Number.isNaN(draft.retention) ? '' : draft.retention} onChange={(event) => edit({ retention: event.target.valueAsNumber })} /></label>
                <button className="backup-button" disabled={!dirty || locked} type="submit">{busy === 'settings' ? '저장 중…' : '설정 저장'}</button>
              </div>
            </fieldset>
            <p className="backup-help">정상 백업을 검증한 뒤 이전 백업을 정리해요. 서버가 꺼져 있으면 다음 시작 때 놓친 최근 예약을 한 번 실행해요.</p>
          </form>
          <details className="backup-location"><summary>백업 저장 위치</summary><code>{status.backupDir}</code></details>
        </section>

        <section className="backup-section" aria-labelledby="backup-history-title">
          <h2 id="backup-history-title">최근 실행</h2>
          {!status.history.length ? <p className="backup-muted">지금 백업하거나 자동 백업을 켜서 첫 사본을 보관해 주세요.</p> : <ol className="backup-history">
            {status.history.slice(0, historyLimit).map((run) => <li key={run.id}>
              <div className="backup-run-main"><time dateTime={run.startedAt}>{formatKoreanTime(run.startedAt)}</time><span>{run.trigger === 'scheduled' ? '자동' : '직접 실행'}</span></div>
              <span className={`backup-run-status is-${run.status}`}>{runLabel[run.status]}{run.status === 'succeeded' ? run.available ? ' · 보관 중' : ' · 보관 제외' : ''}</span>
              {run.error && <p className="backup-run-error">{run.error}</p>}
            </li>)}
          </ol>}
          {status.history.length > historyLimit && <button className="backup-button" type="button" onClick={() => setHistoryLimit((value) => value + 10)}>이전 실행 더 보기</button>}
        </section>

        <details className="backup-restore backup-section">
          <summary>백업에서 복원하는 방법</summary>
          <p>앱을 중지하고 아래 명령을 서버에서 실행해 주세요. 복원 대상은 아직 존재하지 않는 새 경로여야 해요.</p>
          {restorePath ? <>
            <p>최근 성공한 백업을 검증하고 새 폴더로 복원:</p>
            <pre><code>{`npm run backup -- verify ${quoted(restorePath)}\nnpm run backup -- restore ${quoted(restorePath)} './restored-data'`}</code></pre>
            <p>복원된 내용을 확인한 뒤 데이터 경로를 새 폴더로 지정하고 앱을 다시 시작해 주세요.</p>
          </> : <p>정상 백업이 생기면 복원할 사본의 경로와 명령을 여기에 표시해요.</p>}
        </details>
      </>}
    </div>
  );
}
