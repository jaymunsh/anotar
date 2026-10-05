import test from 'node:test';
import assert from 'node:assert/strict';
import { getBlockExcerpt } from '../shared/pageComments.ts';
test('itinerary comments quote the actual plan title instead of an empty block', () => {
  assert.equal(
    getBlockExcerpt(
      [
        {
          id: 'plan',
          type: 'itinerary',
          props: { data: JSON.stringify({ title: '서울 하루 계획' }) },
        },
      ],
      'plan',
    ),
    '일정 · 서울 하루 계획',
  );
});
test('invalid itinerary data still has a meaningful comment anchor', () => {
  assert.equal(
    getBlockExcerpt([{ id: 'plan', type: 'itinerary', props: { data: 'broken' } }], 'plan'),
    '일정',
  );
});
