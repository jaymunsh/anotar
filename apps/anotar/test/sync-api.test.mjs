import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fixture, operation } from './fixtures/sync.mjs';
import { handleSyncRequest } from '../server/sync/routes.mjs';
test('private sync routes expose contract, no-store, validation and replay status', async (t) => {
  const store = await fixture(t),
    server = createServer(async (req, res) => {
      if (!(await handleSyncRequest(req, res, { store }))) {
        res.writeHead(404);
        res.end();
      }
    });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/sync`;
  const session = await fetch(base + '/session');
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.ok((await session.json()).capabilities.includes('capture.create'));
  const op = operation(store);
  const post = (body) =>
    fetch(base + '/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const first = await post(op);
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.item.id, op.entityId);
  assert.equal((await (await post(op)).json()).replayed, true);
  assert.equal((await post({ ...op, payload: { ...op.payload, text: 'different' } })).status, 409);
  assert.equal((await fetch(base + '/operations', { method: 'POST', body: '{}' })).status, 415);
  assert.equal(
    (
      await fetch(base + '/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    422,
  );
  const item = await (await fetch(base + `/entities/capture/${op.entityId}`)).json();
  assert.equal(item.item.text, op.payload.text);
  assert.ok(item.readSeq > 0);
  assert.equal((await (await fetch(base + '/bootstrap?kind=capture')).json()).items.length, 1);
  assert.ok((await (await fetch(base + '/changes?after=0')).json()).changes.length > 0);
  assert.equal((await fetch(base + '/changes?after=no')).status, 422);
});
