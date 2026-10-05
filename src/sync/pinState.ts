import type { Entity } from './repository';
import type { SyncEntity } from '../../shared/sync';
import { idbRequest } from './db';
import { directAssetIds } from '../offline/pageCache';
export async function reconcilePin(
  tx: IDBTransaction,
  w: string,
  old: Entity | undefined,
  incoming: SyncEntity,
) {
  if (incoming.entityKind !== 'page' || !incoming.item?.document || old?.dirty) return false;
  const key = JSON.stringify([w, incoming.entityId]),
    store = tx.objectStore('pins'),
    pin = await idbRequest(store.get(key));
  if (!pin) return false;
  const ids = directAssetIds(incoming.item.document),
    missing: string[] = [];
  for (const id of ids)
    if (!(await idbRequest(tx.objectStore('blobs').get(JSON.stringify([w, id]))))) missing.push(id);
  if (missing.length) {
    store.put({
      ...pin,
      state: 'partial',
      latestVersion: incoming.version,
      successfulEntity:
        pin.successfulEntity ??
        (old?.current?.document
          ? { ...incoming, item: old.current, version: old.current.version }
          : undefined),
      assetIds: [...new Set([...pin.assetIds, ...ids])],
      missing: missing.map((id) => ({ id, error: '새 버전의 첨부를 다시 보관해 주세요.' })),
    });
    return Boolean(old?.current?.document);
  }
  store.put({
    ...pin,
    version: incoming.version,
    successfulVersion: incoming.version,
    successfulEntity: incoming,
    assetIds: ids,
  });
  return false;
}
