// Explicit opt-in: a synthetic keyword job, temporary SQLite, real CLI/search.
// No app keys, notification settings or production data enter this probe.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createOpenCodeRunner } from '../server/ai/opencode.mjs';
import { createAiWorker } from '../server/ai/worker.mjs';

if (process.env.OPENCODE_SMOKE_RESEARCH !== '1')
  throw Error('Opt in with OPENCODE_SMOKE_RESEARCH=1; this calls a real external provider.');
const model = 'opencode/muse-spark-1.3-contributor-free';
const root = await mkdtemp(join(tmpdir(), 'anotar-opencode-smoke-'));
const before = new Set(await readdir(tmpdir()));
const store = openStore(root);
const runner = createOpenCodeRunner({
  AI_OPENCODE_ENABLED: 'true',
  AI_OPENCODE_BIN: process.env.AI_OPENCODE_BIN || 'opencode',
  AI_OPENCODE_MODEL: model,
  AI_OPENCODE_AUTH_FILE: join(root, 'no-auth.json'),
  PATH: process.env.PATH,
});
const worker = createAiWorker({ store, runner });
try {
  assert.equal(runner.enabled, true, 'Install OpenCode 1.18.34 before opting in.');
  const text = 'SQLite FTS5 공식 문서에서 전문 검색의 기본 사용법과 제약을 조사해 주세요.';
  const item = store.createCapture({
    kind: 'note',
    text,
    aiRequest: {
      template: store.getPromptTemplate('research-keyword'),
      additional: '수집된 본문만 근거로 한국어 핵심 요약 3줄과 기본 사용법을 간략히 적어 주세요.',
    },
  });
  worker.start();
  let job;
  for (let i = 0; i < 130; i++) {
    job = store.getAiJob(item.latestAiJob.id);
    if (['result_ready', 'failed'].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await worker.stop();
  const leakedWorkspaces = (await readdir(tmpdir())).filter(
    (name) => name.startsWith('anotar-opencode-') && !before.has(name),
  );
  const report = {
    model,
    status: job.status,
    errorCode: job.errorCode,
    sources: job.result?.sources ?? [],
    usage: job.result?.usage ?? null,
    markdown: job.result?.markdown ?? null,
    sourcePreserved: store.getCapture(item.id).text === text,
    ownedWorkspacesRemaining: leakedWorkspaces.length,
    productionDataUsed: false,
    automaticFallback: false,
  };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(job.status, 'result_ready');
  assert.ok(report.sources.length > 0 && report.sources.length <= 3);
  assert.ok(report.sources.every((source) => source.verified));
  assert.match(report.markdown, /FTS5|MATCH/);
  assert.ok(report.sourcePreserved);
  assert.equal(leakedWorkspaces.length, 0);
} finally {
  await worker.stop();
  store.close();
  await rm(root, { recursive: true, force: true });
}
