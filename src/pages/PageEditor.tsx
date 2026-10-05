import { useOnlineAction } from '../sync/onlineActions';
import { workspaceFetch } from '../sync/runtime';
import { useLocalPage, persistLocalPage, enqueueLocalPage } from './useLocalPage';
import { registerLocalFlush } from '../offline/update';
import ConflictPanel from '../sync/ConflictPanel';
import OfflinePageControl from '../offline/OfflinePageControl';
import {
  Fragment,
  lazy,
  Suspense,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BlockNoteSchema,
  combineByGroup,
  createExtension,
  defaultBlockSpecs,
  SideMenuExtension,
} from '@blocknote/core';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { ko } from '@blocknote/core/locales';
import {
  createReactDiagramBlockSpec,
  getDiagramSlashMenuItems,
  locales as diagramLocales,
} from '@blocknote/diagram-block';
import { BlockNoteView } from '@blocknote/mantine';
import {
  BlockColorsItem,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  GridSuggestionMenuController,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useEditorState,
  usePortalElement,
  useExtension,
  useExtensionState,
} from '@blocknote/react';
import { redoDepth, undoDepth } from 'prosemirror-history';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  Check,
  Clipboard,
  Code2,
  Copy,
  ChevronRight,
  Download,
  Info,
  FileText,
  List,
  Link2,
  MessageCircle,
  MoreHorizontal,
  History,
  FolderInput,
  Paperclip,
  LayoutTemplate,
  Plus,
  Redo2,
  RotateCcw,
  Share2,
  Star,
  Smile,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import RecordTimestamps from '../RecordTimestamps';
import { usePageWorkspace } from './workspaceNavigation';
import { PAGE_OUTLINE_EVENT } from '../search/commands';
import TrashAction from '../trash/TrashAction';
import type { TrashEntry } from '../trash/types';
import PageIconPicker from './PageIconPicker';
import PageCommentPreview from './PageCommentPreview';
import { PlanConnectionsProvider, hasItineraryBlocks } from './PlanConnectionsContext';
import { MapImageContext } from './MapImageControls';
import PlanOrphanConnections, { openPlanConnectionManager } from './PlanOrphanConnections';
import { markCommentThreadRead } from '../comments/api';
import type { PreviewThread } from './pageComments';
import PageCommentGutter from './PageCommentGutter';
import PageInspector from './PageInspector';
import PageOutline from './PageOutline';
import PageMaterialsPanel from './PageMaterialsPanel';
import { serializePageDocument } from '../../shared/pageValidation.mjs';
import type { DocumentBlueprintPayload } from '../../shared/documentBlueprints';
const DocumentBlueprintPicker = lazy(() => import('./DocumentBlueprintPicker'));
import { createMapBlockSpec } from './MapBlock';
import { createItineraryBlockSpec } from './ItineraryBlock';
import {
  listCommentableBlocks,
  listSharedCommentableBlocks,
  type CommentSummary,
} from './pageComments';
import { PageNavContext } from './pageNav';
import { createPageLinkBlockSpec, getPageLinkSlashMenuItems } from './PageLinkBlock';
import { createBookmarkBlockSpec, refreshBookmark } from './BookmarkBlock';
import { createCalloutBlockSpec, getCalloutSlashMenuItems } from './CalloutBlock';
import UrlPasteChoice from './UrlPasteChoice';
import { webBookmarkUrl } from '../../shared/bookmarks';
import { parsePageLink, pageLinkAddress } from '../../shared/pageLinks';
import { createCaptureRefBlockSpec } from './CaptureRefBlock';
import { createAssetBlockSpec } from './AssetBlock';
import { createTableOfContentsBlockSpec, getTableOfContentsSlashMenuItems } from './TocBlock';
import type { PageDocument, PageRecord, PageSummary } from './types';
import { editablePageBlocks, preserveLegacyCaptureRefs } from '../../shared/pageDocuments';
import { recoverPageAiPending } from '../ai/pageSubmission';
import { renderPageMarkdown } from '../../shared/pageMarkdown';
import { publishRecordChange } from '../trash/events';
import {
  createDuplicatePending,
  createPageToolsPending,
  createPageAssetPending,
  executePageToolsPending,
  recoverPageToolsPending,
  forgetPageToolsPending,
  restorePageAssetFiles,
  hasPageAssetFiles,
  readCurrentPage,
  PageToolsResponseError,
} from './pageToolsApi';
import type { PageToolsPending } from './pageToolsApi';
import '@blocknote/mantine/style.css';
import './pageWorkspace.css';

const PageAiPanel = lazy(() => import('./PageAiPanel'));
const PageOrigins = lazy(() => import('./PageOrigins'));
const PageSharePanel = lazy(() => import('./PageSharePanel'));
const AssetOcr = lazy(() => import('../ocr/AssetOcr'));
function hasOcrAsset(blocks: any[], assetId: string): boolean {
  return blocks.some(
    (block) =>
      (block.type === 'asset' && block.props?.assetId === assetId) ||
      hasOcrAsset(block.children || [], assetId),
  );
}
const PageToolsPanel = lazy(() => import('./PageToolsPanel'));

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
    diagram: createReactDiagramBlockSpec(),
    tableOfContents: createTableOfContentsBlockSpec(),
    page: createPageLinkBlockSpec(),
    captureRef: createCaptureRefBlockSpec(),
    asset: createAssetBlockSpec(),
    map: createMapBlockSpec(),
    itinerary: createItineraryBlockSpec(),
    bookmark: createBookmarkBlockSpec(),
    callout: createCalloutBlockSpec(),
  },
});

// 노션처럼 `>`는 접을 수 있는 목록, `"`는 인용으로 바꿉니다.
// 기본 `>` 인용 규칙은 quote-block-shortcuts를 꺼서 제거합니다.
const notionInputShortcuts = createExtension({
  key: 'notion-input-shortcuts',
  inputRules: [
    {
      find: /^>\s$/,
      replace: () => ({ type: 'toggleListItem', props: {} }),
    },
    {
      find: /^\p{Quotation_Mark}\s$/u,
      replace: () => ({ type: 'quote', props: {} }),
    },
  ],
  keyboardShortcuts: {
    'Mod-Alt-q': ({ editor }) => {
      const { block } = editor.getTextCursorPosition();
      return (
        editor.schema.blockSchema[block.type].content === 'inline' &&
        (editor.updateBlock(block, { type: 'quote', props: {} }), true)
      );
    },
  },
});

type Draft = { title: string; icon?: string; document: PageDocument; baseVersion: number };
type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

function PageFormattingToolbar(props: React.ComponentProps<typeof FormattingToolbar>) {
  const editor = useBlockNoteEditor<any, any, any>();
  const bookmarkSelected = useEditorState({
    editor,
    selector: ({ editor }) => {
      const blocks = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block];
      return blocks.length === 1 && blocks[0].type === 'bookmark';
    },
  });
  // The stock toolbar treats any URL property as a file. Bookmark actions live on the card.
  return bookmarkSelected ? null : <FormattingToolbar {...props} />;
}

function draftKey(id: string) {
  return `leneu:page-draft:${id}`;
}

function NestMenuItem() {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });
  if (!components || !block || !editor.getPrevBlock(block)) return null;
  return (
    <components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        editor.setTextCursorPosition(block.id);
        if (editor.canNestBlock()) editor.nestBlock();
      }}
    >
      들여쓰기
    </components.Generic.Menu.Item>
  );
}

function UnnestMenuItem() {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });
  if (!components || !block || !editor.getParentBlock(block)) return null;
  return (
    <components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        editor.setTextCursorPosition(block.id);
        if (editor.canUnnestBlock()) editor.unnestBlock();
      }}
    >
      내어쓰기
    </components.Generic.Menu.Item>
  );
}

function PageSideMenu(props: { dragHandleMenu?: React.ComponentType }) {
  const dictionary = useDictionary();
  return (
    <SideMenu
      {...props}
      dragHandleMenu={(menuProps) => <PageDragHandleMenu {...menuProps} dictionary={dictionary} />}
    />
  );
}

function PageBlockActions() {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, { selector: state => state?.block });
  const portalElement = usePortalElement();
  if (!components || !block) return null;
  const clone = (value: any): any => ({ ...structuredClone(value), id: crypto.randomUUID(), children: (value.children || []).map(clone) });
  const textTypes = ['paragraph','heading','bulletListItem','numberedListItem','checkListItem','toggleListItem','quote'];
  return <>
    <components.Generic.Menu.Item className="bn-menu-item" onClick={()=>{ const [copy] = editor.insertBlocks([clone(block)],block,'after');if(Array.isArray(copy.content))editor.setTextCursorPosition(copy.id);editor.focus(); }}>블록 복제</components.Generic.Menu.Item>
    {textTypes.includes(block.type) && <components.Generic.Menu.Root position="right" sub={true} portalElement={portalElement}>
      <components.Generic.Menu.Trigger sub={true}><components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>블록 유형 변경</components.Generic.Menu.Item></components.Generic.Menu.Trigger>
      <components.Generic.Menu.Dropdown sub={true}>{[
        {label:'텍스트',type:'paragraph'}, {label:'제목 1',type:'heading',level:1}, {label:'제목 2',type:'heading',level:2}, {label:'제목 3',type:'heading',level:3},
        {label:'글머리 목록',type:'bulletListItem'}, {label:'번호 목록',type:'numberedListItem'}, {label:'체크리스트',type:'checkListItem'}, {label:'접는 목록',type:'toggleListItem'}, {label:'인용',type:'quote'},
      ].map(item=><components.Generic.Menu.Item className="bn-menu-item" key={item.label} onClick={()=>{editor.updateBlock(block,{type:item.type,props:item.level?{level:item.level}:{}} as any);editor.setTextCursorPosition(block.id);editor.focus();}}>{item.label}</components.Generic.Menu.Item>)}</components.Generic.Menu.Dropdown>
    </components.Generic.Menu.Root>}
  </>;
}

// 손잡이 메뉴가 열린 동안 대상 블록 전체를 옅게 강조합니다.
// ProseMirror가 관리하는 DOM(블록 요소)을 직접 바꾸면 노드가 다시 렌더링되어
// 사이드 메뉴가 깨지므로, 대신 head에 일시 스타일 규칙을 주입합니다.
function PageDragHandleMenu({
  dictionary,
  ...menuProps
}: {
  dictionary?: ReturnType<typeof useDictionary>;
} & Parameters<typeof DragHandleMenu>[0]) {
  const sideMenu = useExtension(SideMenuExtension);
  const blockId = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block?.id,
  });
  const menuOpen = useExtensionState(SideMenuExtension, {
    selector: () => {
      try {
        return sideMenu.menuFrozen;
      } catch {
        return false;
      }
    },
  });
  useEffect(() => {
    if (!menuOpen || !blockId) return;
    const style = document.createElement('style');
    style.dataset.pageBlockMenuHighlight = '';
    style.textContent = `.page-block-editor .bn-block-outer[data-id="${blockId}"] > .bn-block { background-color: #78917d26; border-radius: 8px; }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [menuOpen, blockId]);
  return (
    <DragHandleMenu {...menuProps}>
      <PageBlockActions />
      <RemoveBlockItem>{dictionary?.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dictionary?.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dictionary?.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>
        {dictionary?.drag_handle.header_column_menuitem}
      </TableColumnHeaderItem>
      <NestMenuItem />
      <UnnestMenuItem />
    </DragHandleMenu>
  );
}

function savedDraft(page: PageRecord): Draft | null {
  try {
    const value = localStorage.getItem(draftKey(page.id));
    if (!value) return null;
    const draft = JSON.parse(value) as Draft;
    return draft?.document?.schemaVersion === 1 && Array.isArray(draft.document.blocks)
      ? draft
      : null;
  } catch {
    return null;
  }
}

export default function PageEditor({
  page,
  pages,
  onSaved,
  theme,
  childCount,
  onTrashed,
  toolbarTarget,
}: {
  page: PageRecord;
  pages: PageSummary[];
  onSaved: (page: PageRecord) => void;
  theme: 'light' | 'dark';
  childCount: number;
  onTrashed: (entry: TrashEntry) => void;
  toolbarTarget: HTMLElement | null;
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: editablePageBlocks(page.document.blocks).length
      ? (editablePageBlocks(page.document.blocks) as any)
      : undefined,
    dictionary: {
      ...ko,
      diagram: diagramLocales.ko,
    },
    disableExtensions: ['quote-block-shortcuts'],
    extensions: [notionInputShortcuts],
  });
  const [urlPaste, setUrlPaste] = useState<{url:string;blockId:string;pageId?:string} | null>(null);
  const [bookmarkNotice, setBookmarkNotice] = useState('');
  const editorAlive = useRef(true);
  useEffect(() => { editorAlive.current = true; return () => { editorAlive.current = false; }; }, []);
  async function chooseUrlPaste(kind: 'link' | 'bookmark' | 'page') {
    const pending = urlPaste;
    setUrlPaste(null);
    if (!pending || !editor.isEditable) return;
    const target = editor.getBlock(pending.blockId);
    if (!target || target.type !== 'paragraph' || target.content?.length) { setBookmarkNotice('붙여넣을 위치가 변경되었어요. URL을 다시 붙여넣어 주세요.'); return; }
    if (kind === 'page' && pending.pageId) {
      setBookmarkNotice('페이지 링크를 확인하고 있어요…');
      let linkedPage: Pick<PageRecord, 'title'> | null = null;
      try {
        const response = await workspaceFetch(`/api/pages/${pending.pageId}`);
        if (response.ok) linkedPage = (await response.json()).item;
      } catch { /* A plain URL remains usable when the destination is unavailable. */ }
      if (!editorAlive.current || !editor.isEditable) return;
      const current = editor.getBlock(pending.blockId);
      if (!current || current.type !== 'paragraph' || current.content?.length) {
        setBookmarkNotice('붙여넣을 위치가 변경되었어요. URL을 다시 붙여넣어 주세요.');
        return;
      }
      if (linkedPage) {
        editor.updateBlock(current, {type:'page',props:{pageId:pending.pageId,title:linkedPage.title || '제목 없음'},content:undefined});
        setBookmarkNotice('페이지로 이동하는 링크를 넣었어요.');
        editor.focus();
        return;
      }
      setBookmarkNotice('페이지를 확인하지 못해 주소 링크로 넣었어요. 온라인에서 다시 열 수 있어요.');
      kind = 'link';
    }
    if (kind === 'link') {
      editor.updateBlock(target, {type:'paragraph',content:[{type:'link',href:pending.url,content:[{type:'text',text:pending.url,styles:{}}]}]});
      editor.setTextCursorPosition(target.id,'end');editor.focus();
      return;
    }
    editor.updateBlock(target, {type:'bookmark',props:{url:pending.url,title:new URL(pending.url).hostname,description:'',imageData:''},content:undefined});
    setBookmarkNotice(navigator.onLine ? '사이트 정보를 확인하고 있어요…' : '북마크를 기기에 저장했어요. 온라인에서 정보 새로고침을 누르세요.');
    if (navigator.onLine) void refreshBookmark(editor, target.id, pending.url)
      .then(applied=>setBookmarkNotice(applied ? '북마크 정보를 확인했어요.' : '편집 위치가 변경되어 북마크 정보 반영을 취소했어요.'))
      .catch(()=>setBookmarkNotice('사이트 정보를 불러오지 못했어요. 북마크 URL은 보존되어 있어요.'));
    editor.focus();
  }
  async function copyPageLink() {
    closePageMenu();
    try {
      await navigator.clipboard.writeText(pageLinkAddress(page.id, location.origin));
      setBookmarkNotice('페이지 링크를 복사했어요. 다른 문서에 붙여넣어 연결할 수 있어요.');
    } catch {
      setBookmarkNotice('링크를 복사하지 못했어요. 브라우저 주소창에서 페이지 주소를 복사해 주세요.');
    }
  }
  const history = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: undoDepth(editor.prosemirrorState) > 0,
      canRedo: redoDepth(editor.prosemirrorState) > 0,
    }),
  });
  const localPage = useLocalPage(page.id);
  const onlineReason=useOnlineAction('page',page.id);
  const basePage = useRef(page);
  const editorRevision=useRef(page.localRevision??0);
  const [localSaveError,setLocalSaveError]=useState('');
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitPromise = useRef<Promise<void> | null>(null);
  const committedRevision = useRef(0);
  const [title, setTitle] = useState(page.title === '제목 없음' ? '' : page.title);
  const [icon, setIcon] = useState(page.icon || '');
  const [savedAt, setSavedAt] = useState(page.updatedAt);
  const [iconOpen, setIconOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [trashPending, setTrashPending] = useState(false);
  const [savedPage, setSavedPage] = useState(page);
  const [aiOpen, setAiOpen] = useState(() =>
    new URLSearchParams(window.location.search).has('aiJob'),
  );
  const [infoOpen, setInfoOpen] = useState(false);
  const [pageInfoExpanded, setPageInfoExpanded] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);
  const [materialFeedback, setMaterialFeedback] = useState('');
  const [view, setView] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('leneu:page-view') || '{}');
      return { wide: stored?.wide === true, smallText: stored?.smallText === true };
    } catch {
      return { wide: false, smallText: false };
    }
  });
  const infoMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('leneu:page-view', JSON.stringify(view));
    } catch {}
  }, [view]);
  useEffect(() => {
    if (!infoOpen) return;
    const outside = (event: PointerEvent) => {
      if (!infoMenu.current?.contains(event.target as Node)) closePageMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePageMenu();
        infoMenu.current?.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [infoOpen]);
  const [shareOpen, setShareOpen] = useState(false);
  const [toolsPending, setToolsPending] = useState<PageToolsPending | null>(() => {
    try {
      return recoverPageToolsPending(page.id);
    } catch {
      return null;
    }
  });
  const [toolsBusy, setToolsBusy] = useState(false);
  const [toolsStorageError, setToolsStorageError] = useState(() => {
    try {
      recoverPageToolsPending(page.id);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '제출 정보를 읽지 못했어요.';
    }
  });
  const [toolsError, setToolsError] = useState(toolsStorageError);
  const [toolsDefinitive, setToolsDefinitive] = useState(false);
  const [editingItineraries, setEditingItineraries] = useState<Set<string>>(() => new Set());
  useLayoutEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId: string; editing: boolean }>).detail;
      if (!detail) return;
      setEditingItineraries((previous) => {
        const next = new Set(previous);
        if (detail.editing) next.add(detail.blockId);
        else next.delete(detail.blockId);
        return next;
      });
    };
    window.addEventListener('leneu:itinerary-editing', listener);
    return () => window.removeEventListener('leneu:itinerary-editing', listener);
  }, []);
  const itineraryEditing = editingItineraries.size > 0;
  const [toolsMode, setToolsMode] = useState<'templates' | 'move' | 'history' | null>(null);
  const [toolSelectionIds, setToolSelectionIds] = useState<string[]>([]);
  const [moveSelectionIds, setMoveSelectionIds] = useState<string[]>([]);
  const pageFileInput = useRef<HTMLInputElement>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [aiPending, setAiPending] = useState(() => {
    try {
      const pending = recoverPageAiPending(page.id);
      return Boolean(pending && pending.kind !== 'request');
    } catch {
      return true;
    }
  });
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const requestedCommentThread = new URLSearchParams(window.location.search).get('commentThread');
  const requestedCommentBlock = new URLSearchParams(window.location.search).get('commentBlock');
  const handledCommentLink = useRef('');
  const [commentReadError, setCommentReadError] = useState('');
  const viewedReceipts = useRef(new Set<string>());
  const readInflight = useRef(new Set<string>());
  const pendingRead = useRef<{ threadId: string; lastGuestMessageId: string } | null>(null);
  const readAbort = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    readAbort.current = controller;
    return () => controller.abort();
  }, []);
  const [commentPreviewOpen, setCommentPreviewOpen] = useState(false);
  const [commentListOpen, setCommentListOpen] = useState(false);
  const [commentAudience, setCommentAudience] = useState<'private' | 'shared'>('private');
  const [selectedCommentBlockId, setSelectedCommentBlockId] = useState<string | null>(null);
  const [hoveredCommentBlockId, setHoveredCommentBlockId] = useState<string | null>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Menus and comment forms operate on the selected block; blank canvas does not.
      if (
        target.closest(
          '.page-document-actions, .page-selection-tools, .page-comment-panel, .page-inspector, [role="dialog"], [role="menu"], [role="listbox"], .bn-side-menu, .bn-toolbar',
        )
      )
        return;
      if (!target.closest('.bn-block-outer[data-id], .page-comment-gutter-button')) {
        setSelectedCommentBlockId(null);
        setHoveredCommentBlockId(null);
        setSelectionIds([]);
        setToolSelectionIds([]);
      }
      const selection = editor.prosemirrorState.selection;
      if (!(selection instanceof NodeSelection)) return;
      const selectedNode = editor.prosemirrorView.nodeDOM(selection.from);
      if (selectedNode?.contains(target)) return;
      editor.transact((transaction) => {
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(selection.from), -1));
      });
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editor]);
  const [commentSummaries, setCommentSummaries] = useState<CommentSummary[]>([]);
  const summaryEpoch = useRef(0);
  const receiveCommentSummary = useCallback((items: CommentSummary[]) => {
    ++summaryEpoch.current;
    setCommentSummaries(items);
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      epoch = ++summaryEpoch.current;
    setCommentSummaries([]);
    void fetch(
      `/api/pages/${page.id}/${commentAudience === 'shared' ? 'shared-comments' : 'comments'}?view=summary`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (!controller.signal.aborted && epoch === summaryEpoch.current)
          setCommentSummaries(data.items);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [page.id, commentAudience]);
  const [markdownSource, setMarkdownSource] = useState('');
  const [recovery, setRecovery] = useState<Draft | null>(() => savedDraft(page));
  const [copied, setCopied] = useState(false);
  const titleField = useRef<HTMLTextAreaElement>(null);
  const commentEditorRef = useRef<HTMLDivElement>(null);
  const endSpacePointer = useRef<{ x: number; y: number } | null>(null);
  const iconArea = useRef<HTMLDivElement>(null);
  const latest = useRef<Draft>({
    title: page.title,
    icon: page.icon,
    document: page.document,
    baseVersion: page.version,
  });
  const version = useRef(page.version);
  const blockSnapshot = useRef(JSON.stringify(editor.document));
  const changes = useRef(0);
  const saving = useRef(false);
  const conflicted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawDocument = useRef(page.document);
  const applying = useRef(false);
  const navigate = useContext(PageNavContext);
  const workspaceNavigation = usePageWorkspace();
  const importedBlockId = new URLSearchParams(window.location.search).get('import');
  const hasReferences = JSON.stringify(editor.document).includes('"type":"asset"');
  const toolsLocked = toolsBusy || Boolean(toolsPending) || Boolean(toolsStorageError);
  const mutationLocked = aiPending || toolsLocked;
  const toolsDisabled =
    Boolean(onlineReason) ||
    itineraryEditing ||
    status !== 'saved' ||
    Boolean(recovery) ||
    trashPending ||
    aiPending ||
    commentPreviewOpen ||
    markdownOpen;
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent<{ pageId: string }>).detail?.pageId !== page.id) return;
      setAiOpen(false);
      setShareOpen(false);
      setCommentPreviewOpen(false);
      setToolsMode(null);
      setOutlineOpen(true); setMaterialsOpen(false);
      closePageMenu();
    };
    window.addEventListener(PAGE_OUTLINE_EVENT, open);
    return () => window.removeEventListener(PAGE_OUTLINE_EVENT, open);
  }, [page.id]);
  useLayoutEffect(() => {
    // BlockNote remounts the view when its editable prop changes. Keep AI locks
    // on the mounted instance so selection/toolbar measurements stay valid.
    editor.isEditable =
      !markdownOpen && !commentPreviewOpen && !recovery && !trashPending && !mutationLocked;
  }, [editor, markdownOpen, commentPreviewOpen, recovery, trashPending, mutationLocked]);

  function captureSelection() {
    // A collapsed text cursor is an editing position, not a selected block.
    // BlockNote excludes NodeSelection from getSelection(), so keep explicit
    // selections of image/card blocks without inventing one for normal typing.
    const selected =
      editor.getSelection()?.blocks ||
      (editor.prosemirrorState.selection instanceof NodeSelection
        ? [editor.getTextCursorPosition().block]
        : []);
    setToolSelectionIds(selected.map((block) => block.id));
    setSelectionIds(
      selected
        .filter((block) => !['captureRef', 'asset', 'page', 'tableOfContents'].includes(block.type))
        .map((block) => block.id),
    );
  }

  function isDocumentEndSpace(target: EventTarget | null, surface: HTMLElement, y: number) {
    const canvas = commentEditorRef.current;
    if (!(target instanceof Element) || !canvas) return false;
    // Only the editor's blank area and article padding accept this action.
    // Block contents, comments, menus and inspector controls keep their own clicks.
    if (target !== surface && !canvas.contains(target)) return false;
    if (
      target.closest(
        '.bn-block-outer, .page-comment-gutter, button, a, input, textarea, [role="menu"], [role="listbox"], .bn-toolbar, .bn-side-menu',
      )
    )
      return false;
    const last = canvas.querySelector('.bn-editor > .bn-block-group')?.lastElementChild;
    return Boolean(last && y >= last.getBoundingClientRect().bottom);
  }

  function focusDocumentEnd() {
    if (
      !editor.isEditable || markdownOpen || commentPreviewOpen || recovery ||
      trashPending || mutationLocked || itineraryEditing
    )
      return;
    const last = editor.document.at(-1);
    if (!last) return;
    const reusable = last.type === 'paragraph' && !last.content?.length && !last.children.length;
    const block = reusable
      ? last
      : editor.insertBlocks([{ type: 'paragraph', content: [], children: [] }], last, 'after')[0];
    setSelectedCommentBlockId(null);
    setHoveredCommentBlockId(null);
    setSelectionIds([]);
    setToolSelectionIds([]);
    editor.setTextCursorPosition(block.id, 'end');
    editor.focus();
  }
  useEffect(
    () =>
      editor.onSelectionChange(() => {
        if (document.activeElement?.closest('.page-block-editor')) {
          captureSelection();
          setHoveredCommentBlockId(editor.getTextCursorPosition().block.id);
        }
      }),
    [editor],
  );

  function acceptAiPage(item: PageRecord) {
    basePage.current=item;editorRevision.current=item.localRevision??localPage.record?.localRevision??editorRevision.current;
    if(localTimer.current)clearTimeout(localTimer.current);
    applying.current = true;
    if (timer.current) clearTimeout(timer.current);
    rawDocument.current = item.document;
    const blocks = editablePageBlocks(item.document.blocks);
    editor.replaceBlocks(
      editor.document,
      (blocks.length ? blocks : [{ type: 'paragraph', content: [] }]) as any,
    );
    blockSnapshot.current = JSON.stringify(editor.document);
    version.current = item.version;
    latest.current = {
      title: item.title,
      icon: item.icon,
      document: item.document,
      baseVersion: item.version,
    };
    setTitle(item.title === '제목 없음' ? '' : item.title);
    setIcon(item.icon);
    setSavedAt(item.updatedAt);
    setSavedPage(item);
    conflicted.current = false;
    localStorage.removeItem(draftKey(page.id));
    setStatus('saved');
    onSaved(item);
    applying.current = false;
  }

  function openTools(mode: 'templates' | 'move' | 'history') {
    if (mode === 'move') {
      // The explicitly opened move tool may act on the current block. Keep that
      // snapshot separate from the live selection shown above the document.
      setMoveSelectionIds(
        (editor.getSelection()?.blocks || [editor.getTextCursorPosition().block])
          .map((block) => block.id),
      );
    }
    setAiOpen(false);
    setOutlineOpen(false); setMaterialsOpen(false);
    setShareOpen(false);
    setCommentPreviewOpen(false);
    setToolsMode(mode);
    closePageMenu();
  }
  function toolMutationPending(pending: boolean) {
    try {
      setToolsPending(pending ? recoverPageToolsPending(page.id) : null);
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : '제출 정보를 확인해 주세요.');
    }
  }
  async function submitTool(pending: PageToolsPending) {
    setToolsBusy(true);
    setToolsPending(pending);
    setToolsError('');
    setToolsDefinitive(false);
    try {
      const result = await executePageToolsPending(pending);
      forgetPageToolsPending(page.id);
      setToolsPending(null);
      publishRecordChange('page-tools');
      if (pending.kind === 'duplicate') {
        navigate('/pages/' + result.item.id);
      } else acceptAiPage(result.item);
    } catch (error) {
      if (error instanceof PageToolsResponseError && error.definitive) setToolsDefinitive(true);
      setToolsError(
        error instanceof Error
          ? error.message
          : '저장 여부를 확인하지 못했어요. 같은 요청을 다시 확인해 주세요.',
      );
    } finally {
      setToolsBusy(false);
    }
  }
  async function attachPageFiles(files: File[]) {
    if (!files.length) return;
    if (
      files.length > 8 ||
      files.some((file) => file.size > 25 * 1024 * 1024) ||
      files.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024
    ) {
      setToolsError('파일은 8개, 개별 25MB, 전체 100MB까지 첨부할 수 있어요.');
      return;
    }
    setToolsBusy(true);
    try {
      if (toolsPending?.kind === 'assets') {
        await restorePageAssetFiles(toolsPending, files);
        await submitTool(toolsPending);
      } else if (!toolsDisabled && !toolsPending) {
        const pending = await createPageAssetPending(savedPage, files);
        await submitTool(pending);
      }
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : '첨부를 준비하지 못했어요.');
    } finally {
      setToolsBusy(false);
    }
  }

  function savedAiMarkdown(ids: string[]) {
    const selected = new Set(ids);
    function choose(blocks: any[]): any[] {
      return blocks.flatMap((block) =>
        selected.has(block.id) ? [block] : choose(block.children || []),
      );
    }
    function publicBlocks(blocks: any[]): any[] {
      return blocks.flatMap((block) =>
        ['captureRef', 'asset', 'page', 'tableOfContents'].includes(block.type)
          ? publicBlocks(block.children || [])
          : [{ ...block, children: publicBlocks(block.children || []) }],
      );
    }
    const source=(localPage.record?.current?.document?localPage.record.current:savedPage) as unknown as PageRecord;
    const blocks = publicBlocks(editablePageBlocks(source.document.blocks));
    return `${ids.length ? '' : '# ' + source.title + '\n\n'}${renderPageMarkdown(ids.length ? choose(blocks) : blocks)}`.trim();
  }

  useEffect(() => {
    if (trashPending) setIconOpen(false);
  }, [trashPending]);

  useEffect(() => {
    if (!importedBlockId) return;
    const timer = setTimeout(() => {
      const block = document.querySelector(`[data-id="${CSS.escape(importedBlockId)}"]`);
      block?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, 100);
    if (page.title === '제목 없음') titleField.current?.focus();
    return () => clearTimeout(timer);
  }, [importedBlockId]);

  // parentId를 따라 올라가 상위 경로를 만듭니다. 끊어진 상위나 순환은 무시합니다.
  const crumbs = useMemo(() => {
    const byId = new Map(pages.map((item) => [item.id, item]));
    const chain: PageSummary[] = [];
    const seen = new Set([page.id]);
    let parentId = page.parentId;
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return chain.length > 3
      ? ([chain[0], null, ...chain.slice(-2)] as (PageSummary | null)[])
      : (chain as (PageSummary | null)[]);
  }, [pages, page.id, page.parentId]);

  useLayoutEffect(() => {
    const field = titleField.current;
    if (!field) return;
    const fitTitle = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };
    fitTitle();
    window.addEventListener('resize', fitTitle);
    return () => window.removeEventListener('resize', fitTitle);
  }, [title]);

  function queueSave(next: Draft) {
    latest.current = next;
    changes.current += 1;
    try { localStorage.setItem(draftKey(page.id), JSON.stringify(next)); } catch { /* IDB commit below owns success */ }
    setStatus('saving');
    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => {void saveLatest().catch(()=>{});}, 250);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveLatest().then(() => enqueueLocalPage(page.id)).catch(() => {}); }, 750);
  }

  function saveLatest(): Promise<void> {
    if (commitPromise.current) return commitPromise.current.then(() => committedRevision.current < changes.current ? saveLatest() : undefined);
    if (committedRevision.current === changes.current) return Promise.resolve();
    const snapshot = latest.current, snapshotChange = changes.current;
    saving.current = true;
    const commit = (async () => {
      try {
        const item = await persistLocalPage(page.id, {...snapshot,icon:snapshot.icon??''}, basePage.current,editorRevision.current);
        editorRevision.current=item.localRevision??editorRevision.current;setLocalSaveError('');
        committedRevision.current = snapshotChange;
        rawDocument.current = item.document;
        setSavedPage(item);
        setSavedAt(item.updatedAt);
        onSaved(item);
        if (snapshotChange === changes.current) {
          try { localStorage.removeItem(draftKey(page.id)); } catch {}
          setStatus('saved');
        }
      } catch (error) {
        setStatus('error');setLocalSaveError(error instanceof Error?error.message:'기기에 저장하지 못했어요.');
        throw error;
      } finally { saving.current = false; commitPromise.current = null; }
    })();
    commitPromise.current = commit;
    return commit;
  }
  useEffect(() => {
    const flush = async () => { await saveLatest(); await enqueueLocalPage(page.id); };
    const unregister = registerLocalFlush(flush);
    const hidden = () => { if(document.visibilityState==='hidden')void flush().catch(()=>{}); };
    document.addEventListener('visibilitychange',hidden);
    return () => { unregister(); document.removeEventListener('visibilitychange',hidden); if(localTimer.current)clearTimeout(localTimer.current); if(timer.current)clearTimeout(timer.current); void flush().catch(()=>{}); };
  }, [page.id]);
  useEffect(() => {
    const current = localPage.record?.current;
    if(!current || localPage.record?.dirty || status !== 'saved')return;
    if(current.title === (latest.current.title.trim() || '제목 없음') && JSON.stringify(current.document) === JSON.stringify(latest.current.document)) {
      const acknowledged=current as unknown as PageRecord;
      version.current=acknowledged.version; basePage.current=acknowledged; setSavedPage(acknowledged); setSavedAt(acknowledged.updatedAt);
    }
  }, [localPage.record, status]);

  function editTitle(value: string) {
    setTitle(value);
    queueSave({ ...latest.current, title: value, baseVersion: version.current });
  }

  function editIcon(value: string) {
    setIcon(value);
    queueSave({ ...latest.current, icon: value, baseVersion: version.current });
  }

  function editBlocks() {
    if (applying.current) return;
    const nextSnapshot = JSON.stringify(editor.document);
    if (nextSnapshot === blockSnapshot.current) return;
    blockSnapshot.current = nextSnapshot;
    queueSave({
      ...latest.current,
      document: {
        schemaVersion: 1,
        blocks: preserveLegacyCaptureRefs(rawDocument.current.blocks, editor.document as unknown[]),
      },
      baseVersion: version.current,
    });
  }

  const insertionLocked = markdownOpen || commentPreviewOpen || Boolean(recovery) || trashPending ||
    mutationLocked || itineraryEditing || status === 'conflict' || status === 'error' || Boolean(localPage.conflict);
  const blankDocument = editor.document.every((block) => block.type === 'paragraph' &&
    !block.children.length && (!block.content || (Array.isArray(block.content) && block.content.length === 0)));

  function insertMaterial(markdown: string) {
    if (insertionLocked || conflicted.current || !editor.isEditable) throw new Error('현재 편집 상태를 확인한 뒤 다시 넣어 주세요.');
    const blocks = editor.tryParseMarkdownToBlocks(markdown.trim());
    if (!blocks.length) throw new Error('넣을 내용이 없어요.');
    const prospective = {schemaVersion: 1, blocks: preserveLegacyCaptureRefs(rawDocument.current.blocks, [...editor.document, ...blocks] as unknown[])};
    // Validate the JSON wire representation; editor attributes may have null prototypes.
    serializePageDocument(JSON.parse(JSON.stringify(prospective)));
    const last = editor.document.at(-1);
    if (last) editor.insertBlocks(blocks, last, 'after');
    editBlocks();

  }

  function applyBlueprint(payload: DocumentBlueprintPayload) {
    if (insertionLocked || conflicted.current || !blankDocument) {
      setMaterialFeedback('빈 페이지에서 템플릿을 적용할 수 있어요.');
      return;
    }
    serializePageDocument({schemaVersion: 1, blocks: preserveLegacyCaptureRefs(rawDocument.current.blocks, payload.document.blocks)});
    applying.current = true;
    try {
      editor.replaceBlocks(editor.document, payload.document.blocks as any);
      blockSnapshot.current = JSON.stringify(editor.document);
      setTitle(payload.title); setIcon(payload.icon);
      queueSave({...latest.current, title: payload.title, icon: payload.icon,
        document: {schemaVersion: 1, blocks: preserveLegacyCaptureRefs(rawDocument.current.blocks, editor.document as unknown[])},
        baseVersion: version.current});
      setBlueprintsOpen(false);
    } finally { applying.current = false; }
  }

  function restoreDraft() {
    if (!recovery || recovery.baseVersion !== version.current) return;
    setTitle(recovery.title === '제목 없음' ? '' : recovery.title);
    if (recovery.icon !== undefined) setIcon(recovery.icon);
    editor.replaceBlocks(editor.document, editablePageBlocks(recovery.document.blocks) as any);
    rawDocument.current = recovery.document;
    queueSave({ ...recovery, baseVersion: version.current });
    setRecovery(null);
  }

  function markdownText(blocks = editor.document, heading = title) {
    const markdown = renderPageMarkdown(editablePageBlocks(blocks), 0, {
      includeAppReferences: true,
    });
    return `# ${heading.trim() || '제목 없음'}\n\n${markdown}`;
  }

  async function copyMarkdown(blocks = editor.document, heading = title) {
    await navigator.clipboard.writeText(markdownText(blocks, heading));
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  function addDiagram() {
    const current = editor.getTextCursorPosition()?.block || editor.document.at(-1);
    if (current)
      editor.insertBlocks(
        [{ type: 'diagram', content: 'graph TD\n  A[시작] --> B[다음]' }],
        current,
        'after',
      );
  }

  function locateCommentBlock(id: string) {
    requestAnimationFrame(() => {
      const block = commentEditorRef.current?.querySelector<HTMLElement>(
        `.bn-block-outer[data-id="${CSS.escape(id)}"]`,
      );
      if (!block) return;
      const mobile = window.matchMedia('(max-width:1239px)').matches;
      const panelTop =
        document.querySelector('.page-comment-panel')?.getBoundingClientRect().top ?? innerHeight;
      const targetTop = mobile ? Math.max(85, Math.min(panelTop - 70, 140)) : 140;
      window.scrollBy({
        top: block.getBoundingClientRect().top - targetTop,
        behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    });
  }
  function selectCommentBlock(id: string | null) {
    setSelectedCommentBlockId(id);
    if (id) {
      setCommentListOpen(true);
      locateCommentBlock(id);
    }
  }
  function openCommentBlock(id: string) {
    setShareOpen(false);
    setAiOpen(false);
    setOutlineOpen(false); setMaterialsOpen(false);
    setToolsMode(null);
    closePageMenu();
    setCommentPreviewOpen(true);
    selectCommentBlock(id);
  }

  useEffect(() => {
    if (
      !requestedCommentThread?.match(/^[a-f0-9-]{36}$/) ||
      status !== 'saved' ||
      recovery ||
      trashPending ||
      mutationLocked ||
      itineraryEditing
    )
      return;
    const link = `${page.id}:${requestedCommentThread}:${requestedCommentBlock || ''}`;
    if (handledCommentLink.current === link) return;
    setShareOpen(false);
    setAiOpen(false);
    setOutlineOpen(false); setMaterialsOpen(false);
    setToolsMode(null);
    setInfoOpen(false);
    setPageInfoExpanded(false);
    setCommentAudience('shared');
    setCommentListOpen(true);
    setCommentPreviewOpen(true);
    setSelectedCommentBlockId(
      requestedCommentBlock && requestedCommentBlock.length <= 100 ? requestedCommentBlock : null,
    );
  }, [
    page.id,
    requestedCommentThread,
    requestedCommentBlock,
    status,
    recovery,
    trashPending,
    mutationLocked,
    itineraryEditing,
  ]);
  const receiveLoadedCommentThreads = useCallback(
    (items: PreviewThread[]) => {
      if (!requestedCommentThread?.match(/^[a-f0-9-]{36}$/)) return;
      const link = `${page.id}:${requestedCommentThread}:${requestedCommentBlock || ''}`;
      if (handledCommentLink.current === link) return;
      handledCommentLink.current = link;
      const target = items.find((item) => item.id === requestedCommentThread);
      if (target) {
        setSelectedCommentBlockId(target.blockId);
        setCommentListOpen(true);
        locateCommentBlock(target.blockId);
      } else {
        setSelectedCommentBlockId(null);
        setCommentReadError('이 대화를 찾을 수 없어요. 삭제되었는지 댓글 목록을 확인해 주세요.');
      }
    },
    [page.id, requestedCommentThread, requestedCommentBlock],
  );
  const recordViewedComment = useCallback(async (thread: PreviewThread) => {
    const guest = thread.comments.filter((message) => message.isOwner === false).at(-1);
    if (!guest || readAbort.current.signal.aborted) return;
    const key = `${thread.id}:${guest.id}`;
    if (viewedReceipts.current.has(key) || readInflight.current.has(key)) return;
    readInflight.current.add(key);
    try {
      await markCommentThreadRead(thread.id, guest.id, readAbort.current.signal);
      if (readAbort.current.signal.aborted) return;
      viewedReceipts.current.add(key);
      if (
        pendingRead.current?.threadId === thread.id &&
        pendingRead.current.lastGuestMessageId === guest.id
      ) {
        pendingRead.current = null;
        setCommentReadError('');
      }
      publishRecordChange('comment-read');
    } catch {
      if (!readAbort.current.signal.aborted) {
        pendingRead.current = { threadId: thread.id, lastGuestMessageId: guest.id };
        setCommentReadError('댓글은 열었지만 읽음 상태를 저장하지 못했어요.');
      }
    } finally {
      readInflight.current.delete(key);
    }
  }, []);
  async function retryCommentRead() {
    const pending = pendingRead.current;
    if (!pending) return;
    try {
      await markCommentThreadRead(
        pending.threadId,
        pending.lastGuestMessageId,
        readAbort.current.signal,
      );
      if (readAbort.current.signal.aborted) return;
      viewedReceipts.current.add(`${pending.threadId}:${pending.lastGuestMessageId}`);
      pendingRead.current = null;
      setCommentReadError('');
      publishRecordChange('comment-read');
    } catch {
      if (!readAbort.current.signal.aborted)
        setCommentReadError('읽음 상태를 저장하지 못했어요. 다시 시도해 주세요.');
    }
  }

  function closePageMenu(restoreFocus = true) {
    const menuWasOpen = infoMenu.current?.open;
    if (infoMenu.current) infoMenu.current.open = false;
    setInfoOpen(false);
    if (restoreFocus && menuWasOpen)
      infoMenu.current?.querySelector('summary')?.focus({ preventScroll: true });
  }

  function openMaterials() {
    const next = !materialsOpen;
    setAiOpen(false); setOutlineOpen(false); setToolsMode(null); setShareOpen(false);
    setCommentPreviewOpen(false); closePageMenu(); setMaterialsOpen(next); setMaterialFeedback('');
  }

  function openAi() {
    setToolsMode(null);
    setOutlineOpen(false); setMaterialsOpen(false);
    setShareOpen(false);
    closePageMenu();
    setAiOpen((value) => !value);
  }

  const toolbar = (
    <div className="page-document-top">
      <nav className="page-crumbs" aria-label="페이지 경로">
        {crumbs.map((item) =>
          item ? (
            <Fragment key={item.id}>
              <a
                href={'/pages/' + item.id}
                className="page-crumb"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/pages/' + item.id);
                }}
              >
                <span className="page-crumb-icon" aria-hidden>
                  {item.icon || <FileText size={12} />}
                </span>
                <span className="page-crumb-text">{item.title}</span>
              </a>
              <span className="page-crumb-sep" aria-hidden>
                /
              </span>
            </Fragment>
          ) : (
            <Fragment key="crumb-overflow">
              <span className="page-crumb-more" aria-hidden>
                …
              </span>
              <span className="page-crumb-sep" aria-hidden>
                /
              </span>
            </Fragment>
          ),
        )}
        <span className="page-crumb page-crumb-current" aria-current="page">
          <span className="page-crumb-icon" aria-hidden>
            {icon || <FileText size={12} />}
          </span>
          <span className="page-crumb-text">{title.trim() || '제목 없음'}</span>
        </span>
      </nav>
      <div className="page-document-controls">
        <span className={`page-save-state state-${status}`} role="status">
          {itineraryEditing
            ? '일정 수정 중'
            : status === 'saved'
              ? localPage.record?.dirty ? '기기에 저장됨' : '서버 반영됨'
              : status === 'saving'
                ? '저장 중…'
                : status === 'conflict'
                  ? '저장 충돌'
                  : '저장 실패'}
        </span>
        <div className="page-document-actions">
          <button
            type="button"
            className="page-favorite-toggle"
            aria-label="페이지 즐겨찾기"
            title={onlineReason || '페이지 즐겨찾기'}
            aria-pressed={workspaceNavigation.favoriteIds.has(page.id)}
            disabled={Boolean(onlineReason) || workspaceNavigation.favoritePendingIds.has(page.id)}
            onClick={() => workspaceNavigation.toggleFavorite(page.id)}
          >
            <Star
              size={16}
              fill={workspaceNavigation.favoriteIds.has(page.id) ? 'currentColor' : 'none'}
            />
          </button>
          <button
            type="button"
            className="page-comment-toggle"
            aria-pressed={commentPreviewOpen}
            aria-label={commentPreviewOpen ? '댓글 닫기' : '블록 댓글'}
            title={commentPreviewOpen ? '댓글 닫기' : '블록 댓글'}
            disabled={
              !commentPreviewOpen &&
              (status !== 'saved' ||
                Boolean(recovery) ||
                trashPending ||
                mutationLocked ||
                itineraryEditing)
            }
            onClick={() => {
              setShareOpen(false);
              setOutlineOpen(false); setMaterialsOpen(false);
              setToolsMode(null);
              closePageMenu();
              if (commentPreviewOpen) {
                setSelectedCommentBlockId(null);
                setCommentListOpen(false);
              } else {
                setAiOpen(false);
                setMarkdownOpen(false);
              }
              setCommentPreviewOpen(!commentPreviewOpen);
            }}
          >
            <MessageCircle size={15} />
            <span>댓글</span>
          </button>
          <button type="button" className="page-materials-toggle" aria-label="자료 가져오기" title="자료 가져오기" aria-expanded={materialsOpen}
            onClick={openMaterials}>
            <FolderInput size={16} />
          </button>
          <button
            type="button"
            className="page-ai-toggle"
            aria-label="페이지 AI 요청"
            title="페이지 AI 요청"
            aria-expanded={aiOpen}
            disabled={commentPreviewOpen || toolsLocked || itineraryEditing}
            onPointerDown={() => {
              if (!aiOpen) captureSelection();
            }}
            onClick={openAi}
          >
            <Sparkles size={16} />
            <span>AI</span>
          </button>
          <button
            type="button"
            className="page-share-toggle"
            aria-label="페이지 공유"
            title={onlineReason || '페이지 공유'}
            aria-expanded={shareOpen}
            disabled={
              Boolean(onlineReason) ||
              status !== 'saved' ||
              Boolean(recovery) ||
              trashPending ||
              mutationLocked ||
              commentPreviewOpen ||
              itineraryEditing
            }
            onClick={() => {
              setAiOpen(false);
              setOutlineOpen(false); setMaterialsOpen(false);
              setToolsMode(null);
              closePageMenu();
              setShareOpen((value) => !value);
            }}
          >
            <Share2 size={16} />
            <span>공유</span>
          </button>
          <details
            ref={infoMenu}
            className="page-info"
            onToggle={(event) => {
              if (event.target !== event.currentTarget) return;
              setInfoOpen(event.currentTarget.open);
              if (!event.currentTarget.open) setPageInfoExpanded(false);
            }}
          >
            <summary
              aria-label="페이지 정보"
              title="페이지 도구 및 정보"
              onPointerDown={captureSelection}
            >
              <MoreHorizontal size={16} />
            </summary>
            <div className="page-info-panel">
              <div className="page-menu-group">
                <button type="button" onClick={() => void copyPageLink()}>
                  <Link2 size={15} /> 페이지 링크 복사
                </button>
              </div>
              <div className="page-menu-group page-menu-favorite">
                <button
                  type="button"
                  disabled={Boolean(onlineReason) || workspaceNavigation.favoritePendingIds.has(page.id)}
                  onClick={() => {
                    workspaceNavigation.toggleFavorite(page.id);
                    closePageMenu();
                  }}
                >
                  <Star size={15} />
                  {workspaceNavigation.favoriteIds.has(page.id)
                    ? '즐겨찾기에서 제거'
                    : '즐겨찾기에 추가'}
                </button>
              </div>
              <div className="page-menu-group">
                <strong>작성·정리</strong>
                <button type="button" onClick={openMaterials}><FolderInput size={15} /> 자료 가져오기</button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => {
                    closePageMenu();
                    void submitTool(createDuplicatePending(savedPage));
                  }}
                >
                  <Copy size={15} /> 페이지 복제
                </button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => {
                    closePageMenu();
                    pageFileInput.current?.click();
                  }}
                >
                  <Paperclip size={15} /> 파일 첨부
                </button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => openTools('templates')}
                >
                  <LayoutTemplate size={15} /> 템플릿
                </button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => openTools('move')}
                >
                  <FolderInput size={15} /> 선택 블록 이동
                </button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => {
                    closePageMenu();
                    workspaceNavigation.requestMove(page.id);
                  }}
                >
                  <FolderInput size={15} /> 페이지 이동
                </button>
              </div>
              <div className="page-menu-group">
                <strong>문서 관리</strong>
                {onlineReason && <small className="page-online-reason">{onlineReason}</small>}
                <OfflinePageControl pageId={page.id} />
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked}
                  onClick={() => openTools('history')}
                >
                  <History size={15} /> 수정 이력
                </button>
                <button
                  type="button"
                  disabled={toolsDisabled || toolsLocked || itineraryEditing || commentPreviewOpen}
                  onClick={() => {
                    setShareOpen(false);
                    setAiOpen(false);
                    setOutlineOpen(false); setMaterialsOpen(false);
                    setToolsMode(null);
                    closePageMenu();
                    openPlanConnectionManager(page.id);
                  }}
                >
                  <List size={15} /> 일정 연결 관리
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={toolsDisabled || toolsLocked || itineraryEditing || commentPreviewOpen}
                  onClick={() => {
                    closePageMenu();
                    window.location.assign(
                      `/api/pages/${savedPage.id}/export?version=${savedPage.version}`,
                    );
                  }}
                >
                  <Download size={15} /> 오프라인 사본 내려받기
                </button>
              </div>
              <div className="page-menu-group page-menu-view">
                <strong>보기 설정</strong>
                <label>
                  <span>넓게 보기</span>
                  <input
                    type="checkbox"
                    checked={view.wide}
                    onChange={(event) =>
                      setView((value) => ({ ...value, wide: event.target.checked }))
                    }
                  />
                </label>
                <label>
                  <span>작은 글씨</span>
                  <input
                    type="checkbox"
                    checked={view.smallText}
                    onChange={(event) =>
                      setView((value) => ({ ...value, smallText: event.target.checked }))
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setAiOpen(false);
                    setShareOpen(false);
                    setCommentPreviewOpen(false);
                    setToolsMode(null);
                    setOutlineOpen((value) => !value); setMaterialsOpen(false);
                    closePageMenu();
                  }}
                >
                  <List size={16} />
                  {outlineOpen ? '목차 닫기' : '목차 열기'}
                </button>
              </div>
              <div className="page-menu-group">
                <button
                  type="button"
                  onClick={() => {
                    editor.undo();
                    closePageMenu();
                  }}
                  disabled={
                    markdownOpen ||
                    commentPreviewOpen ||
                    Boolean(recovery) ||
                    trashPending ||
                    mutationLocked ||
                    itineraryEditing ||
                    !history?.canUndo
                  }
                  title="되돌리기 (⌘Z)"
                  aria-label="되돌리기"
                >
                  <Undo2 size={16} />
                  <span>되돌리기</span>
                  <kbd>⌘Z</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.redo();
                    closePageMenu();
                  }}
                  disabled={
                    markdownOpen ||
                    commentPreviewOpen ||
                    Boolean(recovery) ||
                    trashPending ||
                    mutationLocked ||
                    itineraryEditing ||
                    !history?.canRedo
                  }
                  title="다시 실행 (⇧⌘Z)"
                  aria-label="다시 실행"
                >
                  <Redo2 size={16} />
                  <span>다시 실행</span>
                  <kbd>⇧⌘Z</kbd>
                </button>
                <button
                  type="button"
                  aria-label="Mermaid"
                  title="Mermaid 추가"
                  onClick={() => {
                    addDiagram();
                    closePageMenu();
                  }}
                  disabled={
                    markdownOpen ||
                    commentPreviewOpen ||
                    Boolean(recovery) ||
                    trashPending ||
                    aiPending
                  }
                >
                  <Plus size={16} />
                  <span>Mermaid 추가</span>
                </button>
                <button
                  type="button"
                  aria-label={copied ? '복사됨' : 'Markdown 복사'}
                  title={copied ? '복사됨' : 'Markdown 복사'}
                  onClick={() => {
                    void copyMarkdown();
                    closePageMenu();
                  }}
                >
                  {copied ? <Check size={16} /> : <Clipboard size={16} />}
                  <span>{copied ? '복사됨' : 'Markdown 복사'}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={markdownOpen}
                  aria-label={markdownOpen ? '편집기로 돌아가기' : 'Markdown 보기'}
                  title={markdownOpen ? '편집기로 돌아가기' : 'Markdown 보기'}
                  disabled={commentPreviewOpen || toolsLocked || itineraryEditing}
                  onClick={() => {
                    if (!markdownOpen) setMarkdownSource(markdownText());
                    setMarkdownOpen(!markdownOpen);
                    closePageMenu();
                  }}
                >
                  <Code2 size={16} />
                  <span>{markdownOpen ? '편집기로 돌아가기' : 'Markdown 보기'}</span>
                </button>
              </div>
              <details
                className="page-menu-info"
                open={pageInfoExpanded}
                onToggle={(event) => {
                  if (event.target === event.currentTarget)
                    setPageInfoExpanded(event.currentTarget.open);
                }}
              >
                <summary>
                  <Info size={15} />
                  <span>페이지 정보·도움말</span>
                  <ChevronRight size={14} className="page-menu-info-chevron" />
                </summary>
                {infoOpen && pageInfoExpanded && (
                  <div className="page-menu-info-content">
                    <p>/로 블록을 추가하고 Markdown을 붙여넣을 수 있어요.</p>
                    <Suspense fallback={<p role="status">출처를 불러오는 중…</p>}>
                      <PageOrigins pageId={page.id} />
                    </Suspense>
                  </div>
                )}
              </details>
              <TrashAction
                kind="page"
                id={page.id}
                version={version.current}
                childCount={childCount}
                disabled={
                  Boolean(onlineReason) || status !== 'saved' ||
                  Boolean(recovery) ||
                  mutationLocked ||
                  commentPreviewOpen ||
                  itineraryEditing
                }
                onPendingChange={setTrashPending}
                onMoved={onTrashed}
              />
            </div>
          </details>
        </div>
      </div>
    </div>
  );

  return (
    <article
      className={`page-document${commentPreviewOpen ? ' page-comment-mode page-comment-panel-open' : ''}${view.wide ? ' page-wide' : ''}${view.smallText ? ' page-small-text' : ''}${aiOpen || outlineOpen || toolsMode || materialsOpen ? ' has-inspector' : ''}`}
      onPointerDown={(event) => {
        endSpacePointer.current =
          event.button === 0 && isDocumentEndSpace(event.target, event.currentTarget, event.clientY)
            ? { x: event.clientX, y: event.clientY }
            : null;
      }}
      onPointerCancel={() => {
        endSpacePointer.current = null;
      }}
      onClick={(event) => {
        const start = endSpacePointer.current;
        endSpacePointer.current = null;
        if (
          !start || event.button !== 0 ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
        )
          return;
        if (!isDocumentEndSpace(event.target, event.currentTarget, event.clientY)) return;
        event.preventDefault();
        focusDocumentEnd();
      }}
    >
      {importedBlockId && (
        <style>{`.bn-block-outer[data-id="${CSS.escape(importedBlockId)}"] > .bn-block { background: var(--theme-soft); border-radius: 8px; }`}</style>
      )}
      {commentPreviewOpen && (
        <style>
          {[
            selectedCommentBlockId &&
              `.page-comment-mode .bn-block-outer[data-id="${CSS.escape(selectedCommentBlockId)}"] > .bn-block > .bn-block-content { background: var(--theme-soft); border-radius: 5px; border-left: 1px solid var(--theme-accent); }`,
          ]
            .filter(Boolean)
            .join('\n')}
        </style>
      )}
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      {shareOpen && (
        <Suspense fallback={null}>
          <PageSharePanel pageId={page.id} onClose={() => setShareOpen(false)} />
        </Suspense>
      )}
      {commentPreviewOpen && (
        <div className="page-comment-readonly-note" role="status">
          <MessageCircle size={16} aria-hidden />
          <span>
            <strong>{commentAudience === 'shared' ? '공유 블록 댓글' : '개인 블록 댓글'}</strong>{' '}
            <em>
              {commentAudience === 'shared'
                ? '댓글을 허용한 공유 링크에서 함께 볼 수 있어요.'
                : '본문 블록을 눌러 댓글을 남기세요. 공유 페이지에는 표시되지 않아요.'}
            </em>
          </span>
          <button
            type="button"
            className="page-comment-list-open"
            onClick={() => setCommentListOpen(true)}
          >
            댓글 목록
          </button>
          <label className="page-comment-block-picker">
            <span>댓글 달 블록</span>
            <select
              aria-label="댓글 달 블록"
              value={selectedCommentBlockId || ''}
              onChange={(event) => selectCommentBlock(event.target.value || null)}
            >
              <option value="">블록 선택</option>
              {(commentAudience === 'shared'
                ? listSharedCommentableBlocks(editor.document)
                : listCommentableBlocks(editor.document)
              ).map((block, index) => (
                <option key={block.id} value={block.id}>
                  {index + 1}. {block.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {importedBlockId && (
        <p className="page-import-notice" role="status">
          메모를 페이지에 담았어요. 사본은 자유롭게 고칠 수 있어요.
        </p>
      )}
      {hasReferences && (markdownOpen || copied) && (
        <p className="page-reference-note">
          첨부 파일은 따로 보관돼요. Markdown 복사에 파일 바이트는 포함되지 않아요.
        </p>
      )}
      {recovery && (
        <div className="page-banner">
          <span>
            {recovery.baseVersion === version.current
              ? '저장되지 않은 초안이 있어요.'
              : '다른 기기에서 수정된 뒤 남은 초안이 있어요.'}
          </span>
          {recovery.baseVersion === version.current ? (
            <button type="button" onClick={restoreDraft}>
              초안 복원
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void copyMarkdown(recovery.document.blocks as any, recovery.title)}
            >
              초안 복사
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(draftKey(page.id));
              setRecovery(null);
            }}
          >
            닫기
          </button>
        </div>
      )}
      {localPage.conflict && <ConflictPanel conflict={localPage.conflict} local={localPage.record?.current ?? null} onResolved={({pageId,item})=>{if(pageId!==page.id)navigate('/pages/'+pageId);else if(item){acceptAiPage(item as unknown as PageRecord);basePage.current=item as unknown as PageRecord;}else navigate('/memo');}} />}
      {status === 'conflict' && (
        <div className="page-banner page-banner-error" role="alert">
          <span>다른 곳에서 먼저 수정했어요. 현재 내용은 이 기기에 남아 있습니다.</span>
          <button type="button" onClick={() => void copyMarkdown()}>
            내 내용 복사
          </button>
          <button type="button" onClick={() => location.reload()}>
            최신본 열기
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="page-banner page-banner-error" role="alert">
          <span>{localSaveError||'기기에 저장하지 못했어요. 작성 중인 내용을 복사한 뒤 저장 공간을 확인해 주세요.'}</span>
          {localSaveError.includes('다른 창')&&<button type="button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(latest.current,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='leneu-local-page.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>이 창 원문 내려받기</button>}
          <button type="button" onClick={() => void saveLatest()}>
            <RotateCcw size={15} /> 다시 저장
          </button>
        </div>
      )}
      {aiPending && !aiOpen && (
        <div className="page-banner" role="status">
          <span>AI 반영 여부를 먼저 확인해 주세요.</span>
          <button onClick={() => setAiOpen(true)}>같은 요청 다시 확인</button>
        </div>
      )}
      <input
        ref={pageFileInput}
        type="file"
        multiple
        hidden
        aria-label="페이지 첨부 파일"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          void attachPageFiles(files);
        }}
      />
      {(toolsStorageError || toolsError || (toolsPending && !toolsMode)) && (
        <div className="page-banner" role={toolsError ? 'alert' : 'status'}>
          <span>
            {toolsError || toolsStorageError || '페이지 작업의 저장 여부를 먼저 확인해 주세요.'}
          </span>
          {toolsStorageError && (
            <button
              type="button"
              onClick={() => {
                try {
                  setToolsPending(recoverPageToolsPending(page.id));
                  setToolsStorageError('');
                  setToolsError('');
                } catch (error) {
                  setToolsError(
                    error instanceof Error ? error.message : '제출 정보를 확인해 주세요.',
                  );
                }
              }}
            >
              제출 정보 다시 확인
            </button>
          )}
          {toolsPending && (
            <button
              type="button"
              disabled={toolsBusy}
              onClick={() => {
                if (toolsPending.kind === 'assets' && !hasPageAssetFiles(toolsPending))
                  pageFileInput.current?.click();
                else if (['duplicate', 'assets', 'map-image'].includes(toolsPending.kind))
                  void submitTool(toolsPending);
                else
                  openTools(
                    toolsPending.kind === 'move'
                      ? 'move'
                      : toolsPending.kind === 'restore'
                        ? 'history'
                        : 'templates',
                  );
              }}
            >
              {toolsPending.kind === 'assets' && !hasPageAssetFiles(toolsPending)
                ? '같은 파일 다시 선택'
                : '같은 작업 다시 확인'}
            </button>
          )}
          {toolsPending && toolsDefinitive && (
            <button
              type="button"
              disabled={toolsBusy}
              onClick={() => {
                setToolsBusy(true);
                void readCurrentPage(page.id)
                  .then((item) => {
                    forgetPageToolsPending(page.id);
                    setToolsPending(null);
                    setToolsDefinitive(false);
                    setToolsError('');
                    acceptAiPage(item);
                  })
                  .catch((error) =>
                    setToolsError(
                      error instanceof Error ? error.message : '최신 페이지를 확인해 주세요.',
                    ),
                  )
                  .finally(() => setToolsBusy(false));
              }}
            >
              확인된 실패 닫기
            </button>
          )}
          {!toolsPending && !toolsStorageError && (
            <button type="button" onClick={() => setToolsError('')}>
              닫기
            </button>
          )}
        </div>
      )}
      {toolsMode && (
        <Suspense fallback={<p role="status">페이지 도구를 여는 중…</p>}>
          <PageToolsPanel
            page={savedPage}
            pages={pages}
            mode={toolsMode}
            selectedBlockIds={moveSelectionIds}
            disabled={toolsDisabled}
            onUpdated={(item) => {
              acceptAiPage(item);
              publishRecordChange('page-tools');
            }}
            onCreated={(item) => {
              publishRecordChange('page-tools');
              navigate('/pages/' + item.id);
            }}
            onMutationPending={toolMutationPending}
            onClose={() => setToolsMode(null)}
          />
        </Suspense>
      )}
      {aiOpen && (
        <PageInspector
          title="요청과 결과"
          className="page-ai-inspector"
          onClose={() => setAiOpen(false)}
        >
          <Suspense fallback={<p role="status">페이지 AI를 여는 중…</p>}>
            <PageAiPanel
              page={(localPage.record?.current?.document?localPage.record.current:savedPage) as unknown as PageRecord}
              blocked={
                status !== 'saved' ||
                Boolean(recovery) ||
                trashPending ||
                itineraryEditing ||
                toolsLocked
              }
              selectionIds={selectionIds}
              savedMarkdown={savedAiMarkdown}
              onApplied={acceptAiPage}
              onMutationPending={setAiPending}
            />
          </Suspense>
        </PageInspector>
      )}
      {materialsOpen && <PageInspector title="자료 가져오기" onClose={() => setMaterialsOpen(false)}>
        <PageMaterialsPanel currentPageId={page.id} disabled={insertionLocked} onInsert={insertMaterial} />
        {materialFeedback && <p className="page-material-feedback" role="status">{materialFeedback}</p>}
      </PageInspector>}
      {blueprintsOpen && <Suspense fallback={<p role="status">템플릿을 여는 중…</p>}>
        <DocumentBlueprintPicker disabled={insertionLocked} onSelect={applyBlueprint} onClose={() => setBlueprintsOpen(false)} />
      </Suspense>}
      {outlineOpen && (
        <PageInspector title="목차" onClose={() => setOutlineOpen(false)}>
          <PageOutline editor={editor} />
        </PageInspector>
      )}
      <div className="page-icon-area" ref={iconArea}>
        <button
          type="button"
          className={icon ? 'page-icon-button' : 'page-icon-add'}
          onClick={() => setIconOpen(!iconOpen)}
          disabled={
            markdownOpen ||
            commentPreviewOpen ||
            Boolean(recovery) ||
            trashPending ||
            mutationLocked
          }
          aria-expanded={iconOpen}
          aria-label={icon ? '페이지 아이콘 변경' : '페이지 아이콘 추가'}
        >
          {icon || (
            <>
              <Smile size={13} /> 아이콘 추가
            </>
          )}
        </button>
        {iconOpen && (
          <PageIconPicker
            current={icon}
            container={iconArea}
            onSelect={(value) => {
              editIcon(value);
              setIconOpen(false);
            }}
            onClose={() => setIconOpen(false)}
          />
        )}
      </div>
      <textarea
        ref={titleField}
        className="page-title-input"
        aria-label="페이지 제목"
        placeholder="제목 없음"
        value={title}
        rows={1}
        onChange={(event) => editTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !markdownOpen && !recovery && !trashPending) {
            event.preventDefault();
            editor.focus();
          }
        }}
        readOnly={
          markdownOpen || commentPreviewOpen || Boolean(recovery) || trashPending || mutationLocked
        }
        maxLength={160}
      />
      <RecordTimestamps
        className="page-document-dates"
        createdAt={page.createdAt}
        updatedAt={savedAt}
      />
      {materialFeedback && !materialsOpen && <p className="page-material-feedback" role="status">{materialFeedback}</p>}
      {blankDocument && !commentPreviewOpen && !markdownOpen && <div className="page-empty-start">
        <button type="button" disabled={insertionLocked} onClick={() => setBlueprintsOpen(true)}><LayoutTemplate size={15} /> 템플릿으로 시작</button>
        <span>또는 아래에 바로 작성하세요.</span>
      </div>}
      {toolSelectionIds.length > 0 &&
        !markdownOpen &&
        !commentPreviewOpen &&
        !aiOpen &&
        !toolsMode && (
          <div className="page-selection-tools" aria-label="선택 블록 작업">
            <span>{toolSelectionIds.length}개 블록 선택</span>
            <button
              type="button"
              disabled={toolsDisabled || toolsLocked}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openTools('move')}
            >
              <FolderInput size={14} /> 다른 페이지로 이동
            </button>
            <button
              type="button"
              disabled={toolsDisabled || toolsLocked || !selectionIds.length}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openAi}
            >
              <Sparkles size={14} /> AI 요청
            </button>
          </div>
        )}
      <MapImageContext.Provider
        value={{
          disabled: toolsDisabled || toolsLocked,
          reason: onlineReason,
          busy: toolsBusy && toolsPending?.kind === 'map-image',
          generate: (blockId, style) => {
            if (toolsDisabled || toolsLocked) return;
            void submitTool(
              createPageToolsPending('map-image', page.id, {
                expectedVersion: savedPage.version,
                blockId,
                style,
              }),
            );
          },
        }}
      >
        <PlanConnectionsProvider
          pageId={page.id}
          pageVersion={savedPage.version}
          enabled={hasItineraryBlocks(savedPage.document.blocks)}
        >
          <div
            className="page-block-editor"
            onPasteCapture={event => {
              if (!editor.isEditable || event.clipboardData.files.length) return;
              const pasted = event.clipboardData.getData('text/plain');
              const linkedPage = parsePageLink(pasted, location.origin);
              const url = linkedPage?.url || webBookmarkUrl(pasted);
              if (!url) return;
              const block = editor.getTextCursorPosition().block;
              if (block.type !== 'paragraph' || block.content?.length || editor.getSelection()) return;
              event.preventDefault();event.stopPropagation();
              setBookmarkNotice('');setUrlPaste({url,blockId:block.id,pageId:linkedPage?.pageId});
            }}
            ref={commentEditorRef}
            inert={aiPending}
            style={{ display: markdownOpen ? 'none' : undefined }}
            onMouseMove={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              const id =
                target.closest('.bn-block-outer[data-id]')?.getAttribute('data-id') || null;
              setHoveredCommentBlockId(id);
            }}
            onMouseLeave={() => setHoveredCommentBlockId(null)}
            onClickCapture={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              const block = target.closest('.bn-block-outer[data-id]');
              if (!block || !event.currentTarget.contains(block)) return;
              if (!commentPreviewOpen) {
                setHoveredCommentBlockId(block.getAttribute('data-id'));
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const blockId = block.getAttribute('data-id');
              if (blockId) selectCommentBlock(blockId);
            }}
          >
            <BlockNoteView
              editor={editor}
              theme={theme}
              editable={!markdownOpen && !commentPreviewOpen && !recovery && !trashPending}
              slashMenu={false}
              sideMenu={false}
              formattingToolbar={false}
              onChange={editBlocks}
            >
              <FormattingToolbarController formattingToolbar={PageFormattingToolbar} />
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) =>
                  filterSuggestionItems(
                    combineByGroup(
                      getDefaultReactSlashMenuItems(editor),
                      getDiagramSlashMenuItems(editor),
                      getTableOfContentsSlashMenuItems(editor),
                      getPageLinkSlashMenuItems(editor, page.id),
                      getCalloutSlashMenuItems(editor),
                    ),
                    query,
                  )
                }
              />
              <GridSuggestionMenuController triggerCharacter=":" columns={10} />
              <SideMenuController sideMenu={PageSideMenu} />
            </BlockNoteView>
            {!markdownOpen &&
              status === 'saved' &&
              !recovery &&
              !trashPending &&
              !mutationLocked &&
              !itineraryEditing &&
              !aiOpen &&
              !outlineOpen && !materialsOpen &&
              !toolsMode && (
                <PageCommentGutter
                  containerRef={commentEditorRef}
                  selectedBlockId={selectedCommentBlockId}
                  hoveredBlockId={hoveredCommentBlockId}
                  summaries={commentSummaries}
                  onSelectBlock={openCommentBlock}
                />
              )}
          </div>
          <PlanOrphanConnections
            editable={
              status === 'saved' &&
              editor.isEditable &&
              !mutationLocked &&
              !trashPending &&
              !itineraryEditing
            }
          />
        </PlanConnectionsProvider>
      </MapImageContext.Provider>
      {urlPaste && <UrlPasteChoice url={urlPaste.url} internalPage={Boolean(urlPaste.pageId)} onChoose={chooseUrlPaste}/>}
      {bookmarkNotice && <p className="bookmark-error" role="status">{bookmarkNotice}</p>}
      {markdownOpen && (
        <textarea
          className="page-markdown-source"
          aria-label="Markdown 원문"
          value={markdownSource}
          readOnly
          spellCheck={false}
        />
      )}
      {new URLSearchParams(window.location.search).get('ocrAsset')?.match(/^[a-f0-9-]{36}$/) &&
        !hasOcrAsset(
          editor.document,
          new URLSearchParams(window.location.search).get('ocrAsset')!,
        ) && (
          <Suspense fallback={null}>
            <AssetOcr
              assetId={new URLSearchParams(window.location.search).get('ocrAsset')!}
              initialOpen
            />
          </Suspense>
        )}
      {commentPreviewOpen && (
        <PageCommentPreview
          key={`${page.id}:${commentAudience}:${commentAudience === 'shared' ? requestedCommentThread || '' : ''}`}
          pageId={page.id}
          audience={commentAudience}
          onAudienceChange={setCommentAudience}
          blocks={editor.document}
          selectedBlockId={selectedCommentBlockId}
          listOpen={commentListOpen}
          onSelectBlock={selectCommentBlock}
          onClosePanel={() => {
            const origin = selectedCommentBlockId;
            setHoveredCommentBlockId(origin);
            requestAnimationFrame(() => {
              const button = origin
                ? commentEditorRef.current?.querySelector<HTMLButtonElement>(
                    `[data-comment-block="${CSS.escape(origin)}"]`,
                  )
                : null;
              (button || document.querySelector<HTMLButtonElement>('.page-comment-toggle'))?.focus({
                preventScroll: true,
              });
            });
            setSelectedCommentBlockId(null);
            setCommentPreviewOpen(false);
            setCommentListOpen(false);
          }}
          onCommentedBlocksChange={receiveCommentSummary}
          onLocateBlock={locateCommentBlock}
          onThreadsLoaded={commentAudience === 'shared' ? receiveLoadedCommentThreads : undefined}
          onThreadViewed={commentAudience === 'shared' ? recordViewedComment : undefined}
          readStatusError={commentAudience === 'shared' ? commentReadError : undefined}
          onRetryRead={
            commentAudience === 'shared' && pendingRead.current
              ? () => void retryCommentRead()
              : undefined
          }
        />
      )}
    </article>
  );
}
