import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pageTransaction } from './pageConnections.mjs';
import {
  cleanRequestId,
  AiValidationError,
  AiConflictError,
  AiNotFoundError,
} from './ai/contracts.mjs';
export function createOcrStore(db, owner) {
  db.exec(`CREATE TABLE IF NOT EXISTS ocr_jobs(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('queued','running','result_ready','failed')),text TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ocr_queue ON ocr_jobs(status,created_at);`);
  const read = (id) =>
    db
      .prepare(
        'SELECT id,asset_id AS assetId,status,text,error,created_at AS createdAt,updated_at AS updatedAt FROM ocr_jobs WHERE id=?',
      )
      .get(id);
  function asset(id) {
    const a = owner().getAsset(id);
    if (!a) throw new AiNotFoundError('첨부 이미지를 찾을 수 없어요.');
    return a;
  }
  return {
    requestOcr({ assetId, requestId }) {
      requestId = cleanRequestId(requestId);
      const a = asset(assetId);
      if (!/^image\/(png|jpeg|webp)$/.test(a.mime) || a.size > 5 * 1024 * 1024)
        throw new AiValidationError('OCR은 5MB 이하 PNG·JPEG·WebP 이미지를 지원해요.');
      return pageTransaction(db, () => {
        const prior = db
          .prepare('SELECT id,asset_id FROM ocr_jobs WHERE request_id=?')
          .get(requestId);
        if (prior) {
          if (prior.asset_id !== assetId)
            throw new AiConflictError('같은 요청으로 다른 첨부를 처리할 수 없어요.');
          return read(prior.id);
        }
        if (
          db
            .prepare("SELECT count(*) AS n FROM ocr_jobs WHERE status IN ('queued','running')")
            .get().n >= 100
        )
          throw new AiValidationError('대기 중인 OCR이 많아요. 처리 후 다시 요청해 주세요.');
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare("INSERT INTO ocr_jobs VALUES(?,?,?,'queued',NULL,NULL,?,?)").run(
          id,
          requestId,
          assetId,
          now,
          now,
        );
        return read(id);
      });
    },
    getOcr(id) {
      const j = read(id);
      if (j) asset(j.assetId);
      return j;
    },
    listAssetOcr(id) {
      asset(id);
      return db
        .prepare(
          'SELECT id,asset_id AS assetId,status,text,error,created_at AS createdAt,updated_at AS updatedAt FROM ocr_jobs WHERE asset_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20',
        )
        .all(id);
    },
    claimOcr() {
      return pageTransaction(db, () => {
        if (db.prepare("SELECT 1 FROM ocr_jobs WHERE status='running'").get()) return null;
        const row = db
          .prepare(
            "SELECT id FROM ocr_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1",
          )
          .get();
        if (!row) return null;
        db.prepare("UPDATE ocr_jobs SET status='running',updated_at=? WHERE id=?").run(
          new Date().toISOString(),
          row.id,
        );
        return read(row.id);
      });
    },
    finishOcr(id, text, error = null) {
      if (!error && (typeof text !== 'string' || !text.trim() || text.length > 64000))
        throw new AiValidationError('OCR 결과를 확인해 주세요.');
      return !!db
        .prepare(
          "UPDATE ocr_jobs SET status=?,text=?,error=?,updated_at=? WHERE id=? AND status='running'",
        )
        .run(
          error ? 'failed' : 'result_ready',
          error ? null : text,
          error,
          new Date().toISOString(),
          id,
        ).changes;
    },
    interruptOcr() {
      db.prepare(
        "UPDATE ocr_jobs SET status='failed',error='처리가 중단됐어요. 다시 요청해 주세요.',updated_at=? WHERE status='running'",
      ).run(new Date().toISOString());
    },
  };
}
export function createOcrWorker({ store, dataDir, env = process.env, timeoutMs = 60000 }) {
  let endpoint = null;
  try {
    const u = new URL(env.OCR_RUNNER_URL || '');
    if (
      u.username ||
      u.password ||
      !(
        u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
      )
    )
      throw Error();
    endpoint = u.href;
  } catch {}
  let work = null,
    controller = null,
    stopped = false;
  async function run() {
    let job;
    while (!stopped && (job = store.claimOcr())) {
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), timeoutMs);
      try {
        const a = store.getAsset(job.assetId);
        if (!a) throw Error();
        const base = await realpath(join(dataDir, 'blobs')),
          path = await realpath(resolve(base, a.key));
        if (!path.startsWith(base + '/') || (await stat(path)).size > 5 * 1024 * 1024)
          throw Error();
        const bytes = await readFile(path);
        const r = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(env.OCR_RUNNER_TOKEN ? { Authorization: `Bearer ${env.OCR_RUNNER_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            schemaVersion: 1,
            jobId: job.id,
            kind: 'ocr',
            image: { mime: a.mime, base64: bytes.toString('base64') },
            policy: {
              tools: false,
              treatImageAsData: true,
              maxOutputCharacters: 64000,
              output: 'text',
            },
          }),
        });
        if (!r.ok || !/^application\/json\b/i.test(r.headers.get('content-type') || '')) {
          await r.body?.cancel();
          throw Error();
        }
        const chunks = [];
        let size = 0;
        for await (const c of r.body) {
          size += c.length;
          if (size > 256 * 1024) throw Error();
          chunks.push(c);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString());
        store.finishOcr(job.id, result.text);
      } catch {
        store.finishOcr(
          job.id,
          null,
          controller.signal.aborted
            ? '시간이 초과되거나 처리가 중단됐어요. 다시 요청해 주세요.'
            : '이미지를 인식하지 못했어요. 실행기 연결과 파일을 확인하고 다시 요청해 주세요.',
        );
      } finally {
        clearTimeout(timer);
        controller = null;
      }
    }
  }
  return {
    enabled: !!endpoint,
    start() {
      store.interruptOcr();
      this.wake();
    },
    wake() {
      if (endpoint && !stopped && !work)
        work = run().finally(() => {
          work = null;
        });
    },
    async stop() {
      stopped = true;
      controller?.abort();
      await work;
    },
  };
}
