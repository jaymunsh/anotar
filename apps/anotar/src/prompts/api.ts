import type { PromptDraft, PromptTemplate } from './templates';
import type { ImportMapping } from './migration';
import { cachedRequest } from '../sync/cachedRequest';
import { onlineActionFetch } from '../sync/onlineActions';

export type PromptLibrary = { libraryId: string; items: PromptTemplate[] };
export type PromptImportResult = PromptLibrary & {
  created: number;
  updated: number;
  unchanged: number;
  mappings: ImportMapping[];
};
export class PromptApiError extends Error {
  current?: PromptTemplate;
  constructor(message: string, current?: PromptTemplate) {
    super(message);
    this.current = current;
  }
}
export async function promptRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if(method==='GET')return cachedRequest<T>(`/api/prompt-templates${path}`,signal);
  const response = await onlineActionFetch(`/api/prompt-templates${path}`, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new PromptApiError(
      data.error || '템플릿을 저장하지 못했어요. 다시 시도해 주세요.',
      data.current,
    );
  return data;
}
export function saveServerTemplate(draft: PromptDraft) {
  if (draft.expectedVersion !== undefined && !draft.expectedRevisionId)
    throw new Error(
      '이전 브라우저의 초안이에요. 브라우저 템플릿을 가져오거나 초안을 복제해서 저장해 주세요.',
    );
  const id = draft.id || crypto.randomUUID();
  const updating = draft.expectedVersion !== undefined;
  return promptRequest<{ item: PromptTemplate }>(
    updating ? `/${id}` : '',
    updating ? 'PUT' : 'POST',
    {
      id,
      name: draft.name,
      description: draft.description,
      kind: draft.kind,
      body: draft.body,
      archived: draft.archived,
      expectedVersion: draft.expectedVersion,
      expectedRevisionId: draft.expectedRevisionId,
    },
  );
}
