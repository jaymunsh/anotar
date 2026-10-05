export type AiModel = {
  id: string;
  name: string;
  pricing: 'free' | 'paid' | 'unknown';
  enabled: boolean;
  available: boolean | null;
};
export function mergeModelCatalog(current: AiModel[], remote: AiModel[]): AiModel[] {
  const remoteIds = new Set(remote.map((m) => m.id));
  const currentIds = new Set(current.map((m) => m.id));
  return [
    ...current.map((m) => ({
      ...m,
      available: m.id.startsWith('opencode/') ? remoteIds.has(m.id) : m.available,
    })),
    ...remote.filter((m) => !currentIds.has(m.id)).map((m) => ({ ...m, enabled: false })),
  ];
}
