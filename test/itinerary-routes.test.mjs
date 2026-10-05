import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itineraryRoutes } from '../shared/itinerary.ts';

const stop = (i, extra = {}) => ({
  id: String(i),
  date: '2026-10-03',
  start: '09:00',
  title: `방문 ${i}`,
  place: `장소 ${i}`,
  category: 'sightseeing',
  ...extra,
});
test('route uses scheduled order, coordinates and dates, excluding travel and unknown places', () => {
  const routes = itineraryRoutes([
    stop(1),
    stop(2, { category: 'travel' }),
    stop(3, { place: undefined }),
    stop(4, { latitude: 37.5, longitude: 127 }),
    stop(5, { date: '2026-10-04' }),
  ]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].date, '2026-10-03');
  assert.deepEqual(routes[0].numbers, [1, 2]);
  const url = new URL(routes[0].url);
  assert.equal(url.searchParams.get('origin'), '장소 1');
  assert.equal(url.searchParams.get('destination'), '37.5,127');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.has('key'), false);
  assert.equal(url.searchParams.has('travelmode'), false);
});
test('long plans split with a shared boundary and at most three mobile waypoints', () => {
  const routes = itineraryRoutes(Array.from({ length: 10 }, (_, i) => stop(i + 1)));
  assert.deepEqual(
    routes.map((r) => r.numbers),
    [
      [1, 2, 3, 4, 5],
      [5, 6, 7, 8, 9],
      [9, 10],
    ],
  );
  for (const route of routes)
    assert.ok((new URL(route.url).searchParams.get('waypoints') || '').split('|').length <= 3);
});
test('encoded route URL stays within 2048 characters without losing a connection', () => {
  const routes = itineraryRoutes(
    Array.from({ length: 6 }, (_, i) => stop(i + 1, { place: '서울'.repeat(50) })),
  );
  assert.ok(routes.length > 1);
  assert.deepEqual([...new Set(routes.flatMap((r) => r.numbers))], [1, 2, 3, 4, 5, 6]);
  assert.ok(routes.every((r) => r.url.length <= 2048));
  assert.deepEqual(
    itineraryRoutes([stop(1, { place: '서울'.repeat(80) }), stop(2, { place: '서울'.repeat(80) })]),
    [],
  );
});
test('zero, single and separate-date stops do not produce a misleading route', () => {
  assert.deepEqual(itineraryRoutes([]), []);
  assert.deepEqual(itineraryRoutes([stop(1)]), []);
  assert.deepEqual(itineraryRoutes([stop(1), stop(2, { date: '2026-10-04' })]), []);
});
