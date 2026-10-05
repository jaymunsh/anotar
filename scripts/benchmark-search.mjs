import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import {
  encodeSearchText,
  encodeSearchCharacters,
  registerSearchFunctions,
} from '../server/searchText.mjs';
import { storeRequestSnapshot } from '../shared/aiRequests.ts';

const sizes = (process.env.BENCH_SEARCH_SIZES || '10000,100000').split(',').map(Number);
assert.ok(sizes.every((size) => Number.isSafeInteger(size) && size > 0 && size <= 100000));
const directory = await mkdtemp(join(tmpdir(), 'leneu-search-benchmark-'));
let store = openStore(directory);
const db = new DatabaseSync(join(directory, 'storage.sqlite'));
registerSearchFunctions(db);
db.exec('PRAGMA foreign_keys=ON');
const insertCapture = db.prepare(
  'INSERT INTO captures(id,kind,text,url,created_at,updated_at,version,ai_request) VALUES(?,?,?,NULL,?,?,1,?)',
);
const insertPage = db.prepare(
  'INSERT INTO pages(id,title,icon,parent_id,position,document,version,created_at,updated_at) VALUES(?,?,?,NULL,?,?,1,?,?)',
);
const insertAsset = db.prepare(
  'INSERT INTO assets(id,capture_id,storage_key,name,mime,size) VALUES(?,?,?,?,?,0)',
);
const report = {
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
  dataset:
    '90% Capture / 10% Page, prepared requests in 5% of captures; attachment metadata every 50 captures. Capture text ~400 chars; page text ~1200 chars. Generated temporary records only.',
  stages: [],
};
function measure(action, repeats = 12) {
  const values = [];
  action();
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    action();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return {
    p50Ms: +values[Math.floor(values.length * 0.5)].toFixed(3),
    p95Ms: +values[Math.floor(values.length * 0.95)].toFixed(3),
  };
}
let count = 0;
let firstCapture = null;
try {
  for (const size of sizes) {
    assert.ok(size > count);
    const started = performance.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let i = count; i < size; i++) {
        const id = randomUUID();
        const date = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
        const location = i % 4 === 0 ? '교토' : '제주';
        const base = `${location} 여행 3일 기록 ${i}. 골목을 걷고 카페에서 쉬는 시간을 남긴다. 예약 확인과 교통 수단을 살펴보고 다음에 읽을 SQLite 문서 링크를 정리한다. `;
        const text =
          base.repeat(i % 10 === 9 ? 12 : 4) + (i === size - 1 ? ' 희귀표식' + size : '');
        if (i % 10 === 9) {
          insertPage.run(
            id,
            location + ' 여행 기록 ' + i,
            '🧭',
            i,
            JSON.stringify({
              schemaVersion: 1,
              blocks: [
                {
                  id: randomUUID(),
                  type: 'paragraph',
                  props: {},
                  content: [{ type: 'text', text, styles: {} }],
                  children: [],
                },
              ],
            }),
            date,
            date,
          );
        } else {
          const aiRequest =
            i % 20 === 1
              ? JSON.stringify(
                  storeRequestSnapshot(
                    { template: null, additional: '근거를 정리해 주세요' },
                    { content: text, url: '' },
                  ),
                )
              : null;
          insertCapture.run(id, 'note', text, date, date, aiRequest);
          firstCapture ??= id;
          if (i % 50 === 0)
            insertAsset.run(
              randomUUID(),
              id,
              id + '.md',
              location + ' 예약 확인서 ' + i + '.md',
              'text/markdown',
            );
        }
        if ((i + 1) % 10000 === 0) console.log('Indexed ' + (i + 1) + ' generated source records.');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const incrementalIndexMs = performance.now() - started;
    count = size;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const stage = {
      sourceRecords: size,
      indexedRecords: db.prepare('SELECT COUNT(*) AS n FROM search_documents').get().n,
      incrementalIndexMs: +incrementalIndexMs.toFixed(1),
      queries: [],
    };
    for (const query of ['여행', '교토', '교토 3', '희귀표식' + size, '없는검색표식']) {
      const terms = query.split(' ');
      const clause = terms
        .map(() => '(instr(lower(title),?)>0 OR instr(lower(body),?)>0 OR instr(lower(url),?)>0)')
        .join(' AND ');
      const parameters = terms.flatMap((term) => [term, term, term]);
      const scan = db.prepare('SELECT COUNT(*) AS n FROM search_documents WHERE ' + clause);
      const long = terms.filter((term) => Array.from(term).length >= 2);
      const short = terms.filter((term) => Array.from(term).length < 2);
      const indexed = db.prepare('SELECT COUNT(*) AS n FROM search_fts WHERE search_fts MATCH ?');
      const match = [
        ...long.map((term) => '"' + encodeSearchText(term) + '"'),
        ...short.map((term) => 'characters:"' + encodeSearchCharacters(term) + '"'),
      ].join(' AND ');
      const expected = scan.get(...parameters).n;
      assert.equal(indexed.get(match).n, expected, query);
      const result = store.searchRecords({ query });
      assert.ok(result.items.length <= 20);
      for (const item of result.items)
        assert.ok(
          db
            .prepare('SELECT 1 FROM search_documents WHERE target_id=? AND ' + clause)
            .get(item.id, ...parameters),
        );
      stage.queries.push({
        query,
        matches: expected,
        result20: measure(() => store.searchRecords({ query })),
        indexedCount: measure(() => indexed.get(match), 4),
        scanCount: measure(() => scan.get(...parameters), 4),
      });
    }
    stage.save = measure(() => {
      const item = store.getCapture(firstCapture);
      store.updateCapture({
        id: item.id,
        text: '교토 여행 저장 ' + randomUUID(),
        expectedVersion: item.version,
      });
    });
    const revision = db.prepare('SELECT revision FROM search_state').get().revision;
    store.close();
    const reopen = performance.now();
    store = openStore(directory);
    stage.reopenMs = +(performance.now() - reopen).toFixed(3);
    assert.equal(db.prepare('SELECT revision FROM search_state').get().revision, revision);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    stage.databaseMiB = +(
      (await stat(join(directory, 'storage.sqlite'))).size /
      1024 /
      1024
    ).toFixed(2);
    try {
      stage.ftsMiB = +(
        db.prepare("SELECT SUM(pgsize) AS bytes FROM dbstat WHERE name LIKE 'search_fts%'").get()
          .bytes /
        1024 /
        1024
      ).toFixed(2);
    } catch {
      stage.ftsMiB = null;
    }
    stage.rssMiB = +(process.memoryUsage().rss / 1024 / 1024).toFixed(2);
    stage.peakRssMiB = +(process.resourceUsage().maxRSS / 1024).toFixed(2);
    const cold = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { openStore } from './server/store.mjs';
      import { performance } from 'node:perf_hooks';
      const store = openStore(process.argv[1]);
      const idle = process.memoryUsage().rss/1024/1024;
      const times = [];
      for(let i=0;i<6;i++){ const start=performance.now(); store.searchRecords({query:'여행'}); times.push(performance.now()-start); }
      console.log(JSON.stringify({idleRssMiB:+idle.toFixed(2),afterSearchRssMiB:+(process.memoryUsage().rss/1024/1024).toFixed(2),firstCommonQueryMs:+times[0].toFixed(3)}));
      store.close();
    `,
        directory,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(cold.status, 0, cold.stderr);
    stage.freshReader = JSON.parse(cold.stdout);
    report.stages.push(stage);
    console.log(JSON.stringify(stage));
  }
  if (process.env.BENCH_SEARCH_REPORT)
    await writeFile(process.env.BENCH_SEARCH_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  db.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
