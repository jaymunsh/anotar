import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotIsBound, wouldCreateDependencyCycle } from '../src/sync/pendingSnapshot.ts';
const head = (id, dependencies = []) => ({ operation: { operationId: id }, dependencies });
test('a parent create retains its original request when the new document links its dependent child', () => {
  assert.equal(
    wouldCreateDependencyCycle('parent', ['child'], [head('parent'), head('child', ['parent'])]),
    true,
  );
});
test('transitive dependencies cannot introduce a cycle', () => {
  assert.equal(
    wouldCreateDependencyCycle('a', ['c'], [head('a'), head('b', ['a']), head('c', ['b'])]),
    true,
  );
});
test('independent references and acknowledged dependencies may coalesce', () => {
  assert.equal(
    wouldCreateDependencyCycle('a', ['b', 'ack'], [head('a'), head('b', ['c']), head('c')]),
    false,
  );
});

test('AI dependencies freeze the source snapshot even before first send', () => {
  assert.equal(snapshotIsBound({ operationId: 'source' }, [head('ai', ['source'])]), true);
  assert.equal(snapshotIsBound({ operationId: 'source', baseOperationId: 'earlier' }, []), true);
  assert.equal(snapshotIsBound({ operationId: 'source' }, [head('other', ['unrelated'])]), false);
});
