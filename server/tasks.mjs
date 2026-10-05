import { randomUUID } from 'node:crypto';

export class TaskValidationError extends Error {}
export class TaskConflictError extends Error {
  constructor(message, current = null) {
    super(message);
    this.current = current;
  }
}

function titleValue(title) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 500)
    throw new TaskValidationError('할 일은 1~500자로 입력해 주세요.');
  return title.trim();
}

function dateValue(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))
    throw new TaskValidationError('기한을 올바른 날짜로 입력해 주세요.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    throw new TaskValidationError('기한을 올바른 날짜로 입력해 주세요.');
  return value;
}

function pageValue(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
    throw new TaskValidationError('참조할 페이지를 확인해 주세요.');
  return value;
}

function readCursor(cursor, status) {
  if (cursor === null) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(cursor))
      throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4) throw new Error();
    const [offset, revision, filter, today] = value;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      filter !== status ||
      dateValue(today) === null
    )
      throw new Error();
    return { offset, revision, today };
  } catch {
    throw new TaskValidationError('목록 위치가 올바르지 않습니다.');
  }
}

const makeCursor = (offset, revision, status, today) =>
  Buffer.from(JSON.stringify([offset, revision, status, today])).toString('base64url');

export function koreanToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((value) => value.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function createTaskStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
      due_date TEXT,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      create_request_id TEXT UNIQUE,
      create_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_status_position ON tasks(status, position);
    CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks(status, due_date);
    CREATE TABLE IF NOT EXISTS task_list_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO task_list_state (singleton, revision) VALUES (1, 0);
    CREATE TRIGGER IF NOT EXISTS tasks_revision_insert AFTER INSERT ON tasks BEGIN
      UPDATE task_list_state SET revision = revision + 1 WHERE singleton = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_revision_update AFTER UPDATE ON tasks BEGIN
      UPDATE task_list_state SET revision = revision + 1 WHERE singleton = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_revision_delete AFTER DELETE ON tasks BEGIN
      UPDATE task_list_state SET revision = revision + 1 WHERE singleton = 1;
    END;
  `);
  // Keep the binary completion contract used by plans and AI adoption intact.
  // This additive column never rewrites task rows or dependent foreign keys.
  if (
    !db
      .prepare('PRAGMA table_info(tasks)')
      .all()
      .some((column) => column.name === 'in_progress')
  )
    db.exec(
      'ALTER TABLE tasks ADD COLUMN in_progress INTEGER NOT NULL DEFAULT 0 CHECK (in_progress IN (0, 1))',
    );
  db.exec(`CREATE INDEX IF NOT EXISTS tasks_board_stage ON tasks(status, in_progress, position);
    CREATE INDEX IF NOT EXISTS tasks_completed_order ON tasks(status, completed_at DESC, position, id);`);
  if (!db.prepare('PRAGMA table_info(tasks)').all().some((column) => column.name === 'page_id'))
    db.exec('ALTER TABLE tasks ADD COLUMN page_id TEXT');
  const fields =
    "id, title, status, CASE WHEN status = 'done' THEN 'done' WHEN in_progress = 1 THEN 'doing' ELSE 'todo' END AS stage, due_date AS dueDate, page_id AS pageId, position, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt, version";
  const getTask = (id) => db.prepare(`SELECT ${fields} FROM tasks WHERE id = ?`).get(id) || null;
  return {
    getTask,
    createTask({ title, dueDate = null, pageId = null, requestId = null, syncId = null }) {
      const cleanTitle = titleValue(title);
      const cleanDate = dateValue(dueDate);
      const cleanPage = pageValue(pageId);
      if (
        requestId !== null &&
        (typeof requestId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))
      )
        throw new TaskValidationError('추가 요청이 올바르지 않습니다.');
      // Keep existing request receipts valid when no reference was specified.
      const payload = JSON.stringify(cleanPage === null ? [cleanTitle, cleanDate] : [cleanTitle, cleanDate, cleanPage]);
      if (requestId) {
        const previous = db
          .prepare('SELECT id, create_payload AS payload FROM tasks WHERE create_request_id = ?')
          .get(requestId);
        if (previous) {
          if (previous.payload !== payload)
            throw new TaskConflictError('같은 요청으로 다른 할 일을 추가할 수 없습니다.');
          return getTask(previous.id);
        }
      }
      const id = syncId ?? randomUUID();
      const now = new Date().toISOString();
      const position = db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tasks')
        .get().next;
      db.prepare(
        'INSERT INTO tasks (id, title, due_date, page_id, position, created_at, updated_at, create_request_id, create_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, cleanTitle, cleanDate, cleanPage, position, now, now, requestId, payload);
      return getTask(id);
    },
    updateTask({ id, expectedVersion, title, dueDate, status, stage, pageId }) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new TaskValidationError('할 일 버전이 올바르지 않습니다.');
      const current = getTask(id);
      if (!current) return null;
      if (current.version !== expectedVersion)
        throw new TaskConflictError(
          '다른 곳에서 먼저 수정한 할 일입니다. 입력한 내용을 확인해 주세요.',
          current,
        );
      const nextTitle = title === undefined ? current.title : titleValue(title);
      const nextDate = dueDate === undefined ? current.dueDate : dateValue(dueDate);
      const nextPage = pageId === undefined ? current.pageId : pageValue(pageId);
      if (stage !== undefined && !['todo', 'doing', 'done'].includes(stage))
        throw new TaskValidationError('할 일 진행 단계가 올바르지 않습니다.');
      if (status !== undefined && !['open', 'done'].includes(status))
        throw new TaskValidationError('할 일 상태가 올바르지 않습니다.');
      const nextStage =
        stage ?? (status === undefined ? current.stage : status === 'done' ? 'done' : 'todo');
      const nextStatus = nextStage === 'done' ? 'done' : 'open';
      if (status !== undefined && status !== nextStatus)
        throw new TaskValidationError('완료 상태와 진행 단계가 일치하지 않습니다.');
      if (!['open', 'done'].includes(nextStatus))
        throw new TaskValidationError('할 일 상태가 올바르지 않습니다.');
      if (
        nextTitle === current.title &&
        nextDate === current.dueDate &&
        nextPage === current.pageId &&
        nextStage === current.stage
      )
        return current;
      const now = new Date().toISOString();
      const completedAt = nextStatus === 'done' ? current.completedAt || now : null;
      const result = db
        .prepare(
          'UPDATE tasks SET title = ?, due_date = ?, page_id = ?, status = ?, in_progress = ?, completed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?',
        )
        .run(
          nextTitle,
          nextDate,
          nextPage,
          nextStatus,
          nextStage === 'doing' ? 1 : 0,
          completedAt,
          now,
          id,
          expectedVersion,
        );
      if (!result.changes)
        throw new TaskConflictError('다른 곳에서 먼저 수정한 할 일입니다.', getTask(id));
      return getTask(id);
    },
    listTasks({
      status = 'open',
      stage = null,
      limit = 50,
      cursor = null,
      today = koreanToday(),
    } = {}) {
      if (!['open', 'done'].includes(status))
        throw new TaskValidationError('할 일 필터가 올바르지 않습니다.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new TaskValidationError('목록 개수는 1~100 사이로 지정해 주세요.');
      if (stage !== null && !['todo', 'doing', 'done'].includes(stage))
        throw new TaskValidationError('할 일 진행 단계 필터가 올바르지 않습니다.');
      const filterStatus = stage === 'done' ? 'done' : stage ? 'open' : status;
      const filterKey = stage ? `stage:${stage}` : status;
      const stageWhere =
        stage === 'todo' ? ' AND in_progress = 0' : stage === 'doing' ? ' AND in_progress = 1' : '';
      const previous = readCursor(cursor, filterKey);
      // Read rows, counts and cursor revision from the same SQLite snapshot.
      db.exec('BEGIN');
      try {
        const { revision } = db
          .prepare('SELECT revision FROM task_list_state WHERE singleton = 1')
          .get();
        const reset = !!previous && (previous.revision !== revision || previous.today !== today);
        const offset = previous && !reset ? previous.offset : 0;
        const rows =
          filterStatus === 'open'
            ? db
                .prepare(
                  `SELECT ${fields} FROM tasks WHERE status = ?${stageWhere} ORDER BY CASE WHEN due_date <= ? THEN 0 ELSE 1 END, CASE WHEN due_date <= ? THEN due_date END, position, id LIMIT ? OFFSET ?`,
                )
                .all(filterStatus, today, today, limit + 1, offset)
            : db
                .prepare(
                  `SELECT ${fields} FROM tasks WHERE status = ? ORDER BY completed_at DESC, position, id LIMIT ? OFFSET ?`,
                )
                .all(filterStatus, limit + 1, offset);
        const counts = { open: 0, done: 0 };
        const stageCounts = { todo: 0, doing: 0, done: 0 };
        for (const row of db
          .prepare(
            'SELECT status, in_progress, COUNT(*) AS count FROM tasks GROUP BY status, in_progress',
          )
          .all()) {
          counts[row.status] += row.count;
          stageCounts[row.status === 'done' ? 'done' : row.in_progress ? 'doing' : 'todo'] +=
            row.count;
        }
        db.exec('COMMIT');
        return {
          items: rows.slice(0, limit),
          counts,
          stageCounts,
          reset,
          nextCursor:
            rows.length > limit ? makeCursor(offset + limit, revision, filterKey, today) : null,
        };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
