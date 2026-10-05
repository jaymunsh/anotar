export type PromptKind = 'research' | 'free';
export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  kind: PromptKind;
  body: string;
  archived: boolean;
  version: number;
  revisionId?: string;
};
export type PromptDraft = Omit<PromptTemplate, 'id' | 'version'> & {
  id?: string;
  expectedVersion?: number;
  expectedRevisionId?: string;
};
export const VARIABLE_LABELS: Record<string, string> = {
  url: 'URL',
  content: '메모 내용',
  memo: '메모 내용',
};

export function defaultTemplates(): PromptTemplate[] {
  return [
    {
      id: 'research-brief',
      name: 'URL 리서치',
      description: '핵심 3줄, 근거와 출처, 더 확인할 점',
      kind: 'research',
      body: `다음 URL의 자료를 읽고 한국어로 정리해 주세요.

URL: {{url}}
함께 남긴 메모: {{content}}

## 핵심 요약
가장 중요한 내용을 3줄로 정리해 주세요.

## 근거와 출처
주요 주장과 근거를 구분하고, 확인한 출처 링크를 붙여 주세요.

## 더 확인할 점
추가로 조사할 질문이나 서로 다른 관점을 정리해 주세요.

자료에 접근할 수 없으면 그 사실을 먼저 알려 주세요.
확인하지 못한 내용은 추측해서 채우지 말고 ‘미확인’으로 표시해 주세요.`,
      archived: false,
      version: 1,
    },
    {
      id: 'research-keyword',
      name: '키워드 리서치',
      description: '주제·키워드로 자료를 찾아 핵심 3줄과 출처 정리',
      kind: 'research',
      body: `다음 주제의 관련 자료를 조사하고 한국어로 정리해 주세요.

주제와 조건: {{content}}

## 핵심 요약
가장 중요한 내용을 3줄로 정리해 주세요.

## 근거와 출처
확인한 자료만 사용하고 주요 주장에 출처 링크를 붙여 주세요.
공식·1차 자료를 우선하고 서로 다른 관점이 있으면 구분해 주세요.

## 더 확인할 점
추가 조사할 질문과 자료의 한계를 적어 주세요.
확인하지 못한 사실은 추측해서 채우지 말고 ‘미확인’으로 표시해 주세요.`,
      archived: false,
      version: 1,
    },
    {
      id: 'idea-outline',
      name: '생각 정리',
      description: '메모의 맥락을 살려 차분하게 정리하기',
      kind: 'free',
      body: `아래 메모를 읽고 생각의 흐름을 정리해 주세요.

{{content}}

핵심 생각, 관련 내용, 아직 결정하지 않은 점을 Markdown으로 나눠 주세요.
내가 적지 않은 사실이나 결정을 새로 만들지 마세요.
불분명한 부분은 확인이 필요한 질문으로 남겨 주세요.`,
      archived: false,
      version: 1,
    },
    {
      id: 'travel-outline',
      name: '여행 계획 초안',
      description: '장소와 조건을 묶어 여유 있는 일정 만들기',
      kind: 'free',
      body: `아래 메모를 바탕으로 여행 계획의 초안을 만들어 주세요.

{{content}}

가까운 장소끼리 묶고 이동과 휴식 시간을 충분히 남겨 주세요.
일정, 준비할 것, 확인이 필요한 정보를 Markdown으로 정리해 주세요.
영업시간·예약·가격처럼 달라질 수 있는 정보는 확인이 필요하다고 표시해 주세요.
기간이나 출발지가 없으면 임의로 정하지 말고 먼저 물어봐 주세요.`,
      archived: true,
      version: 1,
    },
  ];
}

export function renderPrompt(body: string, input: { url: string; content: string }) {
  const variables = new Set<string>();
  const missing = new Set<string>();
  const text = body.replace(/\{\{([^{}]+)\}\}/g, (_match, raw: string) => {
    const key = raw.trim();
    if (!Object.hasOwn(VARIABLE_LABELS, key))
      throw new Error(
        `{{${key}}}는 지원하지 않는 변수예요. {{url}} 또는 {{content}}를 사용해 주세요.`,
      );
    variables.add(key);
    const value = key === 'url' ? input.url : input.content;
    if (!value.trim()) missing.add(key);
    return value;
  });
  return { text, variables: [...variables], missing: [...missing] };
}

export function validateDraft(draft: PromptDraft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft))
    throw new Error('템플릿 형식이 올바르지 않아요.');
  if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.trim().length > 80)
    throw new Error('템플릿 이름은 1~80자로 입력해 주세요.');
  if (typeof draft.description !== 'string' || draft.description.length > 200)
    throw new Error('설명은 200자까지 입력할 수 있어요.');
  if (draft.kind !== 'research' && draft.kind !== 'free')
    throw new Error('요청 종류를 선택해 주세요.');
  if (typeof draft.body !== 'string' || !draft.body.trim() || draft.body.length > 10000)
    throw new Error('프롬프트 본문은 1~10,000자로 입력해 주세요.');
  if (typeof draft.archived !== 'boolean') throw new Error('템플릿 상태가 올바르지 않아요.');
  renderPrompt(draft.body, { url: '', content: '' });
}
