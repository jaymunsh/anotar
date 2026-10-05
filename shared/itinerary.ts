export type ItineraryEntry = {
  id: string;
  date: string;
  start: string;
  end?: string;
  title: string;
  place?: string;
  latitude?: number;
  longitude?: number;
  url?: string;
  note?: string;
  category?: ItineraryCategory;
};
export const itineraryCategories = {
  sightseeing: '관광',
  travel: '이동',
  meal: '식사',
  rest: '휴식',
  stay: '숙박',
  other: '기타',
} as const;
export type ItineraryCategory = keyof typeof itineraryCategories;
export type Itinerary = {
  version: 1;
  title: string;
  timezone: 'Asia/Seoul';
  entries: ItineraryEntry[];
};
const fail = (message: string): never => {
  throw new Error(message);
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
function text(v: unknown, max: number, name: string, optional = false): string {
  if (optional && v === undefined) return '';
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
    fail(`${name}을 확인해 주세요.`);
  return (v as string).trim();
}
export function cleanItinerary(value: unknown): Itinerary {
  if (typeof value === 'string') {
    if (value.length > 50000) fail('일정 자료가 너무 커요.');
    try {
      value = JSON.parse(value);
    } catch {
      fail('일정 자료를 읽을 수 없어요.');
    }
  }
  if (
    !record(value) ||
    value.version !== 1 ||
    value.timezone !== 'Asia/Seoul' ||
    !Array.isArray(value.entries) ||
    value.entries.length > 50 ||
    Object.keys(value).some((k) => !['version', 'title', 'timezone', 'entries'].includes(k))
  )
    fail('일정 형식이 올바르지 않아요.');
  const input = value as Record<string, any>;
  const title = text(input.title, 160, '일정 이름');
  const ids = new Set<string>();
  const entries: ItineraryEntry[] = input.entries.map((raw: unknown) => {
    if (
      !record(raw) ||
      Object.keys(raw).some(
        (k) =>
          ![
            'id',
            'date',
            'start',
            'end',
            'title',
            'place',
            'latitude',
            'longitude',
            'url',
            'note',
            'category',
          ].includes(k),
      )
    )
      fail('일정 항목이 올바르지 않아요.');
    const item = raw as Record<string, any>;
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id))
      fail('일정 항목 ID가 올바르지 않아요.');
    ids.add(item.id);
    const date = text(item.date, 10, '일정 날짜');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      fail('일정 날짜를 확인해 주세요.');
    const start = text(item.start, 5, '시작 시간');
    const end = text(item.end, 5, '끝 시간', true);
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      (end && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end < start))
    )
      fail('시작·끝 시간을 확인해 주세요.');
    const title = text(item.title, 160, '일정 내용');
    if (!title) fail('일정 내용을 적어 주세요.');
    const result: ItineraryEntry = { id: item.id, date, start, title };
    if (item.category !== undefined) {
      if (typeof item.category !== 'string' || !Object.hasOwn(itineraryCategories, item.category))
        fail('활동 유형을 확인해 주세요.');
      result.category = item.category;
    }
    if (end) result.end = end;
    for (const key of ['place', 'note'] as const) {
      const val = text(
        item[key],
        key === 'note' ? 1000 : 160,
        key === 'note' ? '메모' : '장소',
        true,
      );
      if (val) result[key] = val;
    }
    if (item.latitude !== undefined || item.longitude !== undefined) {
      if (
        typeof item.latitude !== 'number' ||
        !Number.isFinite(item.latitude) ||
        Math.abs(item.latitude) > 90 ||
        typeof item.longitude !== 'number' ||
        !Number.isFinite(item.longitude) ||
        Math.abs(item.longitude) > 180
      )
        fail('위도·경도를 함께 확인해 주세요.');
      result.latitude = item.latitude;
      result.longitude = item.longitude;
    }
    const url = text(item.url, 2048, '링크', true);
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        fail('HTTP 링크를 입력해 주세요.');
      }
      if (
        !/^https?:\/\//i.test(url) ||
        /\s/.test(url) ||
        !['http:', 'https:'].includes(parsed!.protocol) ||
        parsed!.username ||
        parsed!.password
      )
        fail('HTTP 링크를 입력해 주세요.');
      result.url = url;
    }
    return result;
  });
  const result: Itinerary = { version: 1, title, timezone: 'Asia/Seoul', entries };
  if (JSON.stringify(result).length > 50000) fail('일정 자료가 너무 커요.');
  return result;
}
export function itineraryPlaceUrl(entry: ItineraryEntry): string | null {
  const query = entry.latitude !== undefined ? `${entry.latitude},${entry.longitude}` : entry.place;
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}
export function itineraryRelatedUrl(entry: ItineraryEntry): string | null {
  if (!entry.url) return null;
  const map = itineraryPlaceUrl(entry);
  if (!map) return entry.url;
  const normalize = (input: string) => {
    const url = new URL(input);
    url.searchParams.sort();
    url.search = url.searchParams.toString();
    return url.href;
  };
  return normalize(entry.url) === normalize(map) ? null : entry.url;
}
export function itineraryVisitNumbers(entries: ItineraryEntry[]): Map<string, number> {
  let number = 0;
  return new Map(
    entries
      .filter(
        (entry) =>
          entry.category !== 'travel' &&
          (!entry.category || entry.place || entry.latitude !== undefined),
      )
      .map((entry) => [entry.id, ++number]),
  );
}

export type ItineraryRoute = { date: string; numbers: number[]; url: string };
/** External Maps URLs only. Three waypoints also work in mobile browsers. */
export function itineraryRoutes(entries: ItineraryEntry[]): ItineraryRoute[] {
  const numbers = itineraryVisitNumbers(entries);
  const days = new Map<string, ItineraryEntry[]>();
  for (const entry of entries) {
    if (entry.category === 'travel' || !itineraryPlaceUrl(entry)) continue;
    const stops = days.get(entry.date) || [];
    stops.push(entry);
    days.set(entry.date, stops);
  }
  const query = (entry: ItineraryEntry) =>
    entry.latitude !== undefined ? `${entry.latitude},${entry.longitude}` : entry.place!;
  const routes: ItineraryRoute[] = [];
  for (const [date, stops] of days) {
    for (let start = 0; start < stops.length - 1;) {
      let end = Math.min(start + 5, stops.length);
      let url = '';
      while (end > start + 1) {
        const segment = stops.slice(start, end);
        const params = new URLSearchParams({
          api: '1',
          origin: query(segment[0]),
          destination: query(segment.at(-1)!),
        });
        if (segment.length > 2) params.set('waypoints', segment.slice(1, -1).map(query).join('|'));
        url = `https://www.google.com/maps/dir/?${params}`;
        if (url.length <= 2048) break;
        end--;
      }
      if (end <= start + 1) {
        start++;
        continue;
      }
      routes.push({
        date,
        numbers: stops.slice(start, end).map((entry) => numbers.get(entry.id)!),
        url,
      });
      start = end - 1;
    }
  }
  return routes;
}
export function itineraryDuration(entry: ItineraryEntry): string {
  if (!entry.end) return '';
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const length = minutes(entry.end) - minutes(entry.start);
  if (length < 0) return '';
  const hours = Math.floor(length / 60),
    rest = length % 60;
  return [hours ? `${hours}시간` : '', rest || !hours ? `${rest}분` : ''].filter(Boolean).join(' ');
}
export function itineraryOverlaps(entries: ItineraryEntry[]): Set<string> {
  const overlaps = new Set<string>();
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i],
        b = entries[j];
      if (
        a.end &&
        b.end &&
        a.end > a.start &&
        b.end > b.start &&
        a.date === b.date &&
        a.start < b.end &&
        b.start < a.end
      ) {
        overlaps.add(a.id);
        overlaps.add(b.id);
      }
    }
  return overlaps;
}
const cell = (text: string) => text.replace(/[\\|\[\]<>]/g, (c) => '\\' + c).replace(/\r?\n/g, ' ');
export function itineraryMarkdown(value: unknown): string {
  const data = cleanItinerary(value);
  const rows = data.entries.map(
    (e) =>
      `| ${e.date} | ${e.start}${e.end ? '–' + e.end : ''} | ${itineraryDuration(e)} | ${e.category ? itineraryCategories[e.category] : ''} | ${cell(e.title)} | ${cell(e.place || '')} | ${cell(e.note || '')} |`,
  );
  const links = data.entries.flatMap((e) => {
    const map = itineraryPlaceUrl(e);
    const related = itineraryRelatedUrl(e);
    return [
      map ? `- ${cell(e.title)} · [지도](${map})` : null,
      related
        ? `- ${cell(e.title)} · [관련 링크](${related.replace(/[()]/g, (c) => encodeURIComponent(c))})`
        : null,
    ].filter(Boolean);
  });
  return `### ${cell(data.title || '일정')}\n\n한국시간 (Asia/Seoul)\n\n| 날짜 | 시간 | 소요시간 | 활동 | 일정 | 장소 | 메모 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}${links.length ? '\n\n' + links.join('\n') : ''}`;
}
export function itinerarySample(): Itinerary {
  return {
    version: 1,
    title: '서울, 천천히 걷는 토요일',
    timezone: 'Asia/Seoul',
    entries: [
      {
        id: 'walk-1',
        date: '2026-10-03',
        start: '09:30',
        end: '10:00',
        title: '경복궁역에서 만나기',
        place: '경복궁역 3번 출구',
        latitude: 37.5759,
        longitude: 126.9734,
        note: '커피와 물을 준비하고 출발해요.',
      },
      {
        id: 'walk-2',
        date: '2026-10-03',
        start: '10:10',
        end: '11:30',
        title: '서촌 골목 산책',
        place: '통인시장',
        latitude: 37.5808,
        longitude: 126.9699,
        note: '식사는 현장에서 골라요. 영업일은 방문 전 확인해요.',
      },
      {
        id: 'walk-3',
        date: '2026-10-03',
        start: '13:00',
        end: '14:00',
        title: '공원에서 잠시 쉬기',
        place: '청운효자동 일대',
        latitude: 37.5871,
        longitude: 126.969,
        note: '날씨가 좋으면 느긋하게 걸어요. 비가 오면 실내에서 쉬기.',
      },
      {
        id: 'walk-4',
        date: '2026-10-03',
        start: '15:00',
        title: '다음 약속 정하고 마무리',
        place: '경복궁역',
        latitude: 37.5759,
        longitude: 126.9734,
        note: '지도의 선은 방문 순서를 보여줘요. 이동 시간은 별도로 확인해요.',
      },
    ],
  };
}

export function itineraryNextSlot(
  entries: Pick<ItineraryEntry, 'date' | 'start' | 'end'>[],
  fallbackDate: string,
) {
  const last = entries.at(-1);
  return { date: last?.date || fallbackDate, start: last?.end || last?.start || '09:00' };
}
