import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDueDate, shortDue } from '../src/tasks/dueDate.ts';

// 2026-10-17 is a Saturday.
const today = '2026-10-17';

test('relative words and weekdays', () => {
  assert.equal(parseDueDate('오늘 백업 확인', today), '2026-10-17');
  assert.equal(parseDueDate('내일 장보기', today), '2026-10-18');
  assert.equal(parseDueDate('모레까지 보고서', today), '2026-10-19');
  assert.equal(parseDueDate('금요일까지 교토 숙소 예약하기', today), '2026-10-23');
  assert.equal(parseDueDate('토요일 청소', today), '2026-10-17');
  assert.equal(parseDueDate('이번 주 일요일 정리', today), '2026-10-18');
  assert.equal(parseDueDate('다음 주 월요일 회의', today), '2026-10-19');
  assert.equal(parseDueDate('다음주 금요일 발표', today), '2026-10-23');
});

test('numeric dates, rollover, invalid, first phrase wins', () => {
  assert.equal(parseDueDate('10/23 마감', today), '2026-10-23');
  assert.equal(parseDueDate('11월 3일 병원', today), '2026-11-03');
  assert.equal(parseDueDate('1/5 세금', today), '2027-01-05');
  assert.equal(parseDueDate('2026-12-01 갱신', today), '2026-12-01');
  assert.equal(parseDueDate('2/30 없는 날', today), null);
  assert.equal(parseDueDate('버전 1.2 정리', today), null);
  assert.equal(parseDueDate('그냥 메모', today), null);
  assert.equal(parseDueDate('내일 말고 금요일', today), '2026-10-18');
  assert.equal(shortDue('2026-10-23'), '10/23(금)');
});
