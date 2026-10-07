import { useMemo, useState } from 'react';
import { renderReadMarkdown } from './markdownReading';
import './ai-flow.css';

export default function AiResultContent({
  markdown,
  compact = false,
}: {
  markdown: string;
  compact?: boolean;
}) {
  const [source, setSource] = useState(false);
  const reading = useMemo(() => renderReadMarkdown(markdown), [markdown]);
  const body = (
    <div className="ai-result-content">
      <div className="ai-result-view" role="group" aria-label="결과 보기 방식">
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>
          읽기
        </button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
          Markdown 원문
        </button>
      </div>
      {source ? (
        <pre className="ai-result-text">{markdown}</pre>
      ) : (
        <article className="ai-result-reading" aria-label="AI 결과 본문">
          {reading}
        </article>
      )}
    </div>
  );
  if (!compact) return body;
  return (
    <div className="ai-result-compact">
      <p className="ai-result-summary">
        {markdown
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/[*_`]/g, '')
          .slice(0, 360)}
      </p>
      <details>
        <summary>결과 본문 펼치기</summary>
        {body}
      </details>
    </div>
  );
}
