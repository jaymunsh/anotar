import type { ItineraryEntry } from './itinerary';
export function cleanGoogleMapsKey(value: unknown): string;
export function itineraryMapPoints(
  entries: ItineraryEntry[],
): (ItineraryEntry & { number: number; position: { lat: number; lng: number } })[];
export function loadGoogleMaps(key: string): Promise<any>;
export type GoogleItineraryController = {
  fitAll(): void;
  select(id: string | null): void;
  destroy(): void;
};
export function createGoogleItinerary(
  container: HTMLElement,
  entries: ItineraryEntry[],
  sdk: any,
  onSelect: (id: string) => void,
  onError?: (message: string) => void,
): GoogleItineraryController;
