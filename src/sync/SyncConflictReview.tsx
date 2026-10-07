import { useEffect, useState } from 'react';
import ConflictPanel from './ConflictPanel';
import type { ConflictRecord } from './conflicts';
import { getWorkspaceRuntime } from './runtime';
import { listRecords, readLocalEntity, subscribeLocalChanges, type Value } from './repository';

/** Non-page records use the same comparison controls in their own workspace. */
export default function SyncConflictReview({
  kind,
  entityId,
}: {
  kind: 'capture' | 'task' | 'journal';
  entityId?: string | null;
}) {
  const [items, setItems] = useState<{ conflict: ConflictRecord; local: Value | null }[]>([]);
  const [error, setError] = useState('');
  const requested = new URLSearchParams(window.location.search).get('syncConflict');
  useEffect(() => {
    let active = true,
      sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const { workspaceId } = await getWorkspaceRuntime();
        const conflicts = (
          await listRecords<ConflictRecord>('conflicts', workspaceId, 10000)
        ).filter(
          (item) =>
            !item.resolvedAt &&
            item.entityKind === kind &&
            (!entityId || item.entityId === entityId),
        );
        const rows = await Promise.all(
          conflicts.map(async (conflict) => ({
            conflict,
            local:
              (await readLocalEntity({ workspaceId, kind, id: conflict.entityId }))?.current ??
              conflict.local,
          })),
        );
        if (active && current === sequence) {
          setItems(rows);
          setError('');
        }
      } catch {
        if (active && current === sequence)
          setError('변경 내용을 확인하지 못했어요. 자료는 보관되어 있어요.');
      }
    }
    void load();
    const off = subscribeLocalChanges(() => void load());
    return () => {
      active = false;
      off();
    };
  }, [kind, entityId]);
  if (!items.length && !error) return null;
  return (
    <div className="workspace-sync-review">
      {error && <p role="alert">{error}</p>}
      {items.map(({ conflict, local }) => (
        <div key={conflict.operationId}>
          <h2>{String(local?.title ?? local?.text ?? local?.date ?? '변경 확인').slice(0, 80)}</h2>
          <ConflictPanel
            conflict={conflict}
            local={local}
            requested={requested === conflict.operationId}
            onResolved={() =>
              setItems((current) =>
                current.filter((item) => item.conflict.operationId !== conflict.operationId),
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
