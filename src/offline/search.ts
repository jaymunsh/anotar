import { getWorkspaceRuntime } from '../sync/runtime';
import { readLocalEntity, type Entity } from '../sync/repository';
import { querySummaries } from '../sync/summaries';
import type { SearchBatch, SearchItem, SearchType } from '../search/types';
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  return ['title', 'text', 'content', 'blocks', 'children', 'props', 'data', 'note', 'place']
    .map((key) => (item[key] === undefined ? '' : text(item[key])))
    .join(' ');
}
export async function searchLocalWorkspace({
  query,
  kinds = 'all',
  limit = 50,
}: {
  query: string;
  kinds?: SearchType;
  limit?: number;
}): Promise<SearchBatch> {
  const { workspaceId } = await getWorkspaceRuntime(),
    terms = query.normalize('NFC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),
    items: SearchItem[] = [];
  const matches = (body: string) =>
    terms.every((term) => body.normalize('NFC').toLocaleLowerCase().includes(term));
  const collect = (row: Entity) => {
    if (row.kind === 'journal') return;
    const value = row.current;
    if (!value) return;
    const type = row.kind === 'capture' ? (value.aiRequest ? 'ai' : 'memo') : row.kind;
    const href =
      row.kind === 'page'
        ? '/pages/' + row.id
        : row.kind === 'task'
          ? '/tasks?taskId=' + row.id
          : '/captures/' + row.id;
    const shared = {
      icon: String(value.icon ?? ''),
      kind: String(value.kind ?? row.kind),
      createdAt: String(value.createdAt ?? ''),
      updatedAt: String(value.updatedAt ?? row.localSavedAt),
      href,
      context: row.dirty ? '기기에 저장됨 · 전송 대기' : '기기에 보관한 자료',
    };
    const label = String(value.title ?? value.text ?? '제목 없음');
    if (
      (kinds === 'all' || kinds === type) &&
      matches([label, value.url, text(value.document)].join(' '))
    )
      items.push({
        id: row.id,
        type,
        label: label.slice(0, 160),
        snippet: text(value.document ?? value.text)
          .trim()
          .slice(0, 180),
        ...shared,
      });
    if (kinds === 'all' || kinds === 'file')
      for (const file of (Array.isArray(value.files) ? value.files : []) as {
        id: string;
        name: string;
      }[])
        if (matches(file.name))
          items.push({
            id: file.id,
            type: 'file',
            label: file.name,
            snippet: label.slice(0, 180),
            ...shared,
          });
  };
  for (const kind of ['capture', 'task', 'page'] as const) {
    let after: [string, string] | undefined;
    let found = 0;
    do {
      const batch = await querySummaries(workspaceId, kind, {
        after,
        match: (row) => {
          if (kind === 'page') return row.hasDocument;
          const value = row.current!;
          const type = kind === 'capture' ? (value.aiRequest ? 'ai' : 'memo') : 'task';
          return (
            ((kinds === 'all' || kinds === type) &&
              matches([value.title, value.text, value.url].join(' '))) ||
            ((kinds === 'all' || kinds === 'file') &&
              Array.isArray(value.files) &&
              value.files.some((file) => matches(String(file.name))))
          );
        },
      });
      for (const summary of batch.rows) {
        const row =
          kind === 'page' ? await readLocalEntity({ workspaceId, kind, id: summary.id }) : summary;
        if (row) {
          const before = items.length;
          collect(row);
          found += items.length - before;
        }
      }
      after = batch.nextCursor ? JSON.parse(batch.nextCursor) : undefined;
    } while (after && found < 50);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    items: items.slice(0, Math.min(50, Math.max(1, limit))),
    nextCursor: null,
    reset: false,
    reason: null,
    scope: 'local',
  };
}
