import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanItinerary, itineraryMarkdown, itinerarySample } from '../shared/itinerary.ts';
import { serializePageDocument } from '../server/pages.mjs';
import { renderSharedPage } from '../server/publicPage.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { pageSearchText, registerSearchFunctions } from '../server/searchText.mjs';

test('connected itinerary validates dates, times, coordinates, IDs and URLs', () => {
  const valid = itinerarySample();
  assert.equal(cleanItinerary(JSON.stringify(valid)).entries.length, 4);
  for (const patch of [
    { date: '2026-02-30' },
    { start: '25:00' },
    { end: '08:00' },
    { latitude: 91 },
    { longitude: 181 },
    { url: 'javascript:alert(1)' },
  ]) {
    assert.throws(() => cleanItinerary({ ...valid, entries: [{ ...valid.entries[0], ...patch }] }));
  }
  assert.throws(() => cleanItinerary({ ...valid, entries: [valid.entries[0], valid.entries[0]] }));
  assert.throws(() =>
    cleanItinerary({ ...valid, entries: [{ ...valid.entries[0], longitude: undefined }] }),
  );
  assert.throws(() => cleanItinerary({ ...valid, timezone: 'UTC' }));
  assert.throws(() =>
    cleanItinerary({
      ...valid,
      entries: Array.from({ length: 51 }, (_, i) => ({ ...valid.entries[0], id: `entry-${i}` })),
    }),
  );
  assert.throws(() =>
    cleanItinerary({
      ...valid,
      entries: [{ ...valid.entries[0], url: 'https://example.com\n.evil.test' }],
    }),
  );
});

test('itinerary survives page validation and has usable Markdown export', () => {
  const data = itinerarySample();
  const document = {
    schemaVersion: 1,
    blocks: [
      { id: 'plan-one', type: 'itinerary', props: { data: JSON.stringify(data) }, children: [] },
    ],
  };
  assert.deepEqual(JSON.parse(serializePageDocument(document)), document);
  const md = itineraryMarkdown(data);
  assert.match(md, /시간/);
  assert.match(md, /09:30/);
  assert.match(md, /google\.com\/maps/);
  assert.throws(() =>
    serializePageDocument({
      ...document,
      blocks: [{ ...document.blocks[0], props: { data: '{}' } }],
    }),
  );
});

test('public itinerary escapes content and ships isolated script with no private resource', () => {
  const data = itinerarySample();
  data.title = '<script>alert(1)</script>';
  data.entries[0].title = '</script><img src=x onerror=alert(1)>';
  const html = renderSharedPage(
    {
      title: '공유 일정',
      updatedAt: new Date().toISOString(),
      document: {
        blocks: [
          { id: 'plan', type: 'itinerary', props: { data: JSON.stringify(data) }, children: [] },
        ],
      },
    },
    'a'.repeat(43),
  );
  assert.match(html, /share-plan.js/);
  assert.match(html, /data-static-itinerary/);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('/api/'));
  assert.match(html, /09:30/);
});

test('itinerary authored fields are searchable while internal IDs and coordinates stay private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-itinerary-search-'));
  let store;
  try {
    store = openStore(dir);
    let page = store.createPage({ title: '일정 페이지' });
    const data = itinerarySample();
    data.entries[0].title = '고유시간표검색제목';
    data.entries[0].place = '고유장소검색';
    data.entries[0].note = '고유메모검색';
    data.entries[0].url = 'https://example.com/unique-itinerary-query';
    page = store.updatePage({
      ...page,
      expectedVersion: page.version,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'private-plan-id',
            type: 'itinerary',
            props: { data: JSON.stringify(data) },
            children: [],
          },
        ],
      },
    });
    for (const query of [
      '고유시간표검색제목',
      '고유장소검색',
      '고유메모검색',
      'unique-itinerary-query',
    ])
      assert.equal(store.searchRecords({ query, type: 'page' }).items[0]?.id, page.id);
    const plain = pageSearchText(page.document);
    assert.ok(!plain.includes('walk-1'));
    assert.ok(!plain.includes('37.5759'));
    assert.ok(!plain.includes('Asia/Seoul'));
    store.close();
    store = null;
    const db = new DatabaseSync(join(dir, 'storage.sqlite'));
    registerSearchFunctions(db);
    db.prepare("DELETE FROM search_schema_migrations WHERE name='itinerary-text-v1'").run();
    db.prepare("UPDATE search_documents SET body='' WHERE target_id=? AND target_kind='page'").run(
      page.id,
    );
    db.close();
    store = openStore(dir);
    assert.equal(
      store.searchRecords({ query: '고유시간표검색제목', type: 'page' }).items[0]?.id,
      page.id,
    );
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
