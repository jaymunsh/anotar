export type TextDiffRow = {
  kind: 'same' | 'changed' | 'added' | 'removed';
  before?: string;
  after?: string;
};

/** Read-only line comparison. Large changes use a bounded, coarser alignment. */
export function compareTextLines(before: string | null, after: string | null) {
  const a = before === null ? [] : before.split('\n');
  const b = after === null ? [] : after.split('\n');
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const old = a.slice(prefix, a.length - suffix);
  const current = b.slice(prefix, b.length - suffix);
  const rows: TextDiffRow[] = a
    .slice(0, prefix)
    .map((text) => ({ kind: 'same', before: text, after: text }));
  const coarse = (old.length + 1) * (current.length + 1) > 250000;
  const pair = (removed: string[], added: string[]) => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      rows.push({
        kind:
          i < removed.length && i < added.length
            ? removed[i] === added[i]
              ? 'same'
              : 'changed'
            : i < removed.length
              ? 'removed'
              : 'added',
        ...(i < removed.length ? { before: removed[i] } : {}),
        ...(i < added.length ? { after: added[i] } : {}),
      });
  };
  if (coarse) pair(old, current);
  else {
    const width = current.length + 1;
    const matches = new Uint32Array((old.length + 1) * width);
    for (let i = old.length - 1; i >= 0; i--)
      for (let j = current.length - 1; j >= 0; j--)
        matches[i * width + j] =
          old[i] === current[j]
            ? 1 + matches[(i + 1) * width + j + 1]
            : Math.max(matches[(i + 1) * width + j], matches[i * width + j + 1]);
    let i = 0,
      j = 0;
    let removed: string[] = [],
      added: string[] = [];
    while (i < old.length || j < current.length) {
      if (i < old.length && j < current.length && old[i] === current[j]) {
        pair(removed, added);
        removed = [];
        added = [];
        rows.push({ kind: 'same', before: old[i++], after: current[j++] });
      } else if (
        i < old.length &&
        (j === current.length || matches[(i + 1) * width + j] >= matches[i * width + j + 1])
      )
        removed.push(old[i++]);
      else added.push(current[j++]);
    }
    pair(removed, added);
  }
  for (const text of a.slice(a.length - suffix))
    rows.push({ kind: 'same', before: text, after: text });
  return { rows, coarse };
}
