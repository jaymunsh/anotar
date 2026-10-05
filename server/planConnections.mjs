import { randomUUID } from 'node:crypto';
import { PageValidationError, PageConflictError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
import { pageTransaction } from './pageConnections.mjs';
import { cleanItinerary } from '../shared/itinerary.ts';

function planEntries(document, publicOnly = false) {
  const entries = new Map();
  function visit(blocks) {
    for (const block of blocks || []) {
      if (publicOnly && ['page', 'captureRef', 'tableOfContents'].includes(block.type)) continue;
      if (block.type === 'itinerary') {
        try {
          for (const entry of cleanItinerary(block.props?.data).entries)
            entries.set(block.id + '\0' + entry.id, {
              blockId: block.id,
              entryId: entry.id,
              title: entry.title,
            });
        } catch {
          /* Invalid legacy plans cannot accept relations. */
        }
      }
      visit(block.children);
    }
  }
  visit(document?.blocks);
  return entries;
}

/** Only explicit active task title/status projection; private target IDs never reach HTML. */
export function publicPlanTaskProjection(db, page) {
  if (
    !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='plan_connections'").get()
  )
    return [];
  const entries = planEntries(page.document, true),
    groups = new Map();
  const rows = db
    .prepare(
      `SELECT r.block_id AS blockId,r.entry_id AS entryId,t.title,t.status FROM plan_connections r JOIN tasks t ON t.id=r.target_id WHERE r.page_id=? AND r.kind='task' AND r.shared=1 ORDER BY r.created_at,r.id LIMIT 500`,
    )
    .all(page.id);
  for (const row of rows) {
    const key = row.blockId + '\0' + row.entryId;
    if (!entries.has(key)) continue;
    if (!groups.has(key))
      groups.set(key, { blockId: row.blockId, entryId: row.entryId, tasks: [] });
    groups.get(key).tasks.push({ title: row.title, status: row.status });
  }
  return [...groups.values()];
}
export function createPlanConnectionStore(db, owner) {
  db.exec(`CREATE TABLE IF NOT EXISTS plan_connections(id TEXT PRIMARY KEY,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,block_id TEXT NOT NULL,entry_id TEXT NOT NULL,entry_title TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('task','page','memo')),target_id TEXT NOT NULL,shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN(0,1)),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(page_id,block_id,entry_id,kind,target_id));
  CREATE INDEX IF NOT EXISTS plan_connections_page ON plan_connections(page_id,block_id,entry_id);
  CREATE TABLE IF NOT EXISTS plan_connection_operations(request_id TEXT PRIMARY KEY,page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,payload TEXT NOT NULL);`);
  function page(id) {
    const p = owner().getPage(id);
    if (!p) throw new PageToolsNotFoundError('일정 페이지를 찾을 수 없어요.');
    return p;
  }
  function target(kind, id) {
    return kind === 'task'
      ? owner().getTask(id)
      : kind === 'page'
        ? owner().getPage(id)
        : owner().getCapture(id);
  }
  function list(pageId) {
    const p = page(pageId),
      entries = planEntries(p.document);
    const items = db
      .prepare(
        `SELECT r.id,r.block_id AS blockId,r.entry_id AS entryId,r.entry_title AS entryTitle,r.kind,r.target_id AS targetId,r.shared,r.version,r.created_at AS createdAt,
      CASE r.kind WHEN 'task' THEN t.title WHEN 'page' THEN related.title ELSE CASE WHEN trim(c.text)<>'' THEN substr(c.text,1,160) ELSE COALESCE(c.url,'첨부 메모') END END AS targetTitle,
      CASE r.kind WHEN 'task' THEN t.id WHEN 'page' THEN related.id ELSE c.id END AS activeTarget,
      t.status AS taskStatus,t.version AS taskVersion,t.due_date AS taskDueDate
      FROM plan_connections r LEFT JOIN tasks t ON r.kind='task' AND t.id=r.target_id
      LEFT JOIN pages related ON r.kind='page' AND related.id=r.target_id AND related.deleted_at IS NULL
      LEFT JOIN captures c ON r.kind='memo' AND c.id=r.target_id AND c.deleted_at IS NULL
      WHERE r.page_id=? ORDER BY r.created_at,r.id LIMIT 500`,
      )
      .all(pageId)
      .map(({ targetTitle, activeTarget, taskStatus, taskVersion, taskDueDate, ...row }) => ({
        ...row,
        shared: !!row.shared,
        sourceMissing: !entries.has(row.blockId + '\0' + row.entryId),
        unavailable: !activeTarget,
        title: activeTarget ? targetTitle : '연결한 항목을 찾을 수 없어요.',
        task:
          row.kind === 'task' && activeTarget
            ? {
                id: row.targetId,
                title: targetTitle,
                status: taskStatus,
                version: taskVersion,
                dueDate: taskDueDate,
              }
            : null,
      }));
    return { items, pageVersion: p.version };
  }
  return {
    listPlanConnections: list,
    getPublicPlanTasks(pageId) {
      return publicPlanTaskProjection(db, page(pageId));
    },
    listPlanConnectionOptions(pageId, { kind = 'task', q = '' } = {}) {
      page(pageId);
      if (!['task', 'page', 'memo'].includes(kind) || typeof q !== 'string' || q.length > 160)
        throw new PageValidationError('연결할 항목과 검색어를 확인해 주세요.');
      const query = q.trim(),
        table = { task: 'tasks', page: 'pages', memo: 'captures' }[kind];
      const label =
        kind === 'memo'
          ? "CASE WHEN trim(text)<>'' THEN substr(text,1,160) ELSE COALESCE(url,'첨부 메모') END"
          : 'title';
      const source = kind === 'memo' ? "COALESCE(text,'') || ' ' || COALESCE(url,'')" : 'title';
      const filter = kind === 'task' ? '' : ' AND deleted_at IS NULL';
      const items = db
        .prepare(
          `SELECT id,${label} AS title${kind === 'task' ? ',status' : ''} FROM ${table} WHERE instr(lower(${source}),lower(?))>0${filter} ORDER BY updated_at DESC,id LIMIT 30`,
        )
        .all(query);
      return { items };
    },
    changePlanConnection(input) {
      const {
        pageId,
        blockId,
        entryId,
        action,
        kind = null,
        targetId = null,
        relationId = null,
        expectedVersion = null,
        expectedTaskVersion = null,
        expectedPageVersion,
        title = null,
        dueDate = null,
        shared = null,
        status = null,
        requestId,
      } = input;
      if (
        typeof requestId !== 'string' ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)
      )
        throw new PageValidationError('연결 요청 번호를 확인해 주세요.');
      if (
        !['link', 'create-task', 'unlink', 'share', 'toggle-task'].includes(action) ||
        typeof blockId !== 'string' ||
        blockId.length > 120 ||
        typeof entryId !== 'string' ||
        entryId.length > 120
      )
        throw new PageValidationError('일정 연결 정보를 확인해 주세요.');
      if (!Number.isSafeInteger(expectedPageVersion) || expectedPageVersion < 1)
        throw new PageValidationError('저장된 페이지 버전을 확인해 주세요.');
      if (
        action === 'link' &&
        (!['task', 'page', 'memo'].includes(kind) ||
          typeof targetId !== 'string' ||
          targetId.length > 120)
      )
        throw new PageValidationError('연결할 항목을 확인해 주세요.');
      if (action === 'share' && typeof shared !== 'boolean')
        throw new PageValidationError('할 일 공유 여부를 확인해 주세요.');
      if (action === 'toggle-task' && !['open', 'done'].includes(status))
        throw new PageValidationError('할 일 상태를 확인해 주세요.');
      if (
        !['link', 'create-task'].includes(action) &&
        (typeof relationId !== 'string' ||
          relationId.length > 120 ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1)
      )
        throw new PageValidationError('일정 연결과 버전을 확인해 주세요.');
      const payload = JSON.stringify([
        pageId,
        blockId,
        entryId,
        action,
        kind,
        targetId,
        relationId,
        expectedVersion,
        expectedTaskVersion,
        expectedPageVersion,
        title,
        dueDate,
        shared,
        status,
      ]);
      return pageTransaction(db, () => {
        const p = page(pageId);
        const receipt = db
          .prepare('SELECT payload FROM plan_connection_operations WHERE request_id=?')
          .get(requestId);
        if (receipt) {
          if (receipt.payload !== payload)
            throw new PageConflictError('같은 요청 번호로 다른 연결을 저장할 수 없어요.');
          return { ...list(pageId), replayed: true };
        }
        const source = planEntries(p.document).get(blockId + '\0' + entryId);
        if (!source && action !== 'unlink')
          throw new PageValidationError(
            '이 일정 항목이 변경되었어요. 저장된 페이지를 다시 확인해 주세요.',
          );
        if (p.version !== expectedPageVersion)
          throw new PageConflictError(
            '페이지가 먼저 변경되었어요. 저장된 일정을 확인하고 다시 연결해 주세요.',
          );
        if (action === 'link' || action === 'create-task') {
          const existing =
            action === 'link' &&
            db
              .prepare(
                'SELECT id FROM plan_connections WHERE page_id=? AND block_id=? AND entry_id=? AND kind=? AND target_id=?',
              )
              .get(pageId, blockId, entryId, kind, targetId);
          if (
            !existing &&
            (db.prepare('SELECT COUNT(*) AS n FROM plan_connections WHERE page_id=?').get(pageId)
              .n >= 500 ||
              db
                .prepare(
                  'SELECT COUNT(*) AS n FROM plan_connections WHERE page_id=? AND block_id=? AND entry_id=?',
                )
                .get(pageId, blockId, entryId).n >= 20)
          )
            throw new PageValidationError(
              '일정 항목에는 20개, 페이지에는 500개까지 연결할 수 있어요.',
            );
          const actualKind = action === 'create-task' ? 'task' : kind;
          const value =
            action === 'create-task'
              ? owner().createTask({ title, dueDate, requestId })
              : target(kind, targetId);
          if (!value) throw new PageValidationError('연결할 항목이 삭제되었거나 휴지통에 있어요.');
          db.prepare(
            'INSERT OR IGNORE INTO plan_connections(id,page_id,block_id,entry_id,entry_title,kind,target_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
          ).run(
            randomUUID(),
            pageId,
            blockId,
            entryId,
            source.title,
            actualKind,
            value.id,
            new Date().toISOString(),
          );
        } else {
          const row = db
            .prepare(
              'SELECT * FROM plan_connections WHERE id=? AND page_id=? AND block_id=? AND entry_id=?',
            )
            .get(relationId, pageId, blockId, entryId);
          if (!row) throw new PageToolsNotFoundError('일정 연결을 찾을 수 없어요.');
          if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion)
            throw new PageConflictError('연결이 먼저 변경되었어요. 최신 내용을 확인해 주세요.');
          if (action === 'unlink')
            db.prepare('DELETE FROM plan_connections WHERE id=?').run(row.id);
          else if (action === 'share') {
            if (row.kind !== 'task')
              throw new PageValidationError('공유에는 할 일 제목과 상태만 표시할 수 있어요.');
            if (!target(row.kind, row.target_id))
              throw new PageValidationError('연결한 할 일을 찾을 수 없어요.');
            if (row.shared !== Number(shared))
              db.prepare('UPDATE plan_connections SET shared=?,version=version+1 WHERE id=?').run(
                Number(shared),
                row.id,
              );
          } else {
            if (row.kind !== 'task') throw new PageValidationError('할 일 연결을 확인해 주세요.');
            if (
              !owner().updateTask({
                id: row.target_id,
                expectedVersion: expectedTaskVersion,
                status,
              })
            )
              throw new PageToolsNotFoundError('연결한 할 일을 찾을 수 없어요.');
          }
        }
        db.prepare('INSERT INTO plan_connection_operations VALUES(?,?,?)').run(
          requestId,
          pageId,
          payload,
        );
        return { ...list(pageId), replayed: false };
      });
    },
  };
}
