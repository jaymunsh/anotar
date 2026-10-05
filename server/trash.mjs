import { randomUUID } from 'node:crypto';
import { pageTransaction } from './pageConnections.mjs';

export class TrashValidationError extends Error {
  name = 'TrashValidationError';
}
export class TrashConflictError extends Error {
  name = 'TrashConflictError';
}
export class TrashNotFoundError extends Error {
  name = 'TrashNotFoundError';
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function cleanId(value) {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new TrashValidationError('휴지통 요청 ID가 올바르지 않아요.');
  return value.toLowerCase();
}

export function initializeTrash(db) {
  for (const table of ['captures', 'pages']) {
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name),
    );
    if (!columns.has('deleted_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
    if (!columns.has('trash_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN trash_id TEXT`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS captures_active_created ON captures(created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS pages_active_position ON pages(position) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS pages_trash_id ON pages(trash_id);
    CREATE TABLE IF NOT EXISTS trash_batches (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL,
      label TEXT NOT NULL, preview TEXT NOT NULL, icon TEXT NOT NULL,
      is_ai INTEGER NOT NULL, item_count INTEGER NOT NULL,
      deleted_at TEXT NOT NULL, restored_at TEXT
    );
    CREATE INDEX IF NOT EXISTS trash_active_order ON trash_batches(deleted_at DESC, id DESC) WHERE restored_at IS NULL;
    CREATE TABLE IF NOT EXISTS trash_operations (
      id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL
    );
  `);
}

export function createTrashStore(db) {
  const selectEntry = db.prepare(`SELECT id, kind, target_id AS targetId, label, preview, icon,
    is_ai AS isAi, item_count AS count, deleted_at AS deletedAt, restored_at AS restoredAt
    FROM trash_batches WHERE id = ?`);
  const entry = (id) => {
    const row = selectEntry.get(id);
    return row ? { ...row, isAi: Boolean(row.isAi) } : null;
  };
  function once(operationId, input, action) {
    const id = cleanId(operationId);
    const serialized = JSON.stringify(input);
    return pageTransaction(db, () => {
      const old = db.prepare('SELECT request, result FROM trash_operations WHERE id = ?').get(id);
      if (old) {
        if (old.request !== serialized)
          throw new TrashConflictError(
            '이미 제출한 요청과 내용이 달라요. 이전 요청으로 다시 확인해 주세요.',
          );
        return JSON.parse(old.result);
      }
      const result = action();
      db.prepare('INSERT INTO trash_operations (id, request, result) VALUES (?, ?, ?)').run(
        id,
        serialized,
        JSON.stringify(result),
      );
      return result;
    });
  }
  return {
    trashRecord({ kind, id: rawId, operationId, expectedVersion }) {
      if (kind !== 'capture' && kind !== 'page')
        throw new TrashValidationError('기록 종류가 올바르지 않아요.');
      const id = cleanId(rawId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new TrashValidationError('기록의 수정 버전이 올바르지 않아요.');
      return once(operationId, { action: 'trash', kind, id, expectedVersion }, () => {
        const table = kind === 'capture' ? 'captures' : 'pages';
        const record = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!record) throw new TrashNotFoundError('기록을 찾을 수 없어요.');
        if (record.deleted_at) return { item: entry(record.trash_id) };
        if (record.version !== expectedVersion)
          throw new TrashConflictError(
            '다른 곳에서 기록이 수정됐어요. 최신 내용을 확인한 뒤 다시 옮겨 주세요.',
          );
        const ids =
          kind === 'capture'
            ? [id]
            : db
                .prepare(
                  `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
            UNION SELECT p.id FROM pages p JOIN descendants d ON p.parent_id = d.id WHERE p.deleted_at IS NULL
          ) SELECT id FROM descendants`,
                )
                .all(id)
                .map((row) => row.id);
        const trashId = randomUUID();
        const deletedAt = new Date().toISOString();
        const files =
          kind === 'capture'
            ? db.prepare('SELECT name FROM assets WHERE capture_id = ? ORDER BY rowid').all(id)
            : [];
        const label =
          kind === 'page'
            ? record.title
            : (record.text || record.url || files[0]?.name || '내용 없는 메모').slice(0, 300);
        const preview =
          kind === 'page'
            ? ids.length > 1
              ? `하위 페이지 ${ids.length - 1}개 포함`
              : ''
            : record.url || (files.length ? `${files.length}개의 첨부 파일` : '');
        db.prepare(
          `INSERT INTO trash_batches (id, kind, target_id, label, preview, icon, is_ai, item_count, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          trashId,
          kind,
          id,
          label,
          preview,
          record.icon || '',
          Number(Boolean(record.ai_request)),
          ids.length,
          deletedAt,
        );
        db.prepare(
          `UPDATE ${table} SET deleted_at = ?, trash_id = ?, version = version + 1
          WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`,
        ).run(deletedAt, trashId, JSON.stringify(ids));
        return { item: entry(trashId) };
      });
    },
    restoreTrash({ id: rawId, operationId }) {
      const id = cleanId(rawId);
      return once(operationId, { action: 'restore', id }, () => {
        const batch = entry(id);
        if (!batch) throw new TrashNotFoundError('휴지통의 기록을 찾을 수 없어요.');
        if (batch.restoredAt) return { item: batch };
        if (batch.kind === 'capture') {
          db.prepare(
            'UPDATE captures SET deleted_at = NULL, trash_id = NULL, version = version + 1 WHERE trash_id = ?',
          ).run(id);
        } else {
          db.prepare(
            `UPDATE pages SET parent_id = CASE
            WHEN parent_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM pages parent WHERE parent.id = pages.parent_id AND (parent.deleted_at IS NULL OR parent.trash_id = ?)
            ) THEN NULL ELSE parent_id END,
            deleted_at = NULL, trash_id = NULL, version = version + 1 WHERE trash_id = ?`,
          ).run(id, id);
        }
        db.prepare('UPDATE trash_batches SET restored_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          id,
        );
        return { item: entry(id) };
      });
    },
    listTrash({ type = 'all', cursor = null } = {}) {
      if (!['all', 'capture', 'page'].includes(type))
        throw new TrashValidationError('휴지통 목록 구분이 올바르지 않아요.');
      const conditions = ['restored_at IS NULL'];
      const parameters = [];
      if (type !== 'all') {
        conditions.push('kind = ?');
        parameters.push(type);
      }
      if (cursor !== null) {
        try {
          if (typeof cursor !== 'string' || cursor.length > 500) throw new Error();
          const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          if (
            value.type !== type ||
            !uuid.test(value.id) ||
            typeof value.deletedAt !== 'string' ||
            new Date(value.deletedAt).toISOString() !== value.deletedAt
          )
            throw new Error();
          conditions.push('(deleted_at < ? OR (deleted_at = ? AND id < ?))');
          parameters.push(value.deletedAt, value.deletedAt, value.id);
        } catch {
          throw new TrashValidationError('휴지통 목록을 다시 불러와 주세요.');
        }
      }
      const rows = db
        .prepare(
          `SELECT id, deleted_at AS deletedAt FROM trash_batches WHERE ${conditions.join(' AND ')} ORDER BY deleted_at DESC, id DESC LIMIT 51`,
        )
        .all(...parameters);
      const visible = rows.slice(0, 50);
      const last = visible.at(-1);
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS allCount, COUNT(*) FILTER (WHERE kind = 'capture') AS capture,
        COUNT(*) FILTER (WHERE kind = 'page') AS page FROM trash_batches WHERE restored_at IS NULL`,
        )
        .get();
      return {
        items: visible.map((row) => entry(row.id)),
        counts: { all: counts.allCount, capture: counts.capture, page: counts.page },
        nextCursor:
          rows.length > 50
            ? Buffer.from(JSON.stringify({ ...last, type })).toString('base64url')
            : null,
      };
    },
  };
}
