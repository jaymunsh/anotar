import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, Download } from 'lucide-react';
import { resolveConflict, type ConflictRecord } from './conflicts';
import type { Value } from './repository';
import TextComparison from './TextComparison';
import {
  compareConflictPages,
  conflictBlockSettings,
  conflictBlockPosition,
  conflictText,
} from '../../shared/conflictPresentation';
import {
  changedBlockFields,
  revisionBlockLabel,
  type RevisionChange,
} from '../../shared/pageRevisionDiff';
export default function ConflictPanel({
  conflict,
  local,
  onResolved,
  requested = new URLSearchParams(window.location.search).get('syncConflict') ===
    conflict.operationId,
}: {
  conflict: ConflictRecord;
  local: Value | null;
  onResolved: (result: { pageId: string; item: Value | null }) => void;
  requested?: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    [choice, setChoice] = useState<'server' | 'local' | 'fork' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!requested) return;
    setExpanded(true);
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: 'start' });
  }, [requested]);
  const comparison = useMemo(
    () => compareConflictPages(conflict.server, local),
    [conflict.server, local],
  );
  const preview = (label: string, value: Value | null) => (
    <div className="sync-conflict-side">
      <strong>{label}</strong>
      <pre>
        {conflictText(value?.document ?? value?.text ?? value) ||
          (value ? '내용이 비어 있어요.' : '삭제된 자료예요.')}
      </pre>
    </div>
  );
  function blockChange(change: RevisionChange, textChanged: boolean) {
    const before = change.before ? conflictText({ ...change.before.block, children: [] }) : null;
    const after = change.after ? conflictText({ ...change.after.block, children: [] }) : null;
    const settings =
      !textChanged && change.contentChanged
        ? conflictBlockSettings(change.before!.block, change.after!.block)
        : null;
    return (
      <article key={change.key} className={'sync-change-' + change.kind}>
        <h3>
          {revisionBlockLabel((change.after ?? change.before)!.block)} ·{' '}
          {change.kind === 'added'
            ? '추가'
            : change.kind === 'removed'
              ? '삭제'
              : textChanged
                ? '본문 변경'
                : change.contentChanged
                  ? '서식·설정 변경'
                  : '위치 변경'}
          {!textChanged && (
            <span className="sync-change-excerpt">
              {(after || before || '').split('\n')[0] ||
                ((change.after ?? change.before)!.block.type === 'paragraph'
                  ? '빈 문단'
                  : '본문 글자가 없는 블록')}
            </span>
          )}
        </h3>
        {change.moved && (
          <dl className="sync-position-diff">
            <div>
              <dt>서버에서의 위치</dt>
              <dd>{conflictBlockPosition(conflict.server, change.before!.path)}</dd>
            </div>
            <div>
              <dt>이 기기에서의 위치</dt>
              <dd>{conflictBlockPosition(local, change.after!.path)}</dd>
            </div>
          </dl>
        )}
        {textChanged ? (
          <>
            {change.kind === 'changed' && change.contentChanged && (
              <p>{changedBlockFields(change.before!.block, change.after!.block)} 변경</p>
            )}
            <TextComparison
              before={before}
              after={after}
              beforeLabel={
                '서버본' + (change.before ? ` · ${change.before.path.join('.')}번 블록` : '')
              }
              afterLabel={
                '기기본' + (change.after ? ` · ${change.after.path.join('.')}번 블록` : '')
              }
            />
          </>
        ) : (
          <>
            {settings && (
              <dl className="sync-settings-diff">
                {settings.changes.map((field, index) => (
                  <div key={index}>
                    <dt>
                      {field.path
                        .replace(/^본문 · 열 너비 · (\d+)$/, '$1열 너비')
                        .replace(/^본문 · (\d+) · 서식 · /, '$1번째 글자 구간 · ')}
                    </dt>
                    <dd>
                      <span className="sync-setting-before">
                        <small>서버</small> {field.before}
                      </span>
                      <span aria-label="변경 후">→</span>
                      <span className="sync-setting-after">
                        <small>기기</small> {field.after}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {settings?.truncated && (
              <p>일부 설정만 표시했어요. 내려받은 사본에서 전체 설정을 확인할 수 있어요.</p>
            )}
            {settings && !settings.changes.length && !settings.truncated && (
              <p>글자와 표시 설정은 같아요. 작성기 내부 표현만 달라요.</p>
            )}
            {(after || before) && (
              <details className="sync-unchanged-text">
                <summary>같은 본문 보기</summary>
                <pre>{after || before || '본문이 없는 블록이에요.'}</pre>
              </details>
            )}
          </>
        )}
      </article>
    );
  }
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
    <section ref={panel} tabIndex={-1} className="sync-conflict" aria-label="변경 충돌 확인">
      <div className="sync-conflict-head">
        <ArrowLeftRight size={18} aria-hidden="true" />
        <div>
          <strong>서버본과 기기본이 달라요</strong>
          <p>
            {conflict.tombstone
              ? '서버에서 삭제한 자료예요. 기기본은 보관되어 있어요.'
              : '양쪽 사본을 보관했어요. 비교한 뒤 반영할 내용을 선택해 주세요.'}
          </p>
        </div>
        <button
          type="button"
          className="sync-conflict-review-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '비교 접기' : '변경 내용 비교'}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div id={panelId} className="sync-conflict-review">
          <div className="sync-conflict-review-head">
            <strong>달라진 내용</strong>
            <button type="button" className="sync-conflict-download" onClick={download}>
              <Download size={14} aria-hidden="true" />
              사본 내려받기
            </button>
          </div>
          {(!comparison || comparison.textChanges.length > 0 || comparison.diff.titleChanged) && (
            <p className="sync-diff-legend">
              <span className="sync-diff-key-removed">− 이전 내용</span>
              <span className="sync-diff-key-added">+ 추가·변경 후</span>
              <span>서버본 → 기기본 기준</span>
            </p>
          )}
          {comparison ? (
            <>
              <p className="sync-conflict-summary">
                {[
                  comparison.diff.counts.added && `추가 ${comparison.diff.counts.added}`,
                  comparison.diff.counts.removed && `삭제 ${comparison.diff.counts.removed}`,
                  comparison.textChanged && `본문 ${comparison.textChanged}`,
                  comparison.settingsChanged && `서식·설정만 ${comparison.settingsChanged}`,
                  comparison.moved && `위치 ${comparison.moved}`,
                  comparison.diff.titleChanged && '제목 변경',
                  comparison.diff.iconChanged && '아이콘 변경',
                ]
                  .filter(Boolean)
                  .join(' · ') || '문서 내용과 배치는 같아요.'}
              </p>
              {comparison.diff.titleChanged && (
                <TextComparison
                  before={String(conflict.server?.title ?? '')}
                  after={String(local?.title ?? '')}
                  beforeLabel="서버본 제목"
                  afterLabel="기기본 제목"
                />
              )}
              {comparison.diff.iconChanged && (
                <p>
                  아이콘: {String(conflict.server?.icon || '없음')} →{' '}
                  {String(local?.icon || '없음')}
                </p>
              )}
              <div className="sync-conflict-changes">
                {comparison.textChanges.map((change) => blockChange(change, true))}
              </div>
              {!comparison.textChanges.length &&
                comparison.otherChanges.length > 0 &&
                !comparison.diff.hiddenCount &&
                !comparison.diff.truncated && (
                  <p className="sync-conflict-same-body">
                    {comparison.settingsChanged === 0
                      ? '글자는 같고, 배치만 달라요. 아래에서 이전 위치와 바뀐 위치를 확인해 주세요.'
                      : '글자는 같아요. 아래에서 어떤 설정 값이 바뀌었는지 확인해 주세요.'}
                  </p>
                )}
              {comparison.otherChanges.length > 0 && (
                <details
                  className="sync-conflict-metadata"
                  open={comparison.otherChanges.length <= 3}
                >
                  <summary>
                    {comparison.settingsChanged === 0
                      ? '위치'
                      : comparison.moved === 0
                        ? '서식·설정'
                        : '서식·설정·위치'}{' '}
                    변경 {comparison.otherChanges.length}곳
                  </summary>
                  <div className="sync-conflict-changes">
                    {comparison.otherChanges.map((change) => blockChange(change, false))}
                  </div>
                </details>
              )}
              {comparison.diff.hiddenCount > 0 && (
                <p>
                  표시하지 않은 변경 {comparison.diff.hiddenCount}개가 있어요. 전체 내용이나
                  내려받은 사본도 확인해 주세요.
                </p>
              )}
              {comparison.diff.truncated && (
                <p>큰 문서라 비교 범위를 제한했어요. 전체 사본도 확인해 주세요.</p>
              )}
              {!comparison.diff.changes.length &&
                !comparison.diff.titleChanged &&
                !comparison.diff.iconChanged && (
                  <p>
                    제목·아이콘·본문은 같아요. 저장 버전이나 페이지 설정이 달라 충돌한 상태예요.
                  </p>
                )}
              <details className="sync-conflict-full">
                <summary>전체 내용 보기</summary>
                <div className="sync-conflict-comparison sync-conflict-preview">
                  {preview('서버본', conflict.server)}
                  {preview('기기본', local)}
                </div>
              </details>
            </>
          ) : (
            <TextComparison
              before={
                conflict.server
                  ? conflictText(
                      conflict.server.document ?? conflict.server.text ?? conflict.server,
                    )
                  : null
              }
              after={local ? conflictText(local.document ?? local.text ?? local) : null}
            />
          )}
          <fieldset className="sync-conflict-choices">
            <legend>반영할 내용 선택</legend>
            <div className="sync-conflict-options">
              {[
                {
                  value: 'server' as const,
                  label: conflict.tombstone ? '내 변경 보관 후 닫기' : '서버 내용 사용',
                  hint: '기기본은 충돌 사본으로 남아요.',
                  disabled: false,
                },
                {
                  value: 'local' as const,
                  label: '내 변경으로 반영',
                  hint: '기기본으로 현재 서버 내용을 바꿔요.',
                  disabled: conflict.tombstone,
                },
                ...(conflict.entityKind === 'page'
                  ? [
                      {
                        value: 'fork' as const,
                        label: '새 페이지로 보관',
                        hint: '기기본을 복제하고 원래 페이지는 서버본으로 유지해요.',
                        disabled: false,
                      },
                    ]
                  : []),
              ].map((option) => (
                <label key={option.value} className="sync-conflict-choice">
                  <input
                    type="radio"
                    name={panelId + '-choice'}
                    value={option.value}
                    checked={choice === option.value}
                    disabled={busy || option.disabled}
                    onChange={() => setChoice(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sync-conflict-apply">
            <span>선택하기 전까지 양쪽 사본은 그대로 남아요.</span>
            <button
              type="button"
              disabled={busy || !choice}
              onClick={() => choice && void choose(choice)}
            >
              {busy ? '반영 중…' : '선택한 내용 적용'}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
