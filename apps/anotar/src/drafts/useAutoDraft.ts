import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDraft } from './localDraft';

/** Debounce text writes, but synchronously flush the latest input before leaving. */
export function useAutoDraft(key: string, value: unknown | null, enabled: boolean) {
  const [error, setError] = useState('');
  const latest = useRef({ value, enabled });
  latest.current = { value, enabled };
  const flush = useCallback(() => {
    if (!latest.current.enabled) return;
    try {
      saveDraft(window.localStorage, key, latest.current.value);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '초안을 임시저장하지 못했어요.');
    }
  }, [key]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);
  useEffect(() => {
    const timer = setTimeout(flush, 250);
    return () => clearTimeout(timer);
  }, [flush, value, enabled]);
  return error;
}
