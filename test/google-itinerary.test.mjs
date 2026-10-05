import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSharedPage } from '../server/publicPage.mjs';
import { itinerarySample } from '../shared/itinerary.ts';

const module = await import('../shared/googleItinerary.mjs').catch(() => ({}));
test('map points preserve timetable numbering and omit missing coordinates', () => {
  assert.equal(typeof module.itineraryMapPoints, 'function');
  const entries = itinerarySample().entries;
  const points = module.itineraryMapPoints([
    entries[0],
    { ...entries[1], latitude: undefined, longitude: undefined },
    entries[2],
  ]);
  assert.deepEqual(
    points.map((p) => p.number),
    [1, 3],
  );
  assert.deepEqual(points[0].position, { lat: entries[0].latitude, lng: entries[0].longitude });
});
test('browser map keys reject unsafe input and accept an API key', () => {
  assert.equal(typeof module.cleanGoogleMapsKey, 'function');
  assert.equal(module.cleanGoogleMapsKey('  AIza_test-demo-key  '), 'AIza_test-demo-key');
  for (const value of ['<script>', 'abc&callback=evil', 'a'.repeat(201), null, ''])
    assert.equal(module.cleanGoogleMapsKey(value), '');
});
test('public shares ignore Google keys and show static previews', () => {
  const document = {
    blocks: [
      {
        id: 'plan',
        type: 'itinerary',
        props: { data: JSON.stringify(itinerarySample()) },
        children: [],
      },
    ],
  };
  const page = { title: '세 곳의 하루', document, updatedAt: new Date().toISOString() };
  const before = JSON.stringify(document);
  const html = renderSharedPage(page, 'a'.repeat(43), new Map(), {
    googleMapsKey: 'AIza_test-demo-key',
  });
  assert.doesNotMatch(html, /data-google-maps-key|AIza_test-demo-key/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /방문 순서/);
  assert.ok(!html.includes('/api/'));
  assert.equal(JSON.stringify(document), before);
  assert.ok(!renderSharedPage(page, 'a'.repeat(43)).includes('data-google-maps-key'));
  assert.ok(
    !renderSharedPage(page, 'a'.repeat(43), new Map(), { googleMapsKey: '"><script>' }).includes(
      'data-google-maps-key',
    ),
  );
});
