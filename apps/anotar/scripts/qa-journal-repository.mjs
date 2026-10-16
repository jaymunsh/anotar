import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({
  stdin: {
    contents:
      "import * as repo from './src/sync/repository.ts';import {workspaceRepository,operationForEntity} from './src/sync/workspaceRepository.ts';import * as model from './shared/journal.mjs';import {migrateJournal,listJournalMigrationCollisions} from './src/journal/migration.ts';import {exportPendingWorkspace} from './src/offline/exportPending.ts';window.fixture={...repo,...model,workspaceRepository,operationForEntity,migrateJournal,listJournalMigrationCollisions,exportPendingWorkspace};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html');
  res.end(
    req.url === '/test.js'
      ? bundle.outputFiles[0].text
      : '<!doctype html><body><script src="/test.js"></script></body>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const f = fixture,
      workspaceId = crypto.randomUUID(),
      deviceId = crypto.randomUUID(),
      epoch = crypto.randomUUID(),
      date = '2026-10-05',
      id = f.journalId(workspaceId, date);
    const day = f.normalizeJournalDay(
      {
        priorities: [{ text: '지킬 원문', done: false }],
        brain: '',
        idea: '',
        feedback: 'old',
        plan: [{ id: 'plan', title: '지킬 원문', start: 1320, end: 1350, kind: 'focus', note: '' }],
        actual: [],
      },
      date,
    );
    await f.writeRecord('meta', workspaceId, ['sync'], { workspaceId, epoch, cursor: 0 });
    const operation = {
      protocolVersion: 1,
      workspaceId,
      epoch,
      deviceId,
      operationId: crypto.randomUUID(),
      entityId: id,
      kind: 'journal.create',
      baseVersion: null,
      payload: { date, day },
    };
    await f.saveLocalEntity({
      workspaceId,
      kind: 'journal',
      id,
      value: { id, date, day, version: 1 },
      pending: { operation, dependencies: [], state: 'sending', attempt: 0, nextAttemptAt: 0 },
    });
    const pending = (await f.listRecords('outbox', workspaceId))[0];
    const adapter = f.workspaceRepository(workspaceId, deviceId),
      lease = await adapter.acquireLease('test', Date.now());
    await f.saveLocalEntity({
      workspaceId,
      kind: 'journal',
      id,
      value: { id, date, version: 1, day: { ...day, feedback: 'new while ACK pending' } },
    });
    await adapter.acknowledge(
      pending,
      {
        status: 'applied',
        operationId: operation.operationId,
        replayed: false,
        item: { id, date, day, version: 1 },
        version: 1,
      },
      lease,
    );
    const after = await f.readLocalEntity({ workspaceId, kind: 'journal', id }),
      queue = await f.listRecords('outbox', workspaceId);
    const legacy = JSON.stringify({
      theme: 'light',
      days: { '2026-10-04': { ...day, feedback: 'legacy source' } },
    });
    localStorage.setItem('anotar:journal:v1', legacy);
    const first = await f.migrateJournal(workspaceId, deviceId),
      second = await f.migrateJournal(workspaceId, deviceId);
    const exported = await f.exportPendingWorkspace(workspaceId);
    const collision = JSON.stringify({
      theme: 'dark',
      days: { '2026-10-04': { ...day, feedback: 'second original' } },
    });
    const collided = await f.migrateJournal(workspaceId, deviceId, collision);
    const localCopies = await f.listJournalMigrationCollisions(workspaceId);
    const otherWorkspace = crypto.randomUUID();
    const foreign = await f.migrateJournal(otherWorkspace, deviceId, legacy);
    const foreignChanged = await f.migrateJournal(otherWorkspace, deviceId, collision);
    const foreignQueue = await f.listRecords('outbox', otherWorkspace);
    const kept = await f.readLocalEntity({
      workspaceId,
      kind: 'journal',
      id: f.journalId(workspaceId, '2026-10-04'),
    });
    const copies = await f.listRecords('conflicts', workspaceId),
      meta = await f.listRecords('meta', workspaceId, 100);
    return {
      after,
      queue,
      first,
      second,
      original: localStorage.getItem('anotar:journal:v1'),
      legacy,
      manifest: exported.manifest,
      collided,
      copies,
      localCopies,
      foreign,
      foreignChanged,
      foreignQueue,
      kept,
      archived: meta.filter((m) => m.raw),
    };
  });
  assert.equal(result.after.current.day.feedback, 'new while ACK pending');
  assert.equal(result.after.dirty, true);
  assert.equal(result.queue.length, 1);
  assert.equal(result.queue[0].operation.kind, 'journal.update');
  assert.equal(result.queue[0].operation.baseVersion, 1);
  assert.equal(result.queue[0].operation.payload.day.feedback, 'new while ACK pending');
  assert.deepEqual(result.first, { imported: 1, conflicts: 0 });
  assert.deepEqual(result.second, { imported: 0, conflicts: 0 });
  assert.equal(result.original, result.legacy);
  assert.ok(
    result.manifest.entities.some(
      (e) => e.kind === 'journal' && e.current.day.feedback === 'new while ACK pending',
    ),
  );
  assert.ok(result.manifest.meta.some((m) => m.raw === result.legacy));
  assert.deepEqual(result.collided, { imported: 0, conflicts: 0, localConflicts: 1 });
  assert.deepEqual(result.copies, []);
  assert.equal(result.localCopies[0].legacyDay.feedback, 'second original');
  assert.equal(result.localCopies[0].existing.day.feedback, 'legacy source');
  assert.equal(result.kept.current.day.feedback, 'legacy source');
  assert.deepEqual(result.foreign, { imported: 0, conflicts: 0, foreign: true });
  assert.deepEqual(result.foreignChanged, { imported: 0, conflicts: 0, foreign: true });
  assert.deepEqual(result.foreignQueue, []);
  assert.ok(result.archived.some((m) => m.previous?.length === 1));
  await mkdir('.omo/evidence/journal-sync', { recursive: true });
  await writeFile(
    '.omo/evidence/journal-sync/repository.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks: [
          'late journal ACK retains newer local revision and emits correctly versioned journal.update',
          'migration repeated twice keeps exact original and stable identity',
          'whole JSON and migration raw are included in pending export',
          'dirty migration collision retains existing pending/entity and archives both local copies',
          'device source owner blocks both same and changed fingerprints from foreign workspace',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS journal repository: late ACK, follow-up version, idempotent migration, collision copies and recovery JSON',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
