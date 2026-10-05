import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { browserDraftSession, loadDraft, saveDraft } from './localDraft';
import { useAutoDraft } from './useAutoDraft';
import { readAttachmentDraft, writeAttachmentDraft } from './attachmentDraft';
import { mergeReviewedShare } from '../capture/shareStore.js';
import type { ShareContent } from '../capture/shareStore.js';

import type { AiExecution } from '../../shared/aiRequests';

export type CaptureKind = 'note' | 'link' | 'image' | 'file';
type CaptureInput = {
  kind: CaptureKind;
  text: string;
  url: string;
  aiEnabled: boolean;
  aiTemplateId: string;
  aiAdditional: string;
  aiExecution?: AiExecution | null;
  shareImportIds?: string[];
};
type StoredCaptureDraft = { input: CaptureInput; fileCount: number };
const emptyInput: CaptureInput = {
  kind: 'note',
  text: '',
  url: '',
  aiEnabled: false,
  aiTemplateId: '',
  aiAdditional: '',
  aiExecution: null,
};

function isCaptureDraft(value: unknown): value is StoredCaptureDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as StoredCaptureDraft;
  const input = candidate.input;
  return Boolean(
    input &&
    ['note', 'link', 'image', 'file'].includes(input.kind) &&
    ['text', 'url', 'aiTemplateId', 'aiAdditional'].every(
      (key) => typeof input[key as 'text'] === 'string',
    ) &&
    typeof input.aiEnabled === 'boolean' &&
    (input.aiExecution == null || (['hive', 'devin', 'http'].includes(input.aiExecution.profileId) && typeof input.aiExecution.model === 'string' && input.aiExecution.model.length <= 120)) &&
    (input.shareImportIds === undefined ||
      (Array.isArray(input.shareImportIds) && input.shareImportIds.length <= 128 &&
        input.shareImportIds.every((id) => typeof id === 'string' && id.length <= 128))) &&
    Number.isInteger(candidate.fileCount) &&
    candidate.fileCount >= 0 &&
    candidate.fileCount <= 8,
  );
}

export function useCaptureDraft() {
  const [session] = useState(browserDraftSession);
  const key = `leneu:capture-draft:v1:${session}`;
  const [initial] = useState(() => {
    try {
      return { draft: loadDraft(window.localStorage, key, isCaptureDraft), error: '' };
    } catch (cause) {
      return {
        draft: null,
        error: cause instanceof Error ? cause.message : '초안을 복구하지 못했어요.',
      };
    }
  });
  const [input, setInput] = useState<CaptureInput>(initial.draft?.input ?? emptyInput);
  const [files, updateFiles] = useState<File[]>([]);
  const [filesReady, setFilesReady] = useState(!initial.draft?.fileCount);
  const [fileSaving, setFileSaving] = useState(false);
  const [warning, setWarning] = useState(initial.error);
  const [recovered, setRecovered] = useState(!!initial.draft);
  const modified = useRef(false);
  const filesModified = useRef(false);
  const fileQueue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ input, files });
  const importBusy = useRef(false);
  latest.current = { input, files };

  useEffect(() => {
    if (!initial.draft?.fileCount) return;
    let alive = true;
    void readAttachmentDraft(session)
      .then((restored) => {
        if (!alive) return;
        if (restored.length !== initial.draft!.fileCount) throw new Error();
        updateFiles(restored);
      })
      .catch(() => {
        if (alive)
          setWarning('메모 초안은 복구했지만 첨부를 불러오지 못했어요. 파일을 다시 선택해 주세요.');
      })
      .finally(() => {
        if (alive) setFilesReady(true);
      });
    return () => {
      alive = false;
    };
  }, [initial, session]);

  const setField = useCallback(
    <K extends keyof CaptureInput>(field: K, value: SetStateAction<CaptureInput[K]>) => {
      modified.current = true;
      setRecovered(false);
      setInput((current) => ({
        ...current,
        [field]:
          typeof value === 'function'
            ? (value as (previous: CaptureInput[K]) => CaptureInput[K])(current[field])
            : value,
      }));
    },
    [],
  );
  const setFiles = useCallback((value: SetStateAction<File[]>) => {
    modified.current = true;
    filesModified.current = true;
    setRecovered(false);
    setFileSaving(true);
    updateFiles(value);
  }, []);

  useEffect(() => {
    if (!filesReady || !filesModified.current) return;
    let alive = true;
    fileQueue.current = fileQueue.current
      .catch(() => {})
      .then(() => writeAttachmentDraft(session, files))
      .then(() => {
        if (alive) setFileSaving(false);
      })
      .catch(() => {
        if (alive) {
          setFileSaving(false);
          setWarning('첨부를 임시저장하지 못했어요. 파일은 현재 화면에서 계속 보관할 수 있어요.');
        }
      });
    return () => {
      alive = false;
    };
  }, [files, filesReady, session]);

  const stored = useMemo(() => {
    const fileCount = filesReady ? files.length : (initial.draft?.fileCount ?? 0);
    return input.text || input.url || input.aiEnabled || input.aiAdditional || fileCount
      ? { input, fileCount }
      : null;
  }, [input, files, filesReady, initial]);
  const storageError = useAutoDraft(key, stored, modified.current);

  function snapshot() {
    return { input: { ...input }, files };
  }
  async function applyReviewedImport(id: string, incoming: ShareContent) {
    if (!filesReady || fileSaving || importBusy.current)
      throw new Error('첨부 임시저장이나 복구를 마친 뒤 가져와 주세요.');
    const previous = latest.current;
    const merged = mergeReviewedShare(previous, { ...incoming, id });
    if (merged === previous) return;
    if ((merged.input.shareImportIds?.length ?? 0) > 128)
      throw new Error('현재 초안을 저장한 뒤 공유 내용을 가져와 주세요.');
    importBusy.current = true;
    setFileSaving(true);
    let attachmentsWritten = false;
    const importWork = fileQueue.current.catch(() => {}).then(async () => {
      // The share remains in its durable pending store until this complete draft is durable.
      await writeAttachmentDraft(session, merged.files);
      attachmentsWritten = true;
      if (latest.current.input !== previous.input || latest.current.files !== previous.files)
        throw new Error('가져오는 동안 초안이 바뀌었어요. 작성 중인 내용을 유지했으니 다시 가져와 주세요.');
      saveDraft(window.localStorage, key, { input: merged.input, fileCount: merged.files.length });
      latest.current = merged;
      modified.current = true;
      filesModified.current = false;
      setInput(merged.input);
      updateFiles(merged.files);
      setRecovered(false);
      setWarning('');
    });
    fileQueue.current = importWork;
    try {
      await importWork;
    } catch (cause) {
      if (attachmentsWritten) {
        try { await writeAttachmentDraft(session, latest.current.files); }
        catch { setWarning('작성 중인 첨부의 임시저장을 복구하지 못했어요. 새로고침 전에 저장해 주세요. 공유 원본은 대기함에 남아 있어요.'); }
      }
      if (cause instanceof Error && cause.name !== 'Error')
        throw new Error('공유 첨부를 초안에 임시저장하지 못했어요. 브라우저 저장 공간을 확인하고 다시 가져와 주세요. 공유 원본은 대기함에 남아 있어요.');
      throw cause;
    } finally {
      importBusy.current = false;
      setFileSaving(false);
    }
  }
  function clearIfUnchanged(sent: ReturnType<typeof snapshot>) {
    const current = latest.current;
    if (
      (Object.keys(emptyInput) as (keyof CaptureInput)[]).some(
        (field) => current.input[field] !== sent.input[field],
      ) ||
      current.files.length !== sent.files.length ||
      current.files.some((file, index) => file !== sent.files[index])
    )
      return false;
    modified.current = true;
    filesModified.current = current.files.length > 0;
    setInput(emptyInput);
    updateFiles([]);
    setRecovered(false);
    setFileSaving(current.files.length > 0);
    setWarning('');
    try {
      saveDraft(window.localStorage, key, null);
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : '임시초안을 지우지 못했어요.');
    }
    return true;
  }

  return {
    ...input,
    files,
    setFiles,
    filesReady,
    fileSaving,
    recovered,
    draftWarning: warning || storageError,
    snapshot,
    applyReviewedImport,
    submissionKey: `leneu:capture-submit:v1:${session}`,
    clearIfUnchanged,
    setKind: (value: SetStateAction<CaptureKind>) => setField('kind', value),
    setText: (value: SetStateAction<string>) => setField('text', value),
    setUrl: (value: SetStateAction<string>) => setField('url', value),
    setAiEnabled: (value: SetStateAction<boolean>) => setField('aiEnabled', value),
    setAiTemplateId: (value: SetStateAction<string>) => setField('aiTemplateId', value),
    setAiExecution: (value: AiExecution) => setField('aiExecution', value),
    setAiAdditional: (value: SetStateAction<string>) => setField('aiAdditional', value),
  };
}
