import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncedSync } from '../src/sync/autosave.ts';
function fixture() {
  let now = 0,
    id = 0;
  const jobs = new Map(),
    sent = [];
  let latest = '';
  const sync = createDebouncedSync(
    () => {
      sent.push(latest);
    },
    {
      clock: () => now,
      setTimer: (fn, delay) => {
        jobs.set(++id, { fn, due: now + delay });
        return id;
      },
      clearTimer: (id) => jobs.delete(id),
    },
  );
  return {
    sync,
    sent,
    set: (value) => {
      latest = value;
      return sync.schedule();
    },
    async advance(ms) {
      now += ms;
      for (const [id, job] of [...jobs])
        if (job.due <= now) {
          jobs.delete(id);
          job.fn();
        }
      await Promise.resolve();
    },
    jobs,
  };
}
test('typing merges to the latest snapshot after one quiet second', async () => {
  const f = fixture();
  f.set('a');
  await f.advance(400);
  f.set('ab');
  await f.advance(999);
  assert.deepEqual(f.sent, []);
  await f.advance(1);
  assert.deepEqual(f.sent, ['ab']);
  assert.equal(f.jobs.size, 0);
});
test('continuous typing cannot postpone the burst beyond five seconds', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    f.set(String(i));
    await f.advance(500);
  }
  assert.deepEqual(f.sent, ['9']);
  f.set('next');
  await f.advance(1000);
  assert.deepEqual(f.sent, ['9', 'next']);
});
test('navigation flushes once and removes the delayed send', async () => {
  const f = fixture();
  f.set('draft');
  await f.sync.flush();
  await f.advance(5000);
  assert.deepEqual(f.sent, ['draft']);
});
test('cancellation discards scheduling, not a completed snapshot', async () => {
  const f = fixture();
  f.set('old');
  f.sync.cancel();
  await f.advance(5000);
  assert.deepEqual(f.sent, []);
  f.set('new');
  await f.advance(1000);
  assert.deepEqual(f.sent, ['new']);
});
