import type { AiJob } from './types';
import { Lexer } from 'marked';

function resultHeading(markdown: string) {
  // Top-level tokens exclude heading-like text inside code or quoted source material.
  let offset = 0;
  for (const token of Lexer.lex(markdown)) {
    if (token.type === 'heading' && token.text.trim()) return { token, offset };
    offset += token.raw.length;
  }
  return null;
}
function originalOffset(markdown: string, normalizedOffset: number) {
  let original = 0;
  for (
    let normalized = 0;
    normalized < normalizedOffset && original < markdown.length;
    normalized++
  ) {
    original += markdown[original] === '\r' && markdown[original + 1] === '\n' ? 2 : 1;
  }
  return original;
}

export function suggestedAiPageTitle(job: AiJob): string {
  // Use the saved request topic shown in the activity list, not a result section heading.
  const topic = (
    job.sourceTitle?.trim() ||
    job.request.input?.content.trim() ||
    job.request.input?.url.trim() ||
    '저장된 요청'
  ).replace(/\s+/g, ' ');
  const suffix = ' · AI 요청 결과';
  return topic.slice(0, 160 - suffix.length).trimEnd() + suffix;
}

export function aiPageMarkdown(job: AiJob, pageTitle?: string): string {
  if (!job.result) throw new Error('완료된 AI 결과를 선택해 주세요.');
  let markdown = job.result.markdown;
  const heading = resultHeading(markdown);
  if (heading && pageTitle && pageTitle === heading.token.text.trim()) {
    const start = originalOffset(markdown, heading.offset);
    const end = originalOffset(markdown, heading.offset + heading.token.raw.length);
    markdown = (markdown.slice(0, start) + markdown.slice(end)).replace(/^(?:[ \t]*\r?\n)+/, '');
  }
  if (job.result.sources.length) {
    const escape = (text: string) =>
      text.replace(/[\\\[\]<>\n\r]/g, (character) =>
        character === '\n' || character === '\r' ? ' ' : '\\' + character,
      );
    const links = job.result.sources.map(
      (source) => `- [${escape(source.title)}](<${source.url}>)`,
    );
    markdown += `\n\n## ${job.request.kind === 'research' ? '확인한 출처' : '참고 링크'}\n\n${links.join('\n')}`;
  }
  return markdown;
}
