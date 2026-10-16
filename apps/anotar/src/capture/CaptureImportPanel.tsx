import { useEffect, useRef, useState } from 'react';
import { finishPendingShare, listPendingShares, putPendingShare } from './shareStore.js';
import type { PendingShare, ShareContent } from './shareStore.js';
import { registerCaptureReceiver } from './registration';
import './capture.css';

type Draft = { text: string; url: string; files: File[]; filesReady: boolean; fileSaving: boolean; aiEnabled: boolean; aiAdditional: string };
type Props = { draft: Draft; onApply: (id: string, incoming: ShareContent) => Promise<void> };

export function CaptureImportPanel({ draft, onApply }: Props) {
  const [pending, setPending] = useState<PendingShare[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const initial = useRef<Promise<void> | null>(null);
  const queryId = useRef(new URLSearchParams(window.location.search).get('share'));
  const live = useRef(true);
  const current = pending.find((entry) => entry.id === queryId.current) ?? pending[0];
  const occupied = Boolean(draft.text || draft.url || draft.files.length || draft.aiAdditional);

  async function refresh() {
    try {
      const entries = await listPendingShares();
      if (live.current) setPending(entries);
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '공유 대기함을 불러오지 못했어요. 다시 시도해 주세요.');
    }
  }

  useEffect(() => {
    live.current = true;
    void registerCaptureReceiver();
    initial.current ??= (async () => {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const reason = params.get('shareError');
      if (reason) {
        setError(reason === 'unsupported'
          ? '공유 수신이 준비되지 않아 가져오지 못했어요. 앱을 한 번 연 뒤 다시 공유하거나 링크를 붙여넣고 파일을 직접 첨부해 주세요. 기존 초안은 그대로 있어요.'
          : reason.slice(0, 500));
        params.delete('shareError');
        window.history.replaceState(window.history.state, '', url);
      }
      if (url.pathname === '/capture' && ['title', 'text', 'url'].some((key) => params.has(key))) {
        try {
          const id = crypto.randomUUID();
          await putPendingShare({ title: params.get('title') ?? '', text: params.get('text') ?? '', url: params.get('url') ?? '' }, id);
          queryId.current = id;
          ['title', 'text', 'url'].forEach((key) => params.delete(key));
          params.set('share', id);
          window.history.replaceState(window.history.state, '', url);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '공유 내용을 임시보관하지 못했어요. 내용을 복사한 뒤 다시 시도해 주세요.');
        }
      }
    })();
    void initial.current.then(refresh);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { live.current = false; window.removeEventListener('focus', onFocus); };
  }, []);

  async function apply() {
    if (!current || busy) return;
    setBusy(true);
    setError('');
    try {
      await onApply(current.id, { text: current.text, url: current.url, files: current.files });
      await finishPendingShare(current.id);
      setMessage('공유 내용을 초안에 가져왔어요. 내용과 첨부를 확인한 뒤 저장해 주세요.');
      await refresh();
      setConfirmDelete(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '가져오지 못했어요. 공유 원본은 대기함에 남아 있어요.');
    } finally { setBusy(false); }
  }

  async function discard() {
    if (!current || busy) return;
    setBusy(true);
    try {
      await finishPendingShare(current.id);
      setConfirmDelete(false);
      setMessage('선택한 공유 대기 내용만 지웠어요. 작성 중인 초안은 그대로 있어요.');
      await refresh();
    } catch { setError('대기 내용을 지우지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  if (!current && !error && !message) return null;
  return (
    <section className="capture-import" aria-label="공유 내용 검토" aria-busy={busy}>
      {error && <p className="capture-import-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!current && error && <button type="button" onClick={() => { setError(''); void refresh(); }}>대기함 다시 열기</button>}
      {current && (hidden ? (
        <button type="button" onClick={() => setHidden(false)}>공유 대기 {pending.length}건 보기</button>
      ) : <>
        <div className="capture-import-heading"><strong>공유한 내용 확인</strong><span>대기 {pending.length}건</span></div>
        <p>{occupied ? '작성 중인 초안에 글과 파일을 추가해요. 기존 링크는 유지하고 새 링크는 메모 끝에 덧붙여요.' : '가져올 내용을 확인해 주세요. 가져온 뒤 저장 버튼으로 보관할 수 있어요.'}</p>
        {current.url && <p className="capture-import-url">{current.url}</p>}
        {current.text && <pre className="capture-import-text">{current.text}</pre>}
        {!!current.files.length && <ul className="capture-import-files">{current.files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name} <span>{(file.size / 1024 / 1024).toFixed(1)}MB</span></li>)}</ul>}
        {draft.aiEnabled && <p className="capture-import-error">AI 요청을 끈 뒤 가져와 주세요. 가져오기만으로 저장이나 AI 실행을 요청하지 않아요.</p>}
        <div className="capture-import-actions">
          <button type="button" className="capture-import-apply" disabled={busy || !draft.filesReady || draft.fileSaving || draft.aiEnabled} onClick={() => void apply()}>{busy ? '처리 중…' : occupied ? '초안에 추가 가져오기' : '초안으로 가져오기'}</button>
          <button type="button" disabled={busy} onClick={() => setHidden(true)}>기존 초안 계속 쓰기</button>
          {!confirmDelete ? <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>대기 내용 삭제</button> : <>
            <button type="button" disabled={busy} onClick={() => void discard()}>선택한 대기 내용 삭제 확인</button>
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button>
          </>}
        </div>
      </>)}
    </section>
  );
}
