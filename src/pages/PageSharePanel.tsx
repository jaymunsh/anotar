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

  useEffect(() => {
    let active = true;
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
      .then(([shares, config]) => {
        if (!active) return;
        setItems(shares.items || []);
        const live = (shares.items || []).find(
          (item: Share) =>
            !item.revokedAt && (!item.expiresAt || item.expiresAt > new Date().toISOString()),
        );
        setCommentsEnabled(Boolean(live?.commentsEnabled));
        setAssets(shares.scope?.assets || []);
        setOrigin(config.origin || '');
      })
      .catch(() => active && setError('공유 설정을 불러오지 못했어요. 다시 열어 주세요.'));
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
            disabled={busy || !origin}
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
        <button type="button" disabled={busy || !origin} onClick={() => void createLink()}>
          {active ? '새 링크 발급' : '공유 링크 만들기'}
        </button>
      </div>
      {url ? (
        <div className="page-share-url">
          <input
            aria-label="공유 링크"
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '복사됨' : '복사'}
          </button>
          <a href={url} target="_blank" rel="noreferrer" aria-label="공유 페이지 새 창에서 열기">
            <ExternalLink size={16} />
          </a>
        </div>
      ) : null}
      {active && (
        <div className="page-share-active">
          <span>
            활성 링크 ·{' '}
            {active.expiresAt ? `${formatKoreanTime(active.expiresAt)}까지` : '만료 없음'}
          </span>
          <button type="button" disabled={busy} onClick={() => void revoke(active.id)}>
            <Link2Off size={15} /> 링크 끊기
          </button>
        </div>
      )}
      {active && !url && (
        <p className="page-share-hint">
          기존 링크의 주소는 다시 표시할 수 없어요. 잃어버렸다면 새 링크를 발급하세요.
        </p>
      )}
      {error && (
        <p className="page-share-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
