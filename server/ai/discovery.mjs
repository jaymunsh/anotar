import { AiExecutionError } from './contracts.mjs';
import { collectResearch } from './research.mjs';

export function cleanResearchUrl(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error();
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new AiExecutionError('invalid_result');
  }
}

export function normalizeResearchCandidates(values) {
  if (!Array.isArray(values) || values.length > 5) throw new AiExecutionError('invalid_result');
  const seen = new Set();
  const items = [];
  for (const item of values) {
    if (
      !item ||
      (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 200))
    )
      throw new AiExecutionError('invalid_result');
    const url = cleanResearchUrl(item.url);
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, title: item.title || new URL(url).hostname });
  }
  return items;
}

export async function collectKeywordResearch(candidates, signal, collect = collectResearch) {
  const items = normalizeResearchCandidates(candidates);
  const materials = [],
    seen = new Set();
  for (const item of items) {
    signal.throwIfAborted();
    try {
      const material = await collect(item.url, signal);
      signal.throwIfAborted();
      if (seen.has(material.url)) continue;
      if (!material.text?.trim()) throw new AiExecutionError('research_failed');
      seen.add(material.url);
      materials.push({ ...material, text: material.text.slice(0, 16_666) });
      if (materials.length === 3) break;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (!['research_blocked', 'research_failed', 'research_too_large'].includes(error?.code))
        throw error;
    }
  }
  signal.throwIfAborted();
  if (!materials.length) throw new AiExecutionError('research_no_sources');
  return { materials, candidateCount: items.length };
}
