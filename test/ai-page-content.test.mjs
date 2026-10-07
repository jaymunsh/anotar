import test from 'node:test';
import assert from 'node:assert/strict';
import { aiPageMarkdown, suggestedAiPageTitle } from '../src/ai/pageContent.ts';

const job = (markdown, sources = []) => ({
  request: { template: { name: '리서치' }, kind: 'research', input: { content: 'Gemini 4 관련', url: '' } },
  result: { markdown, sources },
});

test('an empty Markdown heading never consumes the following paragraph as a page title', () => {
  const input = job('#\n남겨야 하는 본문');
  assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
  assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), input.result.markdown);
});

test('a new page uses its first H1 once, while appending or renaming preserves that heading', () => {
  const input = job('# 교토 여행\r\n\r\n**여행 기준**');
  assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
  assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), input.result.markdown);
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
    assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
    assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), markdown);
  }
  for (const [markdown, body] of [
    ['# Document\n\n    const value = 1;', '    const value = 1;'],
    ['# Document\r\n\r\n\tconst value = 1;', '\tconst value = 1;'],
    [' \t\r\n   # Document\r\n\r\n    const value = 1;', '    const value = 1;'],
  ]) {
    const input = job(markdown);
    assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
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

test('a collection notice before the title does not produce a generic template title', () => {
  const input = job('> 수집 안내: 자료 3개\n\n# 출시 안내\n\n전체 본문');
  assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
  const exported = aiPageMarkdown(input, '출시 안내');
  assert.match(exported, /> 수집 안내: 자료 3개/);
  assert.match(exported, /전체 본문/);
  assert.ok(!exported.includes('# 출시 안내'));
});

test('title extraction ignores headings inside fenced code and quoted source material', () => {
  const input = job('```md\n# 코드 안 제목\n```\n\n> # 인용 제목\n\n## 실제 결과 제목\n\n본문');
  assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
  assert.match(aiPageMarkdown(input, '실제 결과 제목'), /# 코드 안 제목/);
  assert.match(aiPageMarkdown(input, '실제 결과 제목'), /> # 인용 제목/);
});

test('the activity topic supplies the editable page title, never a generic result section', () => {
  const input = job('## 핵심 요약\n\n전체 결과');
  assert.equal(suggestedAiPageTitle(input), 'Gemini 4 관련 · AI 요청 결과');
  assert.equal(aiPageMarkdown(input, suggestedAiPageTitle(input)), input.result.markdown);
  input.sourceTitle = '프로젝트 안내';
  assert.equal(suggestedAiPageTitle(input), '프로젝트 안내 · AI 요청 결과');
});

test('title fallback and length limits keep the result suffix intact', () => {
  const input = job('# 핵심 요약\n\n본문');
  input.request.input.content = '';
  input.request.input.url = 'https://example.com/topic';
  assert.equal(suggestedAiPageTitle(input), 'https://example.com/topic · AI 요청 결과');
  input.request.input.url = '';
  assert.equal(suggestedAiPageTitle(input), '저장된 요청 · AI 요청 결과');
  input.request.input.content = '긴 주제 '.repeat(100);
  const title = suggestedAiPageTitle(input);
  assert.ok(title.length <= 160);
  assert.ok(title.endsWith(' · AI 요청 결과'));
});
