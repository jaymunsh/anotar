import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';

test('the staging page is reused across clients and restart without resetting edited content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-staging-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  t.after(() => store.close());
  assert.equal(store.getStagingPage(), null);
  const first = store.ensureStagingPage();
  const edited = store.updatePage({
    id: first.id,
    title: '나중에 정리할 자료',
    expectedVersion: first.version,
    document: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'kept-block',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '직접 작성한 내용', styles: {} }],
          children: [],
        },
      ],
    },
  });
  assert.deepEqual(store.ensureStagingPage(), edited);
  store.close();
  store = openStore(dir);
  assert.deepEqual(store.getStagingPage(), edited);
  assert.deepEqual(store.ensureStagingPage(), edited);
  assert.equal(store.listPages().filter((item) => item.id === first.id).length, 1);
});
