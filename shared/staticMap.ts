import { itineraryVisitNumbers, itineraryPlaceUrl, type ItineraryEntry } from './itinerary.ts';

export const staticMapStyles = {
  'klokantech-basic': '주변 지역·도로',
  'osm-bright-smooth': '지역명 강조',
  positron: '밝고 간결하게',
  'osm-liberty': '도로와 장소 자세히',
  'dark-matter': '어두운 지도',
} as const;
export const defaultStaticMapStyle = 'klokantech-basic' as const;
export type StaticMapStyle = keyof typeof staticMapStyles;
// The image picker offers references in this document. Carry a generated image's
// original coordinates and provider when another itinerary reuses those bytes.
export function staticMapImageMetadata(blocks: { props?: { assetId?: unknown; imageSource?: unknown; imageInput?: unknown }; children?: any[] }[], assetId: string): { imageSource: string; imageInput: string } {
  for (const block of blocks) {
    if (assetId && block.props?.assetId === assetId && block.props.imageSource === 'geoapify')
      return { imageSource: 'geoapify', imageInput: typeof block.props.imageInput === 'string' ? block.props.imageInput : '' };
    const child = staticMapImageMetadata(block.children || [], assetId);
    if (child.imageSource) return child;
  }
  return { imageSource: '', imageInput: '' };
}
export function staticMapPoints(entries: ItineraryEntry[]) {
  const numbers = itineraryVisitNumbers(entries);
  return entries.flatMap((entry) => {
    const number = numbers.get(entry.id);
    return number && Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)
      ? [{ id: entry.id, number, date: entry.date, latitude: entry.latitude!, longitude: entry.longitude! }]
      : [];
  });
}
// Use the exact same numbered, coordinate-bearing stops as the static image.
// Provider POI labels can be omitted; this legend always uses the saved plan names.
export function staticMapStops(entries: ItineraryEntry[]) {
  return staticMapPoints(entries).map((point) => {
    const entry = entries.find((item) => item.id === point.id)!;
    return { id: point.id, number: point.number, name: entry.place || entry.title,
      date: entry.date, start: entry.start, url: itineraryPlaceUrl(entry)! };
  });
}
// Includes coordinate-less visits: inserting one changes the numbering and must invalidate the image.
export function staticMapInput(entries: ItineraryEntry[]): string {
  const numbers = itineraryVisitNumbers(entries);
  return JSON.stringify(entries.filter((entry) => numbers.has(entry.id)).map((entry) => [
    entry.id, numbers.get(entry.id), entry.date, entry.latitude ?? null, entry.longitude ?? null,
  ]));
}
