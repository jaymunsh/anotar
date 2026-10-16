import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as itinerary from '../shared/itinerary.ts';
import { itineraryMapPoints } from '../shared/googleItinerary.mjs';
import { openStore } from '../server/store.mjs';
import { referencedAssetIds, renderSharedPage } from '../server/publicPage.mjs';
import * as staticMaps from '../shared/staticMap.ts';

const planBlock = (data, assetId = '') => ({
  id: 'plan-one',
  type: 'itinerary',
  props: { data: JSON.stringify(data), assetId },
  children: [],
});
const pageFor = (block) => ({
  title: '하루 계획',
  updatedAt: '2026-09-30T00:00:00Z',
  document: { schemaVersion: 1, blocks: [block] },
});

test('map names follow coordinate pin numbering and remain escaped in public/offline output', () => {
  const entries = [
    { id: 'palace', date: '2026-10-03', start: '10:00', title: '산책', place: '경복궁 <script>', latitude: 37.5796, longitude: 126.977 },
    { id: 'travel', date: '2026-10-03', start: '11:00', title: '이동', category: 'travel', latitude: 37.58, longitude: 126.98 },
    { id: 'missing', date: '2026-10-03', start: '11:20', title: '카페', place: '미정' },
    { id: 'museum', date: '2026-10-03', start: '12:00', title: '미술관', place: '국립현대미술관 서울', latitude: 37.5786, longitude: 126.9809 },
  ];
  assert.equal(typeof staticMaps.staticMapStops, 'function');
  const stops = staticMaps.staticMapStops(entries);
  assert.deepEqual(stops.map(({ number, name }) => [number, name]), [[1, '경복궁 <script>'], [3, '국립현대미술관 서울']]);
  for (const stop of stops) assert.equal(new URL(stop.url).host, 'www.google.com');
  const html = renderSharedPage(pageFor(planBlock({ version: 1, timezone: 'Asia/Seoul', title: '계획', entries })), 'a'.repeat(43));
  assert.match(html, /aria-label="지도 방문 장소"/);
  assert.match(html, /경복궁 &lt;script&gt;/);
  assert.doesNotMatch(html, /경복궁 <script>/);
});

test('optional activity types preserve old plans and reject unknown types', () => {
  const legacy = itinerary.itinerarySample();
  assert.deepEqual(itinerary.cleanItinerary(legacy), legacy);
  for (const category of ['sightseeing', 'travel', 'meal', 'rest', 'stay', 'other']) {
    const data = { ...legacy, entries: [{ ...legacy.entries[0], category }] };
    assert.equal(itinerary.cleanItinerary(data).entries[0].category, category);
  }
  assert.throws(() =>
    itinerary.cleanItinerary({
      ...legacy,
      entries: [{ ...legacy.entries[0], category: 'invented' }],
    }),
  );
});

test('duration and overlap handle boundaries, missing end times and dates', () => {
  const entries = itinerary.itinerarySample().entries;
  assert.equal(itinerary.itineraryDuration(entries[0]), '30분');
  assert.equal(
    itinerary.itineraryDuration({ ...entries[0], start: '09:00', end: '10:30' }),
    '1시간 30분',
  );
  assert.equal(itinerary.itineraryDuration({ ...entries[0], end: undefined }), '');
  assert.equal(itinerary.itineraryDuration({ ...entries[0], end: entries[0].start }), '0분');
  const a = { ...entries[0], id: 'a', start: '09:00', end: '12:00' };
  const b = { ...a, id: 'b', start: '10:00', end: '11:00' };
  const c = { ...a, id: 'c', start: '12:00', end: '13:00' };
  const d = { ...b, id: 'd', date: '2026-10-04' };
  assert.deepEqual([...itinerary.itineraryOverlaps([c, d, b, a])].sort(), ['a', 'b']);
});

test('travel never creates a place number and missing coordinates preserve numbering gaps', () => {
  const [a, b, c, d] = itinerary.itinerarySample().entries;
  const entries = [
    a,
    { ...b, category: 'travel' },
    { ...c, latitude: undefined, longitude: undefined },
    d,
  ];
  assert.deepEqual(
    itineraryMapPoints(entries).map((p) => p.number),
    [1, 3],
  );
  const markdown = itinerary.itineraryMarkdown({ ...itinerary.itinerarySample(), entries });
  assert.match(markdown, /활동/);
  assert.match(markdown, /이동/);
  assert.match(markdown, /30분/);
  assert.match(markdown, /google\.com\/maps/);
  assert.doesNotMatch(markdown, /openstreetmap/);
});

test('public plans use static images and links without SDKs, keys or raw plan data', () => {
  const data = itinerary.itinerarySample();
  data.entries[0].category = 'sightseeing';
  data.entries[0].title = '<img src=x onerror=alert(1)>';
  const html = renderSharedPage(pageFor(planBlock(data)), 'a'.repeat(43), new Map(), {
    googleMapsKey: 'AIza_should-not-be-public',
  });
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /Google Maps에서 열기/);
  assert.match(html, /관광/);
  assert.match(html, /30분/);
  assert.doesNotMatch(
    html,
    /data-itinerary=|data-google-maps-key|google-itinerary|openstreetmap|AIza_|<iframe|<img src=x|\/api\//,
  );
});

test('preview image refs remain accessible through source trash, revision and template', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-plan-image-'));
  const store = openStore(dir);
  try {
    const source = store.createCapture({
      kind: 'image',
      text: '지도 이미지',
      url: null,
      files: [{ key: 'map-image', name: '지도.png', mime: 'image/png', size: 8 }],
    });
    const image = store.getCapture(source.id).files[0];
    const plan = itinerary.itinerarySample();
    let page = store.createPage({ title: '이미지 계획' });
    const document = { schemaVersion: 1, blocks: [planBlock(plan, image.id)] };
    page = store.updatePage({ ...page, document, expectedVersion: page.version });
    assert.deepEqual([...referencedAssetIds(document)], [image.id]);
    const html = renderSharedPage(page, 'a'.repeat(43), new Map([[image.id, image]]));
    assert.match(html, new RegExp('/s/' + 'a'.repeat(43) + '/assets/' + image.id));
    assert.doesNotMatch(html, /data:image\/svg/);
    store.trashRecord({
      kind: 'capture',
      id: source.id,
      expectedVersion: source.version,
      operationId: randomUUID(),
    });
    assert.ok(store.getAsset(image.id));
    page = store.updatePage({
      ...page,
      document: { ...document, blocks: [planBlock(plan)] },
      expectedVersion: page.version,
    });
    assert.equal(referencedAssetIds(page.document).size, 0);
    assert.ok(store.getAsset(image.id), 'Historical preview remains available to owner');
    const db = new DatabaseSync(join(dir, 'storage.sqlite'), { readOnly: true });
    assert.ok(db.prepare('SELECT 1 FROM page_revision_assets WHERE asset_id=?').get(image.id));
    db.close();
    const restored = store.restorePageRevision({
      pageId: page.id,
      revisionVersion: 2,
      expectedVersion: page.version,
      operationId: randomUUID(),
    }).item;
    const template = store.savePageTemplate({
      pageId: restored.id,
      name: '지도 계획',
      expectedVersion: restored.version,
      operationId: randomUUID(),
    }).item;
    store.trashRecord({
      kind: 'page',
      id: restored.id,
      expectedVersion: restored.version,
      operationId: randomUUID(),
    });
    assert.ok(store.getAsset(image.id), 'Template preserves the image after page trash');
    const recreated = store.createPageFromTemplate({
      templateId: template.id,
      operationId: randomUUID(),
    }).item;
    assert.equal(recreated.document.blocks[0].props.assetId, image.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('new plan and map previews reject unavailable assets and non-image files atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leneu-plan-image-validation-'));
  const store = openStore(dir);
  try {
    const capture = store.createCapture({
      kind: 'file',
      text: '파일',
      url: null,
      files: [{ key: 'notes-file', name: 'notes.md', mime: 'text/markdown', size: 8 }],
    });
    const file = store.getCapture(capture.id).files[0];
    const page = store.createPage({ title: '이미지 검증' });
    for (const block of [
      planBlock(itinerary.itinerarySample(), file.id),
      {
        id: 'map-one',
        type: 'map',
        props: { latitude: 37.58, longitude: 126.98, zoom: 15, label: '장소', assetId: file.id },
        children: [],
      },
      planBlock(itinerary.itinerarySample(), randomUUID()),
    ]) {
      assert.throws(
        () =>
          store.updatePage({
            ...page,
            expectedVersion: page.version,
            document: { schemaVersion: 1, blocks: [block] },
          }),
        /이미지 파일|첨부 파일을 찾을 수/,
      );
      assert.equal(store.getPage(page.id).version, page.version);
      assert.deepEqual(store.getPage(page.id).document, page.document);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
