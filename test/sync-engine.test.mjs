import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, retryDelay } from '../src/sync/engine.ts';
function harness() {
  let now = 1000,
    token = 1,
    cursor = 0,
    failAck = true,
    sendCount = 0,
    storedCount = 0;
  const receipts = new Map(),
    seen = [];
  const op = {
    protocolVersion: 1,
    workspaceId: 'w',
    epoch: 'e',
    operationId: 'same-id',
    deviceId: 'device',
    kind: 'task.create',
    entityId: 'task',
    baseVersion: null,
    payload: { title: 't', dueDate: null },
  };
  const pending = {
    operation: op,
    localRevision: 1,
    attempt: 0,
    nextAttemptAt: 0,
    state: 'queued',
    dependencies: [],
  };
  const repository = {
    identity: async () => ({ workspaceId: 'w', epoch: 'e', cursor }),
    acquireLease: async () => ({ owner: 'test', fence: token }),
    renewLease: async () => true,
    releaseLease: async () => {},
    pause: async () => {},
    acceptRemote: async () => {},
    advanceCursor: async (n) => {
      cursor = n;
    },
    shouldFetchPage: async () => true,
    bootstrapDone: async () => true,
    markBootstrapDone: async () => {},
    nextOperation: async () =>
      pending.state === 'acked' || pending.state === 'conflict' ? null : pending,
    markSending: async () => {},
    acknowledge: async (p, result, lease) => {
      if (lease.fence !== token) return false;
      pending.state = 'acked';
      seen.push(result);
      return true;
    },
    reject: async (p, state, error, next) => {
      pending.state = state;
      pending.attempt++;
      pending.nextAttemptAt = next;
    },
    counts: async () => ({
      pending: pending.state === 'acked' ? 0 : 1,
      conflicts: pending.state === 'conflict' ? 1 : 0,
    }),
  };
  const transport = {
    session: async () => ({
      protocolVersion: 1,
      workspaceId: 'w',
      epoch: 'e',
      headSeq: 0,
      capabilities: ['task.create'],
    }),
    pullChanges: async () => ({ epoch: 'e', headSeq: 0, nextAfter: 0, changes: [] }),
    fetchEntity: async () => {
      throw Error('no entity');
    },
    bootstrap: async () => ({ items: [], nextAfterId: null }),
    applyOperation: async (op) => {
      sendCount++;
      if (!receipts.has(op.operationId)) {
        receipts.set(op.operationId, {
          status: 'applied',
          operationId: op.operationId,
          item: { id: 'task', title: 't', version: 1 },
          version: 1,
        });
        storedCount++;
      }
      if (failAck) {
        failAck = false;
        throw Error('ack lost');
      }
      return receipts.get(op.operationId);
    },
  };
  const engine = createSyncEngine({ repository, transport, clock: () => now, random: () => 0.5 });
  return {
    engine,
    pending,
    repository,
    transport,
    advance: () => {
      now += 60000;
    },
    invalidate: () => {
      token++;
    },
    seen,
    counts: () => ({ sendCount, storedCount }),
    getCursor: () => cursor,
  };
}
test('lost acknowledgement retries the exact operation and produces one effect', async () => {
  const h = harness();
  await h.engine.requestSync();
  assert.equal(h.pending.state, 'queued');
  h.advance();
  await h.engine.requestSync();
  assert.equal(h.pending.state, 'acked');
  assert.deepEqual(h.counts(), { sendCount: 2, storedCount: 1 });
});
test('a remote page lock queues the draft without treating it as invalid or offline',async()=>{
 const h=harness();
 h.repository.nextOperation=async()=>h.pending.state==='queued'&&h.pending.nextAttemptAt<=1000?h.pending:null;
 h.transport.applyOperation=async()=>{throw Object.assign(Error('페이지가 잠겨 있어요.'),{status:423,code:'page_locked'});};
 await h.engine.requestSync();
 assert.equal(h.pending.state,'queued');
 assert.equal(h.pending.nextAttemptAt,31000);
 assert.equal(h.engine.getSnapshot().state,'ready');
});
test('stale lease cannot commit a late acknowledgement', async () => {
  const h = harness();
  h.transport.applyOperation = async () => {
    h.invalidate();
    return { status: 'applied', item: { version: 1 }, version: 1 };
  };
  await h.engine.requestSync();
  assert.equal(h.pending.state, 'queued');
  assert.equal(h.seen.length, 0);
});
test('epoch mismatch and cursor beyond server head pause pushing', async () => {
  for (const epoch of ['restored', 'e']) {
    const h = harness();
    h.repository.identity = async () => ({
      workspaceId: 'w',
      epoch: 'e',
      cursor: epoch === 'e' ? 9 : 0,
    });
    h.transport.session = async () => ({
      protocolVersion: 1,
      workspaceId: 'w',
      epoch,
      headSeq: 0,
      capabilities: ['task.create'],
    });
    await h.engine.requestSync();
    assert.equal(h.counts().sendCount, 0);
    assert.equal(h.engine.getSnapshot().state, 'recovery');
  }
});
test('authentication/protocol failure pauses; validation failure does not retry automatically', async () => {
  for (const status of [401, 403, 426, 413, 422, 409]) {
    const h = harness();
    h.transport.applyOperation = async () => {
      throw Object.assign(Error('fixture'), {
        status,
        code: status === 409 ? 'version_conflict' : 'error',
        current: { version: 2 },
      });
    };
    await h.engine.requestSync();
    assert.equal(
      h.pending.state,
      status === 409 ? 'conflict' : [413, 422].includes(status) ? 'failed' : 'queued',
    );
    assert.equal(
      h.engine.getSnapshot().state,
      [401, 403, 426].includes(status) ? 'access' : 'ready',
    );
  }
});
test('canonical fetch failure never advances cursor', async () => {
  const h = harness();
  h.transport.session = async () => ({
    protocolVersion: 1,
    workspaceId: 'w',
    epoch: 'e',
    headSeq: 1,
    capabilities: [],
  });
  h.transport.pullChanges = async () => ({
    epoch: 'e',
    headSeq: 1,
    nextAfter: 1,
    changes: [{ seq: 1, entityKind: 'capture', entityId: 'x', action: 'upsert' }],
  });
  await h.engine.requestSync();
  assert.equal(h.getCursor(), 0);
  assert.equal(h.counts().sendCount, 0);
});
test('backoff ladder, jitter and Retry-After are bounded', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 9].map((n) => retryDelay(n, () => 0.5)),
    [2000, 5000, 15000, 30000, 60000, 60000],
  );
  assert.equal(
    retryDelay(0, () => 0),
    1600,
  );
  assert.equal(
    retryDelay(0, () => 1),
    2400,
  );
  assert.equal(
    retryDelay(0, () => 0.5, 900000),
    300000,
  );
});
test('a conflict blocks only its entity while another entity can finish', async () => {
  const h = harness();
  const other = {
    ...structuredClone(h.pending),
    operation: { ...structuredClone(h.pending.operation), operationId: 'other', entityId: 'other' },
  };
  let first = true;
  h.repository.nextOperation = async () =>
    h.pending.state === 'queued' ? h.pending : other.state === 'acked' ? null : other;
  h.repository.acknowledge = async (p) => {
    p.state = 'acked';
    return true;
  };
  h.transport.applyOperation = async () => {
    if (first) {
      first = false;
      throw Object.assign(Error('conflict'), { status: 409, current: { version: 2 } });
    }
    return { status: 'applied', item: { version: 1 }, version: 1 };
  };
  await h.engine.requestSync();
  assert.equal(h.pending.state, 'conflict');
  assert.equal(other.state, 'acked');
});
test('a canceled candidate rejected by atomic claim never uploads or applies', async () => {
  const h = harness();
  h.repository.markSending = async () => {h.pending.state = 'acked';return false;};
  let uploads = 0;
  h.repository.prepareUploads = async () => {uploads++;};
  await h.engine.requestSync();
  assert.equal(uploads,0);
  assert.deepEqual(h.counts(),{sendCount:0,storedCount:0});
});
test('a persisted recovery pause prevents uploads even when server identity returns',async()=>{
  const h=harness();h.repository.isPaused=async()=>true;
  await h.engine.requestSync();
  assert.equal(h.engine.getSnapshot().state,'recovery');
  assert.deepEqual(h.counts(),{sendCount:0,storedCount:0});
});
test('401 during upload/send preserves queued UUID and resumes the same operation after authentication',async()=>{
 const h=harness();
 const original=h.transport.applyOperation;
 h.transport.applyOperation=async()=>{throw {status:401,code:'authentication_required',message:'다시 로그인'};};
 const engine=h.engine;
 const before=JSON.stringify(h.pending.operation);
 await engine.requestSync();
 assert.equal(engine.getSnapshot().state,'access');
 assert.equal(h.pending.state,'queued');
 assert.equal(JSON.stringify(h.pending.operation),before);
 h.transport.applyOperation=original;
 await engine.requestSync();
 assert.equal(JSON.stringify(h.pending.operation),before);
 // First attempt's server response is intentionally lost by the existing harness.
 await engine.requestSync();
 assert.equal(h.pending.state,'acked');
});
