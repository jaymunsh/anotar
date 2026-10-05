import type { JournalStorage } from './storage';
export function mountTimeboxing(
  root: Document | ShadowRoot,
  options?: { storageKey?: string; today?: string; empty?: boolean; embedded?: boolean; storage?: JournalStorage },
): () => void;
