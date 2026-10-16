import { PageValidationError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { pageTransaction } from './pageConnections.mjs';

// Private navigation preferences never enter Page JSON, revisions or public projections.
export function createWorkspacePageStore(db, _owner) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_workspace (
      page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      favorite_at TEXT,
      last_visited_at TEXT
    );
    CREATE INDEX IF NOT EXISTS page_workspace_favorites
      ON page_workspace(favorite_at DESC,page_id) WHERE favorite=1;
    CREATE INDEX IF NOT EXISTS page_workspace_visits
      ON page_workspace(last_visited_at DESC,page_id) WHERE last_visited_at IS NOT NULL;
  `);
  const metadata = `p.id,p.title,p.icon,p.parent_id AS parentId,p.position,p.version,
    p.created_at AS createdAt,p.updated_at AS updatedAt,w.favorite,
    w.last_visited_at AS lastVisitedAt`;
  const favorites = db.prepare(`SELECT ${metadata} FROM page_workspace w
    JOIN pages p ON p.id=w.page_id WHERE w.favorite=1 AND p.deleted_at IS NULL
    ORDER BY w.favorite_at DESC,w.page_id LIMIT 8`);
  const visits = db.prepare(`SELECT ${metadata} FROM page_workspace w
    JOIN pages p ON p.id=w.page_id WHERE w.last_visited_at IS NOT NULL AND p.deleted_at IS NULL
    ORDER BY w.last_visited_at DESC,w.page_id LIMIT 8`);
  const favoriteIds = db.prepare(`SELECT w.page_id FROM page_workspace w
    JOIN pages p ON p.id=w.page_id WHERE w.favorite=1 AND p.deleted_at IS NULL
    ORDER BY w.favorite_at DESC,w.page_id LIMIT 100`);
  const active = db.prepare('SELECT id FROM pages WHERE id=? AND deleted_at IS NULL');
  const preference = db.prepare('SELECT * FROM page_workspace WHERE page_id=?');
  const count = db.prepare('SELECT count(*) AS count FROM page_workspace WHERE favorite=1');
  const latest = db.prepare(
    'SELECT max(last_visited_at) AS latest FROM page_workspace WHERE last_visited_at IS NOT NULL',
  );
  const write = db.prepare(`INSERT INTO page_workspace(page_id,favorite,favorite_at,last_visited_at)
    VALUES(?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET favorite=excluded.favorite,
    favorite_at=excluded.favorite_at,last_visited_at=excluded.last_visited_at`);
  const hydrate = (row) => ({ ...row, favorite: Boolean(row.favorite) });
  const listWorkspacePages = () => ({
    favorites: favorites.all().map(hydrate),
    recentVisited: visits.all().map(hydrate),
    favoriteIds: favoriteIds.all().map((row) => row.page_id),
  });
  return {
    listWorkspacePages,
    setPageWorkspace(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        typeof input.pageId !== 'string' ||
        !input.pageId ||
        Object.keys(input).some((key) => !['pageId', 'favorite', 'visited'].includes(key)) ||
        (!Object.hasOwn(input, 'favorite') && !Object.hasOwn(input, 'visited')) ||
        (Object.hasOwn(input, 'favorite') && typeof input.favorite !== 'boolean') ||
        (Object.hasOwn(input, 'visited') && typeof input.visited !== 'boolean')
      )
        throw new PageValidationError('페이지 탐색 설정을 확인해 주세요.');
      return pageTransaction(db, () => {
        if (!active.get(input.pageId)) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
        const previous = preference.get(input.pageId);
        if (input.favorite === true && !previous?.favorite && count.get().count >= 100)
          throw new PageValidationError('즐겨찾기는 100개까지 저장할 수 있어요.');
        const favorite =
          input.favorite === undefined ? (previous?.favorite ?? 0) : Number(input.favorite);
        const now = new Date().toISOString();
        // A monotonic stamp avoids ambiguous ordering for rapid visits in one millisecond.
        const previousVisit = Date.parse(latest.get().latest || '');
        const lastVisitedAt = input.visited
          ? new Date(
              Math.max(Date.now(), Number.isFinite(previousVisit) ? previousVisit + 1 : 0),
            ).toISOString()
          : (previous?.last_visited_at ?? null);
        write.run(
          input.pageId,
          favorite,
          favorite ? previous?.favorite_at || now : null,
          lastVisitedAt,
        );
        return listWorkspacePages();
      });
    },
  };
}
