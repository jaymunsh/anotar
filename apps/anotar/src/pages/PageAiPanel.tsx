import type { AiExecution } from '../../shared/aiRequests';
import AiTaskAdoption from '../ai/AiTaskAdoption';
import AiResultContent from '../ai/AiResultContent';
import AiRequestSummary from '../ai/AiRequestSummary';
import { useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles, Undo2 } from 'lucide-react';
import type { PageRecord } from './types';
import type { AiJob } from '../ai/types';
import { activeAiJob, aiStatusLabel } from '../ai/types';
import { linkedAiJobId, includeLinkedAiJob } from '../ai/api';
import { aiPageMarkdown, suggestedAiPageTitle } from '../ai/pageContent';
import {
  forgetPageAiPending,
  PageAiResponseError,
  recoverPageAiPending,
  rememberPageAiPending,
  sendPageAiPending,
} from '../ai/pageSubmission';
import type { PageAiPending } from '../ai/pageSubmission';
import { usePromptLibrary } from '../prompts/usePromptLibrary';
import { DIRECT_REQUEST, inferInputUrl } from '../prompts/templates';
import AiRequestFields from '../prompts/AiRequestFields';
import { formatKoreanTime } from '../time';
import { publishRecordChange } from '../trash/events';
import { PageNavContext } from './pageNav';
import '../ai/ai.css';
import { useQueuedWorkflows } from '../sync/workflows';
import { cachedRequest } from '../sync/cachedRequest';
import { useOnlineAction } from '../sync/onlineActions';
import WorkflowQueue from '../sync/WorkflowQueue';

type Applied = { operationId: string; version: number };
const applyKey = (id: string) => 'leneu:page-ai-last-apply:v1:' + id;
function recovery(pageId: string) {
  try {
    return { pending: recoverPageAiPending(pageId), error: '' };
  } catch {
    return {
      pending: null,
      error: '제출 정보를 읽지 못했어요. 브라우저 저장 정보를 확인한 뒤 페이지를 다시 열어 주세요.',
    };
  }
}
export default function PageAiPanel({
  page,
  blocked,
  selectionIds,
  savedMarkdown,
  onApplied,
  onMutationPending,
}: {
  page: PageRecord;
  blocked: boolean;
  selectionIds: string[];
  savedMarkdown: (ids: string[]) => string;
  onApplied: (page: PageRecord) => void;
  onMutationPending: (pending: boolean) => void;
}) {
  const library = usePromptLibrary(true);
  const [selectedTemplate, setSelectedTemplate] = useState(DIRECT_REQUEST);
  const [additional, setAdditional] = useState('');
  const [execution, setExecution] = useState<AiExecution | null>(null);
  const [scope, setScope] = useState<'page' | 'selection'>('page');
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const queued=useQueuedWorkflows(page.id).filter(p=>p.operation.kind==='ai.submit');
  const queuedSignature=queued.map(p=>p.operation.operationId).join(',');
  const wantedRequest=useRef('');
  const onlineReason=useOnlineAction('page',page.id);
  const [notice,setNotice]=useState('');
  const [selectedId, setSelectedId] = useState(linkedAiJobId);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [jobsKnown, setJobsKnown] = useState(false);
  const [error, setError] = useState('');
  const [restored] = useState(() => recovery(page.id));
  const [pending, setPending] = useState<PageAiPending | null>(restored.pending);
  const [definitive, setDefinitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [lastApply, setLastApply] = useState<Applied | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(applyKey(page.id)) || 'null');
      return typeof value?.operationId === 'string' && Number.isSafeInteger(value.version)
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const navigate = useContext(PageNavContext);
  const mounted = useRef(true);
  const submit = useRef<AbortController | null>(null);
  const callbacks = useRef({ onApplied, onMutationPending });
  callbacks.current = { onApplied, onMutationPending };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submit.current?.abort();
    };
  }, []);
  useEffect(() => {
    callbacks.current.onMutationPending(
      Boolean(pending && pending.kind !== 'request') || Boolean(restored.error),
    );
  }, [pending, restored.error]);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const config = new AbortController();
    let controller: AbortController | undefined;
    async function refresh() {
      if (stopped || document.hidden) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        let data:{items:AiJob[]};try {data=await cachedRequest(`/api/pages/${page.id}/ai-jobs`,current.signal);}catch(cause){if(navigator.onLine)throw cause;data={items:[]};}
        if (!Array.isArray(data.items)) throw new Error();
        if (stopped || current.signal.aborted) return;
        const items = await includeLinkedAiJob(
          data.items as AiJob[],
          'page',
          page.id,
          current.signal,
        );
        if (stopped || current.signal.aborted) return;
        setJobsKnown(true);
        setJobs(items);
        setSelectedId((id) => items.find(job=>job.requestId===wantedRequest.current)?.id || (items.some((job) => job.id === id) ? id : items[0]?.id || ''));
        if (items.some(activeAiJob)) timer = setTimeout(() => void refresh(), 2000);
      } catch {
        if (!stopped && !current.signal.aborted) {
          setJobsKnown(false);
          setError('페이지 AI 이력을 불러오지 못했어요. 다시 불러와 주세요.');
        }
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
      config.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [page.id, page.version, reload,queuedSignature]);
  const selected = jobs.find((job) => job.id === selectedId) || jobs[0];
  const active = jobs.some(activeAiJob);
  const unresolved =
    selectedTemplate !== DIRECT_REQUEST &&
    (!library.libraryReady ||
      !library.templates.some((item) => item.id === selectedTemplate && !item.archived));
  const markdown = savedMarkdown(scope === 'selection' ? selectionIds : []);
  const disabled = blocked || busy || !jobsKnown || !!queued.length || Boolean(pending) || Boolean(restored.error);

  async function execute(value: PageAiPending) {
    if (busy || restored.error || blocked) return;
    setError('');
    setDefinitive(false);
    try {
      rememberPageAiPending(page.id, value);
    } catch {
      setError('제출 정보를 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
      return;
    }
    setPending(value);
    setBusy(true);
    callbacks.current.onMutationPending(value.kind !== 'request');
    const controller = new AbortController();
    submit.current = controller;
    try {
      if (value.kind === 'request') {
        wantedRequest.current=String(value.body.requestId);
        const data = await sendPageAiPending<{ item?: AiJob; queued?:boolean }>(value, controller.signal);
        if (!mounted.current) return;
        if(data.item){const job=data.item;setSelectedId(job.id);setJobsKnown(true);setJobs(items=>[job,...items.filter(old=>old.id!==job.id)]);}else setNotice('기기에서 전송 대기 · 원본 저장이 반영된 뒤 AI 요청을 제출해요.');
        publishRecordChange('page-ai-request');
      } else {
        const data = await sendPageAiPending<{
          item: PageRecord;
          operationId?: string;
          replayed: boolean;
        }>(value, controller.signal);
        if (!mounted.current) return;
        const mode = value.body.mode;
        if (mode === 'child') {
          forgetPageAiPending(page.id);
          setPending(null);
          callbacks.current.onMutationPending(false);
          publishRecordChange('page-ai-child');
          navigate('/pages/' + data.item.id);
          return;
        }
        // Replayed receipts can precede newer edits. Read current saved bytes before updating the editor.
        const response = await fetch('/api/pages/' + page.id, { signal: controller.signal });
        const current = await response.json();
        if (!response.ok || !current.item?.document)
          throw new Error(
            '반영한 뒤 최신 페이지를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
          );
        if (!mounted.current) return;
        callbacks.current.onApplied(current.item);
        if (value.kind === 'apply') {
          const applied = {
            operationId: value.body.operationId as string,
            version: data.item.version,
          };
          localStorage.setItem(applyKey(page.id), JSON.stringify(applied));
          setLastApply(applied);
        } else {
          localStorage.removeItem(applyKey(page.id));
          setLastApply(null);
        }
        publishRecordChange('page-ai-' + value.kind);
      }
      forgetPageAiPending(page.id);
      setPending(null);
      callbacks.current.onMutationPending(false);
      setReload((count) => count + 1);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : '저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
        );
        setDefinitive(cause instanceof PageAiResponseError && cause.definitive);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function request(retryOf?: string) {
    if (
      disabled ||
      active ||
      (!retryOf && !enabled && navigator.onLine) ||
      (!retryOf && !execution) ||
      (!retryOf && unresolved) ||
      (!retryOf && scope === 'selection' && !selectionIds.length)
    )
      return;
    const template =
      retryOf && selected?.request.template
        ? {
            ...selected.request.template,
            description: '',
            archived: false,
            revisionId: selected.request.template.revisionId ?? undefined,
          }
        : selectedTemplate === DIRECT_REQUEST
          ? null
          : library.templates.find((item) => item.id === selectedTemplate)!;
    await execute({
      kind: 'request',
      path: `/api/pages/${page.id}/ai-jobs`,
      body: {
        requestId: crypto.randomUUID(),
        expectedVersion: page.version,
        aiRequest: {
          template: retryOf && !selected?.request.template ? null : template,
          additional: retryOf ? selected!.request.additional : additional,
          ...(retryOf ? selected?.request.execution ? { execution: selected.request.execution } : {} : execution ? { execution } : {}),
        },
        ...(retryOf
          ? { blockIds: selected!.targetBlockIds }
          : scope === 'selection'
            ? { blockIds: [...selectionIds] }
            : {}),
        retryOf: retryOf || null,
      },
    });
  }
  async function apply(mode: 'append' | 'replace' | 'child') {
    if (
      disabled ||
      !selected?.result ||
      (mode === 'replace' &&
        (!selected.targetBlockIds.length || page.version !== selected.sourceVersion))
    )
      return;
    setBusy(true);
    setError('');
    callbacks.current.onMutationPending(true);
    try {
      const { parsePageMarkdown } = await import('./parseMarkdown');
      const title = mode === 'child' ? suggestedAiPageTitle(selected) : undefined;
      const document = parsePageMarkdown(aiPageMarkdown(selected, title));
      setBusy(false);
      await execute({
        kind: 'apply',
        path: `/api/pages/${page.id}/ai-applies`,
        body: {
          operationId: crypto.randomUUID(),
          expectedVersion: page.version,
          jobId: selected.id,
          mode,
          document,
          ...(title ? { title } : {}),
        },
      });
    } catch {
      if (mounted.current) {
        setBusy(false);
        callbacks.current.onMutationPending(false);
        setError('AI 결과를 블록으로 변환하지 못했어요. Markdown을 복사하거나 다시 시도해 주세요.');
      }
    }
  }
  function undo() {
    if (disabled || !lastApply || lastApply.version !== page.version) return;
    void execute({
      kind: 'undo',
      path: `/api/pages/${page.id}/ai-applies/${lastApply.operationId}/undo`,
      body: { operationId: crypto.randomUUID(), expectedVersion: page.version },
    });
  }
  return (
    <section className="ai-job-panel page-ai-panel" aria-label="페이지 AI">
      <WorkflowQueue sourceId={page.id} onlyAi />
      {notice&&<p role="status">{notice}</p>}
      <div className="ai-job-heading">
        <h2>
          <Sparkles size={17} />
          페이지 AI
        </h2>
        <span className="ai-job-state">{loading ? '불러오는 중…' : aiStatusLabel(selected)}</span>
      </div>
      <p className="ai-job-explanation">
        저장한 페이지로 요청하고, 결과를 확인한 뒤 본문에 반영하세요. 처리 중에도 문서를 편집할 수
        있어요.
      </p>
      {blocked && !pending && (
        <p role="status" className="ai-job-explanation">
          페이지 저장·충돌·초안 복구를 먼저 완료해 주세요.
        </p>
      )}
      {pending ? (
        <div className="page-ai-pending" role="status">
          <p>제출한 선택을 그대로 보관했어요. 같은 요청을 확인해도 중복으로 처리하지 않아요.</p>
          <button
            disabled={busy || blocked || Boolean(restored.error)}
            onClick={() => void execute(pending)}
          >
            {busy ? '제출 확인 중…' : '같은 요청 다시 확인'}
          </button>
          {definitive && (
            <button
              disabled={busy}
              onClick={() => {
                try {
                  forgetPageAiPending(page.id);
                  setPending(null);
                  callbacks.current.onMutationPending(false);
                  setDefinitive(false);
                  setError('');
                } catch {
                  setError('제출 정보를 정리하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
                }
              }}
            >
              확인된 실패 닫기
            </button>
          )}
        </div>
      ) : (
        <>
          <fieldset className="page-ai-request-fields" disabled={disabled}>
            <legend>요청 범위</legend>
            <div className="page-ai-scope">
              <label>
                <input
                  type="radio"
                  name="page-ai-scope"
                  checked={scope === 'page'}
                  onChange={() => setScope('page')}
                />
                페이지 전체
              </label>
              <label>
                <input
                  type="radio"
                  name="page-ai-scope"
                  checked={scope === 'selection'}
                  disabled={!selectionIds.length}
                  onChange={() => setScope('selection')}
                />
                선택한 블록{selectionIds.length ? ` (${selectionIds.length}개)` : ''}
              </label>
            </div>
            <p className="ai-job-explanation">
              선택한 블록은 편집기에서 글을 선택한 뒤 요청 도구를 열어 주세요.
            </p>
            <AiRequestFields
          execution={execution} onExecution={setExecution} onAvailability={setEnabled}
              subject="page"
              templates={library.templates}
              selectedId={selectedTemplate}
              onSelect={setSelectedTemplate}
              additional={additional}
              onAdditional={setAdditional}
              input={{ content: markdown, url: inferInputUrl(markdown) }}
              onManage={(id) => navigate(id ? '/prompts/' + id : '/prompts')}
              libraryError={library.libraryError}
              loading={library.libraryLoading && !library.libraryReady}
              onReload={() => void library.reloadLibrary()}
            />
          </fieldset>
          <div className="ai-job-actions">
            <button
              className="ai-run-current"
              disabled={
                disabled ||
                loading ||
                active ||
                (!enabled && navigator.onLine) ||
                !execution ||
                unresolved ||
                (scope === 'selection' && !selectionIds.length)
              }
              onClick={() => void request()}
            >
              <Sparkles size={15} />
              현재 페이지로 요청
            </button>
            {selected?.status === 'failed' && (
              <button
                disabled={disabled || loading || active}
                onClick={() => void request(selected.id)}
              >
                실패한 요청 그대로 재시도
              </button>
            )}
          </div>
        </>
      )}
      {!enabled && (
        <p className="ai-job-explanation">
          실행기를 연결하면 AI를 요청할 수 있어요. 이전 결과와 이력은 계속 확인할 수 있어요.
        </p>
      )}
      {activeAiJob(selected) && (
        <p role="status" className="ai-job-explanation">
          {selected.status === 'queued'
            ? '순서가 되면 저장한 요청을 처리해요.'
            : '요청을 처리하고 있어요. 결과가 준비되면 직접 반영할 수 있어요.'}
        </p>
      )}
      {selected && (
        <p className="ai-job-meta">
          {formatKoreanTime(selected.createdAt)} · {selected.runner?.label || '저장한 요청'}
          {selected.runner?.mode === 'test' && <span className="ai-test-mark">테스트 응답</span>}
        </p>
      )}
      {selected && <AiRequestSummary request={selected.request} />}
      {selected && selected.sourceVersion !== page.version && (
        <p className="ai-job-stale" role="status">
          <strong>요청 후 문서가 수정됨</strong>
          <span>
            본문 아래 추가 또는 새 하위 페이지를 선택하거나 현재 버전으로 다시 요청해 주세요.
          </span>
        </p>
      )}
      {selected?.error && (
        <p className="ai-job-error" role="status">
          {selected.error}
        </p>
      )}
      {selected?.result && (
        <>
          <h3 className="page-ai-result-heading">AI 제안</h3>
          <AiResultContent key={selected.id} markdown={selected.result.markdown} />
              <AiTaskAdoption key={selected.id} job={selected} />
          {selected.result.sources.length > 0 && (
            <div className="ai-result-sources">
              <h3>참고 링크</h3>
              {selected.result.sources.map((source, index) => (
                <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <small>{source.verified ? '본문 확인됨' : '본문 미확인'}</small>
                </a>
              ))}
            </div>
          )}
          <div className="ai-job-actions">
            <button disabled={disabled||!!onlineReason} title={onlineReason} onClick={() => void apply('append')}>
              본문 아래 추가
            </button>
            {selected.targetBlockIds.length > 0 && (
              <button
                disabled={disabled || !!onlineReason || selected.sourceVersion !== page.version}
                onClick={() => void apply('replace')}
              >
                선택한 블록 교체
              </button>
            )}
            <button disabled={disabled||!!onlineReason} title={onlineReason} onClick={() => void apply('child')}>
              새 하위 페이지
            </button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(selected.result!.markdown)
                  .catch(() => setError('복사하지 못했어요. 결과를 직접 선택해서 복사해 주세요.'))
              }
            >
              Markdown 복사
            </button>
          </div>
        </>
      )}
      {lastApply && (
        <div className="ai-job-actions">
          <button disabled={disabled || !!onlineReason || page.version !== lastApply.version} onClick={undo}>
            <Undo2 size={15} />
            AI 반영 되돌리기
          </button>
          {page.version !== lastApply.version && (
            <p className="ai-job-explanation">반영 후 새 편집이 있어 되돌리기를 멈췄어요.</p>
          )}
        </div>
      )}
      {selected && (
        <details className="ai-saved-prompt">
          <summary>
            요청 당시 입력·프롬프트
            <ChevronDown size={15} />
          </summary>
          <p>
            {selected.sourceTitle} · 저장 버전 {selected.sourceVersion} ·{' '}
            {selected.targetBlockIds.length ? '선택한 블록' : '페이지 전체'}
          </p>
          <h3>요청 당시 입력</h3>
          <pre>{selected.request.input.content}</pre>
          <h3>프롬프트</h3>
          <pre>{selected.request.prompt}</pre>
        </details>
      )}
      {jobs.length > 1 && (
        <details className="ai-history">
          <summary>
            이전 요청 {jobs.length}개<ChevronDown size={15} />
          </summary>
          <div>
            {jobs.map((job) => (
              <button
                key={job.id}
                aria-pressed={job.id === selected?.id}
                onClick={() => {wantedRequest.current='';setSelectedId(job.id);}}
              >
                <span>{formatKoreanTime(job.createdAt)}</span>
                <span>{aiStatusLabel(job)}</span>
              </button>
            ))}
          </div>
        </details>
      )}
      {(error || restored.error) && (
        <div className="ai-panel-error" role="alert">
          <p>{error || restored.error}</p>
          {!pending && !restored.error && (
            <button
              onClick={() => {
                setError('');
                setReload((value) => value + 1);
              }}
            >
              다시 불러오기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
