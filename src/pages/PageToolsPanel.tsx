import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, FilePlus2, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { PageDocument, PageRecord, PageSummary } from './types';
import PageInspector from './PageInspector';
import { formatKoreanTime } from '../time';
import { publishRecordChange } from '../trash/events';
import { cleanItinerary, itineraryPlaceUrl } from '../../shared/itinerary';
import {
  createPageToolsPending,
  deletePageTemplate,
  executePageToolsPending,
  forgetPageToolsPending,
  hasPageAssetFiles,
  listPageRevisions,
  listPageTemplates,
  PageToolsResponseError,
  readCurrentPage,
  readPageRevision,
  recoverPageToolsPending,
  rememberPageToolsPending,
  restorePageAssetFiles,
} from './pageToolsApi';
import type {
  PageRevision,
  PageRevisionSummary,
  PageTemplate,
  PageToolsPending,
} from './pageToolsApi';
import './pageTools.css';
import './pageRevisionDiff.css';
import {
  comparePageRevision,
  revisionBlockLabel,
  changedBlockFields,
} from '../../shared/pageRevisionDiff';
import type { RevisionBlock } from '../../shared/pageRevisionDiff';

type Props = {
  page: PageRecord;
  pages: PageSummary[];
  mode: 'templates' | 'move' | 'history';
  selectedBlockIds: string[];
  onUpdated: (page: PageRecord) => void;
  onCreated: (page: PageRecord) => void;
  onClose: () => void;
  disabled?: boolean;
  onMutationPending?: (pending: boolean) => void;
};
const titles = { templates: '페이지 템플릿', move: '선택 블록 이동', history: '수정 이력' };
const pendingLabels = {
  'map-image': '지도 이미지 생성',
  duplicate: '페이지 복제',
  'save-template': '템플릿 저장',
  'create-template-page': '템플릿으로 페이지 만들기',
  move: '선택 블록 이동',
  restore: '수정본 복원',
  assets: '첨부 저장',
};
function recovery(pageId: string) {
  try {
    return { pending: recoverPageToolsPending(pageId), error: '' };
  } catch (cause) {
    return {
      pending: null,
      error:
        cause instanceof Error
          ? cause.message
          : '제출 정보를 읽지 못했어요. 페이지를 다시 열어 주세요.',
    };
  }
}

type SavedInline = {
  type?: string;
  text?: string;
  href?: string;
  content?: unknown;
  styles?: Record<string, unknown>;
};
type SavedBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown[];
};
function safeHref(value: unknown) {
  if (typeof value !== 'string') return undefined;
  return /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : undefined;
}
function inline(value: unknown): ReactNode {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  return value.map((raw, index) => {
    const item = raw as SavedInline;
    let content: ReactNode = item.type === 'link' ? inline(item.content) : item.text || '';
    if (item.styles?.code) content = <code>{content}</code>;
    if (item.styles?.bold) content = <strong>{content}</strong>;
    if (item.styles?.italic) content = <em>{content}</em>;
    if (item.styles?.strike) content = <s>{content}</s>;
    const href = safeHref(item.href);
    return (
      <span key={index}>
        {item.type === 'link' && href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        ) : (
          content
        )}
      </span>
    );
  });
}

function SavedDocument({ document }: { document: PageDocument }) {
  function blocks(values: unknown[], depth = 0): ReactNode {
    return values.map((raw, index) => {
      const block = raw as SavedBlock;
      const props = block.props || {};
      const text = inline(block.content);
      let content: ReactNode;
      if (block.type === 'captureRef')
        content = <p className="page-tools-reference">원본 메모 참조</p>;
      else if (block.type === 'asset')
        content = (
          <p className="page-tools-reference">
            <a
              href={'/api/assets/' + encodeURIComponent(String(props.assetId || ''))}
              target="_blank"
              rel="noopener noreferrer"
            >
              첨부 {props.display === 'image' ? '이미지' : '파일'} 열기
            </a>
          </p>
        );
      else if (block.type === 'bookmark') {
        const href = safeHref(props.url);
        content = (
          <div className="page-revision-bookmark">
            <strong>{String(props.title || '북마크')}</strong>
            {props.description ? <p>{String(props.description)}</p> : null}
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {href}
              </a>
            ) : (
              <p className="page-tools-hint">주소 없음</p>
            )}
          </div>
        );
      } else if (block.type === 'page')
        content = <p className="page-tools-reference">페이지 링크</p>;
      else if (block.type === 'tableOfContents')
        content = <p className="page-tools-reference">목차</p>;
      else if (block.type === 'heading') {
        const level = Math.min(6, Math.max(1, Number(props.level) || 1));
        const Heading = ('h' + level) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        content = <Heading>{text}</Heading>;
      } else if (block.type === 'divider') content = <hr />;
      else if (block.type === 'codeBlock' || block.type === 'diagram')
        content = (
          <pre>
            <code>{text}</code>
          </pre>
        );
      else if (block.type === 'quote') content = <blockquote>{text}</blockquote>;
      else if (
        block.type === 'bulletListItem' ||
        block.type === 'numberedListItem' ||
        block.type === 'toggleListItem' ||
        block.type === 'checkListItem'
      )
        content = (
          <p className="page-tools-list-line">
            <span
              aria-label={
                block.type === 'checkListItem' ? (props.checked ? '완료' : '미완료') : undefined
              }
            >
              {block.type === 'numberedListItem'
                ? `${index + 1}.`
                : block.type === 'checkListItem'
                  ? props.checked
                    ? '☑'
                    : '☐'
                  : '•'}
            </span>
            <span>{text}</span>
          </p>
        );
      else if (block.type === 'table') {
        const rows = (block.content as { rows?: { cells: unknown[] }[] })?.rows || [];
        content = (
          <div className="page-tools-table-scroll">
            <table>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.cells.map((cell, cellIndex) => (
                      <td key={cellIndex}>
                        {inline(
                          Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      } else if (block.type === 'map')
        content = (
          <p>
            {String(props.label || '지도')} · {String(props.latitude ?? '')},{' '}
            {String(props.longitude ?? '')}
          </p>
        );
      else if (block.type === 'itinerary') {
        try {
          const itinerary = cleanItinerary(props.data);
          content = (
            <div>
              <strong>{itinerary.title || '일정'}</strong>
              <p className="page-tools-hint">한국시간</p>
              {itinerary.entries.map((entry) => (
                <div key={entry.id}>
                  <p>
                    {entry.date} {entry.start}
                    {entry.end ? `–${entry.end}` : ''}
                    <br />
                    <strong>{entry.title}</strong>
                    {entry.place ? ` · ${entry.place}` : ''}
                    {entry.note ? (
                      <>
                        <br />
                        {entry.note}
                      </>
                    ) : null}
                  </p>
                  {itineraryPlaceUrl(entry) && (
                    <a href={itineraryPlaceUrl(entry)!} target="_blank" rel="noopener noreferrer">
                      장소 지도 열기
                    </a>
                  )}
                  {entry.url && (
                    <p>
                      <a href={entry.url} target="_blank" rel="noopener noreferrer">
                        관련 링크
                      </a>
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        } catch {
          content = <p className="page-tools-hint">이 수정본의 일정 자료를 읽을 수 없어요.</p>;
        }
      } else content = <p>{text}</p>;
      return (
        <div key={block.id || index} className={depth ? 'page-tools-nested-block' : undefined}>
          {content}
          {block.children?.length ? blocks(block.children, depth + 1) : null}
        </div>
      );
    });
  }
  return (
    <div className="page-tools-document">
      {document.blocks.length ? (
        blocks(document.blocks)
      ) : (
        <p className="page-tools-hint">본문이 비어 있어요.</p>
      )}
    </div>
  );
}

function RevisionComparison({ revision, page }: { revision: PageRevision; page: PageRecord }) {
  const diff = useMemo(() => comparePageRevision(revision, page), [revision, page]);
  const total = diff.counts.added + diff.counts.removed + diff.counts.changed;
  function preview(block: RevisionBlock) {
    return <SavedDocument document={{ schemaVersion: 1, blocks: [{ ...block, children: [] }] }} />;
  }
  return (
    <section
      className="page-revision-diff"
      aria-label={`수정본 v${revision.version}과 현재 페이지 비교`}
    >
      <p className="page-tools-hint">
        v{revision.version} → 현재 v{page.version}
        {page.localRevision ? ' · 이 기기 변경 포함' : ''}
      </p>
      <p className="page-revision-summary" role="status">
        추가 {diff.counts.added} · 삭제 {diff.counts.removed} · 변경 {diff.counts.changed}
        {diff.titleChanged ? ' · 제목 변경' : ''}
        {diff.iconChanged ? ' · 아이콘 변경' : ''}
      </p>
      {!total && !diff.titleChanged && !diff.iconChanged && !diff.truncated && (
        <p className="page-tools-hint">제목·아이콘·본문이 같아요.</p>
      )}
      {(diff.titleChanged || diff.iconChanged) && (
        <div className="page-revision-metadata">
          {diff.titleChanged && (
            <>
              <strong>제목 변경</strong>
              <p>
                <span>수정본</span> {revision.title || '제목 없음'}
              </p>
              <p>
                <span>현재</span> {page.title || '제목 없음'}
              </p>
            </>
          )}
          {diff.iconChanged && (
            <>
              <strong>아이콘 변경</strong>
              <p>
                <span>수정본</span> {revision.icon || '없음'}
              </p>
              <p>
                <span>현재</span> {page.icon || '없음'}
              </p>
            </>
          )}
        </div>
      )}
      <ol className="page-revision-changes">
        {diff.changes.map((change) => {
          const location = change.after || change.before!;
          const label =
            change.kind === 'added' ? '추가' : change.kind === 'removed' ? '삭제' : '변경';
          return (
            <li key={change.key} className={`page-revision-change page-revision-${change.kind}`}>
              <h4>
                {label} · {revisionBlockLabel(location.block)}{' '}
                <span>{location.path.join('.')}번 블록</span>
              </h4>
              {change.moved && (
                <p className="page-tools-hint">
                  위치 변경: {change.before!.path.join('.')} → {change.after!.path.join('.')}
                </p>
              )}
              {change.kind === 'changed' && change.contentChanged && (
                <p className="page-tools-hint">
                  {changedBlockFields(change.before!.block, change.after!.block)} 변경
                </p>
              )}
              {change.before && (
                <div className="page-revision-side">
                  <strong>수정본</strong>
                  {preview(change.before.block)}
                </div>
              )}
              {change.after && (
                <div className="page-revision-side">
                  <strong>현재</strong>
                  {preview(change.after.block)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {diff.hiddenCount > 0 && (
        <p className="page-tools-hint">
          변경이 많아 처음 100개를 표시해요. 나머지 {diff.hiddenCount}개는 수정본 전체와 현재
          본문에서 확인하세요.
        </p>
      )}
      {diff.truncated && (
        <p className="page-tools-hint">
          본문이 커서 일부 블록만 비교했어요. 수정본 전체에서 확인하세요.
        </p>
      )}
    </section>
  );
}

export default function PageToolsPanel(props: Props) {
  return <ToolsPanel key={props.page.id} {...props} />;
}
function ToolsPanel({
  page,
  pages,
  mode,
  selectedBlockIds,
  onUpdated,
  onCreated,
  onClose,
  disabled = false,
  onMutationPending,
}: Props) {
  const uid = useId();
  const [restored] = useState(() => recovery(page.id));
  const [pending, setPending] = useState<PageToolsPending | null>(restored.pending);
  const [busy, setBusy] = useState(false);
  const [definitive, setDefinitive] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(mode !== 'move');
  const [listError, setListError] = useState('');
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState(page.title);
  const [parentId, setParentId] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [revisions, setRevisions] = useState<PageRevisionSummary[]>([]);
  const [revisionVersion, setRevisionVersion] = useState(0);
  const [revision, setRevision] = useState<PageRevision | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewReload, setPreviewReload] = useState(0);
  const [historyView, setHistoryView] = useState<'compare' | 'snapshot'>('compare');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [uploadFilesPresent, setUploadFilesPresent] = useState(
    () => !restored.pending || hasPageAssetFiles(restored.pending),
  );
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const submit = useRef<AbortController | null>(null);
  const callbacks = useRef({ onUpdated, onCreated, onMutationPending });
  const blocked = useRef(disabled);
  callbacks.current = { onUpdated, onCreated, onMutationPending };
  blocked.current = disabled;
  const locked = disabled || busy || Boolean(pending) || Boolean(restored.error);
  const selection = [...new Set(selectedBlockIds)];
  const selectedTemplate = templates.find((item) => item.id === templateId);
  const target = pages.find((item) => item.id === targetId && item.id !== page.id);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submit.current?.abort();
    };
  }, []);
  useEffect(() => {
    callbacks.current.onMutationPending?.(Boolean(pending) || Boolean(restored.error));
  }, [pending, restored.error]);
  useEffect(() => {
    if (mode === 'move') {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    void (
      mode === 'templates'
        ? listPageTemplates(controller.signal)
        : listPageRevisions(page.id, controller.signal)
    )
      .then((items) => {
        if (controller.signal.aborted) return;
        if (mode === 'templates') {
          setTemplates(items as PageTemplate[]);
          setTemplateId((id) =>
            items.some((item) => 'id' in item && item.id === id)
              ? id
              : (items[0] as PageTemplate)?.id || '',
          );
        } else {
          const history = items as PageRevisionSummary[];
          setRevisions(history);
          setRevisionVersion((current) =>
            history.some((item) => item.version === current) ? current : history[0]?.version || 0,
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setListError(
            cause instanceof Error
              ? cause.message
              : '목록을 불러오지 못했어요. 다시 불러와 주세요.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mode, page.id, page.version, reload]);
  useEffect(() => {
    setRevision(null);
    setPreviewError('');
    setConfirmRestore(false);
    if (mode !== 'history' || !revisionVersion) {
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    void readPageRevision(page.id, revisionVersion, controller.signal)
      .then((item) => {
        if (!controller.signal.aborted) setRevision(item);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setPreviewError(
            cause instanceof Error
              ? cause.message
              : '수정본을 불러오지 못했어요. 다시 불러와 주세요.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [mode, page.id, revisionVersion, previewReload]);

  async function execute(value: PageToolsPending) {
    if (inFlight.current || blocked.current || restored.error) return;
    try {
      rememberPageToolsPending(value);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '제출 정보를 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.',
      );
      return;
    }
    inFlight.current = true;
    setPending(value);
    setBusy(true);
    setError('');
    setNotice('');
    setDefinitive(false);
    callbacks.current.onMutationPending?.(true);
    const controller = new AbortController();
    submit.current = controller;
    try {
      const receipt = await executePageToolsPending<PageRecord | PageTemplate>(value, {
        signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (value.kind === 'duplicate' || value.kind === 'create-template-page')
        callbacks.current.onCreated(receipt.item as PageRecord);
      else if (value.kind !== 'save-template')
        callbacks.current.onUpdated(receipt.item as PageRecord);
      forgetPageToolsPending(page.id);
      setPending(null);
      callbacks.current.onMutationPending?.(false);
      setNotice(
        value.kind === 'save-template'
          ? '현재 페이지를 템플릿으로 저장했어요.'
          : value.kind === 'move'
            ? '선택한 블록을 이동했어요.'
            : value.kind === 'restore'
              ? '수정본을 새 버전으로 복원했어요.'
              : '저장했어요.',
      );
      setConfirmRestore(false);
      setReload((count) => count + 1);
      publishRecordChange('page-tools-' + value.kind);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : '저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
        );
        setDefinitive(cause instanceof PageToolsResponseError && cause.definitive);
        setUploadFilesPresent(hasPageAssetFiles(value));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function move() {
    if (locked || inFlight.current || !target || !selection.length) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    submit.current = controller;
    try {
      const currentTarget = await readCurrentPage(target.id, controller.signal);
      if (!mounted.current || controller.signal.aborted || blocked.current) return;
      inFlight.current = false;
      await execute(
        createPageToolsPending('move', page.id, {
          expectedVersion: page.version,
          targetPageId: currentTarget.id,
          targetVersion: currentTarget.version,
          blockIds: selection,
        }),
      );
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : '이동할 페이지를 확인하지 못했어요. 다시 시도해 주세요.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function removeTemplate() {
    if (locked || inFlight.current || !deleteId) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    submit.current = controller;
    try {
      await deletePageTemplate(deleteId, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setDeleteId('');
      setNotice('템플릿을 삭제했어요.');
      setReload((count) => count + 1);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : '삭제 여부를 확인하지 못했어요. 같은 템플릿을 다시 확인해 주세요.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function dismissFailure() {
    if (!definitive || busy) return;
    try {
      forgetPageToolsPending(page.id);
      setPending(null);
      setDefinitive(false);
      setError('');
      callbacks.current.onMutationPending?.(false);
    } catch {
      setError('제출 정보를 지우지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
    }
  }
  async function recoverFiles(files: File[]) {
    if (!pending || busy || disabled || !files.length) return;
    setBusy(true);
    try {
      await restorePageAssetFiles(pending, files);
      if (!mounted.current) return;
      setUploadFilesPresent(true);
      setError('');
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : '첨부 파일을 확인하지 못했어요. 다시 선택해 주세요.',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <PageInspector title={titles[mode]} onClose={onClose} className="page-tools-inspector">
      <div className="page-tools-panel" aria-busy={busy}>
        {disabled && (
          <p className="page-tools-hint" role="status">
            페이지 저장이나 초안 복구를 마친 뒤 사용할 수 있어요.
          </p>
        )}
        {restored.error && (
          <p className="page-tools-error" role="alert">
            {restored.error}
          </p>
        )}
        {pending && (
          <section className="page-tools-pending" aria-label="제출한 요청 확인">
            <strong>{pendingLabels[pending.kind]} 확인</strong>
            <p>
              {busy
                ? '저장 여부를 확인하는 중…'
                : definitive
                  ? '요청이 거절된 것을 확인했어요. 닫은 뒤 최신 내용으로 다시 시도하세요.'
                  : '처음 제출한 요청을 보관하고 있어요. 같은 요청으로 저장 여부를 확인하세요.'}
            </p>
            {pending.kind === 'assets' && !uploadFilesPresent && (
              <label className="page-tools-file-picker">
                처음 선택한 첨부 다시 선택
                <input
                  type="file"
                  multiple
                  disabled={busy || disabled}
                  onChange={(event) => {
                    void recoverFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
              </label>
            )}
            {definitive ? (
              <button type="button" disabled={busy} onClick={dismissFailure}>
                확인된 실패 닫기
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || disabled || !uploadFilesPresent}
                onClick={() => void execute(pending)}
              >
                {busy ? '확인 중…' : '같은 요청 다시 확인'}
              </button>
            )}
          </section>
        )}
        {error && (
          <p className="page-tools-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="page-tools-success" role="status">
            {notice}
          </p>
        )}
        {listError && (
          <div className="page-tools-error" role="alert">
            <p>{listError}</p>
            <button type="button" disabled={busy} onClick={() => setReload((count) => count + 1)}>
              다시 불러오기
            </button>
          </div>
        )}
        {loading && (
          <div className="page-tools-loading" role="status">
            <span>목록 불러오는 중…</span>
            <div />
            <div />
          </div>
        )}

        {mode === 'templates' && (
          <>
            <section className="page-tools-section">
              <h3>템플릿으로 새 페이지</h3>
              <p className="page-tools-hint">저장한 제목과 본문으로 새 페이지를 만듭니다.</p>
              {!loading && !listError && !templates.length && (
                <p className="page-tools-empty">
                  저장한 템플릿이 없어요. 아래에서 현재 페이지를 저장하세요.
                </p>
              )}
              {templates.length > 0 && !listError && (
                <>
                  <label className="page-tools-field" htmlFor={uid + '-template'}>
                    <span id={uid + '-template-label'}>템플릿</span>
                    <select
                      id={uid + '-template'}
                      aria-labelledby={uid + '-template-label'}
                      value={templateId}
                      disabled={locked || loading}
                      onChange={(event) => {
                        setTemplateId(event.target.value);
                        setDeleteId('');
                      }}
                    >
                      {templates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="page-tools-field" htmlFor={uid + '-parent'}>
                    <span id={uid + '-parent-label'}>만들 위치</span>
                    <select
                      id={uid + '-parent'}
                      aria-labelledby={uid + '-parent-label'}
                      value={parentId}
                      disabled={locked}
                      onChange={(event) => setParentId(event.target.value)}
                    >
                      <option value="">내 페이지</option>
                      {pages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title || '제목 없음'} 아래
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="page-tools-actions">
                    <button
                      type="button"
                      className="page-tools-primary"
                      disabled={locked || !selectedTemplate}
                      onClick={() =>
                        void execute(
                          createPageToolsPending('create-template-page', page.id, {
                            templateId,
                            ...(parentId ? { parentId } : {}),
                          }),
                        )
                      }
                    >
                      <FilePlus2 size={15} />새 페이지 만들기
                    </button>
                    <button
                      type="button"
                      aria-label={`템플릿 ${selectedTemplate?.name || ''} 삭제`}
                      disabled={locked || !selectedTemplate}
                      onClick={() => setDeleteId(templateId)}
                    >
                      <Trash2 size={15} />
                      삭제
                    </button>
                  </div>
                  {deleteId && (
                    <div className="page-tools-confirm">
                      <p>이 템플릿을 삭제할까요? 이미 만든 페이지는 유지됩니다.</p>
                      <div className="page-tools-actions">
                        <button type="button" disabled={busy} onClick={() => setDeleteId('')}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="page-tools-destructive"
                          disabled={locked}
                          onClick={() => void removeTemplate()}
                        >
                          템플릿 삭제
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
            <section className="page-tools-section">
              <h3>현재 페이지를 템플릿으로 저장</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!locked && templateName.trim())
                    void execute(
                      createPageToolsPending('save-template', page.id, {
                        pageId: page.id,
                        expectedVersion: page.version,
                        name: templateName.trim(),
                      }),
                    );
                }}
              >
                <label className="page-tools-field" htmlFor={uid + '-name'}>
                  템플릿 이름
                  <input
                    id={uid + '-name'}
                    type="text"
                    maxLength={160}
                    value={templateName}
                    disabled={locked}
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={locked || !templateName.trim()}>
                  <Save size={15} />
                  템플릿 저장
                </button>
              </form>
              <p className="page-tools-hint">
                현재 제목·아이콘·본문을 보관합니다. 하위 페이지는 포함하지 않아요.
              </p>
            </section>
          </>
        )}

        {mode === 'move' && (
          <section className="page-tools-section">
            <p className="page-tools-selection">
              선택한 블록 <strong>{selection.length}개</strong>
            </p>
            <p className="page-tools-hint">
              선택한 블록과 그 안의 하위 블록을 다른 페이지의 본문 끝으로 옮깁니다.
            </p>
            {!selection.length && (
              <p className="page-tools-empty">
                본문에서 옮길 블록을 선택한 뒤 이 도구를 열어 주세요.
              </p>
            )}
            <label className="page-tools-field" htmlFor={uid + '-target'}>
              <span id={uid + '-target-label'}>이동할 페이지</span>
              <select
                id={uid + '-target'}
                aria-labelledby={uid + '-target-label'}
                value={targetId}
                disabled={locked || !selection.length}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">페이지 선택</option>
                {pages
                  .filter((item) => item.id !== page.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || '제목 없음'}
                    </option>
                  ))}
              </select>
            </label>
            {pages.length < 2 && (
              <p className="page-tools-hint">먼저 블록을 받을 다른 페이지를 만들어 주세요.</p>
            )}
            <button
              type="button"
              className="page-tools-primary"
              disabled={locked || !selection.length || !target}
              onClick={() => void move()}
            >
              <ArrowRight size={15} />
              {busy ? '이동 확인 중…' : '선택 블록 이동'}
            </button>
          </section>
        )}

        {mode === 'history' && !loading && !listError && (
          <section className="page-tools-section">
            <p className="page-tools-hint">
              최근 100개 수정본을 확인하고 제목·아이콘·본문을 복원할 수 있어요.
            </p>
            {!revisions.length ? (
              <p className="page-tools-empty">저장한 수정 이력이 없어요.</p>
            ) : (
              <>
                <label className="page-tools-field" htmlFor={uid + '-revision'}>
                  <span id={uid + '-revision-label'}>수정본</span>
                  <select
                    id={uid + '-revision'}
                    aria-labelledby={uid + '-revision-label'}
                    value={revisionVersion}
                    disabled={busy || Boolean(pending)}
                    onChange={(event) => setRevisionVersion(Number(event.target.value))}
                  >
                    {revisions.map((item) => (
                      <option key={item.version} value={item.version}>
                        v{item.version}
                        {item.version === page.version ? ' · 현재' : ''} ·{' '}
                        {formatKoreanTime(item.createdAt)}
                      </option>
                    ))}
                  </select>
                </label>
                {previewLoading && (
                  <p className="page-tools-hint" role="status">
                    수정본 내용 불러오는 중…
                  </p>
                )}
                {previewError && (
                  <div className="page-tools-error" role="alert">
                    <p>{previewError}</p>
                    <button type="button" onClick={() => setPreviewReload((count) => count + 1)}>
                      내용 다시 불러오기
                    </button>
                  </div>
                )}
                {revision && (
                  <>
                    <div className="page-revision-view" role="group" aria-label="수정본 보기 방식">
                      <button
                        type="button"
                        aria-pressed={historyView === 'compare'}
                        onClick={() => setHistoryView('compare')}
                      >
                        현재와 비교
                      </button>
                      <button
                        type="button"
                        aria-pressed={historyView === 'snapshot'}
                        onClick={() => setHistoryView('snapshot')}
                      >
                        수정본 전체
                      </button>
                    </div>
                    {historyView === 'compare' ? (
                      <RevisionComparison revision={revision} page={page} />
                    ) : (
                      <article
                        className="page-tools-preview"
                        aria-label={`수정본 v${revision.version} 읽기 전용 내용`}
                      >
                        <h3>
                          {revision.icon && <span aria-hidden="true">{revision.icon} </span>}
                          {revision.title || '제목 없음'}
                        </h3>
                        <p className="page-tools-preview-meta">
                          v{revision.version} · {formatKoreanTime(revision.createdAt)}
                        </p>
                        <SavedDocument document={revision.document} />
                      </article>
                    )}
                    {revision.version === page.version ? (
                      <p className="page-tools-hint">현재 저장된 수정본입니다.</p>
                    ) : (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setConfirmRestore(true)}
                      >
                        <RotateCcw size={15} />이 수정본 복원
                      </button>
                    )}
                    {confirmRestore && (
                      <div className="page-tools-confirm">
                        <p>
                          현재 제목·아이콘·본문을 v{revision.version}으로 바꿀까요? 새 버전으로
                          저장하며 현재 페이지 위치는 유지합니다.
                        </p>
                        <div className="page-tools-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmRestore(false)}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className="page-tools-primary"
                            disabled={locked}
                            onClick={() =>
                              void execute(
                                createPageToolsPending('restore', page.id, {
                                  revisionVersion: revision.version,
                                  expectedVersion: page.version,
                                }),
                              )
                            }
                          >
                            확인하고 복원
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </PageInspector>
  );
}
