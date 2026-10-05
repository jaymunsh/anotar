import { itineraryVisitNumbers } from './itinerary.ts';
import type { ItineraryEntry } from './itinerary.ts';

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );

/** Own diagram, without remote map tiles or Google content. */
export function itineraryPreviewSvg(entries: ItineraryEntry[]): string {
  const numbers = itineraryVisitNumbers(entries);
  const points = entries.filter(
    (e) => e.category !== 'travel' && e.latitude !== undefined && e.longitude !== undefined,
  );
  const width = 480,
    height = 340;
  if (!points.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="480" height="340" fill="#eef2e9"/><text x="240" y="170" text-anchor="middle" fill="#315b41" font-family="sans-serif" font-size="20">장소 링크에서 위치를 확인하세요</text></svg>`;
  const minLat = Math.min(...points.map((p) => p.latitude!)),
    maxLat = Math.max(...points.map((p) => p.latitude!));
  const minLng = Math.min(...points.map((p) => p.longitude!)),
    maxLng = Math.max(...points.map((p) => p.longitude!));
  const cos = Math.max(0.05, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  const scale = Math.min(
    320 / Math.max((maxLng - minLng) * cos, 0.00001),
    180 / Math.max(maxLat - minLat, 0.00001),
  );
  const position = (entry: ItineraryEntry) => ({
    x: 240 + (entry.longitude! - (minLng + maxLng) / 2) * cos * scale,
    y: 165 - (entry.latitude! - (minLat + maxLat) / 2) * scale,
  });
  const lines = points
    .slice(1)
    .map((to, i) => {
      const from = points[i];
      if (from.date !== to.date || numbers.get(to.id)! !== numbers.get(from.id)! + 1) return '';
      const a = position(from),
        b = position(to),
        distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < 48) return '';
      const dx = (b.x - a.x) / distance,
        dy = (b.y - a.y) / distance;
      return `<path d="M${a.x + dx * 23},${a.y + dy * 23} L${b.x - dx * 26},${b.y - dy * 26}" fill="none" stroke="#66845e" stroke-width="3" stroke-dasharray="5 5" marker-end="url(#arrow)"/>`;
    })
    .join('');
  const pins = points
    .map((entry) => {
      const { x, y } = position(entry);
      const name = entry.place || entry.title;
      const label = [...name].slice(0, 12).join('') + ([...name].length > 12 ? '…' : '');
      return `<g><title>${escapeXml(name)}</title><circle cx="${x}" cy="${y}" r="20" fill="#315b41" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 6}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="17" font-weight="600">${numbers.get(entry.id)}</text><text x="${x}" y="${y + 43}" text-anchor="middle" fill="#21352c" font-family="sans-serif" font-size="18" stroke="#eef2e9" stroke-width="5" paint-order="stroke">${escapeXml(label)}</text></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>방문 위치와 순서</title><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#66845e"/></marker></defs><rect width="480" height="340" rx="10" fill="#eef2e9"/><text x="28" y="35" fill="#466546" font-family="sans-serif" font-size="18">방문 위치와 순서</text>${lines}${pins}<text x="28" y="316" fill="#466546" font-family="sans-serif" font-size="12">실제 도로 경로는 Google Maps에서 확인하세요</text></svg>`;
}

export function itineraryPreviewDataUrl(entries: ItineraryEntry[]): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(itineraryPreviewSvg(entries));
}
