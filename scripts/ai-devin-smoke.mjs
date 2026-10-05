// Opt-in: one real installed/authenticated Devin request, entirely temporary data.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(join(tmpdir(), 'leneu-devin-smoke-'));
const model = process.env.DEVIN_SMOKE_MODEL || 'swe-2-high';
const keywordResearch = process.env.DEVIN_SMOKE_RESEARCH === '1';
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: root,
    PORT: String(port),
    HOST: '127.0.0.1',
    AI_RUNNER_KIND: 'devin',
    AI_DEVIN_BIN: process.env.DEVIN_BIN || 'devin',
    AI_DEVIN_MODEL: model,
    AI_RUNNER_URL: '',
    AI_RUNNER_TOKEN: '',
  },
  stdio: 'ignore',
});
try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const status = await (await fetch(base + '/api/ai/status')).json();
  assert.equal(status.enabled, true, 'Install/login to Devin CLI before opting in.');
  const text = keywordResearch
    ? 'SQLite FTS5 공식 문서: 전문 검색의 기본 사용법과 제약을 조사해 주세요.'
    : 'leneu 설계 메모: 빠른 입력을 유지하고, AI는 저장 후 처리한다. 결과는 원문과 분리해 보관한다.';
  const template = keywordResearch
    ? (await (await fetch(base + '/api/prompt-templates')).json()).items.find(
        (item) => item.id === 'research-keyword',
      )
    : null;
  if (keywordResearch) {
    assert.ok(template);
    assert.ok(status.researchModes.includes('keyword'));
  }
  const body = new FormData();
  body.set('kind', 'note');
  body.set('requestId', randomUUID());
  body.set('text', text);
  body.set(
    'aiRequest',
    JSON.stringify({
      template,
      additional: keywordResearch
        ? '제공된 본문에서 기본 사용법과 제약을 구체적으로 정리하세요. 핵심 요약 3줄, 근거와 출처, 더 확인할 점을 적어 주세요.'
        : '이 메모의 계획만 한국어 세 줄로 요약하세요. 실제 줄바꿈을 넣고 JSON에서 한 번만 이스케이프하세요.',
    }),
  );
  const response = await fetch(base + '/api/captures', { method: 'POST', body });
  assert.equal(response.status, 201);
  const { item, aiJob } = await response.json();
  assert.equal(aiJob.status, 'queued');
  let job;
  for (let i = 0; i < 130; i++) {
    job = (await (await fetch(base + '/api/ai-jobs/' + aiJob.id)).json()).item;
    if (['result_ready', 'failed'].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const jobs = (await (await fetch(base + '/api/captures/' + item.id + '/ai-jobs')).json()).items;
  const report = {
    model,
    requests: jobs.length,
    runnerKind: 'devin',
    status: job.status,
    errorCode: job.errorCode,
    markdown: job.result?.markdown ?? null,
    runner: job.runner,
    usage: job.result?.usage ?? null,
    sourcePreserved:
      (await (await fetch(base + '/api/captures/' + item.id)).json()).item.text === text,
    realDataUsed: false,
    ...(keywordResearch ? { researchMode: 'keyword', sources: job.result?.sources ?? [] } : {}),
  };
  await mkdir('.omo/evidence', { recursive: true });
  await writeFile(
    keywordResearch
      ? '.omo/evidence/keyword-devin-smoke.json'
      : '.omo/evidence/ai-devin-smoke.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  assert.equal(job.status, 'result_ready');
  assert.equal(jobs.length, 1);
  assert.ok(report.sourcePreserved);
  if (keywordResearch) {
    assert.ok(report.sources.length > 0 && report.sources.length <= 3);
    assert.ok(report.sources.every((source) => source.verified));
    assert.match(report.markdown, /MATCH|CREATE VIRTUAL TABLE/);
  }
} finally {
  const exited = once(server, 'exit');
  server.kill();
  await exited;
  await rm(root, { recursive: true, force: true });
}
