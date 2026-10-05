import test from 'node:test';
import assert from 'node:assert/strict';
import { rebasePromptDrafts } from '../src/prompts/migration.ts';

test('import mappings preserve unsaved text and only rebase matching browser versions', () => {
  const base = {
    id: 'legacy',
    name: '초안',
    description: '',
    kind: 'free',
    body: '미저장 내용',
    archived: false,
    expectedVersion: 7,
  };
  const mapping = {
    sourceId: 'legacy',
    sourceVersion: 7,
    targetId: 'imported',
    targetVersion: 2,
    targetRevisionId: 'server-revision',
  };
  const moved = rebasePromptDrafts(
    { legacy: base, new: { ...base, id: undefined, expectedVersion: undefined } },
    [mapping],
  );
  assert.equal(moved.legacy, undefined);
  assert.equal(moved.imported.body, base.body);
  assert.equal(moved.imported.expectedVersion, 2);
  assert.equal(moved.imported.expectedRevisionId, 'server-revision');
  assert.equal(moved.new.body, base.body);
  const stale = { ...base, expectedVersion: 6 };
  assert.deepEqual(rebasePromptDrafts({ legacy: stale }, [mapping]), { legacy: stale });
  const server = { ...base, expectedRevisionId: 'original-server-revision' };
  assert.deepEqual(
    rebasePromptDrafts({ legacy: server }, [mapping]),
    { legacy: server },
    'already-server drafts never adopt a later revision',
  );
});
