import type { AiJob } from './types';

const firstHeading = /^(?:[ \t]*\r?\n)* {0,3}#[ \t]+([^\r\n]+)(?:\r?\n|$)/;

export function suggestedAiPageTitle(job: AiJob): string {
  const heading = job.result?.markdown.match(firstHeading)?.[1];
  return (heading?.trim() || `${job.request.template?.name || 'AI 정리'} 결과`).slice(0, 160);
}

export function aiPageMarkdown(job: AiJob, pageTitle?: string): string {
  if (!job.result) throw new Error('완료된 AI 결과를 선택해 주세요.');
  let markdown = job.result.markdown;
  if (firstHeading.test(markdown) && pageTitle && pageTitle === suggestedAiPageTitle(job))
    markdown = markdown.replace(firstHeading, '').replace(/^(?:[ \t]*\r?\n)+/, '');
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
