import test from 'node:test';
import assert from 'node:assert/strict';
import { aiPageMarkdown, suggestedAiPageTitle } from '../src/ai/pageContent.ts';

const job = (markdown, sources = []) => ({
  request: { template: { name: '리서치' }, kind: 'research' },
  result: { markdown, sources },
});

test('an empty Markdown heading never consumes the following paragraph as a page title', () => {
  const input = job('#\n남겨야 하는 본문');
  assert.equal(suggestedAiPageTitle(input), '리서치 결과');
  assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), input.result.markdown);
});

test('a new page uses its first H1 once, while appending or renaming preserves that heading', () => {
  const input = job('# 교토 여행\r\n\r\n**여행 기준**');
  assert.equal(suggestedAiPageTitle(input), '교토 여행');
  assert.equal(aiPageMarkdown(input, '교토 여행'), '**여행 기준**');
  assert.equal(aiPageMarkdown(input), input.result.markdown);
  assert.equal(aiPageMarkdown(input, '다른 제목'), input.result.markdown);
});

test('page title extraction preserves indented code before and after a heading', () => {
  for (const markdown of [
    '    # keep this code comment\n    const value = 1;',
    '\t# keep this code comment\n\tconst value = 1;',
    '\n\n    # keep this code comment\n    const value = 1;',
  ]) {
    const input = job(markdown);
    assert.equal(suggestedAiPageTitle(input), '리서치 결과');
    assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), markdown);
  }
  for (const [markdown, body] of [
    ['# Document\n\n    const value = 1;', '    const value = 1;'],
    ['# Document\r\n\r\n\tconst value = 1;', '\tconst value = 1;'],
    [' \t\r\n   # Document\r\n\r\n    const value = 1;', '    const value = 1;'],
  ]) {
    const input = job(markdown);
    assert.equal(suggestedAiPageTitle(input), 'Document');
    assert.equal(aiPageMarkdown(input, 'Document'), body);
  }
});

test('structured source links remain in the exported document without changing the saved result', () => {
  const input = job('## 요약\n\n내용', [
    { title: '자료 [원문]\n안내', url: 'https://example.com/reference' },
  ]);
  const before = structuredClone(input);
  assert.match(aiPageMarkdown(input), /## 확인한 출처/);
  assert.match(aiPageMarkdown(input), /https:\/\/example.com\/reference/);
  assert.ok(aiPageMarkdown(input).includes('자료 \\[원문\\] 안내'));
  assert.deepEqual(input, before);
});
