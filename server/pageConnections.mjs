import { randomUUID } from 'node:crypto';
import { createPageBacklinks } from './pageBacklinks.mjs';
import {
  cleanPageIcon,
  cleanPageParentId,
  cleanPageTitle,
  PageValidationError,
  serializePageDocument,
} from './pages.mjs';
import { cleanRequestId } from './ai/contracts.mjs';

export class PageImportConflictError extends Error {
  name = 'PageImportConflictError';
}
export class PageImportNotFoundError extends Error {
  name = 'PageImportNotFoundError';
}

export function pageTransaction(db, callback) {
  // SAVEPOINT also works inside the existing staging/sample transactions.
  db.exec('SAVEPOINT page_change');
  try {
    const result = callback();
    db.exec('RELEASE page_change');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO page_change; RELEASE page_change');
    throw error;
  }
}

function references(document) {
  const result = [];
  const visit = (blocks) => {
    for (const block of blocks) {
      const key = {
        captureRef: ['capture', 'captureId'],
        asset: ['asset', 'assetId'],
        page: ['page', 'pageId'],
      }[block.type];
      if (key) result.push({ blockId: block.id, type: key[0], id: block.props[key[1]] });
      if (['map', 'itinerary'].includes(block.type) && block.props.assetId)
        result.push({ blockId: block.id, type: 'asset', id: block.props.assetId, imageOnly: true });
      visit(block.children || []);
    }
  };
  visit(document.blocks);
  return result;
}

export function visibleAsset(db, id) {
  return (
    db
      .prepare(
        `SELECT id, capture_id AS captureId, page_id AS pageId, storage_key AS key, name, mime, size FROM assets WHERE id = ? AND (
    EXISTS (SELECT 1 FROM captures WHERE captures.id = assets.capture_id AND captures.deleted_at IS NULL) OR
    EXISTS (SELECT 1 FROM pages WHERE pages.id = assets.page_id AND pages.deleted_at IS NULL) OR
    EXISTS (SELECT 1 FROM page_references r JOIN pages p ON p.id = r.page_id WHERE r.target_type = 'asset' AND r.target_id = assets.id AND p.deleted_at IS NULL) OR
    EXISTS (SELECT 1 FROM page_revision_assets r JOIN pages p ON p.id=r.page_id WHERE r.asset_id=assets.id AND p.deleted_at IS NULL) OR
    EXISTS (SELECT 1 FROM page_template_assets t WHERE t.asset_id=assets.id)
  )`,
      )
      .get(id) ?? null
  );
}

export function validatePageReferences(db, document, previous = null, { newPageId = null } = {}) {
  const old = new Set(previous ? references(previous).map((ref) => JSON.stringify(ref)) : []);
  const refs = references(document);
  for (const ref of refs) {
    if (old.has(JSON.stringify(ref))) continue;
    const table = { capture: 'captures', asset: 'assets', page: 'pages' }[ref.type];
    const target =
      ref.type === 'asset'
        ? visibleAsset(db, ref.id)
        : ref.type === 'page' && ref.id === newPageId
          ? { id: newPageId }
          : db.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(ref.id);
    if (ref.imageOnly && target && !/^image\/(png|jpeg|webp|gif|avif)$/.test(target.mime))
      throw new PageValidationError('지도 미리보기에는 이미지 파일을 선택해 주세요.');
    if (!target)
      throw new PageValidationError(
        {
          capture: '원본 메모를 찾을 수 없습니다.',
          asset: '첨부 파일을 찾을 수 없습니다.',
          page: '연결할 페이지를 찾을 수 없습니다.',
        }[ref.type],
      );
  }
  return refs;
}

export function syncPageReferences(db, pageId, document, previous = null, validate = true) {
  const refs = validate ? validatePageReferences(db, document, previous) : references(document);
  db.prepare('DELETE FROM page_references WHERE page_id = ?').run(pageId);
  const insert = db.prepare(
    'INSERT INTO page_references (page_id, block_id, target_type, target_id) VALUES (?, ?, ?, ?)',
  );
  for (const ref of refs) {
    insert.run(pageId, ref.blockId, ref.type, ref.id);
    if (ref.type === 'capture')
      db.prepare('INSERT OR IGNORE INTO page_legacy_origins VALUES (?,?)').run(pageId, ref.id);
  }
}

function cleanImport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PageValidationError('가져올 메모를 선택해 주세요.');
  if (
    typeof value.operationId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value.operationId,
    )
  )
    throw new PageValidationError('가져오기 작업 ID가 올바르지 않습니다.');
  if (typeof value.captureId !== 'string' || !/^[a-f0-9-]{1,100}$/.test(value.captureId))
    throw new PageValidationError('원본 메모 ID가 올바르지 않습니다.');
  if (typeof value.copyContent !== 'boolean')
    throw new PageValidationError('내용 복사 선택이 올바르지 않습니다.');
  if (
    !Array.isArray(value.assetIds) ||
    value.assetIds.length > 8 ||
    new Set(value.assetIds).size !== value.assetIds.length ||
    value.assetIds.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{1,100}$/.test(id))
  )
    throw new PageValidationError('첨부 파일 선택이 올바르지 않습니다.');
  let aiResult;
  if (value.disposition !== undefined && value.disposition !== 'organize')
    throw new PageValidationError('메모 정리 방식이 올바르지 않습니다.');
  if (value.aiResult !== undefined) {
    if (
      !value.aiResult ||
      typeof value.aiResult.jobId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(value.aiResult.jobId)
    )
      throw new PageValidationError('정리할 AI 결과를 선택해 주세요.');
    const document = JSON.parse(serializePageDocument(value.aiResult.document));
    const check = (blocks) => {
      for (const block of blocks) {
        if (['captureRef', 'asset', 'page', 'tableOfContents'].includes(block.type))
          throw new PageValidationError('AI 결과에는 글·표·코드·다이어그램만 담을 수 있어요.');
        check(block.children);
      }
    };
    check(document.blocks);
    aiResult = { jobId: value.aiResult.jobId, document };
  }
  return {
    operationId: value.operationId.toLowerCase(),
    captureId: value.captureId,
    copyContent: value.copyContent,
    assetIds: [...value.assetIds].sort(),
    ...(value.disposition ? { disposition: value.disposition } : {}),
    ...(aiResult ? { aiResult } : {}),
  };
}

function importBlocks(store, input) {
  const capture = store.getCapture(input.captureId);
  if (!capture) throw new PageImportNotFoundError('원본 메모를 찾을 수 없습니다.');
  const files = input.assetIds.map((id) => {
    const file = store.getAsset(id);
    if (!file) throw new PageImportNotFoundError('첨부 파일을 찾을 수 없습니다.');
    if (file.captureId !== capture.id)
      throw new PageValidationError('이 메모에 속한 첨부 파일만 담을 수 있습니다.');
    return file;
  });
  const block = (type, props, content) => ({
    id: randomUUID(),
    type,
    props,
    ...(content === undefined ? {} : { content }),
    children: [],
  });
  const blocks =
    input.disposition === 'organize' ? [] : [block('captureRef', { captureId: capture.id })];
  if (input.aiResult) {
    const job = store.getAiJob(input.aiResult.jobId);
    if (!job || job.captureId !== capture.id || job.status !== 'result_ready' || !job.result)
      throw new PageValidationError('이 메모의 완료된 AI 결과만 페이지로 정리할 수 있어요.');
    const copyBlocks = (items) =>
      items.map((item) => ({
        ...item,
        id: randomUUID(),
        children: copyBlocks(item.children),
      }));
    blocks.push(...copyBlocks(input.aiResult.document.blocks));
  }
  if (input.copyContent) {
    if (capture.text)
      for (const text of capture.text.split(/\r\n|\n|\r/))
        blocks.push(block('paragraph', {}, text ? [{ type: 'text', text, styles: {} }] : []));
    if (capture.url)
      blocks.push(
        block('paragraph', {}, [
          {
            type: 'link',
            href: capture.url,
            content: [{ type: 'text', text: capture.url, styles: {} }],
          },
        ]),
      );
  }
  for (const file of files)
    blocks.push(
      block('asset', {
        assetId: file.id,
        display: /^image\/(png|jpeg|webp|gif|avif)$/.test(file.mime) ? 'image' : 'file',
      }),
    );
  if (!blocks.length) blocks.push(block('paragraph', {}, []));
  return blocks;
}

export function createPageConnections(db, getStore) {
  const backlinks = createPageBacklinks(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_references (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      PRIMARY KEY (page_id, block_id)
    );
    CREATE INDEX IF NOT EXISTS page_reference_target ON page_references(target_type, target_id);
    CREATE TABLE IF NOT EXISTS page_import_operations (
      operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_connection_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS page_origins (
      operation_id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
      capture_id TEXT NOT NULL REFERENCES captures(id), job_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS page_origins_page ON page_origins(page_id);
    CREATE TABLE IF NOT EXISTS page_legacy_origins (
      page_id TEXT NOT NULL REFERENCES pages(id), capture_id TEXT NOT NULL,
      PRIMARY KEY(page_id,capture_id)
    );
    CREATE TABLE IF NOT EXISTS capture_organization_operations (
      operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_batch_import_operations (
      operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  if (
    !db.prepare('SELECT name FROM page_connection_migrations WHERE name = ?').get('references-v1')
  ) {
    pageTransaction(db, () => {
      for (const page of db.prepare('SELECT id, document FROM pages').all())
        syncPageReferences(db, page.id, JSON.parse(page.document), null, false);
      db.prepare('INSERT INTO page_connection_migrations (name) VALUES (?)').run('references-v1');
    });
  }
  if (!db.prepare('SELECT name FROM page_connection_migrations WHERE name=?').get('origins-v1'))
    pageTransaction(db, () => {
      db.exec(
        "INSERT OR IGNORE INTO page_legacy_origins SELECT page_id,target_id FROM page_references WHERE target_type='capture'",
      );
      db.prepare('INSERT INTO page_connection_migrations VALUES (?)').run('origins-v1');
    });
  const summary =
    'id, title, icon, parent_id AS parentId, position, version, created_at AS createdAt, updated_at AS updatedAt';
  function pathFor(item) {
    const path = [{ id: item.id, title: item.title }];
    const seen = new Set([item.id]);
    let parentId = item.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = db
        .prepare(
          'SELECT id, title, parent_id AS parentId FROM pages WHERE id = ? AND deleted_at IS NULL',
        )
        .get(parentId);
      if (!parent) break;
      path.unshift({ id: parent.id, title: parent.title });
      parentId = parent.parentId;
    }
    return path;
  }
  function once(input, target, action) {
    const serialized = JSON.stringify({ ...input, target });
    return pageTransaction(db, () => {
      const existing = db
        .prepare('SELECT request, result FROM page_import_operations WHERE operation_id = ?')
        .get(input.operationId);
      if (existing) {
        if (existing.request !== serialized)
          throw new PageImportConflictError(
            '이미 제출한 작업의 선택이 달라졌습니다. 이전 선택으로 다시 시도해 주세요.',
          );
        return { ...JSON.parse(existing.result), replayed: true };
      }
      const result = action();
      db.prepare(
        'INSERT INTO page_import_operations (operation_id, request, result, created_at) VALUES (?, ?, ?, ?)',
      ).run(input.operationId, serialized, JSON.stringify(result), new Date().toISOString());
      return { ...result, replayed: false };
    });
  }
  function recordOrigin(input, pageId) {
    if (input.disposition !== 'organize') return;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO page_origins VALUES (?,?,?,?,?)').run(
      input.operationId,
      pageId,
      input.captureId,
      input.aiResult?.jobId ?? null,
      now,
    );
    db.prepare(
      'UPDATE captures SET organized_at=?, organized_page_id=?, organized_operation_id=? WHERE id=?',
    ).run(now, pageId, input.operationId, input.captureId);
  }
  return {
    ...backlinks,
    validatePageReferences(document, previous = null, options) {
      return validatePageReferences(db, document, previous, options);
    },
    organizeCaptures(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new PageValidationError('정리할 메모를 선택해 주세요.');
      const operationId = cleanRequestId(value.operationId);
      if (!Array.isArray(value.items) || !value.items.length || value.items.length > 20)
        throw new PageValidationError('메모는 1~20개까지 함께 정리할 수 있어요.');
      const items = value.items.map((row) => {
        if (!row || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 1)
          throw new PageValidationError('메모 버전을 확인해 주세요.');
        if (row.aiResult !== undefined)
          throw new PageValidationError('AI 결과는 결과 화면에서 직접 선택해 정리해 주세요.');
        const input = cleanImport({ ...row, disposition: 'organize' });
        if (!input.copyContent && !input.assetIds.length)
          throw new PageValidationError('각 메모에서 내용 또는 첨부를 선택해 주세요.');
        return { ...input, expectedVersion: row.expectedVersion };
      });
      if (
        new Set(items.map((row) => row.captureId)).size !== items.length ||
        new Set(items.map((row) => row.operationId)).size !== items.length
      )
        throw new PageValidationError('같은 메모와 작업은 한 번만 선택해 주세요.');
      const pageId = value.pageId == null ? null : cleanPageParentId(value.pageId);
      if (
        pageId &&
        (!Number.isSafeInteger(value.expectedPageVersion) || value.expectedPageVersion < 1)
      )
        throw new PageValidationError('대상 페이지 버전을 확인해 주세요.');
      const target = pageId
        ? { pageId, expectedPageVersion: value.expectedPageVersion }
        : {
            title: cleanPageTitle(value.title ?? '제목 없음'),
            parentId: cleanPageParentId(value.parentId ?? null),
          };
      const payload = JSON.stringify({ target, items });
      return pageTransaction(db, () => {
        const receipt = db
          .prepare('SELECT request,result FROM page_batch_import_operations WHERE operation_id=?')
          .get(operationId);
        if (receipt) {
          if (receipt.request !== payload)
            throw new PageImportConflictError(
              '같은 요청의 메모나 선택이 달라졌어요. 이전 요청으로 다시 확인해 주세요.',
            );
          return { ...JSON.parse(receipt.result), replayed: true };
        }
        const store = getStore();
        let page = pageId ? store.getPage(pageId) : null;
        if (pageId && !page) throw new PageImportNotFoundError('대상 페이지를 찾을 수 없어요.');
        if (page && page.version !== target.expectedPageVersion)
          throw new PageImportConflictError('대상 페이지가 변경됐어요. 다시 선택해 주세요.');
        const blocks = [];
        for (const input of items) {
          const capture = store.getCapture(input.captureId);
          if (!capture) throw new PageImportNotFoundError('정리할 메모를 찾을 수 없어요.');
          if (capture.version !== input.expectedVersion || capture.organizedAt)
            throw new PageImportConflictError(
              '메모가 변경되거나 이미 정리됐어요. 목록에서 다시 선택해 주세요.',
            );
          if (!input.assetIds.length && (!input.copyContent || !(capture.text || capture.url)))
            throw new PageValidationError('담을 내용이나 첨부 파일을 선택해 주세요.');
          if (capture.aiRequest)
            throw new PageValidationError(
              '일반 메모만 함께 정리할 수 있어요. AI 결과는 직접 선택해 주세요.',
            );
          if (
            db
              .prepare('SELECT operation_id FROM page_origins WHERE operation_id=?')
              .get(input.operationId) ||
            db
              .prepare('SELECT operation_id FROM page_import_operations WHERE operation_id=?')
              .get(input.operationId)
          )
            throw new PageImportConflictError(
              '이미 사용한 메모 정리 작업이에요. 선택을 다시 확인해 주세요.',
            );
          blocks.push(...importBlocks(store, input));
        }
        if (!page) page = store.createPage(target);
        const item = store.updatePage({
          ...page,
          expectedVersion: page.version,
          document: {
            schemaVersion: 1,
            blocks: pageId ? [...page.document.blocks, ...blocks] : blocks,
          },
        });
        for (const input of items) recordOrigin(input, item.id);
        const result = {
          item,
          blockIds: blocks.map((block) => block.id),
          captureIds: items.map((row) => row.captureId),
        };
        db.prepare('INSERT INTO page_batch_import_operations VALUES (?,?,?,?)').run(
          operationId,
          payload,
          JSON.stringify(result),
          new Date().toISOString(),
        );
        return { ...result, replayed: false };
      });
    },
    unorganizeCapture({ id, operationId, expectedOrganizedOperationId }) {
      const cleanId = cleanRequestId(operationId);
      const expected = cleanRequestId(expectedOrganizedOperationId);
      const request = JSON.stringify({ id, expectedOrganizedOperationId: expected });
      return pageTransaction(db, () => {
        const receipt = db
          .prepare(
            'SELECT request,result FROM capture_organization_operations WHERE operation_id=?',
          )
          .get(cleanId);
        if (receipt) {
          if (receipt.request !== request)
            throw new PageImportConflictError('같은 작업 ID의 정리 상태가 달라졌어요.');
          return { ...JSON.parse(receipt.result), replayed: true };
        }
        const item = getStore().getCapture(id);
        if (!item) throw new PageImportNotFoundError('원본 메모를 찾을 수 없어요.');
        if (!item.organizedAt || item.organizedOperationId !== expected)
          throw new PageImportConflictError(
            '메모의 정리 상태가 변경됐어요. 최신 상태를 확인해 주세요.',
          );
        db.prepare(
          'UPDATE captures SET organized_at=NULL,organized_page_id=NULL,organized_operation_id=NULL WHERE id=?',
        ).run(id);
        const result = { item: getStore().getCapture(id) };
        db.prepare('INSERT INTO capture_organization_operations VALUES (?,?,?,?)').run(
          cleanId,
          request,
          JSON.stringify(result),
          new Date().toISOString(),
        );
        return { ...result, replayed: false };
      });
    },
    pageOrigins(pageId) {
      if (!getStore().getPage(pageId)) return null;
      const origins = db
        .prepare(
          'SELECT capture_id,job_id,operation_id FROM page_origins WHERE page_id=? ORDER BY rowid',
        )
        .all(pageId);
      for (const row of db
        .prepare('SELECT operation_id,request,result FROM page_import_operations')
        .all()) {
        const result = JSON.parse(row.result),
          request = JSON.parse(row.request);
        if (result.item?.id === pageId && !origins.some((x) => x.operation_id === row.operation_id))
          origins.push({
            capture_id: request.captureId,
            job_id: request.aiResult?.jobId ?? null,
            operation_id: row.operation_id,
          });
      }
      for (const ref of db
        .prepare(
          "SELECT DISTINCT target_id FROM page_references WHERE page_id=? AND target_type='capture' UNION SELECT capture_id AS target_id FROM page_legacy_origins WHERE page_id=?",
        )
        .all(pageId, pageId))
        if (!origins.some((x) => x.capture_id === ref.target_id))
          origins.push({ capture_id: ref.target_id, job_id: null, operation_id: null });
      return origins.map((row) => ({
        capture: getStore().getCapture(row.capture_id, { includeDeleted: true }),
        job: row.job_id ? getStore().getAiJob(row.job_id, { includeDeleted: true }) : null,
        operationId: row.operation_id,
      }));
    },
    searchPages({ query = '', cursor = null } = {}) {
      if (typeof query !== 'string' || query.length > 160)
        throw new PageValidationError('페이지 검색어는 160자까지 입력합니다.');
      const q = query.trim();
      let offset = 0;
      if (cursor) {
        try {
          if (typeof cursor !== 'string' || cursor.length > 1500) throw new Error();
          const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
          if (parsed.q !== q || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0)
            throw new Error();
          offset = parsed.offset;
        } catch {
          throw new PageValidationError(
            '페이지 검색 커서가 올바르지 않습니다. 다시 검색해 주세요.',
          );
        }
      }
      const escaped = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const items = db
        .prepare(
          `SELECT ${summary} FROM pages WHERE deleted_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY position, id LIMIT 51 OFFSET ?`,
        )
        .all(escaped, offset);
      const hasMore = items.length > 50;
      return {
        items: items.slice(0, 50).map((item) => ({ ...item, path: pathFor(item) })),
        nextCursor: hasMore
          ? Buffer.from(JSON.stringify({ q, offset: offset + 50 })).toString('base64url')
          : null,
      };
    },
    linkedPages(captureId) {
      return db
        .prepare(
          `SELECT ${summary} FROM pages WHERE deleted_at IS NULL AND id IN (SELECT page_id FROM page_references WHERE target_type = 'capture' AND target_id = ? UNION SELECT page_id FROM page_origins WHERE capture_id=?) ORDER BY updated_at DESC, id`,
        )
        .all(captureId, captureId)
        .map((item) => ({ ...item, path: pathFor(item) }));
    },
    importCaptureIntoPage({ pageId, ...value }) {
      const input = cleanImport(value);
      return once(input, { pageId }, () => {
        const store = getStore();
        const page = store.getPage(pageId);
        if (!page) throw new PageImportNotFoundError('페이지를 찾을 수 없습니다.');
        const blocks = importBlocks(store, input);
        const item = store.updatePage({
          ...page,
          expectedVersion: page.version,
          document: { schemaVersion: 1, blocks: [...page.document.blocks, ...blocks] },
        });
        recordOrigin(input, item.id);
        return { item, blockIds: blocks.map((block) => block.id) };
      });
    },
    createPageWithCapture({ title = '제목 없음', icon = '', parentId = null, syncId, captureImport }) {
      const input = cleanImport(captureImport);
      const target = {
        title: cleanPageTitle(title),
        icon: cleanPageIcon(icon),
        parentId: cleanPageParentId(parentId),
        ...(syncId?{syncId}:{}),
      };
      return once(input, target, () => {
        const store = getStore();
        const blocks = importBlocks(store, input);
        const page = store.createPage(target);
        const item = store.updatePage({
          ...page,
          expectedVersion: page.version,
          document: { schemaVersion: 1, blocks },
        });
        recordOrigin(input, item.id);
        return { item, blockIds: blocks.map((block) => block.id) };
      });
    },
  };
}
