import { useEffect, useRef } from 'react';
import type { Capture } from '../memos/types';
import { activeAiJob } from './types';
import type { AiJobSummary } from './types';

export default function AiListUpdates({
  items,
  onJobChange,
}: {
  items: Capture[];
  onJobChange: (captureId: string, job: AiJobSummary) => void;
}) {
  const callback = useRef(onJobChange);
  callback.current = onJobChange;
  const candidates = items.filter((item) => activeAiJob(item.latestAiJob));
  const signature = candidates.map((item) => `${item.id}:${item.latestAiJob!.id}`).join(',');
  useEffect(() => {
    const lookup = new Map(candidates.map((item) => [item.id, item.latestAiJob!.id]));
    const visible = new Set<string>();
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      controller: AbortController | undefined;
    async function poll() {
      if (stopped || document.hidden || !visible.size) return;
      const ids = [...visible].slice(0, 20).map((id) => lookup.get(id)!);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(`/api/ai-jobs?ids=${ids.join(',')}`, {
          signal: current.signal,
        });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as { items: (AiJobSummary & { captureId: string })[] };
        if (stopped || current.signal.aborted) return;
        for (const job of data.items) callback.current(job.captureId, job);
      } catch {
        /* The detail view has a retryable error. Keep the last known list status. */
      }
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    }
    const schedule = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) timer = setTimeout(() => void poll(), 0);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.captureId!;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      schedule();
    });
    for (const card of document.querySelectorAll<HTMLElement>('.capture-card[data-capture-id]'))
      if (lookup.has(card.dataset.captureId!)) observer.observe(card);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
    // Candidate IDs change only when visible active work enters/leaves this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return null;
}
