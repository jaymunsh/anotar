import { randomUUID } from 'node:crypto';
import {
  cleanPageParentId,
  cleanPageTitle,
  PageConflictError,
  PageValidationError,
  serializePageDocument,
} from './pages.mjs';
import { pageTransaction, syncPageReferences } from './pageConnections.mjs';
import { staticMapStyles } from '../shared/staticMap.ts';

export class PageToolsNotFoundError extends Error {
  name = 'PageToolsNotFoundError';
}

// Existing IDs, row order, keys and capture ownership survive this table rebuild.
export function initializePageAssets(db) {
  if (
    db
      .prepare('PRAGMA table_info(assets)')
      .all()
      .some((column) => column.name === 'page_id')
  )
    return;
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON');
  try {
    pageTransaction(db, () => {
      db.exec(`
        DROP TRIGGER IF EXISTS search_asset_insert;
        DROP TRIGGER IF EXISTS search_asset_update;
        DROP TRIGGER IF EXISTS search_asset_delete;
        CREATE TABLE assets_page_migration (
          id TEXT PRIMARY KEY,
          capture_id TEXT REFERENCES captures(id) ON DELETE CASCADE,
          page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
          storage_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
          CHECK((capture_id IS NULL) != (page_id IS NULL))
        );
        INSERT INTO assets_page_migration(rowid,id,capture_id,storage_key,name,mime,size)
          SELECT rowid,id,capture_id,storage_key,name,mime,size FROM assets;
        DROP TABLE assets;
        ALTER TABLE assets_page_migration RENAME TO assets;
        CREATE INDEX assets_capture_id ON assets(capture_id);
        CREATE INDEX assets_page_id ON assets(page_id);
      `);
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Page attachment migration foreign key check failed');
    });
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON');
  }
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function cleanId(value) {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new PageValidationError('페이지 작업 식별자가 올바르지 않아요.');
  return value.toLowerCase();
}
function cleanVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new PageValidationError('페이지 수정 버전이 올바르지 않아요.');
  return value;
}
function cleanName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160)
    throw new PageValidationError('템플릿 이름은 1자부터 160자까지 입력해 주세요.');
  return value.trim();
}
function cloneBlocks(blocks) {
  return blocks.map((block) => ({
    ...structuredClone(block),
    id: randomUUID(),
    children: cloneBlocks(block.children),
  }));
}
function emptyBlock() {
  return { id: randomUUID(), type: 'paragraph', props: {}, content: [], children: [] };
}
function assetIds(document) {
  const result = new Set();
  const visit = (blocks) => {
    for (const block of blocks) {
      if (['asset', 'map', 'itinerary'].includes(block.type) && block.props.assetId)
        result.add(block.props.assetId);
      visit(block.children);
    }
  };
  visit(document.blocks);
  return [...result];
}
function cleanFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 8)
    throw new PageValidationError('한 번에 1개부터 8개까지 첨부할 수 있어요.');
  let total = 0;
  return files.map((file) => {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.key !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,255}$/.test(file.key) ||
      ['.', '..'].includes(file.key) ||
      typeof file.name !== 'string' ||
      !file.name ||
      file.name.length > 255 ||
      typeof file.mime !== 'string' ||
      !file.mime ||
      file.mime.length > 255 ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 25 * 1024 * 1024 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(file.sha256)
    )
      throw new PageValidationError('첨부 파일 정보가 올바르지 않아요.');
    total += file.size;
    if (total > 100 * 1024 * 1024)
      throw new PageValidationError('한 번에 최대 100MB까지 첨부할 수 있어요.');
    return {
      key: file.key,
      name: file.name,
      mime: file.mime,
      size: file.size,
      sha256: file.sha256.toLowerCase(),
    };
  });
}

export function createPageTools(db, getStore) {
  pageTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS page_tool_operations (
        operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS map_image_daily_usage (
        day TEXT PRIMARY KEY, requests INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS page_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, icon TEXT NOT NULL,
        document TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS page_template_assets (
        template_id TEXT NOT NULL REFERENCES page_templates(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL, PRIMARY KEY(template_id,asset_id)
      );
      CREATE INDEX IF NOT EXISTS page_template_asset ON page_template_assets(asset_id);
      CREATE TABLE IF NOT EXISTS page_revisions (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, title TEXT NOT NULL, icon TEXT NOT NULL,
        document TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(page_id,version)
      );
      CREATE TABLE IF NOT EXISTS page_revision_assets (
        page_id TEXT NOT NULL, version INTEGER NOT NULL, asset_id TEXT NOT NULL,
        PRIMARY KEY(page_id,version,asset_id),
        FOREIGN KEY(page_id,version) REFERENCES page_revisions(page_id,version) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS page_revision_asset ON page_revision_assets(asset_id);
      CREATE TRIGGER IF NOT EXISTS page_revision_insert AFTER INSERT ON pages BEGIN
        INSERT INTO page_revisions VALUES(NEW.id,NEW.version,NEW.title,NEW.icon,NEW.document,NEW.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS page_revision_update AFTER UPDATE OF version ON pages WHEN NEW.version != OLD.version BEGIN
        INSERT INTO page_revisions VALUES(NEW.id,NEW.version,NEW.title,NEW.icon,NEW.document,NEW.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS page_revision_retention AFTER INSERT ON page_revisions BEGIN
        INSERT OR IGNORE INTO page_revision_assets
          SELECT NEW.page_id,NEW.version,json_extract(value,'$.props.assetId') FROM json_tree(NEW.document,'$.blocks')
          WHERE type='object' AND json_extract(value,'$.type')='asset' AND json_extract(value,'$.props.assetId') IS NOT NULL;
        DELETE FROM page_revisions WHERE page_id=NEW.page_id AND version IN
          (SELECT version FROM page_revisions WHERE page_id=NEW.page_id ORDER BY version DESC LIMIT -1 OFFSET 100);
      END;
      CREATE TRIGGER IF NOT EXISTS page_revision_delete AFTER DELETE ON page_revisions BEGIN
        DELETE FROM page_revision_assets WHERE page_id=OLD.page_id AND version=OLD.version;
      END;
    `);
    if (
      !db
        .prepare("SELECT name FROM page_connection_migrations WHERE name='page-revisions-v1'")
        .get()
    ) {
      db.exec(`INSERT OR IGNORE INTO page_revisions
        SELECT id,version,title,icon,document,updated_at FROM pages;
        INSERT INTO page_connection_migrations(name) VALUES('page-revisions-v1');`);
    }
  });

  // Only derived reference records change. Preserve every original document/revision.
  if (
    !db
      .prepare("SELECT name FROM page_connection_migrations WHERE name='plan-preview-assets-v1'")
      .get()
  ) {
    pageTransaction(db, () => {
      db.exec(`DROP TRIGGER IF EXISTS page_revision_retention;
        CREATE TRIGGER page_revision_retention AFTER INSERT ON page_revisions BEGIN
          INSERT OR IGNORE INTO page_revision_assets
            SELECT NEW.page_id,NEW.version,json_extract(value,'$.props.assetId') FROM json_tree(NEW.document,'$.blocks')
            WHERE type='object' AND json_extract(value,'$.type') IN ('asset','map','itinerary') AND COALESCE(json_extract(value,'$.props.assetId'),'') != '';
          DELETE FROM page_revisions WHERE page_id=NEW.page_id AND version IN
            (SELECT version FROM page_revisions WHERE page_id=NEW.page_id ORDER BY version DESC LIMIT -1 OFFSET 100);
        END;
        INSERT OR IGNORE INTO page_revision_assets
          SELECT r.page_id,r.version,json_extract(j.value,'$.props.assetId') FROM page_revisions r,json_tree(r.document,'$.blocks') j
          WHERE j.type='object' AND json_extract(j.value,'$.type') IN ('map','itinerary') AND COALESCE(json_extract(j.value,'$.props.assetId'),'') != '';
        INSERT INTO page_connection_migrations(name) VALUES('plan-preview-assets-v1');`);
    });
  }

  const templateFields = 'id,name,title,icon,document,created_at AS createdAt';
  const revisionFields = 'page_id AS pageId,version,title,icon,created_at AS createdAt';
  function hydrate(row) {
    return row ? { ...row, document: JSON.parse(row.document) } : null;
  }
  function current(pageId, expectedVersion) {
    const page = getStore().getPage(pageId);
    if (!page) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
    if (page.version !== expectedVersion)
      throw new PageConflictError('다른 곳에서 페이지를 수정했어요. 최신 내용을 확인해 주세요.');
    return page;
  }
  function once(operationId, request, action) {
    const id = cleanId(operationId),
      serialized = JSON.stringify(request);
    return pageTransaction(db, () => {
      const old = db
        .prepare('SELECT request,result FROM page_tool_operations WHERE operation_id=?')
        .get(id);
      if (old) {
        if (old.request !== serialized)
          throw new PageConflictError(
            '이미 제출한 작업의 내용이 달라요. 이전 요청으로 다시 확인해 주세요.',
          );
        return { ...JSON.parse(old.result), replayed: true };
      }
      const result = action();
      db.prepare('INSERT INTO page_tool_operations VALUES(?,?,?,?)').run(
        id,
        serialized,
        JSON.stringify(result),
        new Date().toISOString(),
      );
      return { ...result, replayed: false };
    });
  }
  function newPage({ title, icon, parentId, document }) {
    if (parentId && !getStore().getPage(parentId))
      throw new PageToolsNotFoundError('상위 페이지를 찾을 수 없어요.');
    const id = randomUUID(),
      now = new Date().toISOString();
    const position = db
      .prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM pages WHERE parent_id IS ?')
      .get(parentId).position;
    db.prepare(
      'INSERT INTO pages(id,title,icon,parent_id,position,document,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)',
    ).run(id, title, icon, parentId, position, serializePageDocument(document), now, now);
    // Snapshots were already validated when saved. Keep their missing legacy references too.
    syncPageReferences(db, id, document, null, false);
    return getStore().getPage(id);
  }
  function mutationInput(pageId, expectedVersion) {
    return { pageId: cleanId(pageId), expectedVersion: cleanVersion(expectedVersion) };
  }
  function saveSnapshot(page, { title = page.title, icon = page.icon, document }) {
    const serialized = serializePageDocument(document);
    // Only persisted snapshots reach this helper; absent legacy targets remain inert references.
    syncPageReferences(db, page.id, document, null, false);
    const result = db
      .prepare(
        'UPDATE pages SET title=?,icon=?,document=?,version=version+1,updated_at=? WHERE id=? AND version=?',
      )
      .run(title, icon, serialized, new Date().toISOString(), page.id, page.version);
    if (!result.changes)
      throw new PageConflictError('다른 곳에서 페이지를 수정했어요. 최신 내용을 확인해 주세요.');
    return getStore().getPage(page.id);
  }
  return {
    preparePageMapImage({ pageId, expectedVersion, operationId, blockId, style }) {
      const input = { ...mutationInput(pageId, expectedVersion), operationId: cleanId(operationId), blockId, style };
      if (typeof blockId !== 'string' || !blockId || blockId.length > 100)
        throw new PageValidationError('일정 블록을 확인해 주세요.');
      if (!Object.hasOwn(staticMapStyles, style)) throw new PageValidationError('지도 스타일을 확인해 주세요.');
      const request = JSON.stringify({ action: 'map-image', ...input });
      const old = db.prepare('SELECT request,result FROM page_tool_operations WHERE operation_id=?').get(input.operationId);
      if (old) {
        if (old.request !== request) throw new PageConflictError('이미 제출한 지도 요청의 내용이 달라요. 이전 요청으로 확인해 주세요.');
        return { input, receipt: { ...JSON.parse(old.result), replayed: true } };
      }
      const page = current(input.pageId, input.expectedVersion);
      const find = (blocks) => {
        for (const block of blocks) {
          if (block.id === blockId) return block;
          const child = find(block.children);
          if (child) return child;
        }
        return null;
      };
      const block = find(page.document.blocks);
      if (block?.type !== 'itinerary') throw new PageValidationError('지도 이미지를 만들 일정 블록을 찾을 수 없어요.');
      return { input, block };
    },
    reserveMapImageRequest(limit) {
      const day = new Date().toISOString().slice(0, 10);
      return pageTransaction(db, () => {
        const used = db.prepare('SELECT requests FROM map_image_daily_usage WHERE day=?').get(day)?.requests || 0;
        if (used >= limit) throw new PageConflictError('오늘의 지도 생성 한도에 도달했어요. 기존 이미지는 유지돼요. 내일 다시 생성해 주세요.');
        db.prepare('INSERT INTO map_image_daily_usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET requests=requests+1').run(day);
        db.prepare('DELETE FROM map_image_daily_usage WHERE day<?').run(day);
      });
    },
    attachPageMapImage({ input, file, imageInput }) {
      const [upload] = cleanFiles([file]);
      return once(input.operationId, { action: 'map-image', ...input }, () => {
        const page = current(input.pageId, input.expectedVersion), assetId = randomUUID();
        db.prepare('INSERT INTO assets(id,page_id,storage_key,name,mime,size) VALUES(?,?,?,?,?,?)')
          .run(assetId, page.id, upload.key, upload.name, upload.mime, upload.size);
        let found = false;
        const replace = (blocks) => blocks.map((block) => {
          if (block.id === input.blockId && block.type === 'itinerary') {
            found = true;
            return { ...block, props: { ...block.props, assetId, imageSource: 'geoapify', imageInput } };
          }
          return { ...block, children: replace(block.children) };
        });
        const document = { schemaVersion: 1, blocks: replace(page.document.blocks) };
        if (!found) throw new PageValidationError('지도 이미지를 넣을 일정 블록을 찾을 수 없어요.');
        return { item: getStore().updatePage({ ...page, document, expectedVersion: page.version }) };
      });
    },
    duplicatePage({ pageId, expectedVersion, operationId }) {
      const input = mutationInput(pageId, expectedVersion);
      return once(operationId, { action: 'duplicate', ...input }, () => {
        const page = current(input.pageId, input.expectedVersion);
        return {
          item: newPage({
            title: cleanPageTitle(page.title.slice(0, 154) + ' (복사)'),
            icon: page.icon,
            parentId: page.parentId,
            document: { schemaVersion: 1, blocks: cloneBlocks(page.document.blocks) },
          }),
        };
      });
    },
    savePageTemplate({ pageId, name, expectedVersion, operationId }) {
      const input = { ...mutationInput(pageId, expectedVersion), name: cleanName(name) };
      return once(operationId, { action: 'save-template', ...input }, () => {
        const page = current(input.pageId, input.expectedVersion),
          id = randomUUID();
        db.prepare('INSERT INTO page_templates VALUES(?,?,?,?,?,?)').run(
          id,
          input.name,
          page.title,
          page.icon,
          serializePageDocument(page.document),
          new Date().toISOString(),
        );
        for (const assetId of assetIds(page.document))
          db.prepare('INSERT INTO page_template_assets VALUES(?,?)').run(id, assetId);
        return {
          item: hydrate(
            db.prepare(`SELECT ${templateFields} FROM page_templates WHERE id=?`).get(id),
          ),
        };
      });
    },
    listPageTemplates() {
      return db
        .prepare(`SELECT ${templateFields} FROM page_templates ORDER BY created_at DESC,rowid DESC`)
        .all()
        .map(hydrate);
    },
    createPageFromTemplate({ templateId, parentId = null, operationId }) {
      const input = { templateId: cleanId(templateId), parentId: cleanPageParentId(parentId) };
      return once(operationId, { action: 'create-template', ...input }, () => {
        const template = hydrate(
          db
            .prepare(`SELECT ${templateFields} FROM page_templates WHERE id=?`)
            .get(input.templateId),
        );
        if (!template) throw new PageToolsNotFoundError('템플릿을 찾을 수 없어요.');
        return {
          item: newPage({
            title: template.title,
            icon: template.icon,
            parentId: input.parentId,
            document: { schemaVersion: 1, blocks: cloneBlocks(template.document.blocks) },
          }),
        };
      });
    },
    deletePageTemplate({ templateId }) {
      return Boolean(
        db.prepare('DELETE FROM page_templates WHERE id=?').run(cleanId(templateId)).changes,
      );
    },
    movePageBlocks({
      pageId,
      targetPageId,
      targetVersion,
      blockIds,
      operationId,
      expectedVersion,
    }) {
      const input = {
        ...mutationInput(pageId, expectedVersion),
        targetPageId: cleanId(targetPageId),
        targetVersion: cleanVersion(targetVersion),
      };
      if (input.pageId === input.targetPageId)
        throw new PageValidationError('다른 페이지를 목적지로 선택해 주세요.');
      if (
        !Array.isArray(blockIds) ||
        !blockIds.length ||
        blockIds.length > 1000 ||
        blockIds.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
        new Set(blockIds).size !== blockIds.length
      )
        throw new PageValidationError('옮길 블록을 선택해 주세요.');
      input.blockIds = [...blockIds].sort();
      return once(operationId, { action: 'move-blocks', ...input }, () => {
        const source = current(input.pageId, input.expectedVersion),
          target = current(input.targetPageId, input.targetVersion);
        const selection = new Set(input.blockIds),
          found = new Set(),
          moved = [];
        const extract = (blocks, selectedAncestor = false) =>
          blocks.flatMap((block) => {
            const selected = selection.has(block.id);
            if (selected) found.add(block.id);
            const children = extract(block.children, selectedAncestor || selected);
            if (selected && !selectedAncestor) moved.push(block);
            return selected && !selectedAncestor ? [] : [{ ...block, children }];
          });
        const kept = extract(source.document.blocks);
        if (found.size !== selection.size)
          throw new PageValidationError('선택한 블록을 찾을 수 없어요. 다시 선택해 주세요.');
        const targetDocument = {
          schemaVersion: 1,
          blocks: [...target.document.blocks, ...cloneBlocks(moved)],
        };
        const sourceDocument = { schemaVersion: 1, blocks: kept.length ? kept : [emptyBlock()] };
        // Validate both limits before writing either page. Target goes first while old file refs exist.
        serializePageDocument(targetDocument);
        serializePageDocument(sourceDocument);
        const updatedTarget = saveSnapshot(target, { document: targetDocument });
        const item = saveSnapshot(source, { document: sourceDocument });
        return { item, target: updatedTarget };
      });
    },
    attachPageFiles({ pageId, files, operationId, expectedVersion }) {
      const input = mutationInput(pageId, expectedVersion),
        uploads = cleanFiles(files);
      return once(
        operationId,
        { action: 'attach', ...input, files: uploads.map(({ key, ...file }) => file) },
        () => {
          const page = current(input.pageId, input.expectedVersion);
          const blocks = uploads.map((file) => {
            const assetId = randomUUID();
            db.prepare(
              'INSERT INTO assets(id,page_id,storage_key,name,mime,size) VALUES(?,?,?,?,?,?)',
            ).run(assetId, page.id, file.key, file.name, file.mime, file.size);
            return {
              id: randomUUID(),
              type: 'asset',
              props: {
                assetId,
                display: /^image\/(png|jpeg|webp|gif|avif)$/.test(file.mime) ? 'image' : 'file',
              },
              children: [],
            };
          });
          return {
            item: getStore().updatePage({
              ...page,
              document: { schemaVersion: 1, blocks: [...page.document.blocks, ...blocks] },
              expectedVersion: page.version,
            }),
          };
        },
      );
    },
    listPageRevisions(pageId) {
      if (!getStore().getPage(pageId)) return null;
      return db
        .prepare(
          `SELECT ${revisionFields} FROM page_revisions WHERE page_id=? ORDER BY version DESC`,
        )
        .all(pageId);
    },
    getPageRevision(pageId, version) {
      if (!getStore().getPage(pageId)) return null;
      return hydrate(
        db
          .prepare(
            `SELECT ${revisionFields},document FROM page_revisions WHERE page_id=? AND version=?`,
          )
          .get(pageId, cleanVersion(version)),
      );
    },
    restorePageRevision({ pageId, revisionVersion, operationId, expectedVersion }) {
      const input = {
        ...mutationInput(pageId, expectedVersion),
        revisionVersion: cleanVersion(revisionVersion),
      };
      return once(operationId, { action: 'restore', ...input }, () => {
        const page = current(input.pageId, input.expectedVersion);
        const revision = hydrate(
          db
            .prepare(
              `SELECT ${revisionFields},document FROM page_revisions WHERE page_id=? AND version=?`,
            )
            .get(input.pageId, input.revisionVersion),
        );
        if (!revision) throw new PageToolsNotFoundError('수정본을 찾을 수 없어요.');
        return { item: saveSnapshot(page, revision) };
      });
    },
  };
}
