import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';

const dataDir = resolve(
  process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)),
);
const text = (value, styles = {}) => ({ type: 'text', text: value, styles });
const block = (type, content = [], props = {}) => ({
  id: randomUUID(),
  type,
  props,
  content,
  children: [],
});
const cell = (value, header = false) => [text(value, header ? { bold: true } : {})];
const row = (values, header = false) => ({ cells: values.map((value) => cell(value, header)) });

const document = {
  schemaVersion: 1,
  blocks: [
    block('paragraph', [
      text(
        '날짜 미정 · 3일 · 느긋한 동선으로 걷고 쉬는 교토 여행. 이 페이지는 일정·장소·준비물을 함께 공유하는 예시입니다.',
      ),
    ]),
    block('heading', [text('한눈에 보는 일정')], { level: 2 }),
    block('table', {
      type: 'tableContent',
      rows: [
        row(['날', '오전', '점심·오후', '저녁'], true),
        row(['1일차', '교토역 도착 · 짐 맡기기', '기온 골목 산책 · 카페', '야사카 신사 주변 식사']),
        row(['2일차', '철학의 길 걷기', '긴카쿠지 · 점심 · 휴식', '가모가와 산책']),
        row(['3일차', '숙소 체크아웃', '니시키 시장 · 기념품', '교토역 이동']),
      ],
    }),
    block('heading', [text('시간표 · 2일차')], { level: 2 }),
    block('table', {
      type: 'tableContent',
      rows: [
        row(['시간', '할 일', '장소·메모'], true),
        row(['09:00–10:30', '철학의 길 산책', '북쪽에서 남쪽으로 천천히 걷기']),
        row(['10:30–12:00', '긴카쿠지 방문', '운영 시간은 출발 전에 확인']),
        row(['12:00–13:30', '점심', '붐비면 근처 대안 식당으로 변경']),
        row(['13:30–16:00', '자유 시간', '카페 또는 숙소 휴식']),
      ],
    }),
    block('heading', [text('장소 지도')], { level: 2 }),
    block('paragraph', [
      text(
        '지도 블록은 장소 이름과 좌표를 직접 바꿀 수 있습니다. 공유 링크에서는 펼쳐서 볼 수 있어요.',
      ),
    ]),
    block('map', [], {
      latitude: 35.0037,
      longitude: 135.7788,
      zoom: 15,
      label: '철학의 길 · 산책 시작점',
    }),
    block('map', [], { latitude: 35.0033, longitude: 135.7846, zoom: 16, label: '긴카쿠지' }),
    block('heading', [text('출발 전 확인')], { level: 2 }),
    block('checkListItem', [text('숙소 예약 시간과 체크인 방법 확인')], { checked: false }),
    block('checkListItem', [text('교통편과 귀가 시간 다시 확인')], { checked: false }),
    block('checkListItem', [text('비가 오면 야외 일정을 카페·박물관으로 변경')], {
      checked: false,
    }),
    block('quote', [text('공유할 때는 예약번호와 개인 연락처를 이 페이지에 적지 않습니다.')]),
  ],
};

const store = openStore(dataDir);
try {
  const page = store.ensureSamplePage({
    key: 'itinerary.kyoto-3-days',
    title: '교토 3일 여행 계획 · 공유 예시',
    icon: '🗺️',
    document,
  });
  console.log(`일정 예시 페이지: http://127.0.0.1:5173/pages/${page.id}`);
} finally {
  store.close();
}
