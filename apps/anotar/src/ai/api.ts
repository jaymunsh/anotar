import type { AiExecution } from '../../shared/aiRequests';
import type { AiActivity, AiActivityFilter, AiJob, AiRunner } from './types';
async function read<T>(response: Response): Promise<T> {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('AI 요청을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
  if (!response.ok)
    throw new Error(data.error || 'AI 요청을 처리하지 못했어요. 다시 시도해 주세요.');
  return data;
}
export const listAiJobs = async (id: string, signal: AbortSignal) =>
  (await (await import('../sync/cachedRequest')).cachedRequest<{items:AiJob[]}>(`/api/captures/${id}/ai-jobs`,signal)).items;
export function linkedAiJobId() {
  const id = new URLSearchParams(window.location.search).get('aiJob') || '';
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) ? id : '';
}
export async function includeLinkedAiJob(
  items: AiJob[],
  ownerKind: 'memo' | 'page',
  ownerId: string,
  signal: AbortSignal,
) {
  const id = linkedAiJobId();
  if (!id || items.some((item) => item.id === id)) return items;
  const { item } = await read<{ item: AiJob }>(await fetch('/api/ai-jobs/' + id, { signal }));
  if ((ownerKind === 'page' ? item.pageId : item.captureId) !== ownerId)
    throw new Error('연결된 AI 요청을 찾을 수 없어요. 요청 목록에서 다시 확인해 주세요.');
  return [...items, item];
}
export async function getAiActivity(
  compact: boolean,
  status: AiActivityFilter,
  signal: AbortSignal,
) {
  const data = await read<AiActivity>(
    await fetch(`/api/ai/activity?view=${compact ? 'compact' : 'full'}&status=${status}`, {
      signal,
    }),
  );
  if (!Array.isArray(data.items) || !data.counts || typeof data.total !== 'number')
    throw new Error('AI 요청 상태를 확인하지 못했어요. 다시 불러와 주세요.');
  return data;
}
export type AiConnectionStatus = {
  enabled: boolean;
  runner: AiRunner | null;
  supports?: string[];
  researchModes?: ('url' | 'keyword')[];
  attachments?: boolean;
};
export const getAiStatus = async (signal: AbortSignal) =>
  (await import('../sync/cachedRequest')).cachedRequest<AiConnectionStatus>('/api/ai/status',signal);
export async function requestAiJob(
  captureId: string,
  expectedVersion: number,
  retryOf: string | undefined,
  signal: AbortSignal,
  execution?: AiExecution | null,
) {
  signal.throwIfAborted();
  const key = `leneu:ai-job-submit:v1:${captureId}`;
  const args = { expectedVersion, retryOf: retryOf ?? null, execution: execution ?? null };
  let pending: typeof args & { requestId: string };
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    pending =
      stored &&
      stored.expectedVersion === expectedVersion &&
      stored.retryOf === args.retryOf &&
      JSON.stringify(stored.execution ?? null) === JSON.stringify(args.execution) &&
      /^[a-f0-9-]{36}$/.test(stored.requestId)
        ? stored
        : { ...args, requestId: crypto.randomUUID() };
    localStorage.setItem(key, JSON.stringify(pending));
  } catch {
    throw new Error('요청 확인 정보를 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
  }
  const {getWorkspaceRuntime}=await import('../sync/runtime');const {readLocalEntity}=await import('../sync/repository');const {queueWorkflow,workflowResult}=await import('../sync/workflows');const {workspaceId}=await getWorkspaceRuntime();
  const source=await readLocalEntity({workspaceId,kind:'capture',id:captureId});
  const stored=source?.current?.aiRequest as AiJob['request']|undefined;
  if(!stored)throw Error('메모에 보관한 요청문을 먼저 확인해 주세요.');
  const template=stored.template?{...stored.template,description:'',archived:false,revisionId:stored.template.revisionId??undefined}:null;
  await queueWorkflow('ai.submit','capture',captureId,pending.requestId,{request:{template,additional:stored.additional,...((execution || stored.execution) ? {execution:execution || stored.execution}: {})},retryOf:retryOf??null});
  const result=await workflowResult(pending.requestId);
  try {
    if (JSON.parse(localStorage.getItem(key) || 'null')?.requestId === pending.requestId)
      localStorage.removeItem(key);
  } catch {
    /* Receipt can be safely replayed. */
  }
  return result?.item as unknown as AiJob|undefined;
}
