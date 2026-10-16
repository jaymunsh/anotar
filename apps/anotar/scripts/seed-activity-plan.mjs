import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';
import { cleanItinerary } from '../shared/itinerary.ts';

const googleUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const plan = cleanItinerary({
  version: 1,
  title: '궁에서 미술관, 그리고 골목으로',
  timezone: 'Asia/Seoul',
  entries: [
    {
      id: 'seoul-palace',
      date: '2026-10-03',
      start: '10:00',
      category: 'sightseeing',
      end: '11:20',
      title: '궁 안에서 아침 산책',
      place: '경복궁',
      latitude: 37.5796,
      longitude: 126.977,
      note: '광화문에서 만나 천천히 둘러보기.',
      url: googleUrl(37.5796, 126.977),
    },
    {
      id: 'walk-to-museum',
      date: '2026-10-03',
      start: '11:20',
      end: '11:40',
      category: 'travel',
      title: '미술관으로 걸어가기',
      note: '이동 시간은 계획용이에요. 실제 경로는 Google Maps에서 확인해요.',
    },
    {
      id: 'seoul-museum',
      date: '2026-10-03',
      start: '11:40',
      category: 'sightseeing',
      end: '13:00',
      title: '전시 보고 잠시 쉬기',
      place: '국립현대미술관 서울',
      latitude: 37.5786,
      longitude: 126.9809,
      note: '전시와 입장 가능 시간을 확인하고, 근처에서 점심 먹기.',
      url: googleUrl(37.5786, 126.9809),
    },
    {
      id: 'lunch',
      date: '2026-10-03',
      start: '13:00',
      end: '13:40',
      category: 'meal',
      title: '점심 먹고 쉬기',
      note: '예약 없이 근처에서 골라요.',
    },
    {
      id: 'walk-to-bukchon',
      date: '2026-10-03',
      start: '13:40',
      end: '14:00',
      category: 'travel',
      title: '북촌으로 이동',
      note: '오르막이 있으니 천천히 걸어요.',
    },
    {
      id: 'seoul-bukchon',
      date: '2026-10-03',
      start: '14:00',
      category: 'sightseeing',
      end: '15:00',
      title: '한옥 골목을 따라 걷기',
      place: '북촌 한옥마을',
      latitude: 37.5826,
      longitude: 126.9831,
      note: '주거 구역의 방문 시간과 안내를 확인하고 조용히 걷기.',
      url: googleUrl(37.5826, 126.9831),
    },
    {
      id: 'rest',
      date: '2026-10-03',
      start: '15:00',
      end: '15:30',
      category: 'rest',
      title: '카페에서 오늘 기록 정리',
      note: '사진을 고르고 다음에 다시 가고 싶은 곳을 적어요.',
    },
  ],
});
const paragraph = (text) => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
const store = openStore(
  resolve(process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url))),
);
try {
  const page = store.ensureSamplePage({
    key: 'seoul-activity-image-plan-v1',
    title: '서울 하루 계획 · 관광과 이동',
    icon: '🗺️',
    document: {
      schemaVersion: 1,
      blocks: [
        paragraph(
          '10월 3일 · 경복궁 → 국립현대미술관 서울 → 북촌 한옥마을. 관광·이동·식사·휴식의 시간을 나눈 하루 계획입니다. 공유 화면은 이미지와 장소 링크로 열립니다.',
        ),
        {
          id: randomUUID(),
          type: 'itinerary',
          props: { data: JSON.stringify(plan), assetId: '' },
          children: [],
        },
        paragraph(
          '시간은 계획용이며 장소 좌표는 대표 지점입니다. 출발 전에 운영 시간·관람 제한을 확인하세요. 지도 화살표는 방문 순서이고 실제 도보 경로는 장소의 Google 지도 링크에서 확인합니다.',
        ),
      ],
    },
  });
  console.log(`활동 유형 일정: http://127.0.0.1:5173/pages/${page.id}?map=google`);
} finally {
  store.close();
}
