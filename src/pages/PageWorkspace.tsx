import { setWorkspaceNotice } from '../workspace/notices';
import { onlineActionFetch, PENDING_REASON } from '../sync/onlineActions';
import { workspaceFetch } from '../sync/runtime';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronRight, FileText, FolderInput, LayoutTemplate, Plus } from 'lucide-react';
import { PageNavContext } from './pageNav';
import type { PageRecord, PageSummary } from './types';
import type { TrashEntry } from '../trash/types';
import { subscribeRecordChanges } from '../trash/events';
import { formatKoreanTime } from '../time';
import './pages.css';
import './workspaceNavigation.css';
import WorkspaceMovePicker from './WorkspaceMovePicker';
import {
  PageWorkspaceContext,
  WORKSPACE_PAGE_MOVE_EVENT,
  WORKSPACE_PAGE_FAVORITE_EVENT,
} from './workspaceNavigation';
import type { WorkspacePageSnapshot, WorkspacePageSummary } from './workspaceNavigation';

const DocumentBlueprintPicker = lazy(() => import('./DocumentBlueprintPicker'));
import type { DocumentBlueprintPayload } from '../../shared/documentBlueprints';

const PageEditor = lazy(() => import('./PageEditor'));

type Props = {
  selectedId: string | null;
  navigate: (path: string) => void;
  sidebarTarget: HTMLElement | null;
  toolbarTarget: HTMLElement | null;
  dashboardTarget: HTMLElement | null;
  continueTarget?: HTMLElement | null;
  showContent: boolean;
  theme: 'light' | 'dark';
  onTrashed: (entry: TrashEntry) => void;
};

export default function PageWorkspace({
  selectedId,
  navigate,
  sidebarTarget,
  toolbarTarget,
  dashboardTarget,
  continueTarget = null,
  showContent,
  theme,
  onTrashed,
}: Props) {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [page, setPage] = useState<PageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('leneu:sidebar-collapsed') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [leafOpen, setLeafOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('leneu:sidebar-leaf-open') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [dropHint, setDropHint] = useState<{
    id: string;
    mode: 'before' | 'after' | 'inside' | 'end';
  } | null>(null);
  const dragId = useRef<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePageSnapshot>({
    favorites: [],
    recentVisited: [],
    favoriteIds: [],
  });
  const [preferenceFailure, setPreferenceFailure] = useState<{
    message: string;
    input?: { pageId: string; favorite?: boolean; visited?: boolean };
  } | null>(null);
  const [favoritePendingIds, setFavoritePendingIds] = useState<Set<string>>(new Set());
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveFeedback, setMoveFeedback] = useState<{
    message: string;
    failed?: { id: string; parentId: string | null; position: number };
  } | null>(null);
  const preferenceRequest = useRef(0);
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const lastVisitedId = useRef<string | null>(null);
  const favoriteIds = useMemo(() => new Set(workspace.favoriteIds), [workspace.favoriteIds]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function refreshWorkspace() {
    const operation = preferenceQueue.current.then(async () => {
      const request = ++preferenceRequest.current;
      try {
        const response = await workspaceFetch('/api/workspace/pages');
        if (!response.ok) throw new Error('즐겨찾기와 최근 열람을 불러오지 못했어요.');
        const snapshot = (await response.json()) as WorkspacePageSnapshot;
        if (mounted.current && request === preferenceRequest.current) {
          setWorkspace(snapshot);
          setPreferenceFailure((current) => (current?.input ? current : null));
        }
      } catch (cause) {
        if (mounted.current && request === preferenceRequest.current)
          setPreferenceFailure((current) =>
            current?.input
              ? current
              : {
                  message:
                    cause instanceof Error ? cause.message : '탐색 정보를 불러오지 못했어요.',
                },
          );
      }
    });
    preferenceQueue.current = operation;
    return operation;
  }

  function saveWorkspace(input: { pageId: string; favorite?: boolean; visited?: boolean }) {
    const operation = preferenceQueue.current.then(async () => {
      const request = ++preferenceRequest.current;
      try {
        const response = await onlineActionFetch(`/api/pages/${input.pageId}/workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, pageId: undefined }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || '탐색 설정을 저장하지 못했어요.');
        }
        const snapshot = (await response.json()) as WorkspacePageSnapshot;
        if (mounted.current && request === preferenceRequest.current) {
          setWorkspace(snapshot);
          setPreferenceFailure((current) =>
            !current?.input ||
            (current.input.pageId === input.pageId &&
              current.input.favorite === input.favorite &&
              current.input.visited === input.visited)
              ? null
              : current,
          );
        }
      } catch (cause) {
        if (mounted.current)
          setPreferenceFailure({
            message: cause instanceof Error ? cause.message : '탐색 설정을 저장하지 못했어요.',
            input,
          });
      }
    });
    preferenceQueue.current = operation;
    return operation;
  }

  async function toggleFavorite(id: string) {
    if (favoritePendingIds.has(id)) return;
    setFavoritePendingIds((current) => new Set(current).add(id));
    await saveWorkspace({ pageId: id, favorite: !favoriteIds.has(id) });
    if (mounted.current)
      setFavoritePendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
  }

  useEffect(() => {
    void refreshWorkspace();
    const onFocus = () => void refreshWorkspace();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (!showContent || selectedId !== lastVisitedId.current) lastVisitedId.current = null;
  }, [selectedId, showContent]);

  useEffect(() => {
    const requestMove = (event: Event) => {
      const id = (event as CustomEvent<{ pageId: string }>).detail?.pageId;
      if (pages.some((item) => item.id === id)) setMoveId(id);
    };
    const requestFavorite = (event: Event) => {
      const id = (event as CustomEvent<{ pageId: string }>).detail?.pageId;
      if (pages.some((item) => item.id === id)) void toggleFavorite(id);
    };
    window.addEventListener(WORKSPACE_PAGE_MOVE_EVENT, requestMove);
    window.addEventListener(WORKSPACE_PAGE_FAVORITE_EVENT, requestFavorite);
    return () => {
      window.removeEventListener(WORKSPACE_PAGE_MOVE_EVENT, requestMove);
      window.removeEventListener(WORKSPACE_PAGE_FAVORITE_EVENT, requestFavorite);
    };
  }, [pages, favoriteIds, favoritePendingIds]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [listResponse, pageResponse] = await Promise.all([
          workspaceFetch('/api/pages'),
          selectedId ? workspaceFetch('/api/pages/' + selectedId) : Promise.resolve(null),
        ]);
        const listData = listResponse.ok ? await listResponse.json() : null;
        if (active && listData) setPages(listData.items);
        if (!listResponse.ok || (pageResponse && !pageResponse.ok))
          throw new Error(
            pageResponse?.status === 404
              ? '페이지를 찾을 수 없습니다.'
              : pageResponse && !pageResponse.ok ? ((await pageResponse.json()).error || '페이지를 불러오지 못했습니다.') : '페이지를 불러오지 못했습니다.',
          );
        const list = listData as {
          items: PageSummary[];
          stagingPageId: string | null;
        };
        const detail = pageResponse ? ((await pageResponse.json()) as { item: PageRecord }) : null;
        if (!active) return;
        setPages(list.items);
        setPage(detail?.item || null);
        // Retained editor state is not evidence of a successful new opening.
        if (
          showContent &&
          detail?.item.id === selectedId &&
          detail.item.id !== lastVisitedId.current
        ) {
          lastVisitedId.current = detail.item.id;
          void saveWorkspace({ pageId: detail.item.id, visited: true });
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : '페이지를 불러오지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [selectedId, showContent, retry]);

  // Refresh navigation without replacing an open editor or its unsaved draft.
  useEffect(() => {
    let active = true;
    let request = 0;
    const unsubscribe = subscribeRecordChanges(() => {
      void refreshWorkspace();
      const current = ++request;
      void workspaceFetch('/api/pages')
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json()) as { items: PageSummary[] };
          if (active && current === request && Array.isArray(data.items)) setPages(data.items);
        })
        .catch(() => {});
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function createPage(blueprint?: DocumentBlueprintPayload) {
    if (creating) return;
    setCreating(true);
    try {
      const response = await workspaceFetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blueprint ?? { title: '제목 없음' }),
      });
      if (!response.ok) throw new Error('새 페이지를 만들지 못했습니다.');
      const { item } = (await response.json()) as { item: PageRecord };
      setBlueprintsOpen(false);
      navigate('/pages/' + item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '새 페이지를 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  }

  const pagesByParent = useMemo(() => {
    const ids = new Set(pages.map((item) => item.id));
    const grouped = new Map<string | null, PageSummary[]>();
    for (const item of pages) {
      const key = item.parentId && ids.has(item.parentId) ? item.parentId : null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }
    for (const items of grouped.values())
      items.sort((a, b) => a.position - b.position || b.updatedAt.localeCompare(a.updatedAt));
    return grouped;
  }, [pages]);
  const recentPages = useMemo(
    () =>
      [...pages]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
        .slice(0, 4),
    [pages],
  );

  useEffect(() => {
    if (!selectedId) return;
    const byId = new Map(pages.map((item) => [item.id, item]));
    const ancestors = new Set<string>();
    let parentId = byId.get(selectedId)?.parentId;
    while (parentId && !ancestors.has(parentId) && parentId !== selectedId) {
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    setCollapsed((current) => {
      if (![...ancestors].some((id) => current.has(id))) return current;
      const next = new Set(current);
      ancestors.forEach((id) => next.delete(id));
      try {
        localStorage.setItem('leneu:sidebar-collapsed', JSON.stringify([...next]));
      } catch {
        /* Keep current navigation usable without browser storage. */
      }
      return next;
    });
  }, [selectedId, pages]);

  function parentKeyOf(item: PageSummary) {
    return item.parentId && pagesByParent.has(item.parentId) ? item.parentId : null;
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('leneu:sidebar-collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  function toggleLeafOpen(id: string) {
    setLeafOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('leneu:sidebar-leaf-open', JSON.stringify([...next]));
      return next;
    });
  }

  function descendantsOf(id: string, found = new Set<string>()) {
    for (const child of pagesByParent.get(id) ?? []) {
      if (!found.has(child.id)) {
        found.add(child.id);
        descendantsOf(child.id, found);
      }
    }
    return found;
  }

  async function movePage(id: string, parentId: string | null, position: number) {
    try {
      const response = await onlineActionFetch(`/api/pages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, position }),
      });
      if (!response.ok) throw new Error('페이지를 옮기지 못했어요.');
      const { item } = (await response.json()) as { item: PageSummary };
      setPages((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, parentId: item.parentId, position: item.position, version: item.version }
            : entry,
        ),
      );
      setMoveFeedback({ message: '페이지를 옮겼어요.' });
      return true;
    } catch {
      setMoveFeedback({ message: '페이지를 옮기지 못했어요.', failed: { id, parentId, position } });
      return false;
    }
  }

  function rowDragOver(item: PageSummary) {
    return (event: DragEvent<HTMLDivElement>) => {
      const moving = dragId.current;
      if (!moving || moving === item.id) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const mode = y < rect.height * 0.28 ? 'before' : y > rect.height * 0.72 ? 'after' : 'inside';
      const targetParent = mode === 'inside' ? item.id : parentKeyOf(item);
      if (targetParent && descendantsOf(moving).has(targetParent)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropHint({ id: item.id, mode });
    };
  }

  async function rowDrop(item: PageSummary, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const moving = dragId.current;
    const hint = dropHint;
    setDropHint(null);
    if (!moving || !hint || hint.id !== item.id) return;
    let parentId: string | null;
    let position: number;
    if (hint.mode === 'inside') {
      parentId = item.id;
      const kids = pagesByParent.get(item.id) ?? [];
      position = (kids.at(-1)?.position ?? 0) + 1;
      setCollapsed((current) => {
        if (!current.has(item.id)) return current;
        const next = new Set(current);
        next.delete(item.id);
        localStorage.setItem('leneu:sidebar-collapsed', JSON.stringify([...next]));
        return next;
      });
    } else {
      parentId = parentKeyOf(item);
      const siblings = pagesByParent.get(parentId) ?? [];
      const index = siblings.findIndex((entry) => entry.id === item.id);
      const near = hint.mode === 'before' ? siblings[index - 1] : siblings[index + 1];
      position = near
        ? (near.position + item.position) / 2
        : item.position + (hint.mode === 'before' ? -1 : 1);
    }
    await movePage(moving, parentId, position);
  }

  function onSaved(saved: PageRecord) {
    const { document: _document, ...summary } = saved;
    setPages((current) => current.map((item) => (item.id === saved.id ? summary : item)));
  }

  function pageLink(path: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      navigate(path);
    };
  }

  const [treeLimit,setTreeLimit]=useState(50);
  const visibleTree=useMemo(()=>{
    const ids:string[]=[];const visited=new Set<string>();
    const visit=(parentId:string|null)=>{for(const item of pagesByParent.get(parentId)??[]){if(visited.has(item.id))continue;visited.add(item.id);ids.push(item.id);if(!collapsed.has(item.id))visit(item.id);}};
    visit(null);const allowed=new Set(ids.slice(0,treeLimit));
    // Opening a deep link always reveals the selected page and its ancestors.
    let selected=pages.find(p=>p.id===selectedId);const ancestors=new Set<string>();
    while(selected&&!ancestors.has(selected.id)){ancestors.add(selected.id);allowed.add(selected.id);selected=pages.find(p=>p.id===selected?.parentId);}
    return {allowed,total:ids.length};
  },[pages,pagesByParent,collapsed,selectedId,treeLimit]);
  function renderPages(parentId: string | null, depth: number): ReactNode {
    return (pagesByParent.get(parentId) ?? []).filter(item=>visibleTree.allowed.has(item.id)).map((item) => {
      const kids = pagesByParent.get(item.id) ?? [];
      const expanded = kids.length ? !collapsed.has(item.id) : leafOpen.has(item.id);
      const hint = dropHint?.id === item.id ? dropHint.mode : null;
      return (
        <Fragment key={item.id}>
          <div
            className={
              'sidebar-page-row' +
              (expanded ? ' expanded' : '') +
              (selectedId === item.id ? ' active' : '') +
              (hint ? ` drop-${hint}` : '')
            }
            style={depth ? { paddingLeft: 4 + Math.min(depth, 4) * 8 } : undefined}
            draggable
            onDragStart={(event) => {
              dragId.current = item.id;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', item.id);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDropHint(null);
            }}
            onDragOver={rowDragOver(item)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDropHint((current) => (current?.id === item.id ? null : current));
            }}
            onDrop={(event) => void rowDrop(item, event)}
          >
            <button
              type="button"
              className={
                'sidebar-page-toggle' + (expanded ? ' on' : '') + (kids.length ? ' kids' : '')
              }
              aria-label={expanded ? '하위 페이지 접기' : '하위 페이지 펼치기'}
              aria-expanded={expanded}
              onClick={() => (kids.length ? toggleCollapsed(item.id) : toggleLeafOpen(item.id))}
            >
              <ChevronRight
                size={12}
                className={'sidebar-page-chevron' + (expanded ? ' open' : '')}
              />
              <span className="sidebar-page-icon" aria-hidden>
                {item.icon || <FileText size={15} />}
              </span>
            </button>
            <a
              href={'/pages/' + item.id}
              onClick={pageLink('/pages/' + item.id)}
              className="sidebar-page-item"
              title={item.title}
              aria-current={selectedId === item.id ? 'page' : undefined}
            >
              <span>{item.title}</span>
              <span className="workspace-title-tip" aria-hidden="true">
                {item.title}
              </span>
            </a>
            <button
              type="button"
              className="workspace-row-action"
              title="페이지 이동"
              data-workspace-move={item.id}
              aria-label={`${item.title} 페이지 이동`}
              onClick={() => setMoveId(item.id)}
            >
              <FolderInput size={14} />
            </button>
          </div>
          {expanded && (
            <div className="sidebar-page-children" role="group" aria-label={`${item.title} 하위 페이지`}
              style={{'--sidebar-guide-left': `${8 + Math.min(depth,4) * 8}px`} as CSSProperties}>
            {kids.length ? renderPages(item.id, depth + 1) : (
            <div
              className="sidebar-page-empty"
              style={{ paddingLeft: 22 + Math.min(depth + 1, 4) * 8 }}
            >
              하위 페이지 없음
            </div>
            )}
            </div>
          )}
        </Fragment>
      );
    });
  }

  function retryPreference() {
    return preferenceFailure?.input ? saveWorkspace(preferenceFailure.input) : refreshWorkspace();
  }

  useEffect(() => {
    setWorkspaceNotice('page-navigation', preferenceFailure ? {
      title: preferenceFailure.input?.favorite !== undefined ? '즐겨찾기 저장 확인'
        : preferenceFailure.input?.visited ? '최근 열람 기록 확인' : '페이지 탐색 정보 확인',
      message: preferenceFailure.message === PENDING_REASON
        ? '문서의 서버 반영을 기다리면서 이 작업을 보류했어요. 동기화가 완료됐으면 다시 시도해 주세요.'
        : preferenceFailure.message,
      retry: retryPreference,
    } : null);
  }, [preferenceFailure]);
  useEffect(() => () => setWorkspaceNotice('page-navigation', null), []);

  function visibleQuickPages(items: WorkspacePageSummary[]) {
    const active = new Map(pages.map((item) => [item.id, item]));
    return items
      .filter((item) => active.has(item.id))
      .map((item) => ({ ...item, ...active.get(item.id)! }));
  }

  function renderQuickList(label: string, items: WorkspacePageSummary[], empty: string) {
    const visible = visibleQuickPages(items);
    return (
      <section className="workspace-quick-section" aria-label={label}>
        <h2>{label}</h2>
        <nav aria-label={label + ' 페이지'}>
          {visible.map((item) => (
            <a
              key={item.id}
              href={'/pages/' + item.id}
              className="workspace-quick-link"
              title={item.title}
              aria-current={selectedId === item.id ? 'page' : undefined}
              onClick={pageLink('/pages/' + item.id)}
            >
              <span className="workspace-quick-icon" aria-hidden>
                {item.icon || <FileText size={14} />}
              </span>
              <span className="workspace-quick-title">{item.title}</span>
              <span className="workspace-title-tip" aria-hidden="true">
                {item.title}
              </span>
            </a>
          ))}
        </nav>
        {!visible.length && <p>{empty}</p>}
      </section>
    );
  }

  function renderContinueList(label: string, items: WorkspacePageSummary[]) {
    const visible = visibleQuickPages(items).slice(0, 3);
    if (!visible.length) return null;
    return (
      <div className="workspace-continue-group">
        <h3>{label}</h3>
        <div className="workspace-continue-links">
          {visible.map((item) => (
            <a
              key={item.id}
              href={'/pages/' + item.id}
              title={item.title}
              onClick={pageLink('/pages/' + item.id)}
            >
              <FileText size={14} aria-hidden />
              <span>{item.title}</span>
              <span className="workspace-title-tip" aria-hidden="true">
                {item.title}
              </span>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {sidebarTarget &&
        createPortal(
          <div className="sidebar-pages workspace-navigation">
            {renderQuickList(
              '즐겨찾기',
              workspace.favorites,
              '페이지에서 즐겨찾기를 추가해요.',
            )}
            <div className="sidebar-pages-heading">
              <span>내 페이지</span>
              <button
                type="button"
                onClick={() => void createPage()}
                disabled={creating}
                aria-label="새 페이지"
              >
                <Plus size={15} />
              </button>
            </div>
            <nav className="sidebar-pages-list" aria-label="페이지 목록">
              {renderPages(null, 0)}
              {visibleTree.total>treeLimit&&<button type="button" className="sidebar-load-more" onClick={()=>setTreeLimit(n=>n+50)}>페이지 50개 더 보기</button>}
              {!loading && !pages.length && <p>아직 페이지가 없어요.</p>}
              {!!pages.length && (
                <div
                  className={
                    'sidebar-pages-dropzone' + (dropHint?.mode === 'end' ? ' drop-end' : '')
                  }
                  onDragOver={(event) => {
                    if (!dragId.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropHint({ id: '__end__', mode: 'end' });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const moving = dragId.current;
                    setDropHint(null);
                    if (!moving) return;
                    const roots = pagesByParent.get(null) ?? [];
                    void movePage(moving, null, (roots.at(-1)?.position ?? 0) + 1);
                  }}
                />
              )}
            </nav>
          </div>,
          sidebarTarget,
        )}
      {continueTarget &&
        createPortal(
          <section className="workspace-continue" aria-label="이어서 작업하기">
            <h2>이어서 작업하기</h2>
            {renderContinueList('최근 열람', workspace.recentVisited)}
            {renderContinueList('즐겨찾기', workspace.favorites)}
            {!workspace.recentVisited.length && !workspace.favorites.length && (
              <p>페이지를 열거나 즐겨찾기에 추가하면 바로 이어서 작업할 수 있어요.</p>
            )}
          </section>,
          continueTarget,
        )}
      {moveId &&
        pages.some((item) => item.id === moveId) &&
        createPortal(
          <WorkspaceMovePicker
            key={moveId}
            pageId={moveId}
            pages={pages}
            excludedIds={new Set([moveId, ...descendantsOf(moveId)])}
            onMove={(parentId, position) => movePage(moveId, parentId, position)}
            onClose={() => setMoveId(null)}
          />,
          document.body,
        )}
      {moveFeedback &&
        !moveId &&
        createPortal(
          <div className="workspace-move-feedback" role={moveFeedback.failed ? 'alert' : 'status'}>
            <span>{moveFeedback.message}</span>
            {moveFeedback.failed && (
              <button
                type="button"
                onClick={() => {
                  const action = moveFeedback.failed!;
                  void movePage(action.id, action.parentId, action.position);
                }}
              >
                다시 이동
              </button>
            )}
            <button type="button" onClick={() => setMoveFeedback(null)} aria-label="이동 안내 닫기">
              닫기
            </button>
          </div>,
          document.body,
        )}
      {dashboardTarget &&
        createPortal(
          <section className="dashboard-page-section" aria-label="최근 페이지">
            <div className="dashboard-section-heading">
              <h2>최근 페이지</h2>
              <div className="dashboard-page-create-actions">
                <button type="button" aria-label="템플릿으로 만들기" onClick={() => { setError(''); setBlueprintsOpen(true); }} disabled={creating}>
                  <LayoutTemplate size={14} aria-hidden="true" /> 템플릿
                </button>
                <button type="button" aria-label="새 페이지 만들기" onClick={() => void createPage()} disabled={creating}>
                  <Plus size={16} aria-hidden="true" /> 새 페이지
                </button>
              </div>
            </div>
            {error ? (
              <div className="dashboard-page-message" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => setRetry((value) => value + 1)}>
                  다시 불러오기
                </button>
              </div>
            ) : loading ? (
              <p className="dashboard-page-message" role="status">
                페이지를 불러오는 중…
              </p>
            ) : recentPages.length ? (
              <div className="dashboard-page-list">
                {recentPages.map((item) => (
                  <a
                    key={item.id}
                    href={'/pages/' + item.id}
                    onClick={pageLink('/pages/' + item.id)}
                    className="dashboard-page-row"
                    title={item.title}
                  >
                    <span className="dashboard-page-icon" aria-hidden="true">
                      {item.icon || <FileText size={18} />}
                    </span>
                    <span className="dashboard-page-copy">
                      <strong>{item.title}</strong>
                      <time dateTime={item.updatedAt}>수정 {formatKoreanTime(item.updatedAt)}</time>
                    </span>
                    <ArrowRight size={16} className="dashboard-page-arrow" aria-hidden="true" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="dashboard-page-message">
                아직 페이지가 없어요. 메모를 정리하거나 새 페이지를 만들어보세요.
              </p>
            )}
          </section>,
          dashboardTarget,
        )}
      {showContent && (
        <section className="pages-workspace">
          {error && (
            <div className="pages-error" role="alert">
              {error}
              <button
                type="button"
                className="prompt-text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                다시 불러오기
              </button>
              {error === '페이지를 찾을 수 없습니다.' && (
                <button
                  type="button"
                  className="prompt-text-button"
                  onClick={() => navigate('/trash')}
                >
                  휴지통 보기
                </button>
              )}
            </div>
          )}
          {loading ? (
            <div className="pages-loading">페이지를 불러오는 중…</div>
          ) : page ? (
            <Suspense fallback={<div className="pages-loading">편집기를 여는 중…</div>}>
              <PageNavContext.Provider value={navigate}>
                <PageWorkspaceContext.Provider
                  value={{
                    favoriteIds,
                    favoritePendingIds,
                    requestMove: setMoveId,
                    toggleFavorite: (id) => void toggleFavorite(id),
                  }}
                >
                  <PageEditor
                    key={page.id}
                    page={page}
                    pages={pages}
                    onSaved={onSaved}
                    theme={theme}
                    childCount={descendantsOf(page.id).size}
                    onTrashed={onTrashed}
                    toolbarTarget={toolbarTarget}
                  />
                </PageWorkspaceContext.Provider>
              </PageNavContext.Provider>
            </Suspense>
          ) : null}
        </section>
      )}
      {blueprintsOpen && <Suspense fallback={<p role="status">템플릿을 여는 중…</p>}>
        <DocumentBlueprintPicker error={error} disabled={creating} onClose={() => setBlueprintsOpen(false)} onSelect={(payload) => void createPage(payload)} />
      </Suspense>}
    </>
  );
}
