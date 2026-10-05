import snapshot from './opencodeModels.json' with { type: 'json' };
import { AiValidationError } from './contracts.mjs';
export const OPENCODE_MODELS_URL = snapshot.source;
const freeTextModel = (model) => model.pricing === 'free' && !model.id.startsWith('opencode/jev-');
export const defaultOpenCodeModels = () => structuredClone(snapshot.models.filter(freeTextModel));
export const catalogCheckedAt = snapshot.checkedAt;
export function validateModelCatalog(value) {
  if (!Array.isArray(value) || value.length > 300)
    throw new AiValidationError('모델 목록은 최대 300개까지 등록할 수 있어요.');
  const ids = new Set();
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9][a-z0-9._:-]*\/[a-z0-9][a-z0-9/._:-]*$/i.test(entry.id) ||
      entry.id.length > 120 ||
      ids.has(entry.id) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.trim().length > 120 ||
      !['free', 'paid', 'unknown'].includes(entry.pricing) ||
      typeof entry.enabled !== 'boolean' ||
      ![true, false, null].includes(entry.available ?? null)
    )
      throw new AiValidationError(
        '모델 ID·이름·사용 여부를 확인해 주세요. 중복된 모델 ID는 등록할 수 없어요.',
      );
    ids.add(entry.id);
    return {
      id: entry.id,
      name: entry.name.trim(),
      pricing: entry.pricing,
      enabled: entry.enabled,
      available: entry.available ?? null,
    };
  });
}
// No settings mutation: caller merges this preview into its draft and explicitly saves.
export async function fetchOpenCodeModels({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(OPENCODE_MODELS_URL, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || ''))
    throw Error('모델 목록을 가져오지 못했어요. 기존 목록은 유지돼요.');
  let bytes = 0;
  const parts = [];
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > 512 * 1024) throw Error('모델 목록이 너무 커요. 기존 목록은 유지돼요.');
    parts.push(part);
  }
  const data = JSON.parse(Buffer.concat(parts).toString('utf8')).data;
  if (!Array.isArray(data) || !data.length || data.length > 300)
    throw Error('모델 목록 형식을 확인하지 못했어요.');
  const known = new Map(snapshot.models.map((m) => [m.id, m]));
  return {
    source: OPENCODE_MODELS_URL,
    checkedAt: new Date().toISOString(),
    models: validateModelCatalog(
      data.map((m) => ({
        id: `opencode/${m.id}`,
        name: m.id,
        pricing: known.get(`opencode/${m.id}`)?.pricing ?? 'unknown',
        enabled: false,
        available: true,
      })),
    ).filter(freeTextModel),
  };
}
