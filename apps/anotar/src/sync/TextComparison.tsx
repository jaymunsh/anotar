import { useMemo } from 'react';
import { compareTextLines } from '../../shared/textDiff';

export default function TextComparison({
  before,
  after,
  beforeLabel = '서버본',
  afterLabel = '기기본',
}: {
  before: string | null;
  after: string | null;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const diff = useMemo(() => compareTextLines(before, after), [before, after]);
  const changed = diff.rows.some((row) => row.kind !== 'same');
  const visible = new Set<number>();
  diff.rows.forEach((row, index) => {
    if (!changed || row.kind !== 'same')
      for (let i = Math.max(0, index - 2); i <= Math.min(diff.rows.length - 1, index + 2); i++)
        visible.add(i);
  });
  const rows = [...visible].sort((a, b) => a - b).slice(0, 500);
  function side(which: 'before' | 'after', label: string, text: string | null) {
    let previous = -1;
    return (
      <div className="sync-conflict-side">
        <strong>{label}</strong>
        {text === null ? (
          <p>이 내용이 없어요.</p>
        ) : (
          <pre className="sync-text-diff">
            {rows.map((index) => {
              const row = diff.rows[index];
              const hidden = index - previous - 1;
              previous = index;
              const value = row[which];
              const tone =
                value === undefined || row.kind === 'same'
                  ? 'same'
                  : which === 'before'
                    ? 'removed'
                    : 'added';
              return (
                <span key={index} className="sync-diff-row-group">
                  {hidden > 0 && <span className="sync-diff-gap">같은 내용 {hidden}줄 생략</span>}
                  <span className={'sync-diff-line sync-diff-' + tone}>
                    <span className="sync-diff-sign" aria-hidden="true">
                      {tone === 'added' ? '+' : tone === 'removed' ? '−' : ' '}
                    </span>
                    {tone !== 'same' && (
                      <span className="sync-diff-a11y">
                        {tone === 'added' ? '추가된 줄: ' : '이전 줄: '}
                      </span>
                    )}
                    <span>{value ?? ''}</span>
                  </span>
                </span>
              );
            })}
            {rows.length > 0 &&
              rows.at(-1)! < diff.rows.length - 1 &&
              visible.size === rows.length && (
                <span className="sync-diff-gap">
                  같은 내용 {diff.rows.length - rows.at(-1)! - 1}줄 생략
                </span>
              )}
          </pre>
        )}
        {visible.size > rows.length && (
          <p>변경이 많아 처음 500줄을 표시해요. 전체 사본은 내려받아 확인할 수 있어요.</p>
        )}
        {diff.coarse && <small>내용이 많아 변경 구간을 묶어서 표시했어요.</small>}
      </div>
    );
  }
  return (
    <div className="sync-conflict-comparison">
      {side('before', beforeLabel, before)}
      {side('after', afterLabel, after)}
    </div>
  );
}
