import { useEffect, useState } from 'react';
import { cachedRequest } from '../sync/cachedRequest';
import type { AiModel } from '../../shared/aiModels';
import type { AiExecution } from '../../shared/aiRequests';
export type AiProfile = {
  model: string;
  catalog?: AiModel[];
  catalogCheckedAt?: string;
  id: AiExecution['profileId'];
  label: string;
  enabled: boolean;
  status: 'configured' | 'missing' | 'disabled' | 'login_required';
  credentialsConfigured: boolean;
  researchModes: ('url' | 'keyword')[];
};
export type AiSettings = {
  version: number;
  defaultProfile: AiExecution['profileId'];
  profiles: AiProfile[];
};
export function useAiProfiles() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState('');
  // 'changed' = this device's copy belongs to a different server workspace (restore or new server); retrying won't help.
  const [errorKind, setErrorKind] = useState<'' | 'changed' | 'failed'>('');
  const [revision, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void cachedRequest<AiSettings>('/api/ai/settings', controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSettings(value);
          setError('');
          setErrorKind('');
        }
      })
      .catch((cause: { code?: string }) => {
        if (controller.signal.aborted) return;
        const changed = cause?.code === 'epoch_mismatch' || cause?.code === 'workspace_mismatch';
        setErrorKind(changed ? 'changed' : 'failed');
        setError(
          changed
            ? '서버 자료가 바뀌어서 이 기기에 남은 자료와 맞지 않아요. 기기 저장소에서 정리하면 다시 불러와요.'
            : 'AI 설정을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
        );
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const refresh = () => reload((v) => v + 1);
    window.addEventListener('anotar:ai-settings-changed', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('anotar:ai-settings-changed', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return { settings, error, errorKind, reload: () => reload((v) => v + 1) };
}
