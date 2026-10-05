import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as reading from '../shared/itineraryReading.ts';
import { renderSharedPage } from '../server/publicPage.mjs';

test('day summaries preserve date order and describe actual time bounds without filling gaps', () => {
  const entries = [
    { id: 'a', date: '2026-10-06', start: '09:00', end: '10:00', title: '산책', place: '공원' },
    {
      id: 'b',
      date: '2026-10-06',
      start: '10:30',
      end: '11:15',
      title: '이동',
      category: 'travel',
      place: '역',
    },
    { id: 'c', date: '2026-10-07', start: '08:00', title: '출발' },
  ];
  assert.equal(typeof reading.itineraryDaySummaries, 'function');
  assert.deepEqual(reading.itineraryDaySummaries(entries), [
    { date: '2026-10-06', label: '10.6 (화)', start: '09:00', end: '11:15', visits: 1 },
    { date: '2026-10-07', label: '10.7 (수)', start: '08:00', end: '08:00', visits: 0 },
  ]);
  assert.deepEqual(reading.itineraryDaySummaries([]), []);
});

test('note lines retain full instructions and identify timed steps without truncating', () => {
  const long = '출발 30분 전에 도착. '.repeat(20);
  assert.deepEqual(reading.itineraryNoteLines(long), [{ time: '', text: long }]);
  assert.deepEqual(
    reading.itineraryNoteLines(
      '07:10–07:40 공항 도착·카운터 확인.\n\n07:40–09:10 수속.\r\n여권 확인.',
    ),
    [
      { time: '07:10–07:40', text: '공항 도착·카운터 확인.' },
      { time: '07:40–09:10', text: '수속.' },
      { time: '', text: '여권 확인.' },
    ],
  );
  assert.deepEqual(reading.itineraryNoteLines(), []);
});

test('explicit travel properties are readable without interpreting ordinary prose or URLs', () => {
  assert.deepEqual(reading.itineraryNoteLines('노선 · 난바 → 교토\n비용: 약 900엔 / 재확인\nhttps://example.com\n주의할 것은 환승이다.\n09:10 게이트 도착'), [
    { time: '', label: '노선', text: '난바 → 교토' },
    { time: '', label: '비용', text: '약 900엔 / 재확인' },
    { time: '', text: 'https://example.com' },
    { time: '', text: '주의할 것은 환승이다.' },
    { time: '09:10', text: '게이트 도착' },
  ]);
});

test('shared timetable shows every note once without a collapsed detail or unsafe HTML', () => {
  const note = '비용 · 미확인 <img src=x onerror=alert(1)>\n첫 문장은 항상 읽힌다. ' + '<script>alert(1)</script> '.repeat(8);
  const page = {
    title: '여행',
    updatedAt: '2026-10-01T00:00:00Z',
    document: {
      blocks: [
        {
          id: 'day',
          type: 'itinerary',
          props: {
            data: JSON.stringify({
              version: 1,
              timezone: 'Asia/Seoul',
              title: '교토',
              entries: [
                {
                  id: 'a',
                  date: '2026-10-06',
                  start: '09:00',
                  end: '10:00',
                  title: '방문',
                  place: '공원',
                  category: 'sightseeing',
                  note,
                },
              ],
            }),
          },
          children: [],
        },
      ],
    },
  };
  const html = renderSharedPage(page, 'local');
  assert.match(html, /itinerary-day-summary/);
  assert.match(html, /10\.6 \(화\)/);
  assert.match(html, /itinerary-entry-note/);
  assert.match(html, /itinerary-note-label">비용<\/span>/);
  assert.match(html, /미확인 &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /itinerary-entry-details/);
  assert.equal((html.match(/첫 문장은 항상 읽힌다/g) || []).length, 1);
  assert.equal((html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) || []).length, 8);
  assert.match(html, /첫 문장은 항상 읽힌다/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('shared reference toggles contain their children once and can be opened natively', () => {
  const page = {
    title: '여행',
    updatedAt: '2026-10-01T00:00:00Z',
    document: {
      blocks: [
        {
          id: 'reference',
          type: 'toggleListItem',
          content: [{ type: 'text', text: '예약 조건' }],
          children: [
            {
              id: 'child',
              type: 'paragraph',
              content: [{ type: 'text', text: '실제 좌석 확인 필요' }],
              children: [],
            },
          ],
        },
      ],
    },
  };
  const html = renderSharedPage(page, 'local');
  assert.match(html, /<details class="page-reference-toggle"><summary>예약 조건<\/summary>/);
  assert.match(html, /<\/p><\/section><\/div><\/details>/);
  assert.equal((html.match(/실제 좌석 확인 필요/g) || []).length, 1);
});

test('shared navigation links only visible public headings and preserves compact opt-in', () => {
  const heading = (id, text) => ({
    id,
    type: 'heading',
    props: { level: 2 },
    content: [{ type: 'text', text }],
    children: [],
  });
  const page = {
    title: '여행',
    updatedAt: '2026-10-01T00:00:00Z',
    document: {
      blocks: [
        {
          id: 'toc',
          type: 'tableOfContents',
          props: { compact: true },
          children: [heading('hidden-toc', 'TOC 숨김 제목')],
        },
        heading('kyoto', '교토 <script>'),
        {
          id: 'hidden',
          type: 'captureRef',
          props: { captureId: 'private' },
          children: [heading('private-title', '원본 숨김 제목')],
        },
      ],
    },
  };
  const html = renderSharedPage(page, 'local');
  assert.match(html, /data-layout="compact"/);
  assert.match(html, /class="page-toc-title">목차</);
  assert.doesNotMatch(html, /바로가기/);
  assert.match(html, /href="#block-kyoto"/);
  assert.match(html, /id="block-kyoto"/);
  assert.match(html, /교토 &lt;script&gt;/);
  assert.doesNotMatch(html, /TOC 숨김 제목|원본 숨김 제목/);
});
