import type { AiExecution } from '../../shared/aiRequests';
import type { AiSettings } from './useAiProfiles';

export function describeExecution(settings: AiSettings | null, value: AiExecution | null | undefined, research: boolean, hasUrl: boolean) {
  const profile = settings?.profiles.find(p => p.id === (value?.profileId || settings.defaultProfile));
  const stale = Boolean(value && profile && (profile.id === 'opencode'
    ? !profile.catalog?.some(m => m.id === value.model && m.enabled)
    : value.model !== profile.model));
  const unsupported = Boolean(research && profile && !profile.researchModes.includes(hasUrl ? 'url' : 'keyword'));
  const reason = !settings ? 'loading' : !profile ? 'missing' : stale ? 'stale'
    : unsupported ? 'unsupported' : !profile.enabled ? 'disabled' : !value?.model.trim() ? 'model' : 'ready';
  return { profile, stale, unsupported, reason, usable: reason === 'ready' };
}
