import { useContext, useEffect, useState } from 'react';
import { CheckSquare, Link2, Plus, X, RefreshCw, ExternalLink } from 'lucide-react';
import { PlanConnectionsContext, type PlanRelation } from './PlanConnectionsContext';
import { PageNavContext } from './pageNav';
import './planConnections.css';
type Option = { id: string; title: string; status?: string };
export default function PlanConnections({
  blockId,
  entryId,
  editable,
  mode = 'summary',
  showStatus = false,
}: {
  blockId: string;
  entryId: string;
  editable: boolean;
  mode?: 'summary' | 'manage';
  showStatus?: boolean;
}) {
  const context = useContext(PlanConnectionsContext),
    navigate = useContext(PageNavContext);
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<'task' | 'page' | 'memo'>('task'),
    [query, setQuery] = useState(''),
    [options, setOptions] = useState<Option[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(''),
    [title, setTitle] = useState('');
  useEffect(() => {
    if (!open || !context) return;
    const abort = new AbortController();
    setSearching(true);
    setOptions([]);
    setSearchError('');
    const timer = setTimeout(
      () => {
        void fetch(
          `/api/pages/${context.pageId}/plan-connections/options?${new URLSearchParams({ kind, q: query })}`,
          { signal: abort.signal },
        )
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok || !Array.isArray(data.items)) throw new Error();
            if (!abort.signal.aborted) setOptions(data.items);
          })
          .catch(() => {
            if (!abort.signal.aborted) setSearchError('연결할 목록을 불러오지 못했어요.');
          })
          .finally(() => {
            if (!abort.signal.aborted) setSearching(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, kind, query, context?.pageId]);
  if (!context) return null;
  const rows = context.items.filter((row) => row.blockId === blockId && row.entryId === entryId),
    base = { blockId, entryId };
  const disabled = !editable || context.busy || !!context.pending || context.loading;
  const failedHere = context.pending?.blockId === blockId && context.pending?.entryId === entryId;
  const mutate = (row: PlanRelation, action: string, extra: Record<string, unknown> = {}) =>
    context.change({ ...base, action, relationId: row.id, expectedVersion: row.version, ...extra });
  const href = (row: PlanRelation) =>
    row.kind === 'task'
      ? `/tasks?taskId=${row.targetId}`
      : row.kind === 'page'
        ? `/pages/${row.targetId}`
        : `/captures/${row.targetId}`;
  if (mode === 'summary') {
    if (!rows.length && !failedHere && !(showStatus && context.error)) return null;
    return (
      <div className="plan-connections plan-connections-summary" aria-label="이 일정의 준비와 참고">
        {showStatus && context.error && !context.pending && (
          <button type="button" onClick={context.refresh} disabled={context.busy}>
            준비 항목을 불러오지 못했어요 · 다시 확인
          </button>
        )}
        {failedHere && (
          <p role="status">준비 항목 저장 확인이 필요해요. 일정의 ··· 메뉴에서 다시 시도하세요.</p>
        )}
        <ul className="plan-connections-reading-list">
          {rows.map((row) => (
            <li key={row.id}>
              {row.task ? (
                <input
                  type="checkbox"
                  checked={row.task.status === 'done'}
                  aria-label={`${row.title} 완료`}
                  disabled={disabled || row.unavailable}
                  onChange={() =>
                    void mutate(row, 'toggle-task', {
                      expectedTaskVersion: row.task!.version,
                      status: row.task!.status === 'done' ? 'open' : 'done',
                    })
                  }
                />
              ) : (
                <Link2 size={13} aria-hidden />
              )}
              <div>
                {row.unavailable ? (
                  <span>연결한 항목을 찾을 수 없어요.</span>
                ) : (
                  <a
                    href={href(row)}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(href(row));
                    }}
                  >
                    {row.title}
                  </a>
                )}
                <small>
                  {row.task
                    ? row.shared
                      ? '공유에 표시되는 준비사항'
                      : '나의 준비사항'
                    : row.kind === 'page'
                      ? '참고 페이지 · 나에게만 표시'
                      : '참고 메모 · 나에게만 표시'}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="plan-connections">
      <button
        type="button"
        className="plan-connections-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CheckSquare size={13} />
        준비·참고 관리
        {failedHere && <span>재시도 필요</span>}
      </button>
      {open && (
        <section className="plan-connections-panel" aria-label="일정 준비와 관련 항목">
          <div className="plan-connections-head">
            <strong>준비와 참고</strong>
            <button
              type="button"
              aria-label="일정 연결 새로고침"
              disabled={context.busy || !!context.pending}
              onClick={context.refresh}
            >
              <RefreshCw size={13} />
            </button>
            <button type="button" aria-label="일정 연결 닫기" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          {context.error && <p role="alert">{context.error}</p>}
          {context.pending && (
            <div className="plan-connections-retry">
              {!failedHere && (
                <p>다른 일정 항목의 연결 요청이 남아 있어요. 확인하거나 요청을 수정해 주세요.</p>
              )}
              <button type="button" disabled={context.busy} onClick={() => void context.retry()}>
                같은 요청 다시 시도
              </button>
              <button type="button" disabled={context.busy} onClick={context.discard}>
                요청 수정
              </button>
            </div>
          )}
          {context.loading && <p role="status">연결을 불러오는 중…</p>}
          <ul className="plan-connections-items">
            {rows.map((row) => (
              <li key={row.id}>
                {row.task && (
                  <input
                    type="checkbox"
                    checked={row.task.status === 'done'}
                    aria-label={`${row.title} 완료`}
                    disabled={disabled || row.unavailable}
                    onChange={() =>
                      void mutate(row, 'toggle-task', {
                        expectedTaskVersion: row.task!.version,
                        status: row.task!.status === 'done' ? 'open' : 'done',
                      })
                    }
                  />
                )}
                <div className="plan-connections-item-text">
                  {row.unavailable ? (
                    <span className="plan-connections-unavailable">
                      연결한 항목을 찾을 수 없어요.
                    </span>
                  ) : (
                    <a
                      href={href(row)}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(href(row));
                      }}
                    >
                      {row.title}
                      <ExternalLink size={11} />
                    </a>
                  )}
                  <small>
                    {row.kind === 'task' ? '할 일' : row.kind === 'page' ? '페이지' : '메모'}
                    {row.task?.dueDate ? ` · ${row.task.dueDate}` : ''}
                    {row.sourceMissing ? ' · 일정에서 빠진 항목' : ''}
                  </small>
                  {row.task && (
                    <label className="plan-connections-share">
                      <input
                        type="checkbox"
                        checked={row.shared}
                        disabled={disabled || row.unavailable}
                        onChange={() => void mutate(row, 'share', { shared: !row.shared })}
                      />
                      공유에 제목·상태 표시
                    </label>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`${row.title} 연결 해제`}
                  disabled={disabled}
                  onClick={() => void mutate(row, 'unlink')}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          {!context.loading && !rows.length && (
            <p className="plan-connections-empty">
              준비 할 일이나 참고할 메모·페이지를 연결하세요.
            </p>
          )}
          {editable && (
            <>
              <form
                className="plan-connections-add"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await context.change({ ...base, action: 'create-task', title, dueDate: null })
                  )
                    setTitle('');
                }}
              >
                <input
                  aria-label="새 준비 할 일"
                  value={title}
                  maxLength={500}
                  placeholder="준비 할 일 추가…"
                  disabled={disabled}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <button
                  type="submit"
                  aria-label="준비 할 일 추가"
                  disabled={disabled || !title.trim()}
                >
                  <Plus size={16} />
                </button>
              </form>
              <div className="plan-connections-select">
                <select
                  aria-label="연결 종류"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                  disabled={context.busy}
                >
                  <option value="task">기존 할 일</option>
                  <option value="page">관련 페이지</option>
                  <option value="memo">관련 메모</option>
                </select>
                <input
                  aria-label="연결할 항목 검색"
                  value={query}
                  maxLength={160}
                  placeholder="이름 또는 내용 검색"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {searchError && <p role="alert">{searchError}</p>}
              {searching ? (
                <p role="status">목록을 찾는 중…</p>
              ) : (
                <ul className="plan-connections-options">
                  {options
                    .filter(
                      (option) =>
                        !rows.some((row) => row.kind === kind && row.targetId === option.id),
                    )
                    .map((option) => (
                      <li key={option.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            void context.change({
                              ...base,
                              action: 'link',
                              kind,
                              targetId: option.id,
                            })
                          }
                        >
                          <Link2 size={13} />
                          <span>{option.title}</span>
                          {option.status === 'done' && <small>완료</small>}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {!searching && !options.length && !searchError && (
                <p className="plan-connections-empty">연결할 항목이 없어요.</p>
              )}
              <p className="plan-connections-note">
                관련 메모·페이지는 나에게만 보입니다. 할 일은 체크한 제목과 상태만 공유합니다.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
