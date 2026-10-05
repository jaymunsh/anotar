import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import PromptHistory from './PromptHistory';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Upload,
  ArrowDownUp,
  Copy,
  Link2,
  MessageSquareText,
  Plus,
  RotateCcw,
} from 'lucide-react';
import {
  renderPrompt,
  VARIABLE_LABELS,
  loadTemplates,
  PROMPT_STORAGE_KEY,
  validateDraft,
} from './templates';
import type { PromptDraft, PromptTemplate } from './templates';
import CopyRequestButton from './CopyRequestButton';
import { usePromptDrafts } from './usePromptDrafts';
import type { PromptEditorDraft } from './usePromptDrafts';
import { rebasePromptDrafts } from './migration';
import type { PromptImportResult } from './api';
import './prompts.css';

type Props = {
  visible: boolean;
  requestedId: string | null;
  templates: PromptTemplate[];
  libraryError: string;
  onSave: (draft: PromptDraft) => Promise<PromptTemplate>;
  loading: boolean;
  ready: boolean;
  onReload: () => void;
  legacyTemplates: PromptTemplate[];
  legacyError: string;
  onImport: (items: PromptTemplate[], browserSource?: boolean) => Promise<PromptImportResult>;
  onNavigate: (path: string) => void;
  onUse: (id: string) => void;
};

const blankDraft: PromptDraft = {
  name: '',
  description: '',
  kind: 'free',
  body: '',
  archived: false,
};
const asDraft = (item: PromptTemplate): PromptDraft => ({
  ...item,
  expectedVersion: item.version,
  expectedRevisionId: item.revisionId,
});

export default function PromptWorkspace({
  visible,
  requestedId,
  templates,
  libraryError,
  onSave,
  onNavigate,
  onUse,
  loading,
  ready,
  onReload,
  legacyTemplates,
  legacyError,
  onImport,
}: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(
    requestedId || templates.find((item) => !item.archived)?.id || '',
  );
  const { drafts, setDrafts, recovered, draftError } = usePromptDrafts();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [metadataOpen, setMetadataOpen] = useState(!mobile);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sampleUrl, setSampleUrl] = useState('https://example.com/article');
  const [sampleContent, setSampleContent] = useState(
    '관심 있는 자료를 저장해 두었어요. 핵심 내용과 다음에 살펴볼 질문을 정리하고 싶어요.',
  );
  const nameInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const transferMenu = useRef<HTMLDetailsElement>(null);
  const duplicateIntent = useRef<{ signature: string; input: PromptDraft } | null>(null);
  const latest = useRef({ selectedId, drafts, visible });
  latest.current = { selectedId, drafts, visible };
  const current = templates.find((item) => item.id === selectedId);
  const draft: PromptEditorDraft = drafts[selectedId] ?? (current ? asDraft(current) : blankDraft);
  const shown = templates.filter((item) => item.archived === showArchived);
  const orphanDrafts = Object.entries(drafts).filter(
    ([id]) => !templates.some((item) => item.id === id),
  );
  const dirty =
    !current ||
    (['name', 'description', 'kind', 'body'] as const).some((key) => draft[key] !== current[key]);
  let preview = '';
  let previewError = '';
  let missing: string[] = [];
  try {
    const result = renderPrompt(draft.body, { url: sampleUrl, content: sampleContent });
    preview = result.text;
    missing = result.missing;
  } catch (cause) {
    previewError = cause instanceof Error ? cause.message : '요청문을 표시하지 못했어요.';
  }

  useEffect(() => {
    if (!requestedId) {
      if (!selectedId && templates.length)
        setSelectedId(templates.find((entry) => !entry.archived)?.id || '');
      return;
    }
    setSelectedId(requestedId);
    const item = templates.find((entry) => entry.id === requestedId);
    if (item) setShowArchived(item.archived);
  }, [requestedId, templates, selectedId]);

  useEffect(() => {
    if (visible && selectedId === 'new') (mobile ? bodyInput : nameInput).current?.focus();
  }, [visible, selectedId, mobile]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(media.matches);
      setMetadataOpen(!media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!visible || !mobile || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () =>
      document.documentElement.style.setProperty(
        '--prompt-toolbar-bottom',
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--prompt-toolbar-bottom');
    };
  }, [visible, mobile]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !transferMenu.current?.contains(event.target)) {
        if (transferMenu.current) transferMenu.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        event.keyCode === 229 ||
        !transferMenu.current?.open
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      transferMenu.current.open = false;
      transferMenu.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [visible]);

  function select(id: string) {
    setSelectedId(id);
    setHistoryOpen(false);
    setError('');
    setNotice('');
    onNavigate(id ? `/prompts/${id}` : '/prompts');
  }

  function edit(patch: Partial<PromptDraft>) {
    setDrafts((previous) => ({ ...previous, [selectedId]: { ...draft, ...patch } }));
    setError('');
    setNotice('');
  }

  async function save(useAfter = false) {
    if (busy || !ready) return;
    const origin = selectedId;
    let sent = draft;
    setBusy(true);
    try {
      if (!sent.name.trim()) {
        setTab('edit');
        setMetadataOpen(true);
        requestAnimationFrame(() => nameInput.current?.focus());
        throw new Error('템플릿 이름은 1~80자로 입력해 주세요.');
      }
      validateDraft(sent);
      if (sent.expectedVersion === undefined) {
        const creation = draft.pendingCreation ?? {
          id: sent.id || crypto.randomUUID(),
          name: sent.name,
          description: sent.description,
          kind: sent.kind,
          body: sent.body,
          archived: sent.archived,
        };
        if (!draft.pendingCreation)
          setDrafts((previous) => ({
            ...previous,
            [origin]: { ...draft, id: creation.id, pendingCreation: creation },
          }));
        sent = creation;
      }
      const item = dirty ? await onSave(sent) : current!;
      const pending = latest.current.drafts[origin] ?? sent;
      const unchanged = (['name', 'description', 'kind', 'body', 'archived'] as const).every(
        (key) => pending[key] === sent[key],
      );
      const separateDraft = origin !== item.id && !!latest.current.drafts[item.id];
      const keepOrigin = separateDraft && !unchanged;
      setDrafts((previous) => {
        const next = { ...previous };
        const newer = previous[origin] ?? sent;
        const hasNewerInput = !(['name', 'description', 'kind', 'body', 'archived'] as const).every(
          (key) => newer[key] === sent[key],
        );
        // A lost creation reply can leave independently edited drafts in both views.
        // Keep the original creation snapshot under its old key rather than replace either draft.
        if (hasNewerInput && origin !== item.id && previous[item.id]) return previous;
        delete next[origin];
        if (hasNewerInput)
          next[item.id] = {
            ...newer,
            id: item.id,
            expectedVersion: item.version,
            expectedRevisionId: item.revisionId,
            pendingCreation: undefined,
          };
        return next;
      });
      if (latest.current.selectedId === origin && latest.current.visible) {
        setError('');
        if (keepOrigin) {
          setNotice(
            '보낸 내용을 저장했어요. 같은 템플릿의 다른 초안이 있어 추가 입력도 남겨뒀어요. 복제해서 따로 저장할 수 있어요.',
          );
          return;
        }
        setSelectedId(item.id);
        setNotice(
          separateDraft
            ? '보낸 내용을 저장했어요. 이 템플릿의 다른 초안은 아직 저장하지 않았어요.'
            : unchanged
              ? '저장소에 저장했어요.'
              : '보낸 내용을 저장했어요. 추가 입력은 초안으로 남아 있어요.',
        );
        if (useAfter && unchanged && !separateDraft) onUse(item.id);
        else onNavigate(`/prompts/${item.id}`);
      }
    } catch (cause) {
      if (latest.current.selectedId === origin)
        setError(cause instanceof Error ? cause.message : '템플릿을 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (busy || !ready) return;
    const origin = selectedId;
    setBusy(true);
    try {
      const signature = JSON.stringify(draft);
      if (duplicateIntent.current?.signature !== signature)
        duplicateIntent.current = {
          signature,
          input: {
            ...draft,
            id: crypto.randomUUID(),
            expectedVersion: undefined,
            expectedRevisionId: undefined,
            name: `${draft.name.slice(0, 75)} 복사본`,
            archived: false,
          },
        };
      const item = await onSave(duplicateIntent.current.input);
      duplicateIntent.current = null;
      if (latest.current.selectedId === origin && latest.current.visible) {
        setShowArchived(false);
        select(item.id);
        setTab('edit');
        setNotice('복사본을 만들었어요. 원하는 문구로 바꿔보세요.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '복사본을 만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!current || busy) return;
    const origin = selectedId;
    setBusy(true);
    try {
      const local = drafts[current.id];
      const item = await onSave({
        ...asDraft(current),
        ...(local
          ? { expectedVersion: local.expectedVersion, expectedRevisionId: local.expectedRevisionId }
          : {}),
        archived: !current.archived,
      });
      setDrafts((previous) =>
        previous[item.id]
          ? {
              ...previous,
              [item.id]: {
                ...previous[item.id],
                archived: item.archived,
                expectedVersion: item.version,
                expectedRevisionId: item.revisionId,
              },
            }
          : previous,
      );
      if (latest.current.selectedId === origin && latest.current.visible) {
        setShowArchived(false);
        select(
          item.archived
            ? templates.find((entry) => !entry.archived && entry.id !== item.id)?.id || ''
            : item.id,
        );
        setNotice(
          item.archived
            ? '보관했어요. 보관된 템플릿에서 다시 꺼낼 수 있어요.'
            : '다시 사용할 수 있게 꺼냈어요.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '템플릿 상태를 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function importItems(items: PromptTemplate[], browserSource = false) {
    if (busy || !ready) return;
    const origin = selectedId;
    setBusy(true);
    setError('');
    setNotice('');
    if (transferMenu.current) transferMenu.current.open = false;
    try {
      const result = await onImport(items, browserSource);
      const before = latest.current;
      const moved = rebasePromptDrafts(before.drafts, result.mappings);
      setDrafts(moved);
      const mapping = result.mappings.find((entry) => entry.sourceId === origin);
      if (
        mapping &&
        before.selectedId === origin &&
        before.visible &&
        (!before.drafts[origin] ||
          moved[origin] === undefined ||
          (mapping.targetId === origin &&
            moved[origin]?.expectedRevisionId === mapping.targetRevisionId))
      )
        select(mapping.targetId);
      setNotice(`템플릿 ${items.length}개를 가져왔어요. 기존에 수정한 내용도 그대로 남아 있어요.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '가져오지 못했어요. 원본은 그대로 남아 있어요.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    if (busy || !ready) return;
    setError('');
    setNotice('');
    if (file.size > 16 * 1024 * 1024) {
      setError('가져올 파일은 16MB까지 받을 수 있어요.');
      return;
    }
    try {
      const raw = await file.text();
      const items = loadTemplates({ getItem: (key) => (key === PROMPT_STORAGE_KEY ? raw : null) });
      await importItems(items);
    } catch {
      setError(
        '템플릿 JSON 파일을 읽지 못했어요. 형식과 내용을 확인해 주세요. 원본은 그대로 남아 있어요.',
      );
    }
  }

  function exportFile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ schemaVersion: 1, items: templates }, null, 2)], {
        type: 'application/json',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'leneu-prompts.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (transferMenu.current) transferMenu.current.open = false;
  }

  function insertVariable(value: string) {
    const field = bodyInput.current;
    const start = field?.selectionStart ?? draft.body.length;
    const end = field?.selectionEnd ?? start;
    const body = draft.body.slice(0, start) + value + draft.body.slice(end);
    if (body.length > 10000) {
      setError('본문은 10,000자까지 입력할 수 있어요. 일부를 지운 뒤 변수를 넣어 주세요.');
      return;
    }
    edit({ body });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + value.length, start + value.length);
    });
  }

  if (!visible) return null;
  return (
    <main className="prompt-workspace">
      <WorkspaceToolbar title="프롬프트">
        <details className="prompt-transfer" ref={transferMenu}>
          <summary
            className="toolbar-icon-mobile"
            aria-label="템플릿 가져오기·내보내기"
            title="템플릿 가져오기·내보내기"
          >
            <ArrowDownUp size={16} />
            <span>가져오기·내보내기</span>
          </summary>
          <div className="prompt-transfer-menu">
            <button
              className="prompt-button"
              type="button"
              disabled={!ready || busy}
              onClick={() => importInput.current?.click()}
            >
              <Upload size={16} /> JSON 가져오기
            </button>
            <button
              className="prompt-button"
              type="button"
              disabled={!ready || busy}
              onClick={exportFile}
            >
              <Download size={16} /> JSON 내보내기
            </button>
          </div>
        </details>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="템플릿 JSON 파일"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="toolbar-primary toolbar-icon-mobile"
          aria-label="새 템플릿"
          title="새 템플릿"
          disabled={!ready || busy}
          onClick={() => {
            setShowArchived(false);
            setTab('edit');
            select('new');
          }}
        >
          <Plus size={17} />
          <span>새 템플릿</span>
        </button>
      </WorkspaceToolbar>
      <div className="prompt-preview-note">
        <span className="prompt-status">요청 템플릿</span>
        <span>저장한 템플릿을 메모와 페이지의 AI 요청에서 선택할 수 있어요.</span>
      </div>
      {!!legacyTemplates.length && (
        <div className="prompt-migration-note">
          <span>
            이 브라우저에 저장된 템플릿 {legacyTemplates.length}개가 있어요. 가져오면 다른
            기기에서도 사용할 수 있어요.
          </span>
          <button
            className="prompt-button"
            type="button"
            disabled={!ready || busy}
            onClick={() => void importItems(legacyTemplates, true)}
          >
            브라우저 템플릿 가져오기
          </button>
        </div>
      )}
      {(error || libraryError || draftError || legacyError) && (
        <div className="prompt-feedback error" role="alert">
          {error || libraryError || draftError || legacyError}
          {libraryError && (
            <button
              className="prompt-text-button"
              type="button"
              disabled={loading}
              onClick={onReload}
            >
              다시 불러오기
            </button>
          )}
          {error.includes('다른 탭') && current && (
            <button
              className="prompt-text-button"
              type="button"
              onClick={() => {
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[current.id];
                  return next;
                });
                setError('');
              }}
            >
              최신 내용 불러오기
            </button>
          )}
        </div>
      )}
      {recovered && (
        <p className="prompt-feedback" role="status">
          작성 중이던 템플릿 초안을 복구했어요.
        </p>
      )}
      {notice && (
        <div className="prompt-feedback" role="status">
          <Check size={15} /> {notice}
        </div>
      )}
      <div className="prompt-board">
        <aside className="prompt-library" aria-label="프롬프트 템플릿 목록">
          <div className="prompt-library-tabs" role="tablist" aria-label="템플릿 상태">
            {[false, true].map((archived) => (
              <button
                key={String(archived)}
                type="button"
                role="tab"
                aria-selected={showArchived === archived}
                onClick={() => {
                  setShowArchived(archived);
                  select(templates.find((item) => item.archived === archived)?.id || '');
                }}
              >
                {archived ? '보관됨' : '사용 중'}
                <span>{templates.filter((item) => item.archived === archived).length}</span>
              </button>
            ))}
          </div>
          <div className="prompt-template-list">
            {!showArchived &&
              orphanDrafts.map(([id, item]) => (
                <button
                  type="button"
                  key={id}
                  className={`prompt-template-item ${selectedId === id ? 'selected' : ''}`}
                  onClick={() => select(id)}
                  aria-current={selectedId === id ? 'true' : undefined}
                >
                  <span className="prompt-template-kind">이 기기에 남은 초안</span>
                  <strong>{item.name || '이름 없는 초안'}</strong>
                </button>
              ))}
            {shown.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`prompt-template-item ${selectedId === item.id ? 'selected' : ''}`}
                aria-current={selectedId === item.id ? 'true' : undefined}
                onClick={() => select(item.id)}
              >
                <span className="prompt-template-kind">
                  {item.kind === 'research' ? <Link2 size={14} /> : <MessageSquareText size={14} />}
                  {item.kind === 'research' ? '리서치' : '자유 요청'}
                </span>
                <strong>{item.name}</strong>
                <span className="prompt-template-description">
                  {item.description || '설명 없음'}
                </span>
              </button>
            ))}
            {!shown.length && (
              <p className="prompt-library-empty">
                {loading
                  ? '템플릿을 불러오는 중…'
                  : showArchived
                    ? '보관된 템플릿이 없어요.'
                    : '새 템플릿을 만들어 보세요.'}
              </p>
            )}
          </div>
          <label className="prompt-mobile-select prompt-field">
            <span>템플릿 선택</span>
            <select
              aria-label="편집할 템플릿"
              value={
                shown.some((item) => item.id === selectedId) ||
                (!showArchived && orphanDrafts.some(([id]) => id === selectedId))
                  ? selectedId
                  : ''
              }
              onChange={(event) => select(event.target.value)}
            >
              <option value="" disabled>
                {selectedId === 'new' ? '새 템플릿 작성 중' : '템플릿을 선택하세요'}
              </option>
              {!showArchived &&
                orphanDrafts.map(([id, item]) => (
                  <option key={id} value={id}>
                    {item.name || '이름 없는 초안'} · 초안
                  </option>
                ))}
              {shown.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="prompt-library-footnote">
            리서치는 정해진 틀로,
            <br />
            나머지는 자유롭게 요청해요.
          </p>
        </aside>
        {selectedId && (current || selectedId === 'new' || drafts[selectedId]) ? (
          <section className="prompt-editor" aria-label="템플릿 편집">
            <div className="prompt-editor-toolbar">
              <div className="prompt-editor-tabs" role="tablist" aria-label="템플릿 작업">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'edit'}
                  onClick={() => setTab('edit')}
                >
                  작성
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'preview'}
                  onClick={() => setTab('preview')}
                >
                  요청 미리보기
                </button>
              </div>
              {(current || drafts[selectedId]) && (
                <div className="prompt-editor-actions">
                  <button
                    type="button"
                    className="prompt-icon-button"
                    aria-label="템플릿 복제"
                    title="템플릿 복제"
                    disabled={!ready || busy}
                    onClick={duplicate}
                  >
                    <Copy size={16} />
                  </button>
                  {current && (
                    <button
                      type="button"
                      disabled={!ready || busy}
                      aria-expanded={historyOpen}
                      onClick={() => setHistoryOpen((v) => !v)}
                    >
                      수정 이력
                    </button>
                  )}
                  {current && (
                    <button
                      type="button"
                      className="prompt-icon-button"
                      aria-label={current.archived ? '템플릿 꺼내기' : '템플릿 보관'}
                      title={current.archived ? '템플릿 꺼내기' : '템플릿 보관'}
                      disabled={!ready || busy}
                      onClick={toggleArchive}
                    >
                      {current.archived ? <RotateCcw size={16} /> : <Archive size={16} />}
                    </button>
                  )}
                </div>
              )}
            </div>
            {historyOpen && current && (
              <PromptHistory
                key={current.id}
                current={current}
                disabled={busy || dirty || !ready}
                onChoose={(patch) => {
                  edit(patch);
                  setTab('edit');
                  setHistoryOpen(false);
                  setNotice('이전 수정본을 초안으로 불러왔어요. 저장하면 새 수정본이 됩니다.');
                }}
              />
            )}
            {tab === 'edit' ? (
              <form
                className="prompt-edit-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <details
                  className="prompt-metadata"
                  open={metadataOpen}
                  onToggle={(event) => setMetadataOpen(event.currentTarget.open)}
                >
                  <summary>
                    템플릿 설정 <ChevronDown size={16} />
                  </summary>
                  <div className="prompt-metadata-fields">
                    <div className="prompt-field-row">
                      <label className="prompt-field">
                        <span>이름</span>
                        <input
                          ref={nameInput}
                          aria-label="템플릿 이름"
                          value={draft.name}
                          maxLength={80}
                          required
                          onChange={(event) => edit({ name: event.target.value })}
                          placeholder="어떤 요청인가요?"
                        />
                      </label>
                      <label className="prompt-field">
                        <span>종류</span>
                        <select
                          aria-label="템플릿 종류"
                          value={draft.kind}
                          onChange={(event) =>
                            edit({ kind: event.target.value as PromptDraft['kind'] })
                          }
                        >
                          <option value="research">리서치</option>
                          <option value="free">자유 요청</option>
                        </select>
                      </label>
                    </div>
                    <label className="prompt-field">
                      <span>
                        설명 <small>선택</small>
                      </span>
                      <input
                        aria-label="템플릿 설명"
                        value={draft.description}
                        maxLength={200}
                        onChange={(event) => edit({ description: event.target.value })}
                        placeholder="어떻게 쓰는 템플릿인지 짧게 적어두세요"
                      />
                    </label>
                  </div>
                </details>
                <label className="prompt-field prompt-body-field">
                  <span>
                    프롬프트 본문 <small>일반 텍스트 · Markdown</small>
                  </span>
                  <textarea
                    ref={bodyInput}
                    aria-label="프롬프트 본문"
                    value={draft.body}
                    maxLength={10000}
                    required
                    onChange={(event) => edit({ body: event.target.value })}
                    placeholder="AI에게 요청할 내용을 작성하세요. 메모를 넣을 자리에 {{content}}를 사용할 수 있어요."
                    rows={13}
                    spellCheck={false}
                  />
                </label>
                <div className="prompt-variable-row">
                  <span>입력값 넣기</span>
                  {['{{url}}', '{{content}}'].map((value) => (
                    <button
                      className="prompt-variable"
                      key={value}
                      type="button"
                      title="커서 위치에 넣기"
                      onClick={() => insertVariable(value)}
                    >
                      {value}
                    </button>
                  ))}
                  <span className="prompt-character-count">
                    {draft.body.length.toLocaleString('ko-KR')} / 10,000
                  </span>
                </div>
                <div className="prompt-editor-footer">
                  <span className="prompt-save-state">
                    {dirty ? (
                      '저장 전'
                    ) : (
                      <>
                        <Check size={14} /> 저장됨 · v{current?.version}
                      </>
                    )}
                  </span>
                  <button
                    className="prompt-button primary"
                    type="submit"
                    disabled={!dirty || busy || !ready}
                  >
                    {busy ? '저장 중…' : '템플릿 저장'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="prompt-test-area">
                <p className="prompt-test-description">
                  입력값이 들어간 요청문을 확인해 보세요. URL을 열거나 AI를 실행하지 않아요.
                </p>
                <label className="prompt-field">
                  <span>테스트 URL</span>
                  <input
                    aria-label="미리보기 URL"
                    type="url"
                    value={sampleUrl}
                    maxLength={2000}
                    onChange={(event) => setSampleUrl(event.target.value)}
                    placeholder="https://example.com/article"
                  />
                </label>
                <label className="prompt-field">
                  <span>테스트 메모</span>
                  <textarea
                    aria-label="미리보기 메모"
                    value={sampleContent}
                    maxLength={10000}
                    onChange={(event) => setSampleContent(event.target.value)}
                    rows={3}
                  />
                </label>
                <div className="prompt-preview-heading">
                  <strong>전달할 요청문</strong>
                  <CopyRequestButton text={preview} onError={setError} />
                </div>
                {previewError && (
                  <p className="prompt-error" role="alert">
                    {previewError}
                  </p>
                )}
                {!!missing.length && (
                  <p className="prompt-input-hint">
                    {[...new Set(missing.map((key) => VARIABLE_LABELS[key]))].join(' · ')}이 비어
                    있어요.
                  </p>
                )}
                <pre className="prompt-result">
                  {preview || '프롬프트 본문을 작성하면 요청문이 여기에 보여요.'}
                </pre>
                <button type="button" className="prompt-text-button" onClick={() => setTab('edit')}>
                  <ArrowLeft size={14} /> 본문 수정하기
                </button>
              </div>
            )}
            <div className="prompt-use-row">
              <span>
                {current?.archived
                  ? '보관된 템플릿은 먼저 꺼내 주세요.'
                  : '입력함에서 이 템플릿으로 요청을 준비해요.'}
              </span>
              <button
                type="button"
                className="prompt-button"
                disabled={!!current?.archived || busy || !ready}
                onClick={() => save(true)}
              >
                {dirty ? '저장하고 사용' : '입력함에서 사용'}
                <ArrowRight size={15} />
              </button>
            </div>
          </section>
        ) : (
          <div className="prompt-editor-empty">
            <MessageSquareText size={30} />
            <h2>
              {loading && !ready
                ? '템플릿을 불러오는 중…'
                : selectedId
                  ? '템플릿을 찾을 수 없어요'
                  : showArchived
                    ? '보관된 템플릿이 없어요'
                    : '나만의 요청을 만들어 보세요'}
            </h2>
            <p>
              {showArchived
                ? '사용 중인 템플릿을 보관하면 여기에 남아요.'
                : '새 템플릿을 만들거나 왼쪽에서 하나를 선택하세요.'}
            </p>
            <button
              type="button"
              className="prompt-button"
              disabled={!ready || busy}
              onClick={() => {
                setTab('edit');
                select('new');
              }}
            >
              <Plus size={16} /> 새 템플릿
            </button>
          </div>
        )}
      </div>
      {selectedId && (current || selectedId === 'new' || drafts[selectedId]) && (
        <div className="prompt-mobile-actions" aria-label="템플릿 작업">
          <button
            type="button"
            className="prompt-button"
            onClick={() => setTab(tab === 'edit' ? 'preview' : 'edit')}
          >
            {tab === 'edit' ? '미리보기' : '본문 수정'}
          </button>
          <button
            type="button"
            className="prompt-button primary"
            disabled={!dirty || busy || !ready}
            onClick={() => save()}
          >
            {busy ? (
              '저장 중…'
            ) : dirty ? (
              '템플릿 저장'
            ) : (
              <>
                <Check size={15} /> 저장됨
              </>
            )}
          </button>
        </div>
      )}
    </main>
  );
}
