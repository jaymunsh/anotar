import test from 'node:test';
import assert from 'node:assert/strict';
let serial = 0;
async function fresh() {
  return import('../src/auth/state.ts?case=' + ++serial);
}
function status(authenticated) {
  return new Response(JSON.stringify({ enabled: true, configured: true, authenticated }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
test('a delayed authenticated status cannot unlock an explicit logout', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const state = await fresh();
  let resolveResponse;
  globalThis.fetch = () => new Promise((r) => (resolveResponse = r));
  const pending = state.refreshAuth();
  state.loggedOut();
  resolveResponse(status(true));
  await pending;
  assert.equal(state.getAuthSnapshot().locked, true);
  assert.equal(state.getAuthSnapshot().state, 'required');
  // A later ordinary refresh cannot bypass the explicit lock either.
  globalThis.fetch = async () => status(true);
  await state.refreshAuth();
  assert.equal(state.getAuthSnapshot().locked, true);
});
test('stale unauthenticated or failed status cannot overwrite a newer successful login', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const state = await fresh();
  let resolveResponse;
  globalThis.fetch = () => new Promise((r) => (resolveResponse = r));
  const pending = state.refreshAuth();
  await state.loggedIn();
  resolveResponse(status(false));
  await pending;
  assert.equal(state.getAuthSnapshot().state, 'authenticated');
  assert.equal(state.getAuthSnapshot().locked, false);
  let rejectResponse;
  globalThis.fetch = () => new Promise((_, reject) => (rejectResponse = reject));
  const failed = state.refreshAuth();
  state.loggedOut();
  rejectResponse(Error('offline'));
  await failed;
  assert.equal(state.getAuthSnapshot().state, 'required');
  assert.equal(state.getAuthSnapshot().locked, true);
});
