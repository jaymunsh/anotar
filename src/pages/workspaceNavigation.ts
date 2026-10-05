import { createContext, useContext } from 'react';
import type { PageSummary } from './types';

export type WorkspacePageSummary = PageSummary & {
  favorite: boolean;
  lastVisitedAt: string | null;
};
export type WorkspacePageSnapshot = {
  favorites: WorkspacePageSummary[];
  recentVisited: WorkspacePageSummary[];
  favoriteIds: string[];
};
export const WORKSPACE_PAGE_MOVE_EVENT = 'leneu:workspace-page-move';
export const WORKSPACE_PAGE_FAVORITE_EVENT = 'leneu:workspace-page-favorite';
export function requestWorkspacePageMove(pageId: string) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PAGE_MOVE_EVENT, { detail: { pageId } }));
}
export function requestWorkspacePageFavorite(pageId: string) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PAGE_FAVORITE_EVENT, { detail: { pageId } }));
}
export type PageWorkspaceNavigation = {
  favoriteIds: ReadonlySet<string>;
  favoritePendingIds: ReadonlySet<string>;
  requestMove: (pageId: string) => void;
  toggleFavorite: (pageId: string) => void;
};
export const PageWorkspaceContext = createContext<PageWorkspaceNavigation>({
  favoriteIds: new Set(),
  favoritePendingIds: new Set(),
  requestMove: requestWorkspacePageMove,
  toggleFavorite: requestWorkspacePageFavorite,
});
export function usePageWorkspace() {
  return useContext(PageWorkspaceContext);
}
