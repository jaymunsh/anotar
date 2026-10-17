import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue } from '../src/dashboard/queueModel.ts';

const now = Date.parse('2026-10-17T12:00:00Z');
const today = '2026-10-17';

test('queue order: overdue tasks, AI results, memos waiting 3+ days (oldest first)', () => {
  const items = buildQueue({
    now,
    today,
    tasks: [
      { id: 't-later', title: '나중', dueDate: '2026-10-20', version: 1 },
      { id: 't-new', title: '어제 기한', dueDate: '2026-10-16', version: 1 },
      { id: 't-old', title: '지난주 기한', dueDate: '2026-10-10', version: 1 },
      { id: 't-none', title: '기한 없음', dueDate: null, version: 1 },
      { id: 't-today', title: '오늘 기한', dueDate: '2026-10-17', version: 1 },
    ],
    ai: [{ id: 'a1', preview: 'WAL 정리', sourceTitle: '', href: '/captures/c?aiJob=a1', finishedAt: null }],
    memos: [
      { id: 'm-fresh', kind: 'note', text: '오늘 메모', createdAt: '2026-10-17T01:00:00Z' },
      { id: 'm-4', kind: 'note', text: '4일 된 메모', createdAt: '2026-10-13T11:00:00Z' },
      { id: 'm-9', kind: 'link', text: '', url: 'https://x.dev', createdAt: '2026-10-08T00:00:00Z' },
    ],
  });
  assert.deepEqual(items.map((item) => item.id), ['t-old', 't-new', 'a1', 'm-9', 'm-4']);
  assert.equal(items.find((item) => item.id === 'm-9').title, 'https://x.dev');
  assert.equal(items.find((item) => item.id === 'm-4').waitedDays, 4);
});
