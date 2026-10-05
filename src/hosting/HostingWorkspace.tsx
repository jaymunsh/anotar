import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, ExternalLink, FolderPlus, RefreshCw, Pencil } from 'lucide-react';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { formatKoreanTime } from '../time';
import './hosting.css';
type Site = {
  id: string;
  slug: string;
  name: string;
  entry: string;
  enabled: boolean;
  bytes: number;
  fileCount: number;
  htmlCount: number;
  version: number;
  updatedAt: string;
};
type Listing = {
  items: Site[];
  origin: string;
  totalBytes: number;
  limits: { siteBytes: number; files: number; totalBytes: number };
};
const extensions =
  /\.(html?|css|m?js|json|txt|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|webmanifest)$/i;
const size = (bytes: number) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + ' MB';
async function api(
  method: string,
  path = '',
  body?: FormData | Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/hosting' + path, {
    method,
    signal,
    ...(body
      ? body instanceof FormData
        ? { body }
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json().catch(() => {
    throw new Error('서버 응답을 확인하지 못했어요. 다시 불러와 주세요.');
  });
  if (!response.ok) throw new Error(data.error || '사이트 요청을 처리하지 못했어요.');
  return data;
}
export default function HostingWorkspace() {
  const [listing, setListing] = useState<Listing | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string | null>(null),
    [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<{ file: File; path: string }[]>([]),
    [excluded, setExcluded] = useState(0);
  const [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [entry, setEntry] = useState('index.html');
  const [editing, setEditing] = useState<string | null>(null),
    [editedName, setEditedName] = useState('');
  const mounted = useRef(true),
    request = useRef<AbortController | null>(null),
    busyRef = useRef(false),
    generation = useRef(0);
  async function load() {
    const id = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const next = await api('GET', '', undefined, controller.signal);
      if (mounted.current && id === generation.current) {
        setListing(next);
        setError('');
      }
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && id === generation.current)
        setError(e instanceof Error ? e.message : '연결을 확인해 주세요.');
    } finally {
      if (mounted.current && id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
    };
  }, []);
  function pick(list: FileList | null) {
    const selected = Array.from(list || []),
      accepted = selected.flatMap((file) => {
        const original = file.webkitRelativePath || file.name,
          path = original.includes('/') ? original.slice(original.indexOf('/') + 1) : original;
        return extensions.test(path) &&
          path.split('/').every((segment) => segment && !segment.startsWith('.'))
          ? [{ file, path }]
          : [];
      });
    setFiles(accepted);
    setExcluded(selected.length - accepted.length);
    setNotice('');
    setError('');
    const rootName = selected[0]?.webkitRelativePath.split('/')[0] || '';
    if (!name) setName(rootName);
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!files.length) {
      setError('HTML 파일이 포함된 폴더를 선택해 주세요.');
      return;
    }
    if (
      files.length > 1000 ||
      files.reduce((n, f) => n + f.file.size, 0) > 50 * 1024 * 1024 ||
      files.some((f) => f.file.size > 25 * 1024 * 1024)
    ) {
      setError('폴더는 1,000개 파일·총 50MB, 개별 파일은 25MB까지 등록할 수 있어요.');
      return;
    }
    busyRef.current = true;
    setBusy('add');
    setError('');
    setNotice('');
    const body = new FormData();
    body.append('name', name);
    body.append('slug', slug);
    body.append('entry', entry);
    for (const item of files) body.append('files', item.file, item.path);
    try {
      await api('POST', '', body);
      if (mounted.current) {
        setAdding(false);
        setFiles([]);
        setName('');
        setSlug('');
        setEntry('index.html');
        setNotice('사이트를 등록했어요. 공개 버튼을 누르면 주소로 접근할 수 있어요.');
        await load();
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '등록하지 못했어요. 다시 시도해 주세요.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function toggle(site: Site) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(site.id);
    setError('');
    setNotice('');
    try {
      const { item } = await api('PATCH', '/' + site.slug, {
        enabled: !site.enabled,
        expectedVersion: site.version,
      });
      if (mounted.current) {
        setListing((old) =>
          old ? { ...old, items: old.items.map((s) => (s.id === item.id ? item : s)) } : old,
        );
        setNotice(
          item.enabled
            ? `${item.name} 사이트를 공개했어요.`
            : `${item.name} 사이트의 공개를 중지했어요.`,
        );
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '변경하지 못했어요. 목록을 다시 불러와 주세요.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function rename(site: Site, event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(site.id);
    setError('');
    setNotice('');
    try {
      const { item } = await api('PATCH', '/' + site.slug, {
        name: editedName,
        expectedVersion: site.version,
      });
      if (mounted.current) {
        setListing((old) =>
          old ? { ...old, items: old.items.map((s) => (s.id === item.id ? item : s)) } : old,
        );
        setEditing(null);
        setNotice('사이트 이름을 변경했어요.');
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : '이름을 변경하지 못했어요. 목록을 다시 불러와 주세요.',
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      if (mounted.current) setNotice('주소를 복사했어요.');
    } catch {
      if (mounted.current)
        setError('주소를 복사하지 못했어요. 표시된 주소를 선택해 복사해 주세요.');
    }
  }
  return (
    <>
      <WorkspaceToolbar
        title="웹 호스팅"
        meta={
          listing ? `${listing.items.length}개 사이트 · ${size(listing.totalBytes)}` : undefined
        }
      />
      <main className="hosting-workspace">
        <header className="hosting-heading">
          <div>
            <h1>웹 호스팅</h1>
            <p>HTML 사이트를 등록하고 공유 주소를 관리해요.</p>
          </div>
          <div className="hosting-actions">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !!busy}
              aria-label="사이트 목록 새로고침"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setAdding((value) => !value)}
              disabled={!!busy}
              aria-expanded={adding}
            >
              <FolderPlus size={16} />
              폴더 등록
            </button>
          </div>
        </header>
        {error && (
          <p className="hosting-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="hosting-notice" role="status">
            {notice}
          </p>
        )}
        {adding && (
          <form className="hosting-import" onSubmit={(event) => void add(event)}>
            <h2>사이트 폴더 등록</h2>
            <p>하위 폴더 구조를 유지해요. PDF·숨김 파일·개발용 파일은 제외해요.</p>
            <label className="hosting-folder">
              사이트 폴더
              <input
                type="file"
                ref={(input) => {
                  input?.setAttribute('webkitdirectory', '');
                }}
                multiple
                onChange={(event) => pick(event.target.files)}
                disabled={!!busy}
              />
            </label>
            {!!files.length && (
              <p className="hosting-selection">
                {files.length}개 파일 · {size(files.reduce((n, f) => n + f.file.size, 0))}
                {excluded > 0 ? ` · ${excluded}개 제외` : ''}
              </p>
            )}
            <div className="hosting-fields">
              <label>
                이름
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                  disabled={!!busy}
                />
              </label>
              <label>
                주소 경로 (선택)
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="비워두면 자동 생성"
                  pattern="[a-z0-9][a-z0-9-]{0,63}"
                  maxLength={64}
                  disabled={!!busy}
                />
              </label>
              <label>
                시작 페이지
                <input
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  placeholder="index.html"
                  required
                  disabled={!!busy}
                />
              </label>
            </div>
            <div className="hosting-form-footer">
              <small>등록 후 공개 상태를 직접 선택할 수 있어요.</small>
              <button type="submit" disabled={!!busy || !files.length}>
                {busy === 'add' ? '등록 중…' : '등록'}
              </button>
            </div>
          </form>
        )}
        {loading && !listing ? (
          <p role="status">사이트 목록을 불러오는 중…</p>
        ) : listing?.items.length ? (
          <ul className="hosting-list" aria-label="등록된 사이트">
            {listing.items.map((site) => {
              const url = `${listing.origin}/${site.slug}/`;
              return (
                <li key={site.id}>
                  <div className="hosting-site-main">
                    <div className="hosting-site-title">
                      {editing === site.id ? (
                        <form
                          className="hosting-rename"
                          onSubmit={(event) => void rename(site, event)}
                        >
                          <input
                            aria-label="사이트 이름"
                            value={editedName}
                            onChange={(event) => setEditedName(event.target.value)}
                            required
                            maxLength={120}
                            autoFocus
                            disabled={!!busy}
                          />
                          <button type="submit" disabled={!!busy}>
                            저장
                          </button>
                          <button type="button" onClick={() => setEditing(null)} disabled={!!busy}>
                            취소
                          </button>
                        </form>
                      ) : (
                        <>
                          <h2>{site.name}</h2>
                          <button
                            type="button"
                            aria-label={`${site.name} 이름 수정`}
                            disabled={!!busy}
                            onClick={() => {
                              setEditing(site.id);
                              setEditedName(site.name);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                        </>
                      )}
                      <span className={`hosting-state${site.enabled ? ' enabled' : ''}`}>
                        {site.enabled ? '공개 중' : '중지'}
                      </span>
                    </div>
                    <a
                      className="hosting-url"
                      href={site.enabled ? url : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {url}
                    </a>
                    <p className="hosting-file-meta">
                      HTML {site.htmlCount}개 · 전체 {site.fileCount}개 · {size(site.bytes)}
                      <span>수정 {formatKoreanTime(site.updatedAt)}</span>
                    </p>
                  </div>
                  <div className="hosting-site-actions">
                    <button
                      type="button"
                      onClick={() => void copy(url)}
                      aria-label={`${site.name} 주소 복사`}
                    >
                      <Copy size={15} />
                      <span>주소 복사</span>
                    </button>
                    {site.enabled && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${site.name} 열기`}
                      >
                        <ExternalLink size={15} />
                        <span>열기</span>
                      </a>
                    )}
                    <button type="button" disabled={!!busy} onClick={() => void toggle(site)}>
                      {busy === site.id ? '변경 중…' : site.enabled ? '공개 중지' : '공개'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : listing ? (
          <div className="hosting-empty">
            <h2>등록된 사이트가 없어요.</h2>
            <p>index.html과 연결된 CSS·JS가 있는 폴더를 등록해 보세요.</p>
            <button type="button" onClick={() => setAdding(true)}>
              폴더 등록
            </button>
          </div>
        ) : null}
        <p className="hosting-footnote">
          서버에서 제공하는 정적 사이트예요. 공개 중인 사이트는 주소를 아는 누구나 볼 수 있어요.
        </p>
      </main>
    </>
  );
}
