import type { AiExecution } from '../../shared/aiRequests';
import AiExecutionPicker from './AiExecutionPicker';
import AiTaskAdoption from './AiTaskAdoption';
import AiResultContent from './AiResultContent';
import AiRequestSummary from './AiRequestSummary';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clipboard, FolderPlus, RotateCcw, Sparkles } from 'lucide-react';
import type { Capture } from '../memos/types';
import type { AiJob, AiJobSummary } from './types';
import { activeAiJob, aiStatusLabel } from './types';
import { listAiJobs, requestAiJob, linkedAiJobId, includeLinkedAiJob } from './api';
import { formatKoreanTime } from '../time';
import { publishRecordChange } from '../trash/events';
import './ai.css';
import WorkflowQueue from '../sync/WorkflowQueue';

export default function AiJobPanel({
  capture,
  onJobChange,
  onOrganize,
}: {
  capture: Capture;
  onJobChange: (captureId: string, job: AiJobSummary | null) => void;
  onOrganize: (job: AiJob) => void;
}) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [jobId, setJobId] = useState(linkedAiJobId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [execution, setExecution] = useState<AiExecution | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [reload, setReload] = useState(0);
  const callback = useRef(onJobChange);
  callback.current = onJobChange;
  const alive = useRef(true);
  const submitting = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      submitting.current?.abort();
    };
  }, []);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const configController = new AbortController();
    async function refresh() {
      if (stopped || document.hidden) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const items = await includeLinkedAiJob(
          await listAiJobs(capture.id, current.signal),
          'memo',
          capture.id,
          current.signal,
        );
        if (stopped || current.signal.aborted) return;
        setJobs(items);
        setJobId((previous) =>
          items.some((job) => job.id === previous) ? previous : items[0]?.id || '',
        );
        setError('');
        callback.current(capture.id, items[0] ?? null);
        if (items.some(activeAiJob)) timer = setTimeout(() => void refresh(), 2000);
      } catch (cause) {
        if (!stopped && !current.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'AI 요청을 불러오지 못했어요.');
      } finally {
        if (!stopped && !current.signal.aborted) setLoading(false);
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      configController.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [capture.id, capture.version, reload]);

  const selected = jobs.find((job) => job.id === jobId) ?? jobs[0];
  const active = jobs.some(activeAiJob);
  async function request(retryOf?: string) {
    if (busy || active || (!retryOf && (!execution || (!enabled && navigator.onLine)))) return;
    setBusy(true);
    setError('');
    setCopyStatus('');
    const controller = new AbortController();
    submitting.current = controller;
    try {
      const job = await requestAiJob(capture.id, capture.version, retryOf, controller.signal, retryOf ? undefined : execution);
      if (!alive.current) return;
      if(!job){setReload(value=>value+1);return;}
      setJobId(job.id);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      callback.current(capture.id, job);
      publishRecordChange('ai-request');
      setReload((value) => value + 1);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '요청을 등록하지 못했어요.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function copy(text: string, result = true) {
    try {
      await navigator.clipboard.writeText(text);
      if (alive.current) setCopyStatus(result ? '결과를 복사했어요.' : '요청문을 복사했어요.');
    } catch {
      if (alive.current) setCopyStatus('복사하지 못했어요. 글을 직접 선택해서 복사해 주세요.');
    }
  }
  return (
    <section className="ai-job-panel" aria-label="AI 처리 결과">
      <WorkflowQueue sourceId={capture.id} onlyAi />
      <div className="ai-job-heading">
        <h2>
          <Sparkles size={17} /> AI 결과
        </h2>
        <span className={`ai-job-state ai-state-${selected?.status || 'prepared'}`}>
          {loading ? '불러오는 중…' : aiStatusLabel(selected)}
        </span>
      </div>
      {loading ? (
        <div className="ai-job-loading" role="status">
          처리 상태를 확인하고 있어요.
        </div>
      ) : (
        <>
          {selected && (
            <p className="ai-job-meta">
              <time dateTime={selected.createdAt}>{formatKoreanTime(selected.createdAt)}</time>
              {selected.runner ? <span>{selected.runner.label}</span> : selected.request.execution && <span>{selected.request.execution.profileId === 'devin' ? 'Devin CLI' : 'Hive'} · {selected.request.execution.model}</span>}
              <span>{selected.request.template?.name || '직접 요청'}{selected.request.template ? ` · v${selected.request.template.version}` : ''}</span>
              {selected.runner?.mode === 'test' && (
                <span className="ai-test-mark">테스트 응답</span>
              )}
            </p>
          )}
          {selected?.stale && (
            <p className="ai-job-stale" role="status">
              <strong>이전 내용 기준</strong>
              <span>요청한 뒤 메모가 수정됐어요. 현재 메모로 다시 요청할 수 있어요.</span>
            </p>
          )}
          {activeAiJob(selected) && (
            <p className="ai-job-explanation" role="status">
              {selected?.status === 'queued'
                ? '순서가 되면 요청을 처리해요. 다른 메모를 작성해도 괜찮아요.'
                : '요청을 처리하고 있어요. 결과는 이 메모에 따로 보관해요.'}
            </p>
          )}
          {selected?.error && (
            <p className="ai-job-error" role="status">
              {selected.error}
            </p>
          )}
          {selected?.result && (
            <>
              <div className="ai-result-toolbar">
                <div className="ai-result-actions">
                  <button onClick={() => onOrganize(selected)}>
                    <FolderPlus size={15} /> 결과를 페이지로 정리
                  </button>
                  <button onClick={() => void copy(selected.result!.markdown)}>
                    <Clipboard size={15} /> Markdown 복사
                  </button>
                </div>
              </div>
              <AiResultContent key={selected.id} markdown={selected.result.markdown} />
              <AiTaskAdoption key={selected.id} job={selected} />
              {!!selected.result.sources.length && (
                <div className="ai-result-sources">
                  <h3>{selected.request.kind === 'research' ? '확인한 출처' : '참고 링크'}</h3>
                  {selected.result.sources.map((source, index) => (
                    <a
                      key={`${source.url}-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>{source.title}</span>
                      <small>
                        {source.verified ? '본문 확인됨' : '본문 미확인'} ·{' '}
                        {new URL(source.url).hostname}
                      </small>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
          {!selected && (
            <p className="ai-job-explanation">
              보관한 요청문을 실행할 수 있어요. 결과는 원문 아래에 따로 남아요.
            </p>
          )}
          {!selected?.result && !!capture.files.length && (
            <p className="ai-job-explanation">
              이번 요청에는 글과 URL만 사용해요. 첨부 파일은 전송하지 않아요.
            </p>
          )}
          {!selected?.result && !enabled && (
            <p className="ai-job-explanation">
              실행기를 연결하면 요청을 처리할 수 있어요. 보관한 요청문은 복사해서 사용할 수 있어요.
            </p>
          )}
          <details className="ai-request-again" open={!selected?.result ? true : undefined}><summary>다시 요청</summary>
          <AiExecutionPicker value={execution} onChange={setExecution} onAvailability={setEnabled} research={capture.aiRequest?.kind === 'research'} hasUrl={Boolean(capture.url || capture.aiRequest?.input.url)} />
          <div className="ai-job-actions">
            <button
              className="ai-run-current"
              disabled={busy || active || (!enabled&&navigator.onLine)}
              onClick={() => void request()}
            >
              <Sparkles size={15} />
              {busy ? '요청 등록 중…' : selected ? '현재 메모로 다시 요청' : '보관한 요청 실행'}
            </button>
            {selected?.status === 'failed' && (
              <button
                disabled={busy || active}
                onClick={() => void request(selected.id)}
              >
                <RotateCcw size={15} /> 실패한 요청 그대로 재시도
              </button>
            )}
          </div>
          <p className="ai-job-explanation">
            다시 요청하면 현재 저장된 메모와 처음 선택한 프롬프트·추가 지시로 새 결과를 만들어요.
          </p>
          </details>
          <details className="ai-saved-prompt">
            <summary>
              요청 당시 입력·프롬프트 <ChevronDown size={15} />
            </summary>
            <p>
              {selected?.request.template?.name || capture.aiRequest?.template?.name || '직접 요청'}{' '}
              ·{' '}
              {selected ? '이 작업을 요청했을 때의 사본이에요.' : '처음 보관했을 때의 사본이에요.'}
            </p>
            <AiRequestSummary request={(selected?.request || capture.aiRequest)!} />
            <h3>요청 당시 입력</h3>
            <pre>
              {(selected?.request || capture.aiRequest)?.input.content || '글 없음'}
              {(selected?.request || capture.aiRequest)?.input.url
                ? `\n${(selected?.request || capture.aiRequest)?.input.url}`
                : ''}
            </pre>
            <h3>프롬프트</h3>
            <pre>{selected?.request.prompt || capture.aiRequest?.prompt}</pre>
            <button
              onClick={() =>
                void copy(selected?.request.prompt || capture.aiRequest?.prompt || '', false)
              }
            >
              <Clipboard size={15} /> 요청문 복사
            </button>
          </details>
          {jobs.length > 1 && (
            <details className="ai-history">
              <summary>
                이전 요청 {jobs.length}개 <ChevronDown size={15} />
              </summary>
              <div>
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    aria-pressed={selected?.id === job.id}
                    onClick={() => {
                      setJobId(job.id);
                      setCopyStatus('');
                    }}
                  >
                    <span>{formatKoreanTime(job.createdAt)}</span>
                    <span>
                      {aiStatusLabel(job)}
                      {selected?.id === job.id && <Check size={14} />}
                    </span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {error && (
        <div className="ai-panel-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setReload((value) => value + 1)}>다시 불러오기</button>
        </div>
      )}
      {copyStatus && (
        <p className="ai-copy-status" role="status">
          {copyStatus}
        </p>
      )}
    </section>
  );
}
