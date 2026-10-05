import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDraftSession } from '../drafts/localDraft';
import {
  loadTemplates,
  PROMPT_STORAGE_KEY,
  RECENT_TEMPLATE_KEY,
  readRecentTemplates,
  rememberTemplate,
  validateDraft,
} from './templates';
import type { PromptDraft, PromptKind, PromptTemplate, RecentTemplates } from './templates';
import { promptRequest, PromptApiError, saveServerTemplate } from './api';
import type { PromptLibrary, PromptImportResult } from './api';

const SYNC_KEY = 'leneu:prompt-library-sync:v1';
const IMPORT_KEY = 'leneu:prompt-imported:v1';
function readLegacy() {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY);
    let oldDraft = false;
    try {
      const stored = JSON.parse(
        localStorage.getItem(`leneu:prompt-drafts:v1:${browserDraftSession()}`) || 'null',
      );
      oldDraft = Object.values(stored?.value || {}).some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          'expectedVersion' in entry &&
          !('expectedRevisionId' in entry),
      );
    } catch {
      /* The draft hook reports its own recovery errors. */
    }
    return {
      items: raw !== null || oldDraft ? loadTemplates(localStorage) : [],
      error: '',
      needsDraftMigration: oldDraft,
    };
  } catch (cause) {
    return {
      items: [],
      error: cause instanceof Error ? cause.message : '브라우저 템플릿을 읽지 못했어요.',
      needsDraftMigration: false,
    };
  }
}
async function fingerprint(items: PromptTemplate[]) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(items)),
  );
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function notifyTabs() {
  try {
    localStorage.setItem(SYNC_KEY, crypto.randomUUID());
  } catch {
    /* Server persistence still succeeded. */
  }
}

export function usePromptLibrary(enabled: boolean) {
  const [library, setLibrary] = useState<PromptLibrary>({ libraryId: '', items: [] });
  const [libraryError, setLibraryError] = useState('');
  const [libraryLoading, setLibraryLoading] = useState(enabled);
  const [legacy, setLegacy] = useState<{
    items: PromptTemplate[];
    error: string;
    needsDraftMigration: boolean;
  }>({
    items: [],
    error: '',
    needsDraftMigration: false,
  });
  const [legacyDone, setLegacyDone] = useState(false);
  const checkedLegacy = useRef(false);
  const sequence = useRef(0);
  const [recentTemplates, setRecentTemplates] = useState<RecentTemplates>(() => {
    try {
      return readRecentTemplates(localStorage);
    } catch {
      return {};
    }
  });
  const [preferenceError, setPreferenceError] = useState('');
  const recent = useRef(recentTemplates);
  recent.current = recentTemplates;
  const reloadLibrary = useCallback(async () => {
    const request = ++sequence.current;
    setLibraryLoading(true);
    try {
      const result = await promptRequest<PromptLibrary>('');
      if (request === sequence.current) {
        setLibrary(result);
        setLibraryError('');
      }
    } catch (cause) {
      if (request === sequence.current)
        setLibraryError(cause instanceof Error ? cause.message : '템플릿을 불러오지 못했어요.');
    } finally {
      if (request === sequence.current) setLibraryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    if (!checkedLegacy.current) {
      checkedLegacy.current = true;
      setLegacy(readLegacy());
    }
    void reloadLibrary();
    const refresh = () => {
      if (document.visibilityState === 'visible') void reloadLibrary();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, reloadLibrary]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === RECENT_TEMPLATE_KEY)
        setRecentTemplates(readRecentTemplates(localStorage));
      if (enabled && (!event.key || event.key === SYNC_KEY)) void reloadLibrary();
      if (enabled && (!event.key || event.key === PROMPT_STORAGE_KEY || event.key === IMPORT_KEY)) {
        setLegacy(readLegacy());
        setLegacyDone(false);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [enabled, reloadLibrary]);
  useEffect(() => {
    if (!library.libraryId || !legacy.items.length) return;
    let active = true;
    void fingerprint(legacy.items)
      .then((hash) => {
        const marker = JSON.parse(localStorage.getItem(IMPORT_KEY) || 'null');
        if (active)
          setLegacyDone(
            !legacy.needsDraftMigration &&
              marker?.libraryId === library.libraryId &&
              marker?.hash === hash,
          );
      })
      .catch(() => {
        /* An unavailable marker never hides migration. */
      });
    return () => {
      active = false;
    };
  }, [library.libraryId, legacy.items, legacy.needsDraftMigration]);
  const mergeItem = useCallback((item: PromptTemplate) => {
    setLibrary((previous) => {
      const current = previous.items.find((entry) => entry.id === item.id);
      if (current && current.version > item.version) return previous;
      return {
        ...previous,
        items: current
          ? previous.items.map((entry) => (entry.id === item.id ? item : entry))
          : [...previous.items, item],
      };
    });
  }, []);
  const saveTemplate = useCallback(
    async (draft: PromptDraft) => {
      validateDraft(draft);
      ++sequence.current;
      try {
        const { item } = await saveServerTemplate(draft);
        ++sequence.current;
        mergeItem(item);
        setLibraryError('');
        setLibraryLoading(false);
        notifyTabs();
        return item;
      } catch (cause) {
        ++sequence.current;
        setLibraryLoading(false);
        if (cause instanceof PromptApiError && cause.current) mergeItem(cause.current);
        throw cause;
      }
    },
    [mergeItem],
  );
  const importTemplates = useCallback(async (items: PromptTemplate[], browserSource = false) => {
    ++sequence.current;
    let result: PromptImportResult;
    try {
      result = await promptRequest<PromptImportResult>('/import', 'POST', {
        schemaVersion: 1,
        items,
      });
    } finally {
      ++sequence.current;
      setLibraryLoading(false);
    }
    setLibrary({ libraryId: result.libraryId, items: result.items });
    setLibraryError('');
    if (browserSource) {
      setLegacyDone(true);
      try {
        localStorage.setItem(
          IMPORT_KEY,
          JSON.stringify({ libraryId: result.libraryId, hash: await fingerprint(items) }),
        );
      } catch {
        setPreferenceError('가져오기는 완료했어요. 브라우저의 완료 표시는 기억하지 못했어요.');
      }
    }
    const next = { ...recent.current };
    for (const kind of ['research', 'free'] as const) {
      const mapping = result.mappings.find((entry) => entry.sourceId === next[kind]);
      if (mapping) {
        next[kind] = mapping.targetId;
        try {
          rememberTemplate(localStorage, kind, mapping.targetId);
        } catch {
          /* Keep in-memory choice. */
        }
      }
    }
    setRecentTemplates(next);
    notifyTabs();
    return result;
  }, []);
  const rememberChoice = useCallback((kind: PromptKind, id: string) => {
    setRecentTemplates((previous) => ({ ...previous, [kind]: id }));
    try {
      setRecentTemplates(rememberTemplate(localStorage, kind, id));
      setPreferenceError('');
    } catch {
      setPreferenceError('최근 템플릿을 기억하지 못했어요. 현재 선택은 사용할 수 있어요.');
    }
  }, []);
  return {
    templates: library.items,
    libraryError,
    libraryLoading,
    libraryReady: !!library.libraryId,
    reloadLibrary,
    saveTemplate,
    importTemplates,
    legacyTemplates: legacyDone ? [] : legacy.items,
    legacyError: legacy.error,
    recentTemplates,
    rememberChoice,
    preferenceError,
  };
}
