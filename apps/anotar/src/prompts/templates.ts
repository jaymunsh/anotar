import { defaultTemplates, validateDraft } from '../../shared/prompts.ts';
import type { PromptKind, PromptTemplate, PromptDraft } from '../../shared/prompts.ts';
export {
  defaultTemplates,
  renderPrompt,
  validateDraft,
  VARIABLE_LABELS,
} from '../../shared/prompts.ts';
export type { PromptKind, PromptTemplate, PromptDraft } from '../../shared/prompts.ts';
type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const PROMPT_STORAGE_KEY = 'leneu:prompt-templates:v1';
export const DIRECT_REQUEST = 'direct';
export const RECENT_TEMPLATE_KEY = 'leneu:recent-prompt-templates:v1';
export type RecentTemplates = Partial<Record<PromptKind, string>>;

export function readRecentTemplates(storage: Pick<Storage, 'getItem'>): RecentTemplates {
  try {
    const value = JSON.parse(storage.getItem(RECENT_TEMPLATE_KEY) || '{}');
    return {
      research: typeof value?.research === 'string' ? value.research : undefined,
      free: typeof value?.free === 'string' ? value.free : undefined,
    };
  } catch {
    return {};
  }
}

export function rememberTemplate(storage: TemplateStorage, kind: PromptKind, id: string) {
  const next = { ...readRecentTemplates(storage), [kind]: id };
  storage.setItem(RECENT_TEMPLATE_KEY, JSON.stringify(next));
  return next;
}

export function preferredTemplateId(
  kind: PromptKind,
  recent: RecentTemplates,
  templates: PromptTemplate[],
) {
  const id = recent[kind];
  if (id === DIRECT_REQUEST || templates.some((item) => item.id === id && !item.archived))
    return id!;
  return kind === 'research'
    ? templates.find((item) => item.kind === 'research' && !item.archived)?.id || DIRECT_REQUEST
    : DIRECT_REQUEST;
}

export function loadTemplates(storage: Pick<Storage, 'getItem'>): PromptTemplate[] {
  let raw: string | null;
  try {
    raw = storage.getItem(PROMPT_STORAGE_KEY);
  } catch {
    throw new Error('이 브라우저의 템플릿 저장소에 접근하지 못했어요.');
  }
  if (raw === null) return defaultTemplates();
  try {
    const value = JSON.parse(raw);
    if (value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 200)
      throw new Error();
    const ids = new Set<string>();
    for (const item of value.items) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        ids.has(item.id) ||
        !Number.isSafeInteger(item.version) ||
        item.version < 1
      )
        throw new Error();
      validateDraft(item);
      ids.add(item.id);
    }
    return value.items;
  } catch {
    throw new Error('저장된 템플릿을 읽지 못했어요. 브라우저의 기존 데이터는 그대로 두었어요.');
  }
}

export function persistTemplate(storage: TemplateStorage, draft: PromptDraft): PromptTemplate {
  validateDraft(draft);
  const items = loadTemplates(storage);
  const current = draft.id ? items.find((item) => item.id === draft.id) : undefined;
  if (draft.id && (!current || current.version !== draft.expectedVersion))
    throw new Error(
      '다른 탭에서 먼저 수정한 템플릿이에요. 최신 내용을 확인해 주세요. 초안은 그대로 남아 있어요.',
    );
  if (!current && items.length >= 200) throw new Error('템플릿은 최대 200개까지 저장할 수 있어요.');
  const item: PromptTemplate = {
    id: current?.id ?? crypto.randomUUID(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    kind: draft.kind,
    body: draft.body,
    archived: draft.archived,
    version: (current?.version ?? 0) + 1,
  };
  const next = current
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [...items, item];
  try {
    storage.setItem(PROMPT_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items: next }));
  } catch {
    throw new Error(
      '브라우저에 저장하지 못했어요. 저장 공간과 설정을 확인하고 다시 저장해 주세요.',
    );
  }
  return item;
}

export { inferInputUrl, buildRequest } from '../../shared/aiRequests.ts';
