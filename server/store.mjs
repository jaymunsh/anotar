import { initializeSyncFeed } from './sync/feed.mjs';
import { createJournalStore } from './journal.mjs';
import { createAuthStore } from './auth/store.mjs';
import { initializeSync, getSyncSession, bindSyncStore } from './sync/store.mjs';
import { createWorkspacePageStore } from './workspacePages.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOcrStore } from './ocr.mjs';
import { createAiTaskAdoption } from './ai/taskAdoption.mjs';
import { createSharedCommentStore } from './sharedComments.mjs';
import { createSharedCommentInboxStore } from './sharedCommentInbox.mjs';
import { createPlanConnectionStore } from './planConnections.mjs';
import { createPageCommentStore } from './pageComments.mjs';
import { createPromptStore } from './prompts.mjs';
import { randomUUID } from 'node:crypto';
import { createTaskStore } from './tasks.mjs';
import {
  createPageConnections,
  pageTransaction,
  syncPageReferences,
  visibleAsset,
} from './pageConnections.mjs';
import { createTrashStore, initializeTrash } from './trash.mjs';
import { createSearchStore } from './search.mjs';
import { registerSearchFunctions } from './searchText.mjs';
import { createAiSettingsStore } from './ai/settings.mjs';
import { createAiJobStore } from './ai/jobs.mjs';
import { createPageAiStore } from './pageAi.mjs';
import { createShareStore } from './shares.mjs';
import { createPageTools, initializePageAssets } from './pageTools.mjs';
import { captureFingerprint, cleanRequestId } from './ai/contracts.mjs';
import { inferInputUrl, storeRequestSnapshot } from '../shared/aiRequests.ts';
import {
  cleanPageIcon,
  cleanPageParentId,
  cleanPageTitle,
  PageConflictError,
  PageValidationError,
  serializePageDocument,
} from './pages.mjs';

export class CaptureValidationError extends Error {}
export class CaptureConflictError extends Error {}

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      capture_id TEXT REFERENCES captures(id) ON DELETE CASCADE,
      page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      CHECK((capture_id IS NULL) != (page_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS captures_created_at ON captures(created_at DESC);
    CREATE INDEX IF NOT EXISTS assets_capture_id ON assets(capture_id);
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      document TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pages_updated_at ON pages(updated_at DESC);
    CREATE TABLE IF NOT EXISTS page_roles (
      role TEXT PRIMARY KEY,
      page_id TEXT NOT NULL UNIQUE REFERENCES pages(id)
    );
  `);
  const captureColumns = new Set(
    db
      .prepare('PRAGMA table_info(captures)')
      .all()
      .map((column) => column.name),
  );
  if (!captureColumns.has('updated_at'))
    db.exec("ALTER TABLE captures ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!captureColumns.has('version'))
    db.exec('ALTER TABLE captures ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  if (!captureColumns.has('ai_request')) db.exec('ALTER TABLE captures ADD COLUMN ai_request TEXT');
  if (!captureColumns.has('sample_key')) db.exec('ALTER TABLE captures ADD COLUMN sample_key TEXT');
  for (const column of ['organized_at', 'organized_page_id', 'organized_operation_id'])
    if (!captureColumns.has(column)) db.exec(`ALTER TABLE captures ADD COLUMN ${column} TEXT`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS captures_sample_key ON captures(sample_key)');
  db.exec("UPDATE captures SET updated_at = created_at WHERE updated_at = ''");
  const pageColumns = new Set(
    db
      .prepare('PRAGMA table_info(pages)')
      .all()
      .map((column) => column.name),
  );
  if (!pageColumns.has('icon'))
    db.exec("ALTER TABLE pages ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  if (!pageColumns.has('parent_id')) db.exec('ALTER TABLE pages ADD COLUMN parent_id TEXT');
  if (!pageColumns.has('position')) {
    db.exec('ALTER TABLE pages ADD COLUMN position REAL NOT NULL DEFAULT 0');
    // 기존 페이지는 최신순 목록 순서를 유지하도록 rowid 역순으로 채운다
    db.exec('UPDATE pages SET position = -rowid');
  }

  initializePageAssets(db);
  db.exec('CREATE INDEX IF NOT EXISTS assets_page_id ON assets(page_id)');
  initializeTrash(db);
  const shareStore = createShareStore(db);
  const selectFiles = db.prepare(
    'SELECT id, storage_key AS key, name, mime, size FROM assets WHERE capture_id = ? ORDER BY rowid',
  );
  const hydrate = (row) => {
    if (!row) return null;
    const { aiRequest, sampleKey, ...item } = row;
    return {
      ...item,
      aiRequest: aiRequest ? JSON.parse(aiRequest) : null,
      latestAiJob: store.latestAiJob(row.id),
      isSample: Boolean(sampleKey),
      files: selectFiles.all(row.id),
    };
  };

  const store = {
    ...createPageConnections(db, () => store),
    ...createPageTools(db, () => store),
    ...createTrashStore(db),
    ...createTaskStore(db),
    ...createPromptStore(db),
    ...shareStore,
    getStagingPage() {
      const role = db.prepare("SELECT page_id FROM page_roles WHERE role = 'staging'").get();
      return role ? this.getPage(role.page_id) : null;
    },
    ensureStagingPage() {
      db.exec('BEGIN IMMEDIATE');
      try {
        let page = this.getStagingPage();
        if (!page) {
          if (db.prepare("SELECT page_id FROM page_roles WHERE role = 'staging'").get())
            throw new PageValidationError('휴지통의 임시 정리 페이지를 먼저 복원해 주세요.');
          page = this.createPage({ title: '임시 정리' });
          db.prepare("INSERT INTO page_roles (role, page_id) VALUES ('staging', ?)").run(page.id);
        }
        db.exec('COMMIT');
        return page;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    ensureSamplePage({ key, title, icon = '', parentId = null, document }) {
      if (typeof key !== 'string' || !/^[a-z0-9.-]{1,100}$/i.test(key))
        throw new PageValidationError('예시 식별자가 올바르지 않습니다.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const role = db
          .prepare('SELECT page_id FROM page_roles WHERE role = ?')
          .get('sample.' + key);
        let page = role ? this.getPage(role.page_id, { includeDeleted: true }) : null;
        if (!page) {
          page = this.createPage({ title, icon, parentId });
          page = this.updatePage({ ...page, document, expectedVersion: page.version });
          db.prepare('INSERT INTO page_roles (role, page_id) VALUES (?, ?)').run(
            'sample.' + key,
            page.id,
          );
        }
        db.exec('COMMIT');
        return page;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    createPage({ title = '제목 없음', icon = '', parentId = null, syncId, document: inputDocument } = {}) {
      const id = syncId || randomUUID();
      const cleanIcon = cleanPageIcon(icon);
      const cleanParentId = cleanPageParentId(parentId);
      if (cleanParentId && !this.getPage(cleanParentId))
        throw new PageValidationError('상위 페이지를 찾을 수 없습니다.');
      const first = db
        .prepare(
          cleanParentId
            ? 'SELECT MAX(position) AS p FROM pages WHERE parent_id = ?'
            : 'SELECT MAX(position) AS p FROM pages WHERE parent_id IS NULL',
        )
        .get(...(cleanParentId ? [cleanParentId] : []));
      const position = (first?.p ?? -1) + 1;
      const now = new Date().toISOString();
      const document = inputDocument ?? {
        schemaVersion: 1,
        blocks: [{ id: randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }],
      };
      return pageTransaction(db, () => {
        db.prepare(
          'INSERT INTO pages (id, title, icon, parent_id, position, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
        ).run(
          id,
          cleanPageTitle(title),
          cleanIcon,
          cleanParentId,
          position,
          serializePageDocument(document),
          now,
          now,
        );
        syncPageReferences(db, id, document);
        return this.getPage(id);
      });
    },
    listPages() {
      return db
        .prepare(
          'SELECT id, title, icon, parent_id AS parentId, position, version, created_at AS createdAt, updated_at AS updatedAt FROM pages WHERE deleted_at IS NULL ORDER BY position, updated_at DESC, rowid',
        )
        .all();
    },
    getPage(id, { includeDeleted = false } = {}) {
      const row = db
        .prepare(
          `SELECT id, title, icon, parent_id AS parentId, position, document, version, created_at AS createdAt, updated_at AS updatedAt FROM pages WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
        )
        .get(id);
      return row ? { ...row, document: JSON.parse(row.document) } : null;
    },
    movePage({ id, parentId, position }) {
      const cleanParentId = cleanPageParentId(parentId);
      if (typeof position !== 'number' || !Number.isFinite(position))
        throw new PageValidationError('페이지 위치가 올바르지 않습니다.');
      const page = this.getPage(id);
      if (!page) return null;
      if (cleanParentId) {
        if (!this.getPage(cleanParentId))
          throw new PageValidationError('상위 페이지를 찾을 수 없습니다.');
        // 상위로 올라가며 대상이 자기 자신 또는 자손인지 확인한다
        let cursor = cleanParentId;
        const seen = new Set([id]);
        while (cursor) {
          if (seen.has(cursor))
            throw new PageValidationError('페이지를 자기 안쪽으로 옮길 수 없습니다.');
          seen.add(cursor);
          cursor = this.getPage(cursor)?.parentId ?? null;
        }
      }
      db.prepare('UPDATE pages SET parent_id = ?, position = ? WHERE id = ?').run(
        cleanParentId,
        position,
        id,
      );
      return this.getPage(id);
    },
    updatePage({ id, title, document, expectedVersion, icon }) {
      const cleanTitle = cleanPageTitle(title);
      const serialized = serializePageDocument(document);
      const cleanIcon = icon === undefined ? null : cleanPageIcon(icon);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new PageConflictError('페이지 버전이 올바르지 않습니다.');
      const updatedAt = new Date().toISOString();
      return pageTransaction(db, () => {
        const previous = this.getPage(id);
        if (!previous) return null;
        if (previous.version !== expectedVersion)
          throw new PageConflictError('다른 곳에서 먼저 수정한 페이지입니다.');
        syncPageReferences(db, id, document, previous.document);
        const result = db
          .prepare(
            'UPDATE pages SET title = ?, document = ?, icon = COALESCE(?, icon), version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
          )
          .run(cleanTitle, serialized, cleanIcon, updatedAt, id, expectedVersion);
        if (!result.changes) {
          if (!this.getPage(id)) return null;
          throw new PageConflictError('다른 곳에서 먼저 수정한 페이지입니다.');
        }
        return this.getPage(id);
      });
    },
    createCapture(input) {
      return this.saveCapture(input).item;
    },
    saveCapture({
      kind,
      text = '',
      url = null,
      files = [],
      aiRequest = null,
      sampleKey = null,
      requestId = null,
      syncId = null,
    }) {
      const submissionId = requestId === null ? null : cleanRequestId(requestId);
      const hash = submissionId ? captureFingerprint({ kind, text, url, files, aiRequest }) : null;
      if (submissionId) {
        const replay = this.captureSubmission(submissionId, hash);
        if (replay) return replay;
      }
      if (sampleKey !== null) {
        if (typeof sampleKey !== 'string' || !/^[a-z0-9.-]{1,100}$/i.test(sampleKey))
          throw new CaptureValidationError('예시 식별자가 올바르지 않습니다.');
        const existing = db.prepare('SELECT id FROM captures WHERE sample_key = ?').get(sampleKey);
        if (existing)
          return { item: this.getCapture(existing.id, { includeDeleted: true }), replayed: true };
      }
      let snapshot = null;
      if (aiRequest !== null) {
        try {
          snapshot = storeRequestSnapshot(aiRequest, {
            content: text,
            url: url || inferInputUrl(text),
          });
        } catch (error) {
          throw new CaptureValidationError(error.message);
        }
      }
      const id = syncId ?? randomUUID();
      const createdAt = new Date().toISOString();
      const insertCapture = db.prepare(
        'INSERT INTO captures (id, kind, text, url, created_at, updated_at, version, ai_request, sample_key) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      );
      const insertAsset = db.prepare(
        'INSERT INTO assets (id, capture_id, storage_key, name, mime, size) VALUES (?, ?, ?, ?, ?, ?)',
      );
      return pageTransaction(db, () => {
        insertCapture.run(
          id,
          kind,
          text,
          url,
          createdAt,
          createdAt,
          snapshot ? JSON.stringify(snapshot) : null,
          sampleKey,
        );
        for (const file of files)
          insertAsset.run(randomUUID(), id, file.key, file.name, file.mime, file.size);
        if (snapshot && !sampleKey)
          this.enqueueAiJob({
            captureId: id,
            requestId: submissionId || randomUUID(),
            expectedVersion: 1,
          });
        if (submissionId) this.recordCaptureSubmission(submissionId, hash, id);
        return { item: this.getCapture(id), replayed: false };
      });
    },
    getCapture(id, { includeDeleted = false } = {}) {
      return hydrate(
        db
          .prepare(
            `SELECT id, kind, text, url, created_at AS createdAt, updated_at AS updatedAt, version, ai_request AS aiRequest, sample_key AS sampleKey, organized_at AS organizedAt, organized_page_id AS organizedPageId, organized_operation_id AS organizedOperationId, deleted_at AS deletedAt FROM captures WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
          )
          .get(id),
      );
    },
    updateCapture({ id, text, url, expectedVersion }) {
      const current = this.getCapture(id);
      if (!current) return null;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new CaptureValidationError('수정 버전이 올바르지 않습니다.');
      if (current.version !== expectedVersion)
        throw new CaptureConflictError('다른 곳에서 먼저 수정한 항목입니다.');
      if (typeof text !== 'string')
        throw new CaptureValidationError('수정할 내용을 입력해 주세요.');
      const cleanText = text.trim();
      if (cleanText.length > 10000)
        throw new CaptureValidationError('메모는 10,000자까지 입력할 수 있습니다.');
      if (current.kind === 'note' && !cleanText && !current.files.length)
        throw new CaptureValidationError('내용을 입력해 주세요.');

      let cleanUrl = current.url;
      if (current.kind === 'link') {
        if (typeof url !== 'string' || !url.trim())
          throw new CaptureValidationError('올바른 링크 주소를 입력해 주세요.');
        cleanUrl = url.trim();
        try {
          if (!/^https?:$/.test(new URL(cleanUrl).protocol)) throw new Error();
        } catch {
          throw new CaptureValidationError('http 또는 https 링크를 입력해 주세요.');
        }
      } else if (url !== undefined && url !== null && url !== '') {
        throw new CaptureValidationError('이 항목의 링크 주소는 수정할 수 없습니다.');
      }
      if (cleanText === current.text && cleanUrl === current.url) return current;

      const updatedAt = new Date().toISOString();
      const result = db
        .prepare(
          'UPDATE captures SET text = ?, url = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?',
        )
        .run(cleanText, cleanUrl, updatedAt, id, expectedVersion);
      if (!result.changes) {
        if (!this.getCapture(id)) return null;
        throw new CaptureConflictError('다른 곳에서 먼저 수정한 항목입니다.');
      }
      return this.getCapture(id);
    },
    captureCounts({ organization = 'inbox' } = {}) {
      if (!['inbox', 'organized'].includes(organization))
        throw new CaptureValidationError('정리 상태가 올바르지 않습니다.');
      const row = db
        .prepare(
          `SELECT COUNT(*) FILTER (WHERE ai_request IS NULL) AS memo, COUNT(*) FILTER (WHERE ai_request IS NOT NULL) AS ai FROM captures WHERE deleted_at IS NULL AND organized_at IS ${organization === 'inbox' ? '' : 'NOT '}NULL`,
        )
        .get();
      return { memo: row.memo, ai: row.ai };
    },
    listCaptures({
      query = '',
      kind = 'all',
      limit = 100,
      scope = 'all',
      organization = 'inbox',
    } = {}) {
      if (!['inbox', 'organized'].includes(organization))
        throw new CaptureValidationError('정리 상태가 올바르지 않습니다.');
      const conditions = [
        'deleted_at IS NULL',
        `organized_at IS ${organization === 'inbox' ? '' : 'NOT '}NULL`,
      ];
      const params = [];
      if (scope !== 'all' && scope !== 'memo' && scope !== 'ai')
        throw new CaptureValidationError('목록 구분이 올바르지 않습니다.');
      if (scope !== 'all')
        conditions.push(scope === 'ai' ? 'ai_request IS NOT NULL' : 'ai_request IS NULL');
      if (kind !== 'all') {
        conditions.push('kind = ?');
        params.push(kind);
      }
      if (query.trim()) {
        conditions.push(
          "(text LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM assets WHERE assets.capture_id = captures.id AND assets.name LIKE ? ESCAPE '\\') OR json_extract(ai_request, '$.input.content') LIKE ? ESCAPE '\\' OR json_extract(ai_request, '$.input.url') LIKE ? ESCAPE '\\' OR json_extract(ai_request, '$.prompt') LIKE ? ESCAPE '\\' OR json_extract(ai_request, '$.template.name') LIKE ? ESCAPE '\\')",
        );
        const escaped = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
        params.push(escaped, escaped, escaped, escaped, escaped, escaped, escaped);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db
        .prepare(
          `SELECT id, kind, text, url, created_at AS createdAt, updated_at AS updatedAt, version, ai_request AS aiRequest, sample_key AS sampleKey, organized_at AS organizedAt, organized_page_id AS organizedPageId, organized_operation_id AS organizedOperationId FROM captures ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(...params, limit)
        .map(hydrate);
    },
    getAsset(id) {
      return visibleAsset(db, id);
    },
    healthy() {
      db.prepare('SELECT 1 FROM pages LIMIT 1').get();
      return true;
    },
    close() {
      db.close();
    },
  };
  Object.assign(
    store,
    createAiJobStore(db, () => store),
    createAiSettingsStore(db),
  );
  Object.assign(
    store,
    createAiTaskAdoption(db, () => store),
  );
  Object.assign(
    store,
    createPageCommentStore(db, () => store),
  );
  Object.assign(
    store,
    createSharedCommentStore(db, () => store),
  );
  Object.assign(store, createSharedCommentInboxStore(db, () => store));
  Object.assign(store, createPlanConnectionStore(db, () => store));
  Object.assign(store, createWorkspacePageStore(db, () => store));
  Object.assign(
    store,
    createOcrStore(db, () => store),
  );
  Object.assign(store, createSearchStore(db));
  Object.assign(
    store,
    createPageAiStore(db, () => store),
  );
  initializeSync(db);
  Object.assign(store, createJournalStore(db));
  initializeSyncFeed(db);
  bindSyncStore(store, db);
  store.syncSession = () => getSyncSession(db);
  store.auth = createAuthStore(db);
  return store;
}
