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
  const [revision, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void cachedRequest<AiSettings>('/api/ai/settings', controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSettings(value);
          setError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('AI 설정을 불러오지 못했어요. 다시 확인해 주세요.');
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
  return { settings, error, reload: () => reload((v) => v + 1) };
}
