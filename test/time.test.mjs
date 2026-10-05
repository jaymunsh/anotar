import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKoreanDate, formatKoreanTime, isNewCapture } from '../src/time.ts';

test('shell calendar date includes the Korean year boundary and weekday independently of device timezone', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(formatKoreanDate(Date.parse('2025-12-31T15:00:00.000Z')), '2026-01-01 (목)');
    assert.equal(formatKoreanDate(Date.parse('2026-09-28T15:00:00.000Z')), '2026-09-29 (화)');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('time is shown in Korea even when the process uses another timezone', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const now = Date.parse('2026-09-26T04:00:00.000Z');
    assert.equal(formatKoreanTime('2026-09-26T03:30:00.000Z', now), '오늘 오후 12:30');
    assert.equal(formatKoreanTime('2026-09-25T03:30:00.000Z', now), '2026-09-25 12:30');
    assert.equal(
      formatKoreanTime('2026-09-26T16:00:00.000Z', Date.parse('2026-09-26T15:10:00.000Z')),
      '오늘 오전 1:00',
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('NEW applies only during the first 24 hours', () => {
  const now = Date.parse('2026-09-26T03:30:00.000Z');
  assert.equal(isNewCapture(new Date(now).toISOString(), now), true);
  assert.equal(isNewCapture(new Date(now - 24 * 60 * 60 * 1000 + 1).toISOString(), now), true);
  assert.equal(isNewCapture(new Date(now - 24 * 60 * 60 * 1000).toISOString(), now), false);
  assert.equal(isNewCapture(new Date(now + 1).toISOString(), now), false);
});
