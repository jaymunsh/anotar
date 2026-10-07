import { defaultDocumentTitle } from '../shared/documentTitle';
import { workspaceFetch } from './sync/runtime';
import { SyncStatus } from './sync/SyncStatus';
import { getSyncSnapshot, subscribeSync } from './sync/runtime';
import AppUpdateNotice from './offline/AppUpdateNotice';
import AuthBoundary from './auth/AuthBoundary';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  File,
  FileImage,
  Link2,
  ListTodo,
  Menu,
  MessageCircle,
  Paperclip,
  Pencil,
  Search,
  Settings,
  WandSparkles,
  X,
} from 'lucide-react';
import { formatKoreanDate } from './time';
import RecordTimestamps from './RecordTimestamps';
import CaptureCollection, { kinds, fileSize, iconFor } from './memos/CaptureCollection';
import type { Capture, Filter, MemoScope, Organization } from './memos/types';
import TaskWorkspace from './tasks/TaskWorkspace';
const JournalWorkspace = React.lazy(() => import('./journal/JournalWorkspace'));
import WorkspaceSettings from './settings/WorkspaceSettings';
import { WorkspaceToolbar, WorkspaceToolbarContext } from './workspace/WorkspaceToolbar';
import { DIRECT_REQUEST, inferInputUrl, preferredTemplateId } from './prompts/templates';
import { usePromptLibrary } from './prompts/usePromptLibrary';
import { useCaptureDraft } from './drafts/useCaptureDraft';
import { inferCaptureUrl } from './capture/shareStore.js';
import { CaptureImportPanel } from './capture/CaptureImportPanel';
import FloatingCreateMenu from './capture/FloatingCreateMenu';
import CaptureComposerSurface from './capture/CaptureComposerSurface';
import { CaptureInstallHelp } from './capture/CaptureInstallHelp';
import { prepareCaptureSubmission, forgetCaptureSubmission } from './drafts/captureSubmission';
import type { AiJob, AiJobSummary } from './ai/types';
import type { AiFollowupSource } from './ai/followup';
import './ai/ai-flow.css';
import { activeAiJob } from './ai/types';
import './style.css';
import './theme-dark.css';
import './dashboard/dashboard.css';
import './workspace.css';
import './productivity.css';
import './workspace/density.css';
import { PAGE_OUTLINE_EVENT, type WorkspaceCommandId } from './search/commands';
import {
  requestWorkspacePageMove,
  requestWorkspacePageFavorite,
} from './pages/workspaceNavigation';
import MemoDetailSurface from './memos/MemoDetailSurface';
import { hasPendingCaptureBatch } from './memos/captureBatchState';
import type { TrashEntry } from './trash/types';
import { publishRecordChange, subscribeRecordChanges } from './trash/events';

const PageWorkspace = React.lazy(() => import('./pages/PageWorkspace'));
const SyncConflictReview = React.lazy(() => import('./sync/SyncConflictReview'));
const SearchPalette = React.lazy(() => import('./search/SearchPalette'));
const PromptWorkspace = React.lazy(() => import('./prompts/PromptWorkspace'));
const AiRequestFields = React.lazy(() => import('./prompts/AiRequestFields'));
const AssetOcr = React.lazy(() => import('./ocr/AssetOcr'));
const AiJobPanel = React.lazy(() => import('./ai/AiJobPanel'));
const AiFollowupComposer = React.lazy(() => import('./ai/AiFollowupComposer'));
const AiActivity = React.lazy(() => import('./ai/AiActivity'));
const CaptureOrganization = React.lazy(() => import('./memos/CaptureOrganization'));
const AiListUpdates = React.lazy(() => import('./ai/AiListUpdates'));
const CaptureBatchImport = React.lazy(() => import('./memos/CaptureBatchImport'));
const CapturePageImport = React.lazy(() => import('./memos/CapturePageImport'));
const TrashAction = React.lazy(() => import('./trash/TrashAction'));
const TrashWorkspace = React.lazy(() => import('./trash/TrashWorkspace'));
const BackupWorkspace = React.lazy(() => import('./backups/BackupWorkspace'));
const HostingWorkspace = React.lazy(() => import('./hosting/HostingWorkspace'));
const TrashNotice = React.lazy(() => import('./trash/TrashNotice'));
const CommentsWorkspace = React.lazy(() =>
  import('./comments').then((module) => ({ default: module.CommentsWorkspace })),
);
const CommentsAttention = React.lazy(() =>
  import('./comments').then((module) => ({ default: module.CommentsAttention })),
);

function currentRoute() {
  if (/^\/hosting\/?$/.test(window.location.pathname))
    return { section: 'hosting' as const, pageId: null, promptId: null };
  if (/^\/journal\/?$/.test(window.location.pathname))
    return { section: 'journal' as const, pageId: null, promptId: null };
  if (/^\/comments\/?$/.test(window.location.pathname))
    return { section: 'comments' as const, pageId: null, promptId: null };
  if (/^\/backups\/?$/.test(window.location.pathname))
    return { section: 'backups' as const, pageId: null, promptId: null };
  if (/^\/ai\/?$/.test(window.location.pathname))
    return { section: 'ai' as const, pageId: null, promptId: null };
  if (/^\/trash\/?$/.test(window.location.pathname))
    return { section: 'trash' as const, pageId: null, promptId: null };
  const captureMatch = window.location.pathname.match(/^\/captures\/([a-f0-9-]+)\/?$/);
  if (captureMatch)
    return {
      section: 'memo' as const,
      pageId: null,
      promptId: null,
      memoScope: 'memo' as const,
      captureId: captureMatch[1],
    };
  const promptMatch = window.location.pathname.match(/^\/prompts(?:\/([a-z0-9-]+))?\/?$/);
  if (promptMatch)
    return { section: 'prompts' as const, pageId: null, promptId: promptMatch[1] || null };
  if (/^\/tasks\/?$/.test(window.location.pathname))
    return { section: 'tasks' as const, pageId: null, promptId: null };
  if (/^\/(memo|temp|pages)\/?$/.test(window.location.pathname))
    return {
      section: 'memo' as const,
      pageId: null,
      promptId: null,
      captureId: null,
      memoScope:
        new URLSearchParams(window.location.search).get('view') === 'ai'
          ? ('ai' as const)
          : ('memo' as const),
    };
  const match = window.location.pathname.match(/^\/pages(?:\/([a-f0-9-]+))?\/?$/);
  return match
    ? { section: 'pages' as const, pageId: match[1] || null, promptId: null }
    : { section: 'inbox' as const, pageId: null, promptId: null };
}

type ThemeMode = 'system' | 'light' | 'dark';

function savedThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem('leneu:theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function App() {
  const syncConflicts = useSyncExternalStore(subscribeSync, () => getSyncSnapshot().conflicts);
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    if (route.section !== 'pages' || !route.pageId) document.title = defaultDocumentTitle;
  }, [route]);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLDivElement | null>(null);
  const [pageToolbarTarget, setPageToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [taskPanelTarget, setTaskPanelTarget] = useState<HTMLDivElement | null>(null);
  const [dashboardContinueTarget, setDashboardContinueTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [memoDetailTarget, setMemoDetailTarget] = useState<HTMLDivElement | null>(null);
  const [memoDesktop, setMemoDesktop] = useState(
    () => window.matchMedia('(min-width: 1101px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1101px)');
    const update = () => setMemoDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [batchCaptures, setBatchCaptures] = useState<Capture[] | null>(null);
  const [batchPending, setBatchPending] = useState(hasPendingCaptureBatch);
  const [commandError, setCommandError] = useState('');
  const creatingPage = useRef(false);
  const [dashboardPageTarget, setDashboardPageTarget] = useState<HTMLDivElement | null>(null);
  const {
    kind,
    setKind,
    text,
    setText,
    url,
    setUrl,
    aiEnabled,
    setAiEnabled,
    aiTemplateId,
    setAiTemplateId,
    aiExecution,
    setAiExecution,
    aiAdditional,
    setAiAdditional,
    files,
    setFiles,
    filesReady,
    fileSaving,
    recovered,
    draftWarning,
    snapshot,
    submissionKey,
    clearIfUnchanged,
    applyReviewedImport,
  } = useCaptureDraft();
  const [captureOptionsOpen, setCaptureOptionsOpen] = useState(false);
  const [promptsVisited, setPromptsVisited] = useState(() => currentRoute().section === 'prompts');
  const {
    templates,
    libraryError,
    saveTemplate,
    recentTemplates,
    rememberChoice,
    preferenceError,
    libraryLoading,
    libraryReady,
    reloadLibrary,
    importTemplates,
    legacyTemplates,
    legacyError,
  } = usePromptLibrary(promptsVisited || aiEnabled);
  const [items, setItems] = useState<Capture[]>([]);
  const [memoCursor, setMemoCursor] = useState<string | null>(null);
  const [memoNextCursor, setMemoNextCursor] = useState<string | null>(null);
  const [memoPrevious, setMemoPrevious] = useState<(string | null)[]>([]);
  const [counts, setCounts] = useState({ memo: 0, ai: 0 });
  const [loadedList, setLoadedList] = useState<{
    scope: MemoScope;
    query: string;
    filter: Filter;
    organization: Organization;
  } | null>(null);
  const [noticeAi, setNoticeAi] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [organization, setOrganization] = useState<Organization>('inbox');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Capture | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [trashNotice, setTrashNotice] = useState<TrashEntry | null>(null);
  const [trashPending, setTrashPending] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importAiJob, setImportAiJob] = useState<AiJob | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [aiFollowup, setAiFollowup] = useState<{
    job: AiJob;
    source: AiFollowupSource;
    editRequest: boolean;
  } | null>(null);
  const [captureRouteError, setCaptureRouteError] = useState('');
  const [captureRetry, setCaptureRetry] = useState(0);
  const [editingCapture, setEditingCapture] = useState(false);
  const [editText, setEditText] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [conflictCapture, setConflictCapture] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileComposerOpen, setMobileComposerOpen] = useState(
    () =>
      /^\/capture\/?$/.test(window.location.pathname) &&
      window.matchMedia('(max-width: 760px)').matches,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSettingsRequested, setAiSettingsRequested] = useState(false);
  const [storageSettingsRequested, setStorageSettingsRequested] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const open = () => {
      setAiSettingsRequested(true);
      setSettingsOpen(true);
    };
    window.addEventListener('anotar:open-ai-settings', open);
    return () => window.removeEventListener('anotar:open-ai-settings', open);
  }, []);
  const [now, setNow] = useState(Date.now());
  const [themeMode, setThemeMode] = useState<ThemeMode>(savedThemeMode);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const latestRequest = useRef(0);
  const isPageView = route.section === 'pages';
  const isTaskView = route.section === 'tasks';
  const isJournalView = route.section === 'journal';
  const isHostingView = route.section === 'hosting';
  const isPromptView = route.section === 'prompts';
  const isInboxView = route.section === 'inbox';
  const isMemoView = route.section === 'memo';
  const aiResultView = Boolean(
    selected?.aiRequest &&
    !editingCapture &&
    new URLSearchParams(window.location.search).has('aiJob'),
  );
  const isTrashView = route.section === 'trash';
  const isAiView = route.section === 'ai';
  const isBackupView = route.section === 'backups';
  const isCommentsView = route.section === 'comments';
  const memoScope: MemoScope = isMemoView ? route.memoScope : 'memo';
  const listQuery = isMemoView ? query : '';
  const listFilter = isMemoView ? filter : 'all';
  const listOrganization: Organization = isMemoView ? organization : 'inbox';
  const currentList = useRef({
    query: listQuery,
    filter: listFilter,
    scope: memoScope,
    organization: listOrganization,
  });
  currentList.current = {
    query: listQuery,
    filter: listFilter,
    scope: memoScope,
    organization: listOrganization,
  };
  const aiUrl = kind === 'link' ? url : inferInputUrl(text);
  const requestKind = kind === 'link' || aiUrl ? 'research' : 'free';
  const defaultTemplateId = preferredTemplateId(requestKind, recentTemplates, templates);
  const activeTemplateId = !libraryReady
    ? aiTemplateId || recentTemplates[requestKind] || defaultTemplateId
    : aiTemplateId === DIRECT_REQUEST ||
        templates.some((item) => item.id === aiTemplateId && !item.archived)
      ? aiTemplateId
      : defaultTemplateId;
  const aiTemplateUnresolved = aiEnabled && !libraryReady && aiTemplateId !== DIRECT_REQUEST;
  const activeTheme = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;
  const captureRouteId = route.section === 'memo' ? route.captureId : null;
  useEffect(() => {
    setTrashPending(false);
  }, [selected?.id]);

  useEffect(() => {
    if (!captureRouteId) return;
    let active = true;
    setCaptureRouteError('');
    workspaceFetch('/api/captures/' + captureRouteId)
      .then(async (response) => {
        if (response.status === 404) {
          if (active) setCaptureRouteError('원본 메모를 찾을 수 없어요.');
          return;
        }
        if (!response.ok) throw new Error('Capture request failed');
        const data = (await response.json()) as { item: Capture };
        if (!data.item || data.item.id !== captureRouteId)
          throw new Error('Invalid capture response');
        if (active) openCapture(data.item);
      })
      .catch(() => {
        if (active) setCaptureRouteError('원본 메모를 불러오지 못했어요. 다시 시도해 주세요.');
      });
    return () => {
      active = false;
    };
  }, [captureRouteId, captureRetry]);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [Boolean(selected)]);

  useEffect(() => {
    if (/^\/(pages|temp)\/?$/.test(window.location.pathname))
      window.history.replaceState(null, '', '/memo' + window.location.search);
  }, []);

  useEffect(() => {
    if (isPromptView) setPromptsVisited(true);
  }, [isPromptView]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', activeTheme === 'dark' ? '#1b1e1d' : '#f6f5f0');
    try {
      if (themeMode === 'system') localStorage.removeItem('leneu:theme');
      else localStorage.setItem('leneu:theme', themeMode);
    } catch {
      // Private browsing may reject persistent storage; the current choice still works.
    }
  }, [activeTheme, themeMode]);

  const captureNavigationLock = useRef(false);
  captureNavigationLock.current =
    editingCapture || editBusy || importBusy || trashPending || Boolean(aiFollowup);
  const activePath = useRef(window.location.pathname + window.location.search);
  useEffect(() => {
    const protectReload = (event: BeforeUnloadEvent) => {
      if (captureNavigationLock.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectReload);
    return () => window.removeEventListener('beforeunload', protectReload);
  }, []);
  useEffect(() => {
    const onPopState = () => {
      if (captureNavigationLock.current) {
        window.history.pushState(null, '', activePath.current);
        setCommandError('메모의 수정을 마치거나 처리 중인 요청이 끝난 뒤 이동해 주세요.');
        return;
      }
      activePath.current = window.location.pathname + window.location.search;
      setRoute(currentRoute());
      setCaptureRetry((value) => value + 1);
      setMobileMenu(false);
      setSelected(null);
      setImportOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(path: string, completedRequest = false) {
    if (
      editingCapture ||
      editBusy ||
      (!completedRequest && (importBusy || trashPending || aiFollowup))
    ) {
      setCommandError('메모의 수정을 마치거나 처리 중인 요청이 끝난 뒤 이동해 주세요.');
      return;
    }
    setCommandError('');
    activePath.current = path;
    if (window.location.pathname + window.location.search !== path)
      window.history.pushState(null, '', path);
    setRoute(currentRoute());
    setCaptureRetry((value) => value + 1);
    setMobileMenu(false);
    setSelected(null);
    setImportOpen(false);
    setCaptureRouteError('');
    setMobileComposerOpen(false);
    window.scrollTo(0, 0);
  }

  function useTemplate(id: string) {
    rememberChoice(requestKind, id);
    flushSync(() => {
      setAiEnabled(true);
      setAiTemplateId(id);
      navigate('/');
      if (window.matchMedia('(max-width: 760px)').matches) setMobileComposerOpen(true);
    });
    (kind === 'link' ? urlInput : textInput).current?.focus();
  }

  const loadItems = useCallback(
    async (
      search = currentList.current.query,
      activeFilter: Filter = currentList.current.filter,
      scope: MemoScope = currentList.current.scope,
      activeOrganization: Organization = currentList.current.organization,
      cursor: string | null = null,
    ) => {
      const requestId = ++latestRequest.current;
      setLoading(true);
      setListError('');
      try {
        const params = new URLSearchParams({
          q: search,
          kind: activeFilter,
          scope,
          organization: activeOrganization,
        });
        if (cursor) params.set('cursor', cursor);
        const response = await workspaceFetch(`/api/captures?${params}`);
        if (!response.ok) throw new Error('목록을 불러오지 못했습니다.');
        const data = (await response.json()) as {
          items: Capture[];
          counts: { memo: number; ai: number };
          nextCursor?: string | null;
        };
        if (!Array.isArray(data.items) || !data.counts) throw new Error('Invalid memo list');
        if (requestId !== latestRequest.current) return;
        setItems(data.items);
        setMemoCursor(cursor);
        setMemoNextCursor(data.nextCursor ?? null);
        if (!cursor) setMemoPrevious([]);
        setCounts(data.counts);
        setLoadedList({
          scope,
          query: search,
          filter: activeFilter,
          organization: activeOrganization,
        });
        setListError('');
      } catch {
        if (requestId === latestRequest.current)
          setListError('메모 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(
    () =>
      subscribeRecordChanges(() => {
        const current = currentList.current;
        void loadItems(current.query, current.filter, current.scope);
      }),
    [loadItems],
  );

  function onTrashed(entry: TrashEntry) {
    setTrashNotice(entry);
    const current = currentRoute();
    if (entry.kind === 'page') {
      if (current.section === 'pages' && current.pageId === entry.targetId) navigate('/memo', true);
    } else if (selectedRef.current?.id === entry.targetId) {
      if (current.section === 'memo' && current.captureId === entry.targetId)
        navigate('/memo', true);
      else {
        setSelected(null);
        setImportOpen(false);
      }
    }
  }

  useEffect(() => {
    const timer = setTimeout(
      () => void loadItems(listQuery, listFilter, memoScope, listOrganization),
      isMemoView && query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      ++latestRequest.current;
    };
  }, [listQuery, listFilter, loadItems, isMemoView, memoScope, listOrganization]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (mobileComposerOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMobileComposerOpen(false);
        }
        return;
      }
      if (document.querySelector('.workspace-settings[open]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setMobileMenu(false);
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (importOpen || aiFollowup) return;
        if (editingCapture) {
          if (!editBusy) cancelCaptureEdit();
        } else closeCapture();
        setMobileComposerOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [
    editingCapture,
    editBusy,
    conflictCapture,
    query,
    filter,
    loadItems,
    importOpen,
    aiFollowup,
    captureRouteId,
    searchOpen,
    mobileComposerOpen,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!mobileComposerOpen) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      document.documentElement.style.setProperty(
        '--capture-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty('--capture-top', `${viewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      document.documentElement.style.removeProperty('--capture-height');
      document.documentElement.style.removeProperty('--capture-top');
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileComposerOpen]);

  useEffect(() => {
    if (kind !== 'note') setCaptureOptionsOpen(true);
  }, [kind]);
  useEffect(() => {
    const resize = () => {
      const input = textInput.current;
      if (!input || (!isInboxView && !mobileComposerOpen)) return;
      input.style.height = 'auto';
      const limit = mobileComposerOpen ? 320 : 220;
      input.style.height = `${Math.max(72, Math.min(input.scrollHeight, limit))}px`;
      input.style.overflowY = input.scrollHeight > limit ? 'auto' : 'hidden';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [text, kind, mobileComposerOpen, isInboxView]);

  function openMobileComposer() {
    if (captureNavigationLock.current) {
      setCommandError('메모의 수정을 마치거나 처리 중인 요청이 끝난 뒤 다시 열어 주세요.');
      return;
    }
    flushSync(() => {
      setMobileComposerOpen(true);
    });
    (kind === 'link' ? urlInput.current : textInput.current)?.focus();
  }

  function addFiles(incoming: FileList | File[]) {
    if (!filesReady) {
      setError('첨부 초안을 복구하는 중이에요. 잠시 후 다시 선택해 주세요.');
      return;
    }
    const next = Array.from(incoming);
    if (!next.length) return;
    if (next.some((file) => file.size > 25 * 1024 * 1024)) {
      setError('파일 하나는 25MB까지 첨부할 수 있습니다.');
      return;
    }
    if (files.length + next.length > 8) {
      setError('파일은 한 번에 8개까지 첨부할 수 있습니다.');
      return;
    }
    setFiles((current) => [...current, ...next]);
    setError('');
    if (kind === 'note')
      setKind(next.every((file) => file.type.startsWith('image/')) ? 'image' : 'file');
  }

  async function save(includeAi = aiEnabled) {
    if (
      busy ||
      !filesReady ||
      (includeAi && (aiTemplateUnresolved || !aiExecution || (!aiAvailable && navigator.onLine)))
    )
      return;
    if (kind === 'note' && !text.trim() && !files.length) {
      textInput.current?.focus();
      return;
    }
    if (kind === 'link' && !url.trim()) {
      setError('저장할 링크를 입력해 주세요.');
      return;
    }
    if ((kind === 'image' || kind === 'file') && !files.length) {
      fileInput.current?.click();
      return;
    }
    setBusy(true);
    setError('');
    const submitted = snapshot();
    const withAi = includeAi;
    if (withAi) rememberChoice(requestKind, activeTemplateId);
    try {
      const receipt = await prepareCaptureSubmission({
        storage: window.localStorage,
        key: submissionKey,
        input: { ...submitted.input, aiEnabled: withAi },
        files: submitted.files,
        selection: withAi
          ? {
              template:
                activeTemplateId === DIRECT_REQUEST
                  ? null
                  : (templates.find((item) => item.id === activeTemplateId) ?? null),
              additional: submitted.input.aiAdditional,
              ...(submitted.input.aiExecution ? { execution: submitted.input.aiExecution } : {}),
            }
          : null,
      });
      const body = new FormData();
      body.set('requestId', receipt.requestId);
      body.set('kind', submitted.input.kind);
      body.set('text', submitted.input.text);
      body.set('url', submitted.input.kind === 'link' ? submitted.input.url : '');
      submitted.files.forEach((file) => body.append('files', file));
      if (receipt.selection) body.set('aiRequest', JSON.stringify(receipt.selection));
      const response = await workspaceFetch('/api/captures', { method: 'POST', body });
      const data = (await response.json()) as { item?: Capture; error?: string; local?: boolean };
      if (!response.ok) throw new Error(data.error || '저장하지 못했습니다.');
      if (!data.item?.id)
        throw new Error('저장 여부를 확인하지 못했어요. 입력은 남아 있으니 다시 저장해 주세요.');
      forgetCaptureSubmission(window.localStorage, submissionKey, receipt.requestId);
      setNow(Date.now());
      const cleared = clearIfUnchanged(submitted);
      setNoticeAi(withAi);
      if (cleared && fileInput.current) fileInput.current.value = '';
      setNotice(
        data.local
          ? '기기에 저장했어요. 연결되면 동기화해요.'
          : withAi
            ? '메모를 보관하고 AI 요청을 등록했어요.'
            : '보관함에 저장했어요',
      );
      if (withAi) publishRecordChange('ai-request');
      void loadItems();
      if (cleared && mobileComposerOpen) {
        textInput.current?.blur();
        setMobileComposerOpen(false);
      } else if (cleared) {
        textInput.current?.focus();
      }
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? '저장 여부를 확인하지 못했어요. 입력은 남아 있으니 다시 저장해 주세요.'
          : cause instanceof Error
            ? cause.message
            : '저장하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  function openCapture(item: Capture) {
    setSelected(item);
    setAiFollowup(null);
    setImportOpen(false);
    setEditingCapture(false);
    setEditError('');
    setConflictCapture(null);
  }

  function closeCapture() {
    if (captureRouteId)
      navigate(
        new URLSearchParams(window.location.search).has('aiJob')
          ? '/ai'
          : selected?.aiRequest
            ? '/memo?view=ai'
            : '/memo',
      );
    else setSelected(null);
  }

  function startCaptureEdit() {
    if (!selected) return;
    setEditText(selected.text);
    setEditUrl(selected.url || '');
    setEditError('');
    setConflictCapture(null);
    setEditingCapture(true);
  }

  function cancelCaptureEdit() {
    setCommandError('');
    if (conflictCapture) {
      setSelected(conflictCapture);
      setItems((current) =>
        current.map((item) => (item.id === conflictCapture.id ? conflictCapture : item)),
      );
      void loadItems();
    }
    setEditingCapture(false);
    setEditError('');
    setConflictCapture(null);
  }

  async function saveCaptureEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || editBusy) return;
    const content = editText.trim();
    const link = selected.kind === 'link' ? editUrl.trim() : null;
    if (selected.kind === 'note' && !content && !selected.files.length) {
      setEditError('내용을 입력해 주세요.');
      return;
    }
    if (content.length > 10000) {
      setEditError('메모는 10,000자까지 입력할 수 있습니다.');
      return;
    }
    if (selected.kind === 'link' && !link) {
      setEditError('링크 주소를 입력해 주세요.');
      return;
    }
    if (content === selected.text && link === selected.url) {
      cancelCaptureEdit();
      return;
    }
    setEditBusy(true);
    setEditError('');
    setConflictCapture(null);
    try {
      const response = await workspaceFetch(`/api/captures/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          ...(selected.kind === 'link' ? { url: link } : {}),
          expectedVersion: selected.version,
        }),
      });
      const data = (await response.json()) as {
        item?: Capture;
        current?: Capture;
        error?: string;
      };
      if (!response.ok || !data.item) {
        if (response.status === 409 && data.current) setConflictCapture(data.current);
        throw new Error(data.error || '수정 내용을 저장하지 못했습니다.');
      }
      setSelected(data.item);
      setItems((current) => current.map((item) => (item.id === data.item!.id ? data.item! : item)));
      cancelCaptureEdit();
      await loadItems();
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : '수정 내용을 저장하지 못했습니다.');
    } finally {
      setEditBusy(false);
    }
  }

  function loadConflictCapture() {
    if (!conflictCapture) return;
    setSelected(conflictCapture);
    setEditText(conflictCapture.text);
    setEditUrl(conflictCapture.url || '');
    setItems((current) =>
      current.map((item) => (item.id === conflictCapture.id ? conflictCapture : item)),
    );
    setEditError('');
    setConflictCapture(null);
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      addFiles(event.clipboardData.files);
      return;
    }
    const pasted = event.clipboardData.getData('text/plain').trim();
    const pastedUrl = inferCaptureUrl(pasted);
    if (kind === 'note' && !text.trim() && pastedUrl) {
      event.preventDefault();
      setKind('link');
      setUrl(pastedUrl);
    }
  }
  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }
  const hasDraft = Boolean(
    text.trim() || url.trim() || files.length || !filesReady || aiAdditional.trim(),
  );

  function openMemo(scope: MemoScope = 'memo') {
    setQuery('');
    setFilter('all');
    navigate(scope === 'ai' ? '/memo?view=ai' : '/memo');
  }
  function startMemo() {
    if (captureNavigationLock.current) {
      setCommandError('메모의 수정을 마치거나 처리 중인 요청이 끝난 뒤 이동해 주세요.');
      return;
    }
    flushSync(() => {
      if (memoScope === 'ai') setAiEnabled(true);
      navigate('/');
      if (window.matchMedia('(max-width: 760px)').matches) setMobileComposerOpen(true);
    });
    (kind === 'link' ? urlInput : textInput).current?.focus();
  }
  function startAiRequest() {
    setAiEnabled(true);
    startMemo();
  }
  const updateAiJob = useCallback((captureId: string, job: AiJobSummary | null) => {
    setItems((current) =>
      current.map((item) => (item.id === captureId ? { ...item, latestAiJob: job } : item)),
    );
    setSelected((current) =>
      current?.id === captureId ? { ...current, latestAiJob: job } : current,
    );
  }, []);
  async function executeWorkspaceCommand(id: WorkspaceCommandId) {
    if (captureNavigationLock.current) {
      setCommandError('메모의 수정을 마치거나 처리 중인 요청이 끝난 뒤 이동해 주세요.');
      return;
    }
    setCommandError('');
    if (id === 'memo') return startMemo();
    if (id === 'ai') return startAiRequest();
    if (id === 'task') {
      flushSync(() => navigate('/tasks'));
      document.querySelector<HTMLInputElement>('[aria-label="새 할 일"]')?.focus();
      return;
    }
    if (id === 'outline' && route.pageId) {
      window.dispatchEvent(
        new CustomEvent(PAGE_OUTLINE_EVENT, { detail: { pageId: route.pageId } }),
      );
      return;
    }
    if (id === 'move' && route.pageId) return requestWorkspacePageMove(route.pageId);
    if (id === 'favorite' && route.pageId) return requestWorkspacePageFavorite(route.pageId);
    if (id !== 'page' || creatingPage.current) return;
    creatingPage.current = true;
    try {
      const response = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '제목 없음' }),
      });
      const result = await response.json();
      if (!response.ok || !result.item?.id) throw new Error();
      publishRecordChange('page-create');
      navigate(`/pages/${result.item.id}`);
    } catch {
      setCommandError('새 페이지를 만들지 못했어요. 빠른 작업에서 다시 시도해 주세요.');
    } finally {
      creatingPage.current = false;
    }
  }
  function collection(compact = false) {
    return (
      <CaptureCollection
        compact={compact}
        onNext={
          memoNextCursor
            ? () => {
                setMemoPrevious((p) => [...p, memoCursor]);
                void loadItems(undefined, undefined, undefined, undefined, memoNextCursor);
              }
            : undefined
        }
        onPrevious={
          memoPrevious.length
            ? () => {
                const previous = memoPrevious.at(-1)!;
                setMemoPrevious((p) => p.slice(0, -1));
                void loadItems(undefined, undefined, undefined, undefined, previous);
              }
            : undefined
        }
        selectedId={selected?.id}
        items={items}
        now={now}
        loading={
          loading ||
          !loadedList ||
          loadedList.scope !== memoScope ||
          loadedList.query !== listQuery ||
          loadedList.filter !== listFilter ||
          loadedList.organization !== listOrganization
        }
        error={listError}
        counts={counts}
        scope={memoScope}
        onScope={openMemo}
        organization={listOrganization}
        onOrganization={setOrganization}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        searchRef={searchInput}
        onBatchOrganize={(captures) => {
          if (editingCapture || editBusy || importOpen || importBusy || trashPending) return;
          setBatchCaptures(captures);
        }}
        batchDisabled={editingCapture || editBusy || importOpen || importBusy || trashPending}
        hasPendingBatch={batchPending}
        onOpen={(item) => {
          if (!editingCapture && !editBusy && !importOpen && !importBusy && !trashPending)
            openCapture(item);
        }}
        onCreate={startMemo}
        onViewAll={() => openMemo()}
        onRetry={() => void loadItems()}
      />
    );
  }

  return (
    <WorkspaceToolbarContext.Provider value={pageToolbarTarget}>
      <div className={`app-shell ${mobileMenu ? 'menu-open' : ''}`}>
        <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
          <div className="brand-line">
            <a
              className="brand"
              href="/"
              aria-label="anotar 홈"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              <img
                className="brand-mark"
                src="/capture-icons/icon-192.png"
                alt=""
                width="26"
                height="26"
              />
              <span>anotar</span>
            </a>
            <time
              className="today-label"
              dateTime={new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)}
            >
              {formatKoreanDate(now)}
            </time>
          </div>
          <div className="sidebar-scroll" tabIndex={0} role="region" aria-label="작업 공간 탐색">
            <div className="sidebar-primary-navigation">
              <nav aria-label="주 메뉴" className="nav-shortcuts">
                <button
                  type="button"
                  className="nav-item nav-search"
                  title="검색 · ⌘K / Ctrl+K"
                  aria-keyshortcuts="Meta+k Control+k"
                  onClick={() => {
                    setMobileMenu(false);
                    setSearchOpen(true);
                  }}
                >
                  <span className="nav-icon">
                    <Search size={18} />
                  </span>
                  <span className="nav-label">검색</span>
                </button>
                <a
                  className={`nav-item ${isMemoView ? 'active' : ''}`}
                  aria-current={isMemoView ? 'page' : undefined}
                  href="/memo"
                  onClick={(event) => {
                    event.preventDefault();
                    openMemo();
                  }}
                >
                  <span className="nav-icon">
                    <File size={18} />
                  </span>
                  <span className="nav-label">메모</span>
                </a>
                <a
                  className={`nav-item ${isJournalView ? 'active' : ''}`}
                  aria-current={isJournalView ? 'page' : undefined}
                  href="/journal"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate('/journal');
                  }}
                >
                  <span className="nav-icon">
                    <CalendarDays size={18} />
                  </span>
                  <span className="nav-label">일지</span>
                </a>
                <a
                  className={`nav-item ${isTaskView ? 'active' : ''}`}
                  aria-current={isTaskView ? 'page' : undefined}
                  href="/tasks"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate('/tasks');
                  }}
                >
                  <span className="nav-icon">
                    <ListTodo size={18} />
                  </span>
                  <span className="nav-label">할 일</span>
                </a>
                <a
                  className={`nav-item ${isAiView ? 'active' : ''}`}
                  aria-current={isAiView ? 'page' : undefined}
                  href="/ai"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate('/ai');
                  }}
                >
                  <span className="nav-icon">
                    <WandSparkles size={18} />
                  </span>
                  <span className="nav-label">AI 작업</span>
                </a>
                <a
                  className={`nav-item ${isCommentsView ? 'active' : ''}`}
                  aria-current={isCommentsView ? 'page' : undefined}
                  href="/comments"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate('/comments');
                  }}
                >
                  <span className="nav-icon">
                    <MessageCircle size={18} />
                  </span>
                  <span className="nav-label">공유 댓글</span>
                </a>
              </nav>
            </div>
            <div ref={setSidebarTarget} className="sidebar-pages-slot" />
          </div>
          <AppUpdateNotice />
          <div className="sidebar-footer">
            <img className="sidebar-profile" src="/profile.png" alt="" width="20" height="20" />
            <SyncStatus
              onNavigate={navigate}
              onOpenStorage={() => {
                setStorageSettingsRequested(true);
                setSettingsOpen(true);
              }}
            />
            <button
              type="button"
              className="sidebar-settings-button"
              aria-label="설정 열기"
              title="설정"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={15} aria-hidden />
            </button>
          </div>
        </aside>
        {settingsOpen && (
          <WorkspaceSettings
            initialSection={
              storageSettingsRequested ? 'storage' : aiSettingsRequested ? 'ai' : 'appearance'
            }
            theme={activeTheme}
            onThemeChange={setThemeMode}
            onClose={() => {
              setSettingsOpen(false);
              setAiSettingsRequested(false);
              setStorageSettingsRequested(false);
            }}
            onOpen={(path) => {
              setSettingsOpen(false);
              setStorageSettingsRequested(false);
              navigate(path);
            }}
          />
        )}
        {mobileMenu && (
          <button
            className="mobile-scrim"
            aria-label="메뉴 닫기"
            onClick={() => setMobileMenu(false)}
          />
        )}
        {searchOpen && (
          <React.Suspense fallback={null}>
            <SearchPalette
              onClose={() => setSearchOpen(false)}
              onNavigate={navigate}
              pageId={route.pageId}
              onCommand={(id) => void executeWorkspaceCommand(id)}
            />
          </React.Suspense>
        )}
        <div className="content-area">
          {commandError && (
            <div className="command-error" role="alert">
              {commandError}
              <button onClick={() => setSearchOpen(true)}>빠른 작업 열기</button>
              <button onClick={() => setCommandError('')}>닫기</button>
            </div>
          )}
          <header
            className={`topbar workspace-topbar${isPageView && route.pageId ? ' document-topbar' : ''}`}
          >
            <button
              className="mobile-menu icon-button"
              aria-label="메뉴 열기"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <div className="page-toolbar-slot workspace-toolbar-slot" ref={setPageToolbarTarget} />
            <span className="toolbar-fallback">
              {isPageView
                ? '페이지'
                : isHostingView
                  ? '웹 호스팅'
                  : isJournalView
                    ? '일지'
                    : isTaskView
                      ? '할 일'
                      : isPromptView
                        ? '프롬프트'
                        : isAiView
                          ? 'AI 작업'
                          : isBackupView
                            ? '백업'
                            : isCommentsView
                              ? '공유 댓글'
                              : isMemoView
                                ? '메모'
                                : isTrashView
                                  ? '휴지통'
                                  : '입력함'}
            </span>
          </header>
          {isInboxView && (
            <WorkspaceToolbar title="입력함">
              <button
                className="toolbar-icon-mobile home-desktop-action"
                onClick={() => setSearchOpen(true)}
                aria-label="통합 검색 열기"
                title="통합 검색 · ⌘K"
              >
                <Search size={16} />
                <span>검색</span>
                <kbd>⌘K</kbd>
              </button>
            </WorkspaceToolbar>
          )}
          <main
            className="main-content home-dashboard"
            style={{ display: !isInboxView ? 'none' : undefined }}
          >
            <header className="intro dashboard-intro">
              <div>
                <h1>
                  생각을, <em>놓아두세요.</em>
                </h1>
                <p>지금 떠오른 것은 빠르게 담고, 정리는 필요할 때 해요.</p>
              </div>
            </header>
            <div className="dashboard-grid">
              <div ref={setDashboardContinueTarget} className="dashboard-continue" />
              <div className="dashboard-primary">
                <CaptureComposerSurface
                  open={mobileComposerOpen}
                  onClose={() => setMobileComposerOpen(false)}
                >
                  <section
                    className={`composer ${aiEnabled ? 'composer-ai' : ''} ${dragging ? 'dragging' : ''} ${mobileComposerOpen ? 'mobile-open' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node))
                        setDragging(false);
                    }}
                    onDrop={onDrop}
                    aria-label={mobileComposerOpen ? '빠른 기록' : '새 항목 저장'}
                  >
                    <div className="composer-heading">
                      <strong>{aiEnabled ? 'AI 요청' : '빠른 메모'}</strong>
                      <span className="composer-subtitle">
                        {aiEnabled ? '요청과 결과를 함께 보관해요' : '적어두고 나중에 정리해요'}
                      </span>
                      {!mobileComposerOpen && (
                        <button
                          type="button"
                          className="dashboard-expand"
                          aria-label="전체 화면으로 쓰기"
                          onClick={openMobileComposer}
                        >
                          크게 쓰기 <ArrowUpRight size={15} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        className="mobile-composer-close icon-button"
                        aria-label="입력 닫기"
                        onClick={() => setMobileComposerOpen(false)}
                      >
                        <X size={22} />
                      </button>
                    </div>
                    <div className="composer-body">
                      <CaptureImportPanel
                        draft={{
                          text,
                          url,
                          files,
                          filesReady,
                          fileSaving,
                          aiEnabled,
                          aiAdditional,
                        }}
                        onApply={applyReviewedImport}
                      />
                      {kind === 'link' && (
                        <div className="url-field">
                          <Link2 size={18} />
                          <input
                            ref={urlInput}
                            type="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://example.com/읽고-싶은-글"
                            aria-label="링크 주소"
                          />
                        </div>
                      )}
                      {captureOptionsOpen && (kind === 'image' || kind === 'file') && (
                        <button
                          className="upload-zone"
                          type="button"
                          onClick={() => fileInput.current?.click()}
                        >
                          <span className="upload-symbol">
                            {kind === 'image' ? <FileImage size={23} /> : <Paperclip size={22} />}
                          </span>
                          <strong>
                            {kind === 'image'
                              ? '이미지를 여기에 놓거나 선택하세요'
                              : '파일을 여기에 놓거나 선택하세요'}
                          </strong>
                          <span>한 파일 최대 25MB · 최대 8개</span>
                        </button>
                      )}
                      <textarea
                        ref={textInput}
                        value={text}
                        onFocus={() => setCaptureOptionsOpen(false)}
                        onChange={(event) => setText(event.target.value)}
                        onPaste={onPaste}
                        onKeyDown={(event) => {
                          if (
                            !event.nativeEvent.isComposing &&
                            (event.metaKey || event.ctrlKey) &&
                            event.key === 'Enter'
                          ) {
                            event.preventDefault();
                            void save();
                          }
                        }}
                        placeholder={
                          kind === 'note'
                            ? '떠오른 생각을 바로 적어보세요…'
                            : kind === 'link'
                              ? '이 링크에 대한 메모를 남겨보세요 (선택)'
                              : '함께 기억할 내용을 적어보세요 (선택)'
                        }
                        aria-label="메모 내용"
                        rows={kind === 'note' ? 3 : 2}
                      />
                      <details
                        className="composer-options"
                        open={captureOptionsOpen}
                        onToggle={(event) => setCaptureOptionsOpen(event.currentTarget.open)}
                      >
                        <summary>
                          <span>
                            {kind === 'note'
                              ? '링크·이미지·파일 추가'
                              : `${kinds.find((item) => item.id === kind)?.label} 입력`}
                          </span>
                          <ChevronDown size={14} aria-hidden="true" />
                        </summary>
                        <div className="composer-tabs" role="tablist" aria-label="저장할 항목 종류">
                          {kinds.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              role="tab"
                              aria-selected={kind === option.id}
                              className={`composer-tab ${kind === option.id ? 'selected' : ''}`}
                              onClick={() => {
                                setKind(option.id);
                                setError('');
                              }}
                            >
                              <option.icon size={16} strokeWidth={1.9} />
                              <span>{option.label}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                      {!!files.length && (
                        <div className="attached-files">
                          {files.map((file, index) => (
                            <span className="file-pill" key={`${file.name}-${index}`}>
                              <Paperclip size={14} />
                              <span>{file.name}</span>
                              <small>{fileSize(file.size)}</small>
                              <button
                                aria-label={`${file.name} 제거`}
                                onClick={() =>
                                  setFiles((current) =>
                                    current.filter((_, currentIndex) => currentIndex !== index),
                                  )
                                }
                              >
                                <X size={14} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`capture-ai ${aiEnabled ? 'enabled' : ''}`}>
                        <div className="capture-ai-toggle-row">
                          <label className="capture-ai-toggle">
                            <input
                              type="checkbox"
                              checked={aiEnabled}
                              onChange={(event) => setAiEnabled(event.target.checked)}
                            />
                            <WandSparkles size={15} aria-hidden="true" />
                            <span>AI 요청</span>
                          </label>
                          <span className="capture-ai-preview-label">저장 후 처리</span>
                        </div>
                        {aiEnabled && (
                          <React.Suspense
                            fallback={<p className="capture-ai-loading">요청 설정을 여는 중…</p>}
                          >
                            <AiRequestFields
                              execution={aiExecution}
                              onExecution={setAiExecution}
                              onAvailability={setAiAvailable}
                              templates={templates}
                              selectedId={activeTemplateId}
                              onSelect={(id) => {
                                setAiTemplateId(id);
                                rememberChoice(requestKind, id);
                              }}
                              additional={aiAdditional}
                              onAdditional={setAiAdditional}
                              input={{ url: aiUrl, content: text }}
                              onManage={(id) => navigate(id ? `/prompts/${id}` : '/prompts')}
                              libraryError={libraryError || preferenceError}
                              loading={libraryLoading && !libraryReady}
                              onReload={() => void reloadLibrary()}
                            />
                          </React.Suspense>
                        )}
                        {aiEnabled && aiExecution && !aiAvailable && online && (
                          <button
                            type="button"
                            className="prompt-text-button"
                            disabled={busy || !filesReady}
                            onClick={() => void save(false)}
                          >
                            메모만 저장
                          </button>
                        )}
                      </div>
                      {(draftWarning || recovered || !filesReady || fileSaving) && (
                        <p
                          className={`capture-draft-status ${draftWarning ? 'error' : ''}`}
                          role={draftWarning ? 'alert' : 'status'}
                        >
                          {draftWarning ||
                            (!filesReady
                              ? '첨부를 복구하는 중…'
                              : fileSaving
                                ? '첨부 임시저장 중…'
                                : '작성 중인 초안을 복구했어요.')}
                        </p>
                      )}
                    </div>
                    {error && mobileComposerOpen && (
                      <div className="composer-error-mobile" role="alert">
                        {error}
                      </div>
                    )}
                    <div className="composer-footer">
                      <div className="composer-tools">
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          hidden
                          accept={kind === 'image' ? 'image/*' : undefined}
                          onChange={(event) => {
                            if (event.target.files?.length) {
                              const picked = Array.from(event.target.files);
                              if (
                                window.matchMedia('(max-width: 760px)').matches &&
                                !mobileComposerOpen
                              ) {
                                setMobileComposerOpen(true);
                              }
                              addFiles(picked);
                            }
                            event.target.value = '';
                          }}
                        />
                        <button
                          className="attach-button"
                          type="button"
                          onClick={() => fileInput.current?.click()}
                          title="파일 첨부"
                        >
                          <Paperclip size={18} />
                          <span>첨부하기</span>
                        </button>
                        <span className="composer-hint">붙여넣기 또는 끌어놓기도 가능해요</span>
                      </div>
                      <button
                        className="save-button"
                        onClick={() => void save()}
                        disabled={
                          busy ||
                          (aiEnabled && (!aiExecution || (!aiAvailable && online))) ||
                          !filesReady ||
                          aiTemplateUnresolved
                        }
                      >
                        <span>
                          {busy
                            ? '저장 중...'
                            : !filesReady
                              ? '첨부 복구 중…'
                              : aiTemplateUnresolved
                                ? '템플릿 확인 중…'
                                : aiEnabled
                                  ? '저장하고 AI 요청'
                                  : '저장'}
                        </span>
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    {dragging && (
                      <div className="drop-overlay">
                        <FileImage size={30} />
                        <strong>여기에 놓으면 첨부돼요</strong>
                      </div>
                    )}
                  </section>
                </CaptureComposerSurface>
                {error && !mobileComposerOpen && (
                  <div className="feedback error" role="alert">
                    {error}
                  </div>
                )}
                {notice && (
                  <div className="feedback success" role="status">
                    <Check size={16} />
                    <span>{notice}</span>
                    <button
                      className="memo-notice-link"
                      onClick={() => (noticeAi ? navigate('/ai') : openMemo())}
                    >
                      {noticeAi ? '요청 보기' : '메모 보기'}
                    </button>
                  </div>
                )}
                <div className="dashboard-memos">{isInboxView && collection(true)}</div>
                <div ref={setDashboardPageTarget} className="dashboard-pages" />
                {window.location.pathname === '/capture' && <CaptureInstallHelp />}
              </div>
              <aside className="dashboard-secondary" aria-label="할 일과 AI·댓글 현황">
                <div ref={setTaskPanelTarget} className="tasks-panel-host" />
                {isInboxView && (
                  <div className="dashboard-ai">
                    <React.Suspense fallback={null}>
                      <AiActivity compact onNavigate={navigate} onCreate={startAiRequest} />
                    </React.Suspense>
                  </div>
                )}
                {isInboxView && (
                  <React.Suspense fallback={null}>
                    <CommentsAttention onNavigate={navigate} />
                  </React.Suspense>
                )}
              </aside>
            </div>
          </main>
          {syncConflicts > 0 && (isJournalView || isTaskView || isMemoView) && (
            <React.Suspense fallback={null}>
              <SyncConflictReview
                key={route.section + (isMemoView ? route.captureId || '' : '')}
                kind={isJournalView ? 'journal' : isTaskView ? 'task' : 'capture'}
                entityId={isMemoView ? route.captureId : null}
              />
            </React.Suspense>
          )}
          {isJournalView && (
            <React.Suspense fallback={<p role="status">일지를 여는 중…</p>}>
              <JournalWorkspace />
            </React.Suspense>
          )}
          {isMemoView && (
            <main
              className={`memo-workspace${selected && memoDesktop ? ' memo-split' : ''}${aiResultView ? ' memo-ai-reading' : ''}`}
            >
              <div className="memo-split-list">{collection()}</div>
              <div ref={setMemoDetailTarget} className="memo-detail-host" />
            </main>
          )}
          {isAiView && (
            <main className="memo-workspace">
              <React.Suspense fallback={<p role="status">AI 요청을 여는 중…</p>}>
                <AiActivity onNavigate={navigate} onCreate={startAiRequest} />
              </React.Suspense>
            </main>
          )}
          {isTrashView && (
            <React.Suspense fallback={<div className="page-route-loading">휴지통을 여는 중…</div>}>
              <TrashWorkspace navigate={navigate} />
            </React.Suspense>
          )}
          {isHostingView && (
            <React.Suspense fallback={<p role="status">호스팅 목록을 여는 중…</p>}>
              <HostingWorkspace />
            </React.Suspense>
          )}
          {isBackupView && (
            <React.Suspense fallback={<div className="page-route-loading">백업을 여는 중…</div>}>
              <BackupWorkspace />
            </React.Suspense>
          )}
          {isCommentsView && (
            <main className="memo-workspace">
              <React.Suspense fallback={<p role="status">공유 댓글을 여는 중…</p>}>
                <CommentsWorkspace onNavigate={navigate} />
              </React.Suspense>
            </main>
          )}
          {promptsVisited && (
            <React.Suspense
              fallback={
                isPromptView ? <div className="page-route-loading">프롬프트를 여는 중…</div> : null
              }
            >
              <PromptWorkspace
                visible={isPromptView}
                requestedId={route.promptId}
                templates={templates}
                libraryError={libraryError}
                loading={libraryLoading && !libraryReady}
                ready={libraryReady}
                onReload={() => void reloadLibrary()}
                legacyTemplates={legacyTemplates}
                legacyError={legacyError}
                onImport={async (items, browserSource) => {
                  const result = await importTemplates(items, browserSource);
                  setAiTemplateId(
                    (current) =>
                      result.mappings.find((entry) => entry.sourceId === current)?.targetId ||
                      current,
                  );
                  return result;
                }}
                onSave={saveTemplate}
                onNavigate={navigate}
                onUse={useTemplate}
              />
            </React.Suspense>
          )}
          <TaskWorkspace
            mode={isTaskView ? 'full' : isInboxView ? 'panel' : 'hidden'}
            panelTarget={taskPanelTarget}
            onOpenAll={() => navigate('/tasks')}
            onNavigate={navigate}
          />
          <React.Suspense
            fallback={
              isPageView ? <div className="page-route-loading">페이지를 여는 중…</div> : null
            }
          >
            <PageWorkspace
              key={route.pageId || 'all'}
              selectedId={route.pageId}
              navigate={navigate}
              sidebarTarget={sidebarTarget}
              toolbarTarget={isPageView ? pageToolbarTarget : null}
              dashboardTarget={isInboxView ? dashboardPageTarget : null}
              continueTarget={isInboxView ? dashboardContinueTarget : null}
              showContent={isPageView}
              theme={activeTheme}
              onTrashed={onTrashed}
            />
          </React.Suspense>
        </div>
        {trashNotice && (
          <React.Suspense fallback={null}>
            <TrashNotice
              key={trashNotice.id}
              entry={trashNotice}
              onClose={() => setTrashNotice(null)}
            />
          </React.Suspense>
        )}
        {!mobileComposerOpen && !mobileMenu && !searchOpen && (
          <FloatingCreateMenu
            hasDraft={hasDraft}
            onMemo={openMobileComposer}
            onPage={() => void executeWorkspaceCommand('page')}
          />
        )}
        {notice && !isInboxView && (
          <div className="capture-context-notice" role="status">
            <span>{notice}</span>
            <button onClick={() => (noticeAi ? navigate('/ai') : openMemo())}>
              {noticeAi ? '요청 보기' : '메모 보기'}
            </button>
          </div>
        )}
        {captureRouteError && (
          <div className="capture-route-error" role="alert">
            <span>{captureRouteError}</span>
            <button onClick={() => setCaptureRetry((value) => value + 1)}>다시 불러오기</button>
            <button onClick={() => navigate('/memo')}>메모 목록으로</button>
          </div>
        )}
        {selected && (isInboxView || isMemoView) && (
          <MemoDetailSurface
            inline={isMemoView && memoDesktop}
            target={memoDetailTarget}
            onBackdrop={() => {
              if (!editingCapture && !importOpen && !aiFollowup) closeCapture();
            }}
          >
            <aside
              className={
                'detail-panel' +
                (selected.aiRequest ? ' ai-capture-detail' : '') +
                (importOpen || aiFollowup ? ' capture-import-panel' : '')
              }
              role={isMemoView && memoDesktop ? 'region' : 'dialog'}
              aria-modal={isMemoView && memoDesktop ? undefined : true}
              aria-label="보관한 항목"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {aiFollowup ? (
                <React.Suspense fallback={<p role="status">추가 요청을 여는 중…</p>}>
                  <AiFollowupComposer
                    job={aiFollowup.job}
                    initialSource={aiFollowup.source}
                    editRequest={aiFollowup.editRequest}
                    onBack={() => {
                      if (!importBusy) setAiFollowup(null);
                    }}
                    onBusy={setImportBusy}
                    onCreated={(capture) => {
                      setAiFollowup(null);
                      setNotice('원본을 보존하고 새 AI 요청을 등록했어요.');
                      setNoticeAi(true);
                      void loadItems();
                      navigate(`/captures/${capture.id}`, true);
                    }}
                  />
                </React.Suspense>
              ) : importOpen ? (
                <React.Suspense fallback={<p role="status">정리 화면을 불러오는 중…</p>}>
                  <CapturePageImport
                    key={selected.id}
                    capture={selected}
                    aiJob={importAiJob?.captureId === selected.id ? importAiJob : null}
                    expanded
                    onExpand={() => setImportOpen(true)}
                    onBack={() => {
                      if (!importBusy) setImportOpen(false);
                    }}
                    onBusy={setImportBusy}
                    navigate={(path) => navigate(path, true)}
                  />
                </React.Suspense>
              ) : (
                <>
                  {isMemoView && !aiResultView && (
                    <div className="memo-detail-navigation" aria-label="메모 이동">
                      <button
                        disabled={
                          editingCapture ||
                          editBusy ||
                          trashPending ||
                          items.findIndex((item) => item.id === selected.id) <= 0
                        }
                        onClick={() =>
                          openCapture(items[items.findIndex((item) => item.id === selected.id) - 1])
                        }
                      >
                        이전
                      </button>
                      <span>
                        {items.findIndex((item) => item.id === selected.id) >= 0
                          ? `${items.findIndex((item) => item.id === selected.id) + 1} / ${items.length}`
                          : '검색 범위 밖의 메모'}
                      </span>
                      <button
                        disabled={
                          editingCapture ||
                          editBusy ||
                          trashPending ||
                          items.findIndex((item) => item.id === selected.id) < 0 ||
                          items.findIndex((item) => item.id === selected.id) >= items.length - 1
                        }
                        onClick={() =>
                          openCapture(items[items.findIndex((item) => item.id === selected.id) + 1])
                        }
                      >
                        다음
                      </button>
                    </div>
                  )}
                  {editingCapture && isMemoView && (
                    <p className="memo-edit-guidance">
                      수정 내용을 저장하거나 취소하면 다른 메모를 열 수 있어요.
                    </p>
                  )}
                  <div className="detail-top">
                    <span className="detail-eyebrow">
                      {aiResultView ? 'AI 결과' : selected.aiRequest ? '요청 원본' : '메모'}
                    </span>
                    <div className="detail-top-actions">
                      {!editingCapture && (
                        <button
                          className="detail-edit-trigger"
                          disabled={trashPending}
                          onClick={startCaptureEdit}
                        >
                          <Pencil size={15} /> 항목 수정
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={editingCapture ? '수정 취소' : '닫기'}
                        disabled={editBusy}
                        onClick={editingCapture ? cancelCaptureEdit : closeCapture}
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                  {!aiResultView && (
                    <>
                      {selected.aiRequest && <h2 className="memo-detail-section-label">원문</h2>}
                      <div className={`detail-icon capture-icon-${selected.kind}`}>
                        {React.createElement(iconFor(selected.kind), { size: 26 })}
                      </div>
                      <span className="detail-type">
                        {kinds.find((option) => option.id === selected.kind)?.label}
                      </span>
                      <RecordTimestamps
                        createdAt={selected.createdAt}
                        updatedAt={selected.updatedAt}
                      />
                      {editingCapture ? (
                        <form className="detail-edit-form" onSubmit={saveCaptureEdit}>
                          {selected.kind === 'link' && (
                            <label className="detail-edit-field">
                              <span>링크 주소</span>
                              <input
                                aria-label="보관한 링크 주소"
                                type="url"
                                value={editUrl}
                                onChange={(event) => setEditUrl(event.target.value)}
                                disabled={editBusy}
                              />
                            </label>
                          )}
                          <label className="detail-edit-field">
                            <span>{selected.kind === 'note' ? '내용' : '설명'}</span>
                            <textarea
                              aria-label="보관한 내용"
                              value={editText}
                              onChange={(event) => setEditText(event.target.value)}
                              maxLength={10000}
                              rows={8}
                              disabled={editBusy}
                              autoFocus
                            />
                          </label>
                          {editError && (
                            <div className="detail-edit-error" role="alert">
                              <span>{editError}</span>
                              {conflictCapture && (
                                <button type="button" onClick={loadConflictCapture}>
                                  최신 내용 불러오기
                                </button>
                              )}
                            </div>
                          )}
                          <div className="detail-edit-actions">
                            <button type="button" onClick={cancelCaptureEdit} disabled={editBusy}>
                              취소
                            </button>
                            <button type="submit" disabled={editBusy}>
                              {editBusy ? '저장 중…' : '변경 저장'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          {selected.url && (
                            <a
                              className="detail-link"
                              href={selected.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Link2 size={17} />
                              <span>{selected.url}</span>
                              <ArrowUpRight size={16} />
                            </a>
                          )}
                          {selected.text && <p className="detail-text">{selected.text}</p>}
                        </>
                      )}
                    </>
                  )}
                  {selected.aiRequest && !editingCapture && (
                    <React.Suspense fallback={<p role="status">AI 요청을 불러오는 중…</p>}>
                      <AiJobPanel
                        key={selected.id}
                        capture={selected}
                        onJobChange={updateAiJob}
                        compactResult={!aiResultView}
                        onAdditionalRequest={(job, source, editRequest = false) => {
                          setAiFollowup({ job: structuredClone(job), source, editRequest });
                        }}
                        onOrganize={(job) => {
                          setImportAiJob(job);
                          setImportOpen(true);
                        }}
                      />
                    </React.Suspense>
                  )}
                  {aiResultView && (
                    <details className="ai-original-note">
                      <summary>원문 · 현재 메모</summary>
                      <RecordTimestamps
                        createdAt={selected.createdAt}
                        updatedAt={selected.updatedAt}
                      />
                      {selected.url && (
                        <a
                          className="detail-link"
                          href={selected.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {selected.url}
                        </a>
                      )}
                      {selected.text && <p className="detail-text">{selected.text}</p>}
                    </details>
                  )}
                  {!!selected.files.length && (
                    <div className="detail-files">
                      <h3>
                        첨부 파일 <span>{selected.files.length}</span>
                      </h3>
                      {selected.files.map((file) => (
                        <div key={file.id}>
                          <a
                            key={file.id}
                            href={file.localUrl ?? `/api/assets/${file.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="detail-file"
                          >
                            {file.mime.startsWith('image/') ? (
                              <FileImage size={20} />
                            ) : (
                              <File size={20} />
                            )}
                            <span>
                              <strong>{file.name}</strong>
                              <small>{fileSize(file.size)}</small>
                            </span>
                            <ArrowUpRight size={17} />
                          </a>
                          {/^image\/(png|jpeg|webp)$/.test(file.mime) && (
                            <React.Suspense fallback={null}>
                              <AssetOcr assetId={file.id} />
                            </React.Suspense>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!editingCapture &&
                    !trashPending &&
                    ((!aiResultView && selected.latestAiJob?.status !== 'result_ready') || Boolean(selected.organizedAt)) && (
                      <section className="memo-connections" aria-label="메모 정리">
                        {!aiResultView && selected.latestAiJob?.status !== 'result_ready' && (
                          <React.Suspense fallback={<p role="status">페이지 정리를 불러오는 중…</p>}>
                            <CapturePageImport
                              key={selected.id}
                              capture={selected}
                              expanded={false}
                              onExpand={() => {
                                setImportAiJob(null);
                                setImportOpen(true);
                              }}
                              onBack={() => setImportOpen(false)}
                              onBusy={setImportBusy}
                              navigate={navigate}
                            />
                          </React.Suspense>
                        )}
                        {selected.organizedAt && (
                          <React.Suspense fallback={null}>
                            <CaptureOrganization
                              key={selected.id}
                              capture={selected}
                              disabled={editingCapture || trashPending || importBusy}
                              onRestored={setSelected}
                            />
                          </React.Suspense>
                        )}
                      </section>
                  )}
                  {!editingCapture && (
                    <React.Suspense fallback={null}>
                      <TrashAction
                        key={selected.id}
                        kind="capture"
                        id={selected.id}
                        version={selected.version}
                        onMoved={onTrashed}
                        onPendingChange={setTrashPending}
                      />
                    </React.Suspense>
                  )}
                </>
              )}
            </aside>
          </MemoDetailSurface>
        )}
        {batchCaptures && (
          <React.Suspense
            fallback={
              <p className="page-route-loading" role="status">
                정리 화면을 여는 중…
              </p>
            }
          >
            <CaptureBatchImport
              captures={batchCaptures}
              onClose={() => {
                setBatchCaptures(null);
                setBatchPending(hasPendingCaptureBatch());
              }}
              onDone={(page) => {
                setBatchCaptures(null);
                setBatchPending(hasPendingCaptureBatch());
                void loadItems();
                navigate(`/pages/${page.id}`);
              }}
            />
          </React.Suspense>
        )}
        {isMemoView && items.some((item) => activeAiJob(item.latestAiJob)) && (
          <React.Suspense fallback={null}>
            <AiListUpdates items={items} onJobChange={updateAiJob} />
          </React.Suspense>
        )}
      </div>
    </WorkspaceToolbarContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <AuthBoundary>
    <App />
  </AuthBoundary>,
);
