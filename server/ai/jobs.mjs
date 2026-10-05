import { randomUUID } from 'node:crypto';
import { storeRequestSnapshot, inferInputUrl } from '../../shared/aiRequests.ts';
import { pageTransaction } from '../pageConnections.mjs';
import { pageAiSource } from '../pageMarkdown.mjs';
import {
  AiConflictError,
  AiNotFoundError,
  AiValidationError,
  cleanRequestId,
  fingerprint,
  AI_ERRORS,
} from './contracts.mjs';

export function createAiJobStore(db, getStore) {
  let resolveExecution;
  const pinExecution = request => resolveExecution ? {...request, execution: resolveExecution(request.execution)} : request;
  const columns = db.prepare('PRAGMA table_info(ai_jobs)').all();
  if (columns.length && !columns.some((column) => column.name === 'page_id')) {
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      pageTransaction(db, () => {
        db.exec(`CREATE TABLE ai_jobs_page_migration (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
          capture_id TEXT REFERENCES captures(id), page_id TEXT REFERENCES pages(id), source_version INTEGER NOT NULL,
          source_document TEXT, source_title TEXT, target_block_ids TEXT NOT NULL DEFAULT '[]',
          request_json TEXT NOT NULL, retry_of TEXT REFERENCES ai_jobs(id),
          status TEXT NOT NULL CHECK(status IN ('queued','running','result_ready','failed')),
          run_token TEXT, runner_json TEXT, result_json TEXT, error_code TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
          CHECK((capture_id IS NULL) != (page_id IS NULL))
        );
        INSERT INTO ai_jobs_page_migration (rowid,id,request_id,fingerprint,capture_id,source_version,request_json,retry_of,status,run_token,runner_json,result_json,error_code,created_at,updated_at,started_at,finished_at)
          SELECT rowid,id,request_id,fingerprint,capture_id,source_version,request_json,retry_of,status,run_token,runner_json,result_json,error_code,created_at,updated_at,started_at,finished_at FROM ai_jobs;
        DROP TABLE ai_jobs;
        ALTER TABLE ai_jobs_page_migration RENAME TO ai_jobs;`);
        if (db.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('AI job migration foreign key check failed');
      });
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      capture_id TEXT REFERENCES captures(id), page_id TEXT REFERENCES pages(id), source_version INTEGER NOT NULL,
      source_document TEXT, source_title TEXT, target_block_ids TEXT NOT NULL DEFAULT '[]',
      request_json TEXT NOT NULL, retry_of TEXT REFERENCES ai_jobs(id),
      status TEXT NOT NULL CHECK(status IN ('queued','running','result_ready','failed')),
      run_token TEXT, runner_json TEXT, result_json TEXT, error_code TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      CHECK((capture_id IS NULL) != (page_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS ai_jobs_capture_order ON ai_jobs(capture_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_jobs_queue ON ai_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS ai_jobs_page_order ON ai_jobs(page_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS capture_submissions (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
      capture_id TEXT NOT NULL REFERENCES captures(id), created_at TEXT NOT NULL
    );
  `);
  const select = `SELECT j.*, COALESCE(c.version,p.version) AS current_version, COALESCE(c.deleted_at,p.deleted_at) AS owner_deleted_at FROM ai_jobs j LEFT JOIN captures c ON c.id=j.capture_id LEFT JOIN pages p ON p.id=j.page_id`;
  function hydrate(row, internal = false) {
    if (!row) return null;
    const job = {
      id: row.id,
      requestId: row.request_id,
      captureId: row.capture_id,
      pageId: row.page_id,
      targetBlockIds: JSON.parse(row.target_block_ids),
      ...(row.page_id
        ? { sourceDocument: JSON.parse(row.source_document), sourceTitle: row.source_title }
        : {}),
      sourceVersion: row.source_version,
      request: JSON.parse(row.request_json),
      retryOf: row.retry_of,
      status: row.status,
      runner: row.runner_json ? JSON.parse(row.runner_json) : null,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      errorCode: row.error_code,
      error: row.error_code ? AI_ERRORS[row.error_code] || AI_ERRORS.runner_failed : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      stale: row.current_version !== row.source_version,
    };
    return internal ? { ...job, runToken: row.run_token } : job;
  }
  return {
    setAiExecutionResolver(resolve) { resolveExecution = resolve; },
    captureSubmission(requestId, hash) {
      const receipt = db
        .prepare('SELECT * FROM capture_submissions WHERE request_id=?')
        .get(cleanRequestId(requestId));
      if (!receipt) return null;
      if (receipt.fingerprint !== hash)
        throw new AiConflictError('같은 요청 식별자에 다른 내용이 담겨 있어요.');
      const item = getStore().getCapture(receipt.capture_id);
      if (!item) throw new AiConflictError('저장했던 항목이 휴지통에 있어요. 먼저 복원해 주세요.');
      return { item, replayed: true };
    },
    recordCaptureSubmission(requestId, hash, captureId) {
      db.prepare('INSERT INTO capture_submissions VALUES (?,?,?,?)').run(
        requestId,
        hash,
        captureId,
        new Date().toISOString(),
      );
    },
    latestAiJob(captureId) {
      const row = db
        .prepare(
          'SELECT id,status,source_version AS sourceVersion,error_code AS errorCode,updated_at AS updatedAt FROM ai_jobs WHERE capture_id=? ORDER BY rowid DESC LIMIT 1',
        )
        .get(captureId);
      return row ? { ...row } : null;
    },
    aiJobSummaries(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 20)
        throw new AiValidationError('상태는 한 번에 20개까지 확인할 수 있어요.');
      const cleanIds = ids.map(cleanRequestId);
      return db
        .prepare(
          `SELECT j.id, j.capture_id AS captureId, j.page_id AS pageId, j.status, j.source_version AS sourceVersion, j.error_code AS errorCode, j.updated_at AS updatedAt FROM ai_jobs j LEFT JOIN captures c ON c.id=j.capture_id LEFT JOIN pages p ON p.id=j.page_id WHERE COALESCE(c.deleted_at,p.deleted_at) IS NULL AND j.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(cleanIds));
    },
    listAiActivity({ status = 'all', compact = false } = {}) {
      if (!['all', 'active', 'result_ready', 'failed'].includes(status))
        throw new AiValidationError('요청 상태가 올바르지 않아요.');
      const owners = `FROM ai_jobs j LEFT JOIN captures c ON c.id=j.capture_id LEFT JOIN pages p ON p.id=j.page_id
        WHERE COALESCE(c.deleted_at,p.deleted_at) IS NULL`;
      const state =
        status === 'active'
          ? " AND j.status IN ('queued','running')"
          : status === 'all'
            ? ''
            : ' AND j.status=?';
      db.exec('SAVEPOINT ai_activity');
      try {
        const counts = { queued: 0, running: 0, result_ready: 0, failed: 0 };
        for (const row of db
          .prepare(`SELECT j.status, COUNT(*) AS count ${owners} GROUP BY j.status`)
          .all())
          counts[row.status] = row.count;
        const args = status === 'result_ready' || status === 'failed' ? [status] : [];
        const items = db
          .prepare(
            `SELECT j.id, j.capture_id AS captureId, j.page_id AS pageId,
          j.status, j.error_code AS errorCode, j.created_at AS createdAt, j.started_at AS startedAt,
          j.finished_at AS finishedAt, j.updated_at AS updatedAt,
          substr(COALESCE(j.source_title,p.title,''),1,180) AS sourceTitle,
          substr(COALESCE(NULLIF(json_extract(j.request_json,'$.input.content'),''),json_extract(j.request_json,'$.input.url'),''),1,180) AS preview,
          substr(COALESCE(json_extract(j.request_json,'$.template.name'),'직접 요청'),1,100) AS templateName,
          substr(COALESCE(json_extract(j.runner_json,'$.label'),CASE json_extract(j.request_json,'$.execution.profileId') WHEN 'hive' THEN 'Hive' WHEN 'devin' THEN 'Devin CLI' ELSE '' END),1,140) AS executionLabel,
          substr(COALESCE(json_extract(j.request_json,'$.execution.model'),''),1,120) AS model,
          json_extract(j.request_json,'$.template.version') AS templateVersion,
          c.organized_at IS NOT NULL AS organized
          ${owners}${state} ORDER BY ${compact ? "CASE WHEN j.status IN ('queued','running') THEN 0 ELSE 1 END," : ''} j.rowid DESC LIMIT ${compact ? 3 : 50}`,
          )
          .all(...args)
          .map((row) => ({
            ...row,
            organized: !!row.organized,
            ownerKind: row.pageId ? 'page' : 'memo',
            href: `${row.pageId ? '/pages/' + row.pageId : '/captures/' + row.captureId}?aiJob=${row.id}`,
          }));
        db.exec('RELEASE ai_activity');
        const total =
          status === 'active'
            ? counts.queued + counts.running
            : status === 'all'
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : counts[status];
        return { items, counts, total };
      } catch (error) {
        db.exec('ROLLBACK TO ai_activity');
        db.exec('RELEASE ai_activity');
        throw error;
      }
    },
    enqueueAiJob({ captureId, requestId, expectedVersion, retryOf = null, selection }) {
      const cleanId = cleanRequestId(requestId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new AiValidationError('원본 버전이 올바르지 않아요.');
      const hash = fingerprint({ captureId, expectedVersion, retryOf, ...(selection===undefined?{}:{selection}) });
      return pageTransaction(db, () => {
        const previous = db.prepare(`${select} WHERE request_id=?`).get(cleanId);
        if (previous) {
          if (previous.fingerprint !== hash)
            throw new AiConflictError('같은 요청 식별자에 다른 AI 요청이 담겨 있어요.');
          if (previous.owner_deleted_at) throw new AiNotFoundError('원본 메모를 찾을 수 없어요.');
          return hydrate(previous);
        }
        const capture = getStore().getCapture(captureId);
        if (!capture) throw new AiNotFoundError('원본 메모를 찾을 수 없어요.');
        if (capture.version !== expectedVersion)
          throw new AiConflictError('원본이 수정됐어요. 최신 내용을 확인한 뒤 요청해 주세요.');
        if (!capture.aiRequest && selection===undefined) throw new AiValidationError('보관한 AI 요청문이 없는 메모예요.');
        if (
          retryOf !== null &&
          (typeof retryOf !== 'string' ||
            !db
              .prepare('SELECT id FROM ai_jobs WHERE id=? AND capture_id=?')
              .get(retryOf, captureId))
        )
          throw new AiValidationError('이전 요청을 찾을 수 없어요.');
        if (
          db
            .prepare("SELECT id FROM ai_jobs WHERE capture_id=? AND status IN ('queued','running')")
            .get(captureId)
        )
          throw new AiConflictError('이미 진행 중인 AI 요청이 있어요.');
        let request,
          sourceVersion = capture.version;
        if (retryOf) {
          const old = db
            .prepare('SELECT request_json,source_version FROM ai_jobs WHERE id=?')
            .get(retryOf);
          request = JSON.parse(old.request_json);
          sourceVersion = old.source_version;
        } else if(selection!==undefined) {
          try {request=storeRequestSnapshot(selection,{content:capture.text,url:capture.url||inferInputUrl(capture.text)});}catch(error){throw new AiValidationError(error.message);}

        } else {
          const oldTemplate = capture.aiRequest.template;
          const template = oldTemplate
            ? {
                ...oldTemplate,
                description: '',
                archived: false,
                revisionId: oldTemplate.revisionId ?? undefined,
              }
            : null;
          request = storeRequestSnapshot(
            { template, additional: capture.aiRequest.additional, execution: capture.aiRequest.execution },
            { content: capture.text, url: capture.url || inferInputUrl(capture.text) },
          );
        }
        if (!retryOf) {
          request = pinExecution(request);
          if (selection !== undefined) db.prepare('UPDATE captures SET ai_request=? WHERE id=?').run(JSON.stringify(request), captureId);
        }
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO ai_jobs (id,request_id,fingerprint,capture_id,source_version,request_json,retry_of,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'queued',?,?)",
        ).run(
          id,
          cleanId,
          hash,
          captureId,
          sourceVersion,
          JSON.stringify(request),
          retryOf,
          now,
          now,
        );
        return hydrate(db.prepare(`${select} WHERE j.id=?`).get(id));
      });
    },
    getAiJob(id, { includeDeleted = false } = {}) {
      return hydrate(
        db
          .prepare(
            `${select} WHERE j.id=?${includeDeleted ? '' : ' AND COALESCE(c.deleted_at,p.deleted_at) IS NULL'}`,
          )
          .get(id),
      );
    },
    submissionAiJob(captureId, requestId) {
      return hydrate(
        db
          .prepare(`${select} WHERE j.capture_id=? AND request_id=? AND c.deleted_at IS NULL`)
          .get(captureId, cleanRequestId(requestId)),
      );
    },
    listAiJobs(captureId) {
      if (!getStore().getCapture(captureId)) return null;
      return db
        .prepare(`${select} WHERE j.capture_id=? ORDER BY j.rowid DESC LIMIT 50`)
        .all(captureId)
        .map((row) => hydrate(row));
    },
    listPageAiJobs(pageId) {
      if (!getStore().getPage(pageId)) return null;
      return db
        .prepare(`${select} WHERE j.page_id=? ORDER BY j.rowid DESC LIMIT 50`)
        .all(pageId)
        .map((row) => hydrate(row));
    },
    enqueuePageAiJob({
      pageId,
      requestId,
      expectedVersion,
      aiRequest,
      blockIds = [],
      retryOf = null,
    }) {
      const cleanId = cleanRequestId(requestId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw new AiValidationError('원본 버전이 올바르지 않아요.');
      const hash = fingerprint({ pageId, expectedVersion, aiRequest, blockIds, retryOf });
      return pageTransaction(db, () => {
        const previous = db.prepare(`${select} WHERE request_id=?`).get(cleanId);
        if (previous) {
          if (previous.fingerprint !== hash)
            throw new AiConflictError('같은 요청 식별자에 다른 AI 요청이 담겨 있어요.');
          if (previous.owner_deleted_at) throw new AiNotFoundError('페이지를 찾을 수 없어요.');
          return hydrate(previous);
        }
        const page = getStore().getPage(pageId);
        if (!page) throw new AiNotFoundError('페이지를 찾을 수 없어요.');
        if (page.version !== expectedVersion)
          throw new AiConflictError('페이지가 수정됐어요. 최신 내용을 확인한 뒤 요청해 주세요.');
        if (
          db
            .prepare("SELECT id FROM ai_jobs WHERE page_id=? AND status IN ('queued','running')")
            .get(pageId)
        )
          throw new AiConflictError('이미 진행 중인 AI 요청이 있어요.');
        let request,
          sourceVersion = page.version,
          sourceDocument = page.document,
          sourceTitle = page.title,
          targetBlockIds;
        if (retryOf !== null) {
          const old = db
            .prepare('SELECT * FROM ai_jobs WHERE id=? AND page_id=?')
            .get(cleanRequestId(retryOf), pageId);
          if (!old) throw new AiValidationError('이 페이지의 이전 요청을 찾을 수 없어요.');
          request = JSON.parse(old.request_json);
          sourceVersion = old.source_version;
          sourceDocument = JSON.parse(old.source_document);
          sourceTitle = old.source_title;
          targetBlockIds = JSON.parse(old.target_block_ids);
        } else {
          const source = pageAiSource(page, blockIds);
          targetBlockIds = source.targetBlockIds;
          try {
            request = storeRequestSnapshot(aiRequest, {
              content: source.content,
              url: inferInputUrl(source.content),
            });
          } catch (error) {
            throw new AiValidationError(error.message);
          }
        }
        if (!retryOf) request = pinExecution(request);
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO ai_jobs (id,request_id,fingerprint,page_id,source_version,source_document,source_title,target_block_ids,request_json,retry_of,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued',?,?)",
        ).run(
          id,
          cleanId,
          hash,
          pageId,
          sourceVersion,
          JSON.stringify(sourceDocument),
          sourceTitle,
          JSON.stringify(targetBlockIds),
          JSON.stringify(request),
          retryOf,
          now,
          now,
        );
        return hydrate(db.prepare(`${select} WHERE j.id=?`).get(id));
      });
    },
    claimAiJob(runner = null) {
      return pageTransaction(db, () => {
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE ai_jobs SET status='failed',error_code='source_deleted',updated_at=?,finished_at=? WHERE status='queued' AND (capture_id IN (SELECT id FROM captures WHERE deleted_at IS NOT NULL) OR page_id IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL))",
        ).run(now, now);
        if (db.prepare("SELECT id FROM ai_jobs WHERE status='running' LIMIT 1").get()) return null;
        const row = db
          .prepare("SELECT id,request_json FROM ai_jobs WHERE status='queued' ORDER BY rowid LIMIT 1")
          .get();
        if (!row) return null;
        db.prepare(
          "UPDATE ai_jobs SET status='running',run_token=?,runner_json=?,started_at=?,updated_at=? WHERE id=? AND status='queued'",
        ).run(randomUUID(), runner ? JSON.stringify(typeof runner === 'function' ? runner(JSON.parse(row.request_json)) : runner) : null, now, now, row.id);
        return hydrate(db.prepare(`${select} WHERE j.id=?`).get(row.id), true);
      });
    },
    completeAiJob(id, token, result) {
      const now = new Date().toISOString();
      return Boolean(
        db
          .prepare(
            "UPDATE ai_jobs SET status='result_ready',result_json=?,run_token=NULL,updated_at=?,finished_at=? WHERE id=? AND status='running' AND run_token=?",
          )
          .run(JSON.stringify(result), now, now, id, token).changes,
      );
    },
    failAiJob(id, token, code) {
      const now = new Date().toISOString();
      return Boolean(
        db
          .prepare(
            "UPDATE ai_jobs SET status='failed',error_code=?,run_token=NULL,updated_at=?,finished_at=? WHERE id=? AND status='running' AND run_token=?",
          )
          .run(Object.hasOwn(AI_ERRORS, code) ? code : 'runner_failed', now, now, id, token)
          .changes,
      );
    },
    interruptAiJobs() {
      const now = new Date().toISOString();
      return Number(
        db
          .prepare(
            "UPDATE ai_jobs SET status='failed',error_code='interrupted',run_token=NULL,updated_at=?,finished_at=? WHERE status='running'",
          )
          .run(now, now).changes,
      );
    },
  };
}
