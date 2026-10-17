// Lets any screen open the ⌘K search with a query (main.tsx listens).
export const openSearchEvent = 'anotar:open-search';
export function openTagSearch(tag: string) {
  window.dispatchEvent(new CustomEvent(openSearchEvent, { detail: tag.startsWith('#') ? tag : '#' + tag }));
}
