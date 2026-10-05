import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';
import { itinerarySample } from '../shared/itinerary.ts';
const store = openStore(
  resolve(process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url))),
);
const paragraph = (text) => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
try {
  const page = store.ensureSamplePage({
    key: 'connected-seoul-plan-v1',
    title: '서울, 천천히 걷는 토요일',
    icon: '🌿',
    document: {
      schemaVersion: 1,
      blocks: [
        paragraph(
          '2026년 10월 3일 · 서울 서촌 · 함께 걷고 쉬는 하루. 아래 시간표에서 일정을 누르면 지도에서 장소가 강조돼요.',
        ),
        {
          id: randomUUID(),
          type: 'itinerary',
          props: { data: JSON.stringify(itinerarySample()) },
          children: [],
        },
        {
          id: randomUUID(),
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'text', text: '출발 전 함께 확인', styles: {} }],
          children: [],
        },
        {
          id: randomUUID(),
          type: 'checkListItem',
          props: { checked: false },
          content: [
            {
              type: 'text',
              text: '날씨·장소 영업 시간 확인하고 필요하면 실내 일정으로 변경',
              styles: {},
            },
          ],
          children: [],
        },
        paragraph(
          '지도는 장소를 선택해 펼칠 때만 불러옵니다. 점선은 방문 순서이고 실제 도보 경로는 아니에요. 날짜와 시간을 수정하거나 이 페이지를 템플릿으로 저장해서 다음 계획에 재사용할 수 있어요.',
        ),
      ],
    },
  });
  console.log(`연결된 일정 페이지: /pages/${page.id}`);
} finally {
  store.close();
}
