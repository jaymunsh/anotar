import type { PromptDraft } from './templates';

export type ImportMapping = {
  sourceId: string;
  sourceVersion: number;
  targetId: string;
  targetVersion: number;
  targetRevisionId: string;
};
export function rebasePromptDrafts(drafts: Record<string, PromptDraft>, mappings: ImportMapping[]) {
  const next = { ...drafts };
  for (const mapping of mappings) {
    const draft = drafts[mapping.sourceId];
    if (!draft || draft.expectedRevisionId || draft.expectedVersion !== mapping.sourceVersion)
      continue;
    if (mapping.targetId !== mapping.sourceId && next[mapping.targetId]) continue;
    delete next[mapping.sourceId];
    next[mapping.targetId] = {
      ...draft,
      id: mapping.targetId,
      expectedVersion: mapping.targetVersion,
      expectedRevisionId: mapping.targetRevisionId,
    };
  }
  return next;
}
