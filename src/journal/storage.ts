import { journalId, normalizeJournalDay, type JournalDay } from '../../shared/journal.mjs';
import { getWorkspaceRuntime, queueValue } from '../sync/runtime';
import { idbRequest, transaction } from '../sync/db';
import {
  readRecord,
  subscribeLocalChanges,
  type Entity,
  type Value,
} from '../sync/repository';

import {
  migrateJournal,
  listJournalMigrationCollisions,
  type JournalMigrationCollision,
} from './migration';
export { migrateJournal } from './migration';

export type JournalStorage = {
  days: Record<string, JournalDay>;
  notice: string;
  collisions: JournalMigrationCollision[];
  save: (date: string, day: JournalDay) => Promise<void>;
  flush: () => Promise<void>;
  subscribe: (listener: (days: Record<string, JournalDay>) => string[]) => () => void;
};
export async function createJournalStorage(): Promise<JournalStorage> {
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  let notice = '';
  try {
    const result = await migrateJournal(workspaceId, deviceId);
    if ('foreign' in result && result.foreign)
      notice =
        '이전 기기 일지는 다른 작업 공간의 자료예요. 자동으로 가져오지 않았고 원본은 그대로 남아 있어요.';
    if (result.conflicts)
      notice = `이전 기기 일지 ${result.conflicts}일과 기존 내용이 달라요. 상단 동기화 상태에서 양쪽 내용을 확인해 주세요. 원본은 보존했어요.`;
  } catch {
    notice = '이전 기기 일지를 읽거나 이관하지 못했어요. 원본은 이 기기에 그대로 남아 있어요.';
  }
  const revisions = new Map<string, number>(),
    pending = new Map<string, number>();
  const visibleDays = new Map<string, JournalDay>(),
    visibleBases = new Map<string, Value | null>();
  let chain: Promise<unknown> = Promise.resolve();
  const load = async () => {
    const rows: Entity[] = await transaction(['entities'], 'readonly', (tx) =>
      idbRequest(tx.objectStore('entities').index('kind').getAll([workspaceId, 'journal'])),
    );
    const days: Record<string, JournalDay> = {};
    for (const row of rows)
      if (row.current) {
        const date = String(row.current.date);
        days[date] = normalizeJournalDay(row.current.day, date);
        // Revision advances only when the controller accepts this same view.
        // A focused textarea can retain its old view after another tab writes.
      }
    return {
      days,
      revisions: new Map(
        rows
          .filter((row) => row.current)
          .map((row) => [String(row.current!.date), row.localRevision]),
      ),
      bases: new Map(
        rows.filter((row) => row.current).map((row) => [String(row.current!.date), row.base]),
      ),
    };
  };
  const initial = await load();
  for (const [date, revision] of initial.revisions) revisions.set(date, revision);
  for (const [date, day] of Object.entries(initial.days)) visibleDays.set(date, day);
  for (const [date, base] of initial.bases) visibleBases.set(date, base);
  const storage: JournalStorage = {
    days: initial.days,
    notice,
    collisions: await listJournalMigrationCollisions(workspaceId),
    async flush() {
      await chain;
    },
    save(date, day) {
      const expected = revisions.get(date) ?? 0;
      const previousVisibleDay = visibleDays.get(date),
        previousVisibleBase = visibleBases.get(date) ?? null;
      revisions.set(date, expected + 1);
      pending.set(date, (pending.get(date) ?? 0) + 1);
      const snapshot = normalizeJournalDay(day, date),
        id = journalId(workspaceId, date),
        now = new Date().toISOString();
      visibleDays.set(date, snapshot);
      const saving = chain.then(async () => {
        const row = await readRecord<Entity>('entities', workspaceId, 'journal', id);
        // A remote read can advance a clean base without changing localRevision.
        // While the controller retains focused input, a different cached day
        // must still save against the base the user actually saw. Own ACKs may
        // advance the base when the prior visible day remains identical.
        const baseOverride =
          row?.current && JSON.stringify(row.current.day) !== JSON.stringify(previousVisibleDay)
            ? previousVisibleBase
            : (row?.base ?? null);
        await queueValue(
          'journal',
          id,
          {
            ...row?.current,
            id,
            date,
            day: snapshot,
            version: row?.current?.version ?? 1,
            createdAt: row?.current?.createdAt ?? now,
            updatedAt: now,
            clientCreatedAt: row?.current?.clientCreatedAt ?? now,
          },
          crypto.randomUUID(),
          [],
          [],
          true,
          0,
          baseOverride,
          expected,
        );
      });
      // A failed commit stops this mounted editor's later writes. All input
      // remains visible for copying, and the source archive is untouched.
      chain = saving;
      return saving.finally(() => pending.set(date, Math.max(0, (pending.get(date) ?? 1) - 1)));
    },
    subscribe(listener) {
      let active = true,
        generation = 0;
      const refresh = () => {
        const run = ++generation;
        void load()
          .then(({ days, revisions: incomingRevisions, bases: incomingBases }) => {
            if (!active || run !== generation) return;
            for (const [date, count] of pending) if (count) delete days[date];
            const accepted = listener(days);
            for (const date of accepted)
              if (!pending.get(date)) {
                revisions.set(date, incomingRevisions.get(date) ?? 0);
                visibleDays.set(date, days[date]);
                visibleBases.set(date, incomingBases.get(date) ?? null);
              }
          })
          .catch(() => {});
      };
      const off = subscribeLocalChanges(refresh);
      return () => {
        active = false;
        off();
      };
    },
  };
  void engine.requestSync();
  return storage;
}
