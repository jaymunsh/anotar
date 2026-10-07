/** A new reference must not make a create wait for its own dependent child. */
export function wouldCreateDependencyCycle(
  operationId: string,
  dependencies: string[],
  heads: { operation: { operationId: string }; dependencies: string[] }[],
): boolean {
  if (!dependencies.length) return false;
  const graph = new Map(heads.map((head) => [head.operation.operationId, head.dependencies]));
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === operationId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (graph.get(id) ?? []).some(visit);
  };
  return dependencies.some(visit);
}

/** Workflows bind to a specific source revision; keep their dependency immutable. */
export function snapshotIsBound(
  operation: { operationId: string; baseOperationId?: string },
  heads: { dependencies: string[] }[],
): boolean {
  return (
    Boolean(operation.baseOperationId) ||
    heads.some((head) => head.dependencies.includes(operation.operationId))
  );
}
