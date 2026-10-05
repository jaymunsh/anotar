import { renderPrompt, validateDraft } from './prompts.ts';
import type { PromptTemplate } from './prompts.ts';

export type AiExecution = { profileId: 'hive' | 'devin' | 'opencode' | 'http'; model: string };
export type AiRequestSelection = {
  template: PromptTemplate | null;
  additional: string;
  execution?: AiExecution;
};
export type StoredAiRequest = {
  execution?: AiExecution;
  schemaVersion: 1;
  status: 'prepared';
  template:
    | (Pick<PromptTemplate, 'id' | 'name' | 'body' | 'kind' | 'version'> & {
        revisionId: string | null;
      })
    | null;
  kind: 'research' | 'free';
  additional: string;
  input: { url: string; content: string };
  prompt: string;
};

export function inferInputUrl(text: string) {
  return text.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[.,;!?，。)\]}]+$/, '') ?? '';
}

export function buildRequest(
  template: Pick<PromptTemplate, 'body'> | undefined,
  input: { url: string; content: string },
  additional: string,
) {
  const result = template
    ? renderPrompt(template.body, input)
    : {
        text: [input.content, input.content.includes(input.url) ? '' : input.url]
          .filter(Boolean)
          .join('\n\n'),
        variables: [],
        missing: [],
      };
  return {
    ...result,
    text: result.text + (additional.trim() ? `\n\n추가 요청:\n${additional.trim()}` : ''),
  };
}

export function storeRequestSnapshot(
  selection: unknown,
  input: { url: string; content: string },
): StoredAiRequest {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection))
    throw new Error('AI 요청 설정이 올바르지 않아요.');
  const { template, additional, execution } = selection as AiRequestSelection;
  if (
    execution !== undefined &&
    (!execution ||
      !['hive', 'devin', 'opencode', 'http'].includes(execution.profileId) ||
      typeof execution.model !== 'string' ||
      execution.model.length > 120 ||
      (execution.model && !/^[a-z0-9][a-z0-9/._:-]*$/i.test(execution.model)))
  )
    throw new Error('AI 실행기 설정이 올바르지 않아요.');
  if (typeof additional !== 'string' || additional.length > 1000)
    throw new Error('추가 요청은 1,000자까지 입력해 주세요.');
  if (template !== null) {
    validateDraft(template);
    if (
      typeof template.id !== 'string' ||
      !/^[a-z0-9-]{1,80}$/i.test(template.id) ||
      !Number.isSafeInteger(template.version) ||
      template.version < 1 ||
      (template.revisionId !== undefined &&
        (typeof template.revisionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(template.revisionId)))
    )
      throw new Error('템플릿 저장 정보가 올바르지 않아요. 다시 선택해 주세요.');
  }
  const request = buildRequest(template ?? undefined, input, additional);
  if (request.text.length > 64000)
    throw new Error('조립된 요청문은 64,000자까지 보관할 수 있어요.');
  return {
    ...(execution ? { execution: { profileId: execution.profileId, model: execution.model } } : {}),
    schemaVersion: 1,
    status: 'prepared',
    template: template
      ? {
          id: template.id,
          name: template.name.trim(),
          body: template.body,
          kind: template.kind,
          version: template.version,
          revisionId: template.revisionId ?? null,
        }
      : null,
    kind: template?.kind ?? (input.url ? 'research' : 'free'),
    additional,
    input: { ...input },
    prompt: request.text,
  };
}
