// One traversal for lossless export and reference-aware reclamation, including nested archives.
export function attachmentReferences(...values: unknown[]) {
  const ids = new Set<string>(),
    requiredIds = new Set<string>(),
    uploadIds = new Set<string>(),
    seen = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || value instanceof Blob || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.assetId === 'string' && row.assetId) ids.add(row.assetId);
    if (Array.isArray(row.blobIds))
      for (const id of row.blobIds)
        if (typeof id === 'string') {
          ids.add(id);
          requiredIds.add(id);
        }
    if (Array.isArray(row.files))
      for (const file of row.files) if (file && typeof file.id === 'string') ids.add(file.id);
    if (Array.isArray(row.uploadIds))
      for (const id of row.uploadIds) if (typeof id === 'string') uploadIds.add(id);
    Object.values(row).forEach(visit);
  };
  values.forEach(visit);
  return { ids, uploadIds, requiredIds };
}
