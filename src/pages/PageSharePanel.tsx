import { onlineActionFetch } from '../sync/onlineActions';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2Off, X } from 'lucide-react';
import { formatKoreanTime } from '../time';
import './pageSharePanel.css';

type Share = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  commentsEnabled: boolean;
  linkAvailable: boolean;
};
type SharedAsset = { id: string; name: string; size: number };

export default function PageSharePanel({
  pageId,
  onClose,
}: {
  pageId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Share[]>([]);
  const [assets, setAssets] = useState<SharedAsset[]>([]);
  const [origin, setOrigin] = useState('');
  const [url, setUrl] = useState('');
  const [period, setPeriod] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoaded(false); setUrl(''); setItems([]); setOrigin(''); setError(''); setCopied(false);
    Promise.all([
      fetch(`/api/pages/${pageId}/shares`).then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      }),
      fetch('/api/share-config').then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      }),
    ])
      .then(async ([shares, config]) => {
        if (!active) return;
        setItems(shares.items || []);
        const live = (shares.items || []).find(
          (item: Share) =>
            !item.revokedAt && (!item.expiresAt || item.expiresAt > new Date().toISOString()),
        );
        setCommentsEnabled(Boolean(live?.commentsEnabled));
        setAssets(shares.scope?.assets || []);
        setOrigin(config.origin || '');
        setLoaded(true);
        if (live?.linkAvailable && config.origin) {
          const response = await fetch(`/api/pages/${pageId}/shares/${live.id}/link`);
          const body = await response.json();
          if (!active) return;
          if (!response.ok) throw new Error(body.error || '공유 링크를 불러오지 못했어요.');
          setUrl(body.url);
        }
      })
      .catch((cause) => active && setError(cause instanceof Error && cause.message ? cause.message : '공유 설정을 불러오지 못했어요. 다시 열어 주세요.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [pageId]);

  async function createLink() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const response = await onlineActionFetch(`/api/pages/${pageId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresInDays: period === 'none' ? null : Number(period),
          commentsEnabled,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '링크를 만들지 못했어요.');
      setItems((current) => [
        body.item,
        ...current.map((entry) =>
          entry.revokedAt ? entry : { ...entry, revokedAt: body.item.createdAt },
        ),
      ]);
      setUrl(`${origin}/s/${body.token}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '링크를 만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      const response = await onlineActionFetch(`/api/pages/${pageId}/shares/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('링크를 끊지 못했어요.');
      setItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, revokedAt: new Date().toISOString() } : entry,
        ),
      );
      setUrl('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '링크를 끊지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('복사하지 못했어요. 주소를 직접 선택해 주세요.');
    }
  }

  const active = items.find(
    (item) => !item.revokedAt && (!item.expiresAt || item.expiresAt > new Date().toISOString()),
  );
  async function changeCommentPolicy(enabled: boolean) {
    if (!active) {
      setCommentsEnabled(enabled);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await onlineActionFetch(`/api/pages/${pageId}/shares/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentsEnabled: enabled }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '댓글 설정을 바꾸지 못했어요.');
      setCommentsEnabled(enabled);
      setItems((current) =>
        current.map((item) =>
          item.id === active.id ? { ...item, commentsEnabled: enabled } : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '댓글 설정을 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-share-panel" aria-label="페이지 공유">
      <div className="page-share-head">
        <h2>페이지 공유</h2>
        <button type="button" aria-label="공유 설정 닫기" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="page-share-link-section">
        <strong>공유 링크</strong>
        {loading ? <p role="status">공유 링크를 불러오는 중이에요.</p> : url ? (
          <div className="page-share-url">
            <input aria-label="공유 링크" readOnly value={url} onFocus={(event) => event.target.select()} />
            <button type="button" onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '복사됨' : '복사'}
            </button>
            <a href={url} target="_blank" rel="noreferrer" aria-label="공유 페이지 새 창에서 열기" title="공유 페이지 열기"><ExternalLink size={16} /></a>
          </div>
        ) : loaded && !active ? <p>아직 공유하지 않은 페이지예요. 아래에서 링크를 만들 수 있어요.</p> : null}
        {!loading && active && !active.linkAvailable && !url && <p className="page-share-hint">이전 방식으로 만든 링크라 주소를 다시 표시할 수 없어요. 새 링크를 발급하면 이후에는 이곳에서 계속 확인할 수 있어요.</p>}
        {active && <div className="page-share-active">
          <span>{active.expiresAt ? `${formatKoreanTime(active.expiresAt)}까지` : '만료 없음'}</span>
          <button type="button" disabled={busy || loading} onClick={() => void revoke(active.id)}><Link2Off size={15} /> 링크 끊기</button>
        </div>}
      </div>
      <p>
        이 페이지만 읽기 전용으로 보여줍니다. 하위 페이지와 원본 메모는 자동으로 공개되지 않아요.
      </p>
      <div className="page-share-scope">
        <strong>공유 범위</strong>
        <span>현재 페이지 본문 · 첨부 {assets.length}개</span>
        {assets.length > 0 && (
          <ul>
            {assets.map((asset) => (
              <li key={asset.id}>{asset.name}</li>
            ))}
          </ul>
        )}
      </div>
      <p>공유 후 고친 내용은 링크에도 반영됩니다. 링크를 새로 만들면 이전 링크는 즉시 끊깁니다.</p>
      <div className="page-share-comment-policy">
        <label>
          <input
            type="checkbox"
            checked={commentsEnabled}
            disabled={busy || loading || !loaded || !origin}
            onChange={(event) => void changeCommentPolicy(event.target.checked)}
          />
          방문자 댓글 허용
        </label>
        <p>로그인 없이 이름으로 댓글을 남길 수 있어요. 개인 댓글은 공개되지 않습니다.</p>
        {commentsEnabled && <p>공유 댓글은 이 페이지에 보관되며 새 링크에서도 이어집니다.</p>}
      </div>
      <div className="page-share-row">
        <label htmlFor="page-share-period">링크 유효 기간</label>
        <select
          id="page-share-period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        >
          <option value="1">1일</option>
          <option value="7">7일</option>
          <option value="30">30일</option>
          <option value="90">90일</option>
          <option value="none">만료 없음</option>
        </select>
        <button type="button" disabled={busy || loading || !loaded || !origin} onClick={() => void createLink()}>
          {active ? '새 링크 발급' : '공유 링크 만들기'}
        </button>
      </div>
      {error && (
        <p className="page-share-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
