import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDraft, saveDraft, draftSessionId } from '../src/drafts/localDraft.ts';
import {
  loadTemplates,
  preferredTemplateId,
  readRecentTemplates,
  rememberTemplate,
} from '../src/prompts/templates.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('drafts restore exact input, clear after saving, and leave other tab drafts untouched', () => {
  const storage = memoryStorage();
  const isNote = (value) => typeof value?.text === 'string';
  saveDraft(storage, 'tab-a', { text: '작성 중\n{{url}} — 원문', enabled: true });
  saveDraft(storage, 'tab-b', { text: '다른 탭' });
  assert.deepEqual(loadDraft(storage, 'tab-a', isNote), {
    text: '작성 중\n{{url}} — 원문',
    enabled: true,
  });
  saveDraft(storage, 'tab-a', null);
  assert.equal(loadDraft(storage, 'tab-a', isNote), null);
  assert.deepEqual(loadDraft(storage, 'tab-b', isNote), { text: '다른 탭' });
});

test('a tab keeps its draft identity after reload, and new tabs get different identities', () => {
  const session = memoryStorage();
  const id = draftSessionId(session);
  assert.equal(draftSessionId(session), id);
  assert.notEqual(draftSessionId(memoryStorage()), id);
});

test('corrupt drafts and quota failures are reported without silently deleting existing data', () => {
  const storage = memoryStorage();
  storage.setItem('draft', '{invalid');
  assert.throws(() => loadDraft(storage, 'draft', () => true), /복구/);
  assert.equal(storage.getItem('draft'), '{invalid');
  assert.throws(
    () =>
      saveDraft(
        {
          ...storage,
          setItem: () => {
            throw new Error('quota');
          },
        },
        'draft',
        { text: '초안' },
      ),
    /임시저장/,
  );
  assert.equal(storage.getItem('draft'), '{invalid');
});

test('recent choices persist separately for URL and memo inputs and archived choices fall back', () => {
  const storage = memoryStorage();
  const templates = loadTemplates(storage);
  rememberTemplate(storage, 'research', 'research-keyword');
  rememberTemplate(storage, 'free', 'idea-outline');
  const recent = readRecentTemplates(storage);
  assert.equal(preferredTemplateId('research', recent, templates), 'research-keyword');
  assert.equal(preferredTemplateId('free', recent, templates), 'idea-outline');
  assert.equal(
    preferredTemplateId(
      'free',
      recent,
      templates.map((item) => ({ ...item, archived: item.id === 'idea-outline' })),
    ),
    'direct',
  );
  assert.equal(
    preferredTemplateId(
      'research',
      recent,
      templates.map((item) => ({ ...item, archived: item.id === 'research-keyword' })),
    ),
    'research-brief',
  );
});
