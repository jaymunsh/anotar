import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as itinerary from '../shared/itinerary.ts';
test('new activity suggests last end, preserving date without rollover', () => {
  assert.deepEqual(itinerary.itineraryNextSlot([], '2026-10-03'), {date:'2026-10-03',start:'09:00'});
  assert.deepEqual(itinerary.itineraryNextSlot([{date:'2026-10-04',start:'22:00',end:'23:59'}], '2026-10-03'), {date:'2026-10-04',start:'23:59'});
  assert.equal(itinerary.itineraryNextSlot([{date:'2026-10-04',start:'11:00'}], '2026-10-03').start, '11:00');
});
