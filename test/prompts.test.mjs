import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTemplates,
  persistTemplate,
  renderPrompt,
  buildRequest,
  PROMPT_STORAGE_KEY,
} from '../src/prompts/templates.ts';
import { defaultTemplates } from '../shared/prompts.ts';

test('keyword research template accepts a topic without a missing URL and preserves the topic in preview', () => {
  const keyword = defaultTemplates().find((item) => item.id === 'research-keyword');
  assert.ok(keyword, 'keyword research must be selectable');
  assert.equal(keyword.kind, 'research');
  const result = buildRequest(
    keyword,
    { url: '', content: 'N100 SQLite FTS5 장단점' },
    '공식 자료 우선',
  );
  assert.deepEqual(result.missing, []);
  assert.match(result.text, /N100 SQLite FTS5 장단점/);
  assert.match(result.text, /공식 자료 우선/);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('direct requests preserve a URL already in the memo without duplicating it', () => {
  const content = '이 자료를 읽어 주세요: https://example.com/article';
  assert.equal(
    buildRequest(undefined, { content, url: 'https://example.com/article' }, '').text,
    content,
  );
  assert.equal(
    buildRequest(
      undefined,
      { content: '자료를 정리해 주세요.', url: 'https://example.com/article' },
      '세 줄로',
    ).text,
    '자료를 정리해 주세요.\n\nhttps://example.com/article\n\n추가 요청:\n세 줄로',
  );
});

test('prompt substitution is one pass and unsupported variables are rejected', () => {
  const result = renderPrompt('URL: {{ url }}\n메모: {{content}} / {{memo}}', {
    url: 'https://example.com/article',
    content: '본문 안의 {{url}}은 원문이다. $&',
  });
  assert.equal(
    result.text,
    'URL: https://example.com/article\n메모: 본문 안의 {{url}}은 원문이다. $& / 본문 안의 {{url}}은 원문이다. $&',
  );
  assert.deepEqual(result.missing, []);
  assert.deepEqual(renderPrompt('{{url}}', { url: '', content: '' }).missing, ['url']);
  assert.throws(() => renderPrompt('{{secret}}', { url: '', content: '' }), /secret/);
});

test('template edits, duplication and archives survive reload without reviving archived defaults', () => {
  const storage = memoryStorage();
  const initial = loadTemplates(storage);
  assert.equal(initial.length, 4);
  const first = initial[0];
  const edited = persistTemplate(storage, {
    ...first,
    body: '자료: {{url}}',
    expectedVersion: first.version,
  });
  assert.equal(edited.version, 2);
  const duplicate = persistTemplate(storage, {
    ...edited,
    id: undefined,
    name: '리서치 복사본',
    expectedVersion: undefined,
  });
  assert.notEqual(duplicate.id, edited.id);
  assert.equal(duplicate.version, 1);
  for (const item of loadTemplates(storage)) {
    persistTemplate(storage, { ...item, archived: true, expectedVersion: item.version });
  }
  assert.equal(loadTemplates(storage).filter((item) => !item.archived).length, 0);
  const archived = loadTemplates(storage)[0];
  persistTemplate(storage, { ...archived, archived: false, expectedVersion: archived.version });
  assert.equal(loadTemplates(storage).filter((item) => !item.archived).length, 1);
});

test('stale template edits cannot overwrite the newest body', () => {
  const storage = memoryStorage();
  const first = loadTemplates(storage)[0];
  persistTemplate(storage, { ...first, body: '새 내용', expectedVersion: first.version });
  assert.throws(
    () => persistTemplate(storage, { ...first, body: '늦은 내용', expectedVersion: first.version }),
    /다른 탭/,
  );
  assert.equal(loadTemplates(storage)[0].body, '새 내용');
});

test('invalid templates and storage failures are surfaced without replacing stored data', () => {
  const storage = memoryStorage();
  const first = loadTemplates(storage)[0];
  assert.throws(() => persistTemplate(storage, { ...first, name: '', expectedVersion: 1 }), /이름/);
  assert.throws(
    () => persistTemplate(storage, { ...first, body: '{{unknown}}', expectedVersion: 1 }),
    /unknown/,
  );
  assert.throws(
    () =>
      persistTemplate(
        {
          ...storage,
          setItem: () => {
            throw new Error('quota');
          },
        },
        { ...first, expectedVersion: 1 },
      ),
    /브라우저/,
  );
  storage.setItem(PROMPT_STORAGE_KEY, '{bad json');
  assert.throws(() => loadTemplates(storage), /읽지 못/);
  assert.throws(() => persistTemplate(storage, { ...first, expectedVersion: 1 }), /읽지 못/);
  assert.equal(storage.getItem(PROMPT_STORAGE_KEY), '{bad json');
});
