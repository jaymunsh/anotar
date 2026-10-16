import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { usePromptLibrary } from '../prompts/usePromptLibrary';
import { DIRECT_REQUEST, type PromptTemplate } from '../prompts/templates';
import AiRequestFields from '../prompts/AiRequestFields';
import type { AiJob } from './types';
import type { Capture } from '../memos/types';
import {
  createAiFollowup,
  prepareAiFollowup,
  followupInstructionError,
  readAiFollowupDraft,
  type AiFollowupDraft,
  type AiFollowupSource,
} from './followup';
import { forgetCaptureSubmission } from '../drafts/captureSubmission';
import { workspaceFetch } from '../sync/runtime';
import { publishRecordChange } from '../trash/events';
import './ai-flow.css';

export default function AiFollowupComposer({
  job,
  initialSource = 'result',
  editRequest = false,
  onBack,
  onBusy,
  onCreated,
}: {
  job: AiJob;
  initialSource?: AiFollowupSource;
  editRequest?: boolean;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
  onCreated: (capture: Capture) => void;
}) {
  const draftKey = `leneu:ai-followup-draft:v1:${job.id}:${editRequest ? 'edit' : 'additional'}`;
  const [draft, setDraft] = useState(() =>
    readAiFollowupDraft(sessionStorage, draftKey, job, initialSource, editRequest),
  );
  const [restoredDraft] = useState(() => {
    const initial = createAiFollowup(job, initialSource, editRequest);
    return (
      draft.sourceType !== initialSource ||
      draft.additional !== initial.additional ||
      draft.selectedId !==
        (editRequest ? job.request.template?.id || DIRECT_REQUEST : DIRECT_REQUEST) ||
      Boolean(
        initial.execution && JSON.stringify(draft.execution) !== JSON.stringify(initial.execution),
      )
    );
  });
  const draftRef = useRef(draft);
  const { sourceType, additional, execution, selectedId } = draft;
  function updateDraft(patch: Partial<AiFollowupDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      setError('추가 요청 초안을 보관하지 못했어요. 창을 닫기 전에 요청 내용을 복사해 주세요.');
    }
  }
  const source = useMemo(
    () => createAiFollowup(job, sourceType, editRequest),
    [job, sourceType, editRequest],
  );
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manageHint, setManageHint] = useState('');
  const panel = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const { templates, libraryLoading, libraryReady, libraryError, reloadLibrary } =
    usePromptLibrary(true);
  // Editing an old request begins with its stored template revision, even if the library changed.
  const choices = useMemo(() => {
    const previous = editRequest && job.request.template;
    if (!previous) return templates;
    const snapshot: PromptTemplate = {
      ...previous,
      revisionId: previous.revisionId ?? undefined,
      description: '이 작업을 요청했을 때의 템플릿 사본',
      archived: false,
    };
    return [snapshot, ...templates.filter((template) => template.id !== previous.id)];
  }, [templates, job, editRequest]);
  const template = choices.find((entry) => entry.id === selectedId) ?? null;
  const unresolved = selectedId !== DIRECT_REQUEST && !template;
  const tooLong = source.content.length > 10000;
  const instructionError = followupInstructionError(additional, template);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function submit() {
    if (
      busyRef.current ||
      !execution ||
      unresolved ||
      instructionError ||
      tooLong ||
      (!enabled && navigator.onLine) ||
      (!source.content.trim() && !source.url)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const { body, receipt, key } = await prepareAiFollowup({
        source,
        additional,
        template,
        execution,
        storage: localStorage,
      });
      const response = await workspaceFetch('/api/captures', { method: 'POST', body });
      const data = (await response.json().catch(() => {
        throw new Error('등록 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      })) as { item?: Capture; error?: string };
      if (!response.ok || !data.item?.id)
        throw new Error(
          data.error || '등록 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
        );
      forgetCaptureSubmission(localStorage, key, receipt.requestId);
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Submission is already preserved. */
      }
      publishRecordChange('ai-request');
      onCreated(data.item);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '등록 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="ai-followup"
      aria-label={editRequest ? 'AI 요청 수정' : 'AI 추가 요청'}
      ref={panel}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!busyRef.current) onBack();
        }
        if (event.key === 'Tab' && panel.current?.closest('[role=dialog]')) {
          const controls = [
            ...panel.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]',
            ),
          ].filter((element) => element.getClientRects().length);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="ai-followup-heading">
        <button type="button" aria-label="결과로 돌아가기" disabled={busy} onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h2>{editRequest ? '요청을 수정해 새로 만들기' : '이 결과로 추가 요청'}</h2>
      </header>
      <p className="ai-followup-help">
        선택한 입력 사본으로 독립된 AI 요청을 만들어요. 내용을 확인한 뒤 등록해 주세요.
      </p>
      {restoredDraft && (
        <p className="ai-followup-restored" role="status">
          작성하던 추가 요청 초안을 이어서 열었어요.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="ai-followup-fields">
          <fieldset className="ai-followup-source-choice">
            <legend>요청에 사용할 입력</legend>
            {job.result && (
              <label>
                <input
                  type="radio"
                  name="followup-source"
                  value="result"
                  checked={sourceType === 'result'}
                  onChange={() => updateDraft({ sourceType: 'result' })}
                />
                현재 AI 결과
              </label>
            )}
            <label>
              <input
                type="radio"
                name="followup-source"
                value="original"
                checked={sourceType === 'original'}
                onChange={() => updateDraft({ sourceType: 'original' })}
              />
              원본 메모 · 요청 당시 사본
            </label>
          </fieldset>
          <details className="ai-followup-source">
            <summary>
              입력 사본 확인 · {source.content.length.toLocaleString('ko-KR')}자
              {source.url ? ' · URL 포함' : ''}
            </summary>
            <pre>
              {source.content || '글 없음'}
              {source.url ? `\n${source.url}` : ''}
            </pre>
          </details>
          {tooLong && (
            <p className="ai-panel-error" role="alert">
              이 결과는 메모의 10,000자 한도를 넘어 바로 요청할 수 없어요. 원본 메모를 선택하거나
              결과를 페이지에 정리한 뒤 페이지 AI를 사용해 주세요.
            </p>
          )}
          {instructionError && (
            <p className="ai-followup-help" role="status">
              {instructionError}
            </p>
          )}
          <AiRequestFields
            templates={choices}
            selectedId={selectedId}
            onSelect={(selectedId) => updateDraft({ selectedId })}
            additional={additional}
            onAdditional={(additional) => updateDraft({ additional })}
            input={{ content: source.content, url: source.url }}
            sourceLabel={source.label}
            instructionMode
            execution={execution}
            onExecution={(execution) => updateDraft({ execution })}
            onAvailability={setEnabled}
            onManage={() =>
              setManageHint(
                '템플릿을 관리하려면 이 초안을 닫고 사이드바의 템플릿을 열어 주세요. 작성한 추가 요청은 이 탭에 남아요.',
              )
            }
            libraryError={libraryError}
            loading={libraryLoading && !libraryReady}
            onReload={() => void reloadLibrary()}
          />
        </fieldset>
        {manageHint && (
          <p className="ai-followup-help" role="status">
            {manageHint}
          </p>
        )}
        {error && (
          <p className="ai-panel-error" role="alert">
            {error}
          </p>
        )}
        <div className="ai-followup-actions">
          <button type="button" disabled={busy} onClick={onBack}>
            취소
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              tooLong ||
              unresolved ||
              Boolean(instructionError) ||
              !execution ||
              (!enabled && navigator.onLine)
            }
          >
            <Sparkles size={15} />
            {busy ? '등록 확인 중…' : '새 AI 요청 등록'}
          </button>
        </div>
      </form>
    </section>
  );
}
