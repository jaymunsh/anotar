export type DocumentBlueprintInputs = { title?: string; startDate?: string; days?: number };
export type DocumentBlueprintPayload = {
  title: string;
  icon: string;
  document: { schemaVersion: 1; blocks: BlueprintBlock[] };
};
type BlueprintBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: { type: 'text'; text: string; styles: Record<string, never> }[];
  children: BlueprintBlock[];
};
const commonInstructions = [
  '빈칸과 작성 안내는 사실이 아니다. 제공된 자료로만 채우고 모르는 내용은 미확인으로 남긴다.',
  '사실·해석·미확인을 구분하고 외부 사실에는 확인 가능한 출처와 확인 날짜를 남긴다.',
  '원본 메모와 페이지를 바꾸지 않는다. 블록 ID는 새로 만들고 기존 문서를 수정할 때는 버전을 확인한다.',
];
const allDocumentBlueprints = [
  {
    id: 'research',
    title: '리서치 노트',
    icon: '🔎',
    description: '질문에서 시작해 근거와 결론을 정리해요.',
    version: 1,
    instructions: [
      ...commonInstructions,
      '핵심 질문에 먼저 답하고 근거, 반대 근거, 남은 질문을 분리한다. 출처 없는 주장을 결론으로 확정하지 않는다.',
    ],
  },
  {
    id: 'travel',
    title: '여행 계획',
    icon: '🧳',
    description: '여행 개요, 날짜별 메모와 일정표를 준비해요.',
    version: 1,
    instructions: [
      ...commonInstructions,
      '확인된 날짜·시간·장소만 일정표에 넣는다. 예약·요금·좌표·이동 소요시간을 추측하지 않는다.',
      '날짜별로 이동과 방문을 구분하고 제목은 짧게, 장소와 시간은 전용 필드에 쓴다. 메모에는 반복 없이 필요한 안내를 모두 남긴다.',
      '일정 스키마의 timezone은 Asia/Seoul 고정이다. 해외 현지 시각을 쓰면 문서에 기준을 명시하고 시간대를 자동 변환했다고 주장하지 않는다.',
      '예약은 미예약·확인 필요·확정으로 구분하며 확정 근거가 있을 때만 확정으로 표시한다.',
      '각 날짜의 일정 블록에 그날의 이동·방문을 모은다. 예산은 예상과 실제 지출을 구분하고 통화와 확인 근거를 남긴다.',
      '준비물은 실제 준비한 항목만 완료로 표시한다. 비상 연락처와 대안은 확인 후 기록하고 공유 전 예약번호·개인 연락처 등 민감한 내용을 검토한다.',
    ],
  },
  {
    id: 'meeting',
    title: '회의 기록',
    icon: '📝',
    description: '논의, 결정과 다음 행동을 따로 남겨요.',
    version: 1,
    instructions: [
      ...commonInstructions,
      '논의 중인 제안과 합의된 결정을 구분한다. 담당자·기한은 확인된 경우에만 기록한다.',
    ],
  },
  {
    id: 'development',
    title: '개발 기록',
    icon: '🛠️',
    description: '문제와 변경, 검증 결과를 이어서 기록해요.',
    version: 1,
    instructions: [
      ...commonInstructions,
      '재현 조건, 변경 이유, 실제 실행한 검증과 결과를 남긴다. 실행하지 않은 테스트를 통과로 표시하지 않는다.',
    ],
  },
] as const;

// Retired travel templates remain readable for existing agents and saved documents.
// Only active templates are offered when creating a new anotar page.
export const documentBlueprints = allDocumentBlueprints.filter((item) => item.id !== 'travel');
export const legacyDocumentBlueprints = allDocumentBlueprints.filter((item) => item.id === 'travel');

const block = (type: string, text = '', props: Record<string, unknown> = {}): BlueprintBlock => ({
  id: crypto.randomUUID(),
  type,
  props,
  ...(type === 'itinerary'
    ? {}
    : { content: text ? [{ type: 'text' as const, text, styles: {} }] : [] }),
  children: [],
});
const section = (title: string, prompt: string) => [
  block('heading', title, { level: 2 }),
  block('paragraph', prompt),
];

export function buildDocumentBlueprint(
  id: string,
  inputs: DocumentBlueprintInputs = {},
): DocumentBlueprintPayload {
  const blueprint = allDocumentBlueprints.find((item) => item.id === id);
  if (!blueprint) throw new Error('문서 템플릿을 찾을 수 없어요.');
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
    throw new Error('템플릿 입력을 확인해 주세요.');
  if (
    inputs.title !== undefined &&
    (typeof inputs.title !== 'string' ||
      inputs.title.trim().length > 160 ||
      /[\u0000-\u001f]/.test(inputs.title))
  )
    throw new Error('제목은 줄바꿈 없이 160자까지 입력해 주세요.');
  const title = inputs.title?.trim() || blueprint.title;
  let blocks: BlueprintBlock[];
  if (id === 'travel') {
    const days = inputs.days ?? 3;
    if (!Number.isInteger(days) || days < 1 || days > 14)
      throw new Error('여행 기간은 1일부터 14일까지 입력해 주세요.');
    const date = inputs.startDate;
    let start: Date | undefined;
    if (date !== undefined && date !== '') {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('시작 날짜를 확인해 주세요.');
      start = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date)
        throw new Error('시작 날짜를 확인해 주세요.');
      const last = new Date(start.getTime() + (days - 1) * 86400000);
      if (last.getUTCFullYear() > 9999)
        throw new Error('여행 마지막 날짜는 9999년을 넘을 수 없어요.');
    }
    blocks = [
      ...section(
        '여행 개요',
        '목적지 · 동행 · 여행 목적을 적어 주세요. 날짜와 현지 시각 기준도 확인해 주세요.',
      ),
      ...section(
        '먼저 확인할 것',
        '교통 · 숙소 · 예산 · 예약 상태를 확인해 주세요. 아직 확인하지 않은 내용은 미확인으로 남겨 주세요.',
      ),
      ...Array.from({ length: days }, (_, index) => {
        const dayTitle = start
          ? `${index + 1}일차 · ${new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)}`
          : `${index + 1}일차 · 날짜 미정`;
        return [
          ...section(
            dayTitle,
            '이날의 지역과 우선순위를 적어 주세요. 아래 일정표에 확인한 시간·장소와 필요한 안내를 추가해 주세요.',
          ),
          block('itinerary', '', {
            data: JSON.stringify({
              version: 1,
              title: dayTitle,
              timezone: 'Asia/Seoul',
              entries: [],
            }),
          }),
        ];
      }).flat(),
      ...section(
        '예약과 교통',
        '교통·숙소별 예약 상태(미예약 / 확인 필요 / 확정), 확인 링크와 취소 조건을 적어 주세요. 환승·승차 장소와 마지막 교통편도 확인해 주세요.',
      ),
      ...section(
        '예산',
        '통화와 기준을 먼저 적고 교통 · 숙박 · 식비 · 입장료 · 예비비를 나눠 주세요. 예상 금액과 실제 지출을 구분하고 미확인 금액은 비워 두세요.',
      ),
      block('heading', '준비물 체크리스트', { level: 2 }),
      block('checkListItem', '필요한 서류·예약 내역 확인', { checked: false }),
      block('checkListItem', '통신·결제 수단 준비', { checked: false }),
      block('checkListItem', '날씨·복장·개인 준비물 확인', { checked: false }),
      ...section(
        '비상 연락과 대안',
        '확인한 비상 연락처와 숙소 연락 방법을 적어 주세요. 악천후·운휴·지연 시 대안과 합류 방법도 남겨 주세요.',
      ),
      ...section(
        '공유 전 확인',
        '동행에게 필요한 안내가 빠지지 않았는지 확인하고 예약번호·개인 연락처 등 공개하면 안 되는 정보를 검토해 주세요.',
      ),
      ...section(
        '출처와 확인 날짜',
        '교통·영업시간·요금 등을 확인한 링크와 확인 날짜를 남겨 주세요.',
      ),
    ];
  } else {
    const sections =
      id === 'research'
        ? [
            ['핵심 질문', '무엇을 알아보려는지, 범위와 기준을 적어 주세요.'],
            ['요약과 결론', '자료를 확인한 뒤 핵심 답변과 확신의 정도를 적어 주세요.'],
            ['근거와 발견', '확인한 사실, 해석, 반대 근거를 구분해 적어 주세요.'],
            ['남은 질문', '확인하지 못한 점과 다음 조사 방향을 적어 주세요.'],
            ['출처', '자료 제목 · 링크 · 확인 날짜를 남겨 주세요.'],
          ]
        : id === 'meeting'
          ? [
              ['회의 개요', '일시 · 참석자 · 목적을 적어 주세요.'],
              ['안건과 논의', '안건별 핵심 논점과 제안을 적어 주세요.'],
              ['결정 사항', '실제로 합의한 내용과 그 이유를 적어 주세요.'],
              ['다음 행동', '할 일 · 확인된 담당자 · 합의한 기한을 적어 주세요.'],
              ['남은 논의', '보류한 안건과 확인할 내용을 적어 주세요.'],
            ]
          : [
              ['문제와 목표', '문제가 나타나는 조건과 기대 동작을 적어 주세요.'],
              ['접근과 변경', '원인, 선택한 방법과 변경 이유를 적어 주세요.'],
              ['검증 결과', '실행한 명령이나 시나리오, 실제 결과를 적어 주세요.'],
              ['남은 과제', '확인하지 못한 범위와 다음 작업을 적어 주세요.'],
              ['참고 자료', '관련 문서 · 이슈 · 변경 기록 링크를 남겨 주세요.'],
            ];
    blocks = sections.flatMap(([heading, prompt]) => section(heading, prompt));
  }
  return { title, icon: blueprint.icon, document: { schemaVersion: 1, blocks } };
}
