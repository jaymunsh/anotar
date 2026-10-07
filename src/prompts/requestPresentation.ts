import type { PromptTemplate } from '../../shared/prompts';

export function quickRequestTemplates(
  templates: PromptTemplate[], selectedId: string,
  recent: { research?: string; free?: string } = {},
): PromptTemplate[] {
  const active = templates.filter(t => !t.archived);
  const ids = [selectedId, recent.research, recent.free, 'research-keyword', 'research-brief', 'idea-outline', ...active.map(t => t.id)];
  return [...new Set(ids)].flatMap(id => {
    const found = active.find(t => t.id === id);
    return found ? [found] : [];
  }).slice(0, 3);
}

export function templatePresentation(template: Pick<PromptTemplate, 'kind' | 'body' | 'description'>) {
  const urlInput = /\{\{\s*url\s*\}\}/.test(template.body);
  const outline = [...template.body.matchAll(/^#{1,4}\s+(.+)$/gm)].map(m => m[1].trim()).slice(0, 4);
  return {
    inputLabel: template.kind === 'research' ? (urlInput ? 'URL · 함께 남긴 메모' : '주제 · 조사 조건') : '글 · 메모',
    outline,
    sample: template.kind === 'research'
      ? { url: urlInput ? 'https://example.com/article' : '', content: 'SQLite와 PostgreSQL의 차이를 개인 프로젝트 관점에서 조사해 주세요. 공식 문서와 운영상의 한계를 함께 확인하고 싶어요.' }
      : { url: '', content: '자료를 메모로 모았지만 아직 정리하지 못했어요. 이번 주에는 자료 세 개를 읽고, 공통 주제와 다음에 할 일을 정리하려고 해요. 정리 결과는 지인에게 공유할 예정이에요.' },
  };
}
