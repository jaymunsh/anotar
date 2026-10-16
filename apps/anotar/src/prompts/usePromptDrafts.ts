import { useCallback, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { browserDraftSession, loadDraft } from '../drafts/localDraft';
import { useAutoDraft } from '../drafts/useAutoDraft';
import type { PromptDraft } from './templates';

export type PromptEditorDraft = PromptDraft & { pendingCreation?: PromptDraft };
type Drafts = Record<string, PromptEditorDraft>;
function isFields(item: unknown): item is PromptDraft {
  if (!item || typeof item !== 'object') return false;
  const draft = item as Partial<PromptDraft>;
  return (
    typeof draft.name === 'string' &&
    draft.name.length <= 80 &&
    typeof draft.description === 'string' &&
    draft.description.length <= 200 &&
    typeof draft.body === 'string' &&
    draft.body.length <= 10000 &&
    ['free', 'research'].includes(draft.kind || '') &&
    typeof draft.archived === 'boolean'
  );
}
function isDrafts(value: unknown): value is Drafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    // Up to 200 server drafts, 200 retained browser drafts, and one new draft.
    entries.length <= 401 &&
    entries.every(
      ([id, item]) =>
        /^[a-z0-9-]+$/.test(id) &&
        item &&
        typeof item === 'object' &&
        typeof item.name === 'string' &&
        item.name.length <= 80 &&
        typeof item.description === 'string' &&
        item.description.length <= 200 &&
        typeof item.body === 'string' &&
        item.body.length <= 10000 &&
        ['free', 'research'].includes(item.kind) &&
        typeof item.archived === 'boolean' &&
        (item.id === undefined ||
          item.id === id ||
          (id === 'new' && item.expectedVersion === undefined)) &&
        (item.expectedRevisionId === undefined || typeof item.expectedRevisionId === 'string') &&
        (item.pendingCreation === undefined ||
          (isFields(item.pendingCreation) &&
            typeof item.pendingCreation.id === 'string' &&
            item.pendingCreation.id === item.id &&
            item.pendingCreation.expectedVersion === undefined &&
            item.pendingCreation.expectedRevisionId === undefined)) &&
        (item.expectedVersion === undefined ||
          (Number.isInteger(item.expectedVersion) && item.expectedVersion > 0)),
    )
  );
}

export function usePromptDrafts() {
  const [key] = useState(() => `leneu:prompt-drafts:v1:${browserDraftSession()}`);
  const [initial] = useState(() => {
    try {
      return { drafts: loadDraft(window.localStorage, key, isDrafts) ?? {}, error: '' };
    } catch (cause) {
      return {
        drafts: {},
        error: cause instanceof Error ? cause.message : '초안을 복구하지 못했어요.',
      };
    }
  });
  const [drafts, updateDrafts] = useState<Drafts>(initial.drafts);
  const [recovered, setRecovered] = useState(Object.keys(initial.drafts).length > 0);
  const changed = useRef(false);
  const setDrafts = useCallback((value: SetStateAction<Drafts>) => {
    changed.current = true;
    setRecovered(false);
    updateDrafts(value);
  }, []);
  const storageError = useAutoDraft(
    key,
    Object.keys(drafts).length ? drafts : null,
    changed.current && !initial.error,
  );
  return {
    drafts,
    setDrafts,
    recovered,
    draftError: initial.error
      ? `${initial.error} 새 초안의 임시저장은 멈췄어요. 새로고침 전에 저장하거나 내용을 복사해 주세요.`
      : storageError,
  };
}
