import { onlineActionFetch } from '../sync/onlineActions';
import { useRef, useState } from 'react';
import type { TrashEntry, TrashRequest } from './types';

export function useTrashOperation() {
  const request = useRef<TrashRequest | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  async function run(makeRequest: () => TrashRequest) {
    if (busyRef.current) return null;
    const snapshot = request.current || makeRequest();
    request.current = snapshot;
    busyRef.current = true;
    setBusy(true);
    setPending(true);
    setError('');
    setConflict(false);
    try {
      const response = await onlineActionFetch(snapshot.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot.body),
      });
      if ([400, 404, 409, 412].includes(response.status)) {
        request.current = null;
        setPending(false);
        setConflict(response.status === 409);
        const data = (await response.json()) as { error?: string };
        setError(data.error || '기록을 확인한 뒤 다시 시도해 주세요.');
        return null;
      }
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { item?: TrashEntry };
      if (!data.item?.id || !['capture', 'page'].includes(data.item.kind)) throw new Error();
      request.current = null;
      setPending(false);
      return data.item;
    } catch {
      setError('응답을 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { run, busy, pending, error, conflict };
}
