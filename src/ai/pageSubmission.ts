export type PageAiPending = {
  kind: 'request' | 'apply' | 'undo';
  path: string;
  body: Record<string, unknown>;
};
const key = (pageId: string) => `leneu:page-ai-submit:v1:${pageId}`;
export function recoverPageAiPending(pageId: string): PageAiPending | null {
  const raw = localStorage.getItem(key(pageId));
  if (!raw) return null;
  const value = JSON.parse(raw) as PageAiPending;
  const id = value.body?.requestId || value.body?.operationId;
  if (
    !['request', 'apply', 'undo'].includes(value.kind) ||
    !value.path.startsWith(`/api/pages/${pageId}/`) ||
    typeof id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(id)
  )
    throw new Error('제출한 AI 요청 정보를 읽지 못했어요. 브라우저 저장 정보를 확인해 주세요.');
  return value;
}
export function rememberPageAiPending(pageId: string, value: PageAiPending) {
  localStorage.setItem(key(pageId), JSON.stringify(value));
}
export function forgetPageAiPending(pageId: string) {
  localStorage.removeItem(key(pageId));
}
export class PageAiResponseError extends Error {
  definitive: boolean;
  constructor(message: string, definitive: boolean) {
    super(message);
    this.definitive = definitive;
  }
}
export async function sendPageAiPending<T>(
  pending: PageAiPending,
  signal?: AbortSignal,
): Promise<T> {
  if(pending.kind==='request' && typeof indexedDB!=='undefined') {
    const {queueWorkflow,workflowResult}=await import('../sync/workflows');
    const id=pending.path.split('/')[3],requestId=String(pending.body.requestId);
    await queueWorkflow('ai.submit','page',id,requestId,{request:pending.body.aiRequest,blockIds:pending.body.blockIds??[],retryOf:pending.body.retryOf??null});
    const result=await workflowResult(requestId);return (result??{queued:true,operationId:requestId}) as T;
  }
  const {onlineActionFetch}=await import('../sync/onlineActions.ts');
  const response = await onlineActionFetch(pending.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pending.body),
    signal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new PageAiResponseError(
      '저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
      false,
    );
  }
  if (!response.ok)
    throw new PageAiResponseError(
      data.error || '요청을 처리하지 못했어요. 다시 확인해 주세요.',
      [400, 404, 409, 412].includes(response.status),
    );
  if (!data.item?.id)
    throw new PageAiResponseError(
      '저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
      false,
    );
  return data;
}
