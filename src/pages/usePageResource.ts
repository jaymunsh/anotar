import { workspaceFetch } from '../sync/runtime';
import { useEffect, useState } from 'react';
import { subscribeRecordChanges } from '../trash/events';

export function usePageResource<T>(path: string) {
  const [item, setItem] = useState<T | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => subscribeRecordChanges(() => setRetry((value) => value + 1)), []);
  useEffect(() => {
    const controller = new AbortController();
    setItem(null);
    setState('loading');
    workspaceFetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          if (!controller.signal.aborted) setState('missing');
          return;
        }
        if (!response.ok) throw new Error();
        const data = (await response.json()) as { item: T };
        if (!data.item) throw new Error();
        if (!controller.signal.aborted) {
          setItem(data.item);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [path, retry]);
  return { item, state, reload: () => setRetry((value) => value + 1) };
}
