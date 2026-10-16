import { randomUUID } from 'node:crypto';
import { pageTransaction } from './pageConnections.mjs';
import {
  serializePageDocument,
  cleanPageTitle,
  PageConflictError,
  PageValidationError,
} from './pages.mjs';
import { cleanRequestId, fingerprint, AiNotFoundError } from './ai/contracts.mjs';

export function convertedAiDocument(value) {
  const document = JSON.parse(serializePageDocument(value));
  function copy(blocks) {
    return blocks.map((block) => {
      if (['captureRef', 'asset', 'page', 'tableOfContents'].includes(block.type))
        throw new PageValidationError('AI 결과에는 글·표·코드·다이어그램만 담을 수 있어요.');
      return { ...block, id: randomUUID(), children: copy(block.children) };
    });
  }
  if (!document.blocks.length) throw new PageValidationError('반영할 AI 결과가 비어 있어요.');
  return { schemaVersion: 1, blocks: copy(document.blocks) };
}

export function createPageAiStore(db, getStore) {
  db.exec(`CREATE TABLE IF NOT EXISTS page_ai_revisions (
    operation_id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id),
    prior_version INTEGER NOT NULL, title TEXT NOT NULL, document TEXT NOT NULL, applied_version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS page_ai_applies (
    operation_id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), fingerprint TEXT NOT NULL,
    request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS page_ai_undos (
    operation_id TEXT PRIMARY KEY, apply_operation_id TEXT NOT NULL REFERENCES page_ai_applies(operation_id),
    fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  function checkPage(pageId, expectedVersion) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new PageConflictError('페이지 버전이 올바르지 않아요.');
    const page = getStore().getPage(pageId);
    if (!page) throw new AiNotFoundError('페이지를 찾을 수 없어요.');
    if (page.version !== expectedVersion)
      throw new PageConflictError('다른 곳에서 페이지가 수정됐어요. 최신 내용을 확인해 주세요.');
    return page;
  }
  return {
    applyPageAiJob({ pageId, operationId, expectedVersion, jobId, mode, document, title }) {
      const id = cleanRequestId(operationId);
      const hash = fingerprint({ pageId, expectedVersion, jobId, mode, document, title });
      return pageTransaction(db, () => {
        const receipt = db.prepare('SELECT * FROM page_ai_applies WHERE operation_id=?').get(id);
        if (receipt) {
          if (receipt.fingerprint !== hash)
            throw new PageConflictError(
              '같은 반영 ID에 다른 내용이 담겨 있어요. 최초 선택으로 다시 시도해 주세요.',
            );
          return { ...JSON.parse(receipt.result), replayed: true };
        }
        const page = checkPage(pageId, expectedVersion);
        if (!['append', 'replace', 'child'].includes(mode))
          throw new PageValidationError('AI 반영 방식이 올바르지 않아요.');
        const job = getStore().getAiJob(jobId);
        if (!job || job.pageId !== pageId || job.status !== 'result_ready' || !job.result)
          throw new PageValidationError('이 페이지의 완료된 AI 결과를 선택해 주세요.');
        const converted = convertedAiDocument(document);
        let item;
        if (mode === 'child') {
          const child = getStore().createPage({
            title: title === undefined ? 'AI 결과' : cleanPageTitle(title),
            parentId: pageId,
          });
          item = getStore().updatePage({
            ...child,
            document: converted,
            expectedVersion: child.version,
          });
        } else {
          let blocks;
          if (mode === 'append') blocks = [...page.document.blocks, ...converted.blocks];
          else {
            if (!job.targetBlockIds.length)
              throw new PageValidationError(
                '선택한 블록을 기준으로 요청한 결과만 교체할 수 있어요.',
              );
            if (job.sourceVersion !== page.version)
              throw new PageConflictError(
                '요청 후 문서가 수정됐어요. 본문 아래에 추가하거나 다시 요청해 주세요.',
              );
            const selected = new Set(job.targetBlockIds),
              found = new Set();
            let inserted = false;
            function markSelected(block) {
              if (selected.has(block.id)) found.add(block.id);
              for (const child of block.children) markSelected(child);
            }
            function replace(items) {
              return items.flatMap((block) => {
                if (selected.has(block.id)) {
                  markSelected(block);
                  if (inserted) return [];
                  inserted = true;
                  return converted.blocks;
                }
                return [{ ...block, children: replace(block.children) }];
              });
            }
            blocks = replace(page.document.blocks);
            if (found.size !== selected.size)
              throw new PageConflictError('선택한 블록이 변경됐어요. 다시 요청해 주세요.');
          }
          item = getStore().updatePage({
            ...page,
            document: { schemaVersion: 1, blocks },
            expectedVersion,
          });
          db.prepare('INSERT INTO page_ai_revisions VALUES (?,?,?,?,?,?)').run(
            id,
            pageId,
            page.version,
            page.title,
            JSON.stringify(page.document),
            item.version,
          );
        }
        const result = { item, operationId: id };
        db.prepare('INSERT INTO page_ai_applies VALUES (?,?,?,?,?,?)').run(
          id,
          pageId,
          hash,
          JSON.stringify({ expectedVersion, jobId, mode, document, title }),
          JSON.stringify(result),
          new Date().toISOString(),
        );
        return { ...result, replayed: false };
      });
    },
    undoPageAiApply({ pageId, applyOperationId, operationId, expectedVersion }) {
      const id = cleanRequestId(operationId),
        applyId = cleanRequestId(applyOperationId);
      const hash = fingerprint({ pageId, applyOperationId: applyId, expectedVersion });
      return pageTransaction(db, () => {
        const receipt = db.prepare('SELECT * FROM page_ai_undos WHERE operation_id=?').get(id);
        if (receipt) {
          if (receipt.fingerprint !== hash)
            throw new PageConflictError('같은 되돌리기 ID에 다른 내용이 담겨 있어요.');
          return { ...JSON.parse(receipt.result), replayed: true };
        }
        const page = checkPage(pageId, expectedVersion);
        const apply = db
          .prepare('SELECT * FROM page_ai_applies WHERE operation_id=? AND page_id=?')
          .get(applyId, pageId);
        if (!apply) throw new AiNotFoundError('반영 이력을 찾을 수 없어요.');
        const revision = db
          .prepare('SELECT * FROM page_ai_revisions WHERE operation_id=?')
          .get(applyId);
        if (!revision)
          throw new PageValidationError(
            '새 하위 페이지는 해당 페이지의 휴지통 이동으로 되돌려 주세요.',
          );
        if (page.version !== revision.applied_version)
          throw new PageConflictError(
            'AI 반영 후 문서가 수정됐어요. 새 편집을 덮지 않도록 되돌리기를 멈췄어요.',
          );
        const item = getStore().updatePage({
          ...page,
          expectedVersion,
          title: revision.title,
          document: JSON.parse(revision.document),
        });
        const result = { item };
        db.prepare('INSERT INTO page_ai_undos VALUES (?,?,?,?,?)').run(
          id,
          applyId,
          hash,
          JSON.stringify(result),
          new Date().toISOString(),
        );
        return { ...result, replayed: false };
      });
    },
  };
}
