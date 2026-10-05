import { itineraryVisitNumbers, type ItineraryEntry } from './itinerary.ts';

/** Reading metadata only. Stored order, timestamps, numbering and gaps stay intact. */
export function itineraryDaySummaries(entries: ItineraryEntry[]) {
  const days = new Map<string, ItineraryEntry[]>();
  const numbers = itineraryVisitNumbers(entries);
  for (const entry of entries) {
    const rows = days.get(entry.date) || [];
    rows.push(entry);
    days.set(entry.date, rows);
  }
  return [...days].map(([date, rows]) => {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][
      new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    ];
    return {
      date,
      label: `${month}.${day} (${weekday})`,
      start: rows.reduce((min, row) => (row.start < min ? row.start : min), rows[0].start),
      end: rows.reduce(
        (max, row) => ((row.end || row.start) > max ? row.end || row.start : max),
        rows[0].end || rows[0].start,
      ),
      visits: rows.filter((row) => numbers.has(row.id) && (row.place || row.latitude !== undefined))
        .length,
    };
  });
}

/** Every instruction stays visible; explicit newlines separate timed substeps. */
export function itineraryNoteLines(note = ''): { time: string; text: string; label?: string }[] {
  return note
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const timed = line.match(/^(\d{2}:\d{2}(?:[–-]\d{2}:\d{2})?)\s+(.+)$/u);
      if (timed) return { time: timed[1], text: timed[2] };
      // Only explicitly authored labels become properties. Never infer facts from prose.
      const property = line.match(/^(노선|이동|환승|소요|비용|예산|준비|주의|대안|예약|확인|식사|입장|운영|경로)\s*[·:：]\s*(.+)$/u);
      return property
        ? { time: '', label: property[1], text: property[2] }
        : { time: '', text: line };
    });
}
