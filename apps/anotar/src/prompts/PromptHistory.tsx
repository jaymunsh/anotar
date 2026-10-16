import { useEffect, useState } from 'react';
import type { PromptDraft, PromptTemplate } from './templates';
import { formatKoreanTime } from '../time';
type Revision = PromptTemplate & { createdAt: string };
export default function PromptHistory({
  current,
  disabled,
  onChoose,
}: {
  current: PromptTemplate;
  disabled: boolean;
  onChoose: (draft: Partial<PromptDraft>) => void;
}) {
  const [items, setItems] = useState<Revision[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(`/api/prompt-templates/${current.id}/revisions`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        setItems(data.items);
        setSelected(data.items[0]?.id || '');
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('수정 이력을 불러오지 못했어요.');
      });
    return () => controller.abort();
  }, [current.id, current.version, reload]);
  const revision = items.find((i) => i.id === selected);
  return (
    <section className="prompt-history" aria-label="프롬프트 수정 이력">
      <h3>수정 이력</h3>
      <p>
        이전 요청문을 초안으로 불러온 뒤 저장하면 새 수정본이 생깁니다. 최근 100개를 표시합니다.
      </p>
      {error ? (
        <p role="alert">
          {error} <button onClick={() => setReload((v) => v + 1)}>다시 불러오기</button>
        </p>
      ) : (
        <>
          <select
            aria-label="프롬프트 수정본"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                v{i.version} · {formatKoreanTime(i.createdAt)}
              </option>
            ))}
          </select>
          {revision && (
            <>
              <pre>{revision.body}</pre>
              <button
                disabled={disabled || revision.version === current.version}
                onClick={() =>
                  onChoose({
                    name: revision.name,
                    description: revision.description,
                    kind: revision.kind,
                    body: revision.body,
                  })
                }
              >
                이 수정본을 초안으로 불러오기
              </button>
            </>
          )}
          {disabled && <p>작성 중인 초안을 먼저 저장하거나 정리해 주세요.</p>}
        </>
      )}
    </section>
  );
}
