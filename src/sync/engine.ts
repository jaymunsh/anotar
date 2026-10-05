import type { SyncApplyResult, SyncEntity, SyncEntityKind } from '../../shared/sync.ts';
import type { Pending } from './repository.ts';
import type { SyncTransport } from './transport.ts';
export type Lease = { owner: string; fence: number };
export type Identity = { workspaceId: string; epoch: string; cursor: number };
export type EngineRepository = {
  identity: () => Promise<Identity>;
  acquireLease: (owner: string, now: number) => Promise<Lease | null>;
  renewLease: (lease: Lease, now: number) => Promise<boolean>;
  releaseLease: (lease: Lease) => Promise<void>;
  pause: (reason: string) => Promise<void>;
  isPaused?: () => Promise<boolean>;
  bootstrapDone: () => Promise<boolean>;
  bootstrapKindDone?: (kind: SyncEntityKind) => Promise<boolean>;
  markBootstrapKindDone?: (kind: SyncEntityKind, lease: Lease) => Promise<void>;
  markBootstrapDone: (cursor: number, lease: Lease) => Promise<void>;
  shouldFetchPage: (id: string) => Promise<boolean>;
  acceptRemote: (entity: SyncEntity, lease: Lease) => Promise<void>;
  advanceCursor: (cursor: number, lease: Lease) => Promise<void>;
  nextOperation: (now: number, capabilities: string[]) => Promise<Pending | null>;
  markSending: (pending: Pending, lease: Lease) => Promise<boolean | void>;
  acknowledge: (pending: Pending, result: SyncApplyResult, lease: Lease) => Promise<boolean>;
  reject: (
    pending: Pending,
    state: Pending['state'],
    error: unknown,
    nextAttemptAt: number,
    lease: Lease,
  ) => Promise<void>;
  nextWake?: () => Promise<number | undefined>;
  counts: () => Promise<{ pending: number; conflicts: number }>;
  prepareUploads?: (
    pending: Pending,
    transport: SyncTransport,
    lease: Lease,
  ) => Promise<SyncApplyResult | void>;
};
export type EngineSnapshot = {
  state: 'idle' | 'syncing' | 'ready' | 'offline' | 'access' | 'recovery';
  pending: number;
  conflicts: number;
  error: string;
  lastSync: number | null;
};
export function retryDelay(
  attempt: number,
  random: () => number = Math.random,
  retryAfter?: number,
) {
  return retryAfter !== undefined && Number.isFinite(retryAfter)
    ? Math.min(300000, Math.max(0, retryAfter))
    : Math.round([2000, 5000, 15000, 30000, 60000][Math.min(4, attempt)] * (0.8 + random() * 0.4));
}
export function createSyncEngine({
  repository,
  transport,
  clock = Date.now,
  random = Math.random,
}: {
  repository: EngineRepository;
  transport: SyncTransport;
  clock?: () => number;
  random?: () => number;
}) {
  const owner = crypto.randomUUID(),
    listeners = new Set<() => void>();
  let heldLease: Lease | null = null;
  let rerun = false,
    active = false,
    busy: Promise<void> | null = null,
    poll: ReturnType<typeof setInterval> | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  let snapshot: EngineSnapshot = {
    state: 'idle',
    pending: 0,
    conflicts: 0,
    error: '',
    lastSync: null,
  };
  function update(value: Partial<EngineSnapshot>) {
    snapshot = { ...snapshot, ...value };
    listeners.forEach((fn) => fn());
  }
  async function run() {
    const lease = await repository.acquireLease(owner, clock());
    if (!lease) {
      update({ state: 'syncing', ...(await repository.counts()) });
      if (active) {
        clearTimeout(retry);
        retry = setTimeout(() => {
          void requestSync();
        }, 2000);
      }
      return;
    }
    heldLease = lease;
    const renew = setInterval(() => {
      void repository.renewLease(lease, clock());
    }, 10000);
    try {
      update({ state: 'syncing', error: '' });
      const session = await transport.session(),
        identity = await repository.identity();
      if (session.protocolVersion !== 1) throw { status: 426, message: '앱을 업데이트해 주세요.' };
      if (
        session.workspaceId !== identity.workspaceId ||
        session.epoch !== identity.epoch ||
        identity.cursor > session.headSeq
      ) {
        await repository.pause('서버 복원 또는 작업 공간 변경');
        update({
          state: 'recovery',
          error: '서버가 바뀌었어요. 기기에 저장한 자료를 확인해 주세요.',
        });
        return;
      }
      if (await repository.isPaused?.()) {
        update({ state: 'recovery', error: '서버 변경 복구 안내를 먼저 확인해 주세요.' });
        return;
      }
      let cursor = identity.cursor;
      const bootstrapKind = async (kind: SyncEntityKind, startSeq: number) => {
          let afterId: string | null = null;
          do {
            const batch = await transport.bootstrap(kind, afterId);
            for (const item of batch.items) {
              const id = String(item.id);
              const incoming =
                kind === 'page' && !(await repository.shouldFetchPage(id))
                  ? {
                      workspaceId: batch.workspaceId ?? session.workspaceId,
                      epoch: batch.epoch ?? session.epoch,
                      entityKind: kind,
                      entityId: id,
                      item,
                      version: Number(item.version),
                      readSeq: startSeq,
                      tombstone: false,
                      missing: false,
                    }
                  : await transport.fetchEntity(kind, id);
              await repository.acceptRemote(incoming, lease);
            }
            afterId = batch.nextAfterId;
          } while (afterId);
        await repository.markBootstrapKindDone?.(kind,lease);
      };
      if (!(await repository.bootstrapDone())) {
        const startSeq = session.headSeq;
        const kinds: SyncEntityKind[] = ['capture','task','page'];
        if (session.capabilities.includes('journal.create')) kinds.push('journal');
        for (const kind of kinds) await bootstrapKind(kind,startSeq);
        await repository.markBootstrapDone(startSeq, lease);
        cursor = startSeq;
      }
      // Connected devices predate newly supported entities. Bootstrap journal
      // once while retaining the global cursor and the ordinary change feed.
      if (session.capabilities.includes('journal.create') && repository.bootstrapKindDone && !(await repository.bootstrapKindDone('journal')))
        await bootstrapKind('journal',session.headSeq);
      for (let batchNumber = 0; batchNumber < 100; batchNumber++) {
        const batch = await transport.pullChanges(cursor);
        if (batch.epoch !== identity.epoch || cursor > batch.headSeq) {
          await repository.pause('서버 복원');
          update({ state: 'recovery' });
          return;
        }
        for (const change of batch.changes) {
          if (
            change.entityKind === 'page' &&
            !(await repository.shouldFetchPage(change.entityId))
          ) {
            // Metadata endpoints avoid downloading uncached document bodies. Tombstone must be explicit, never inferred from HTTP errors.
            const incoming = await (transport.fetchMetadata ?? transport.fetchEntity)(
              'page',
              change.entityId,
            );
            if (incoming.item) {
              incoming.item = { ...incoming.item };
              delete incoming.item.document;
            }
            await repository.acceptRemote(incoming, lease);
          } else
            await repository.acceptRemote(
              await transport.fetchEntity(change.entityKind, change.entityId),
              lease,
            );
        }
        await repository.advanceCursor(batch.nextAfter, lease);
        cursor = batch.nextAfter;
        if (!batch.changes.length || cursor >= batch.headSeq) break;
      }
      for (let count = 0; count < 100; count++) {
        const pending = await repository.nextOperation(clock(), session.capabilities);
        if (!pending) break;
        try {
          if ((await repository.markSending(pending, lease)) === false) continue;
          const uploaded = await repository.prepareUploads?.(pending, transport, lease);
          const result = uploaded ?? (await transport.applyOperation(pending.operation));
          if (!(await repository.acknowledge(pending, result, lease))) break;
        } catch (cause) {
          const error = cause as {
            status?: number;
            code?: string;
            retryAfter?: number;
            message?: string;
          };
          if ([401, 403, 426].includes(error.status ?? 0)) {
            await repository.reject(pending, 'queued', cause, clock(), lease);
            update({ state: 'access', error: error.message ?? '접근 권한을 확인해 주세요.' });
            return;
          }
          if (error.code === 'epoch_mismatch' || error.code === 'workspace_mismatch') {
            await repository.pause('서버 복원');
            update({ state: 'recovery' });
            return;
          }
          if (error.status === 409) {
            await repository.reject(pending, 'conflict', cause, 0, lease);
            continue;
          }
          if ([404, 413, 422].includes(error.status ?? 0)) {
            await repository.reject(pending, 'failed', cause, 0, lease);
            continue;
          }
          const delay = retryDelay(pending.attempt, random, error.retryAfter);
          await repository.reject(pending, 'queued', cause, clock() + delay, lease);
          if (active) {
            clearTimeout(retry);
            retry = setTimeout(() => {
              void requestSync();
            }, delay);
          }
          update({ state: 'offline', error: '서버에 연결되면 다시 전송해요.' });
          return;
        }
      }
      const wake = await repository.nextWake?.();
      if (active && wake !== undefined) {
        clearTimeout(retry);
        retry = setTimeout(
          () => {
            void requestSync();
          },
          Math.max(10, wake - clock()),
        );
      }
      update({ state: 'ready', lastSync: clock() });
    } catch (cause) {
      const error = cause as { status?: number; message?: string; code?: string };
      if (error.code === 'epoch_mismatch') {
        await repository.pause('서버 복원 또는 작업 공간 변경');
        update({ state: 'recovery', error: error.message });
        return;
      }
      update({
        state: [401, 403, 426].includes(error.status ?? 0) ? 'access' : 'offline',
        error: error.message ?? '서버 연결을 기다리고 있어요.',
      });
    } finally {
      clearInterval(renew);
      await repository.releaseLease(lease);
      if (heldLease === lease) heldLease = null;
      update(await repository.counts());
    }
  }
  function requestSync() {
    if (busy) {
      rerun = true;
      return busy;
    }
    busy = run().finally(() => {
      busy = null;
      if (rerun) {
        rerun = false;
        void requestSync();
      }
    });
    return busy;
  }
  const visible = () => {
    if (
      !['access', 'recovery'].includes(snapshot.state) &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    )
      void requestSync();
  };
  const pagehide = () => {
    if (heldLease) void repository.releaseLease(heldLease).catch(() => {});
  };
  function start() {
    if (active) return;
    active = true;
    void requestSync();
    poll = setInterval(visible, 30000);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', pagehide);
      window.addEventListener('online', visible);
      window.addEventListener('focus', visible);
      document.addEventListener('visibilitychange', visible);
    }
  }
  function stop() {
    active = false;
    clearInterval(poll);
    clearTimeout(retry);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', visible);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    }
  }
  return {
    start,
    stop,
    requestSync,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
