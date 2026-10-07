import type { AiExecution } from '../../shared/aiRequests.ts';
import type { PromptTemplate } from '../prompts/templates.ts';
import type { AiJob } from './types.ts';
import { prepareCaptureSubmission } from '../drafts/captureSubmission.ts';

export type AiFollowupSource = 'result' | 'original';
export type AiFollowup = {
  jobId: string;
  source: AiFollowupSource;
  label: string;
  content: string;
  url: string;
  additional: string;
  execution: AiExecution | null;
};

export function createAiFollowup(
  job: AiJob,
  source: AiFollowupSource,
  editRequest = false,
): AiFollowup {
  if (source === 'result' && !job.result) throw new Error('추가 요청에 사용할 결과가 없어요.');
  return {
    jobId: job.id,
    source,
    label: source === 'result' ? '현재 AI 결과' : '원본 메모 · 요청 당시 사본',
    content: source === 'result' ? job.result!.markdown : job.request.input.content,
    url: source === 'result' ? '' : job.request.input.url,
    additional: editRequest ? job.request.additional : '',
    execution: job.request.execution ? { ...job.request.execution } : null,
  };
}

export async function prepareAiFollowup({
  source,
  additional,
  template,
  execution,
  storage,
}: {
  source: AiFollowup;
  additional: string;
  template: PromptTemplate | null;
  execution: AiExecution;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}) {
  const key = `leneu:ai-followup-submit:v1:${source.jobId}:${source.source}`;
  const kind = source.url ? 'link' : 'note';
  const receipt = await prepareCaptureSubmission({
    storage,
    key,
    input: {
      kind,
      text: source.content,
      url: source.url,
      aiEnabled: true,
      aiTemplateId: template?.id || 'direct',
      aiAdditional: additional,
      aiExecution: execution,
    },
    files: [],
    selection: { template, additional, execution },
  });
  const body = new FormData();
  body.set('requestId', receipt.requestId);
  body.set('kind', kind);
  body.set('text', source.content);
  body.set('url', source.url);
  body.set('aiRequest', JSON.stringify(receipt.selection));
  return { body, receipt, key };
}

export function followupInstructionError(
  additional: string,
  template: Pick<PromptTemplate, 'body'> | null,
) {
  return additional.trim() || template?.body.trim()
    ? ''
    : '원하는 작업을 적거나 작업 지시가 담긴 템플릿을 선택해 주세요.';
}

export type AiFollowupDraft = {
  sourceType: AiFollowupSource;
  additional: string;
  execution: AiExecution | null;
  selectedId: string;
};
export function readAiFollowupDraft(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  job: AiJob,
  initialSource: AiFollowupSource,
  editRequest: boolean,
): AiFollowupDraft {
  const source = createAiFollowup(job, initialSource, editRequest);
  const fallback: AiFollowupDraft = {
    sourceType: initialSource,
    additional: source.additional,
    execution: source.execution,
    selectedId: editRequest ? job.request.template?.id || 'direct' : 'direct',
  };
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (
      !saved ||
      !['result', 'original'].includes(saved.sourceType) ||
      (saved.sourceType === 'result' && !job.result) ||
      typeof saved.additional !== 'string' ||
      saved.additional.length > 1000 ||
      typeof saved.selectedId !== 'string' ||
      saved.selectedId.length > 80 ||
      (saved.execution !== null &&
        (!saved.execution ||
          !['hive', 'devin', 'opencode', 'http'].includes(saved.execution.profileId) ||
          typeof saved.execution.model !== 'string' ||
          saved.execution.model.length > 120))
    )
      return fallback;
    return {
      sourceType: saved.sourceType,
      additional: saved.additional,
      selectedId: saved.selectedId,
      execution: saved.execution,
    };
  } catch {
    return fallback;
  }
}
