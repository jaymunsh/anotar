import type { SyncEntityKind } from '../../shared/sync';
import { useState } from 'react';

// 온라인 전용: AI 요청·메모 정리를 서버 REST로 바로 보낸다.
// 예전 기기 우선 outbox 대기열(engine/transport)은 제거했다.

export type QueuedWorkflow = { queued: true; operationId: string };
type WorkflowResult = { item: Record<string, unknown>; blockIds?: string[] };

// 같은 요청 UUID의 서버 응답을 잠깐 보관해 workflowResult가 돌려준다.
const results = new Map<string, WorkflowResult>();

export async function workflowResult(operationId: string) {
  return results.get(operationId);
}

export async function queueWorkflow(
  kind: 'capture.organize' | 'ai.submit',
  sourceKind: SyncEntityKind,
  sourceId: string,
  requestId: string,
  input: Record<string, unknown>,
): Promise<QueuedWorkflow> {
  let path: string;
  let body: Record<string, unknown>;
  if (kind === 'ai.submit' && sourceKind === 'capture') {
    path = `/api/captures/${sourceId}/ai-jobs`;
    body = {
      requestId,
      expectedVersion: input.expectedVersion,
      selection: input.request,
      retryOf: input.retryOf ?? null,
    };
  } else if (kind === 'ai.submit') {
    path = `/api/pages/${sourceId}/ai-jobs`;
    body = {
      requestId,
      expectedVersion: input.expectedVersion,
      aiRequest: input.request,
      blockIds: input.blockIds ?? [],
      retryOf: input.retryOf ?? null,
    };
  } else {
    path = '/api/capture-batches/organize';
    body = { ...input, requestId };
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했어요. 다시 확인해 주세요.');
  if (data.item) results.set(requestId, { item: data.item, blockIds: data.blockIds });
  return { queued: true, operationId: requestId };
}

// 온라인 전용에는 기기 대기열이 없다. 아래 함수들은 호출부 호환용 no-op이다.
export async function cancelQueuedWorkflow(_operationId: string) {}
export async function dismissRejectedWorkflow(_operationId: string) {}
export async function replaceRejectedWrite(_operationId: string) {}

type QueuedItem = {
  operation: { operationId: string; kind: string; payload: Record<string, unknown> };
  state: string;
  error?: string;
  attempt: number;
  errorCode?: string;
};
export function useQueuedWorkflows(_sourceId?: string) {
  const [items] = useState<QueuedItem[]>([]);
  return items;
}
