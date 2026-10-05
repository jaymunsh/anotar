/** Ten-minute adjustments preserve duration when moving and never cross midnight. */
export function adjustPlan(entry, kind, delta, others = []) {
  const step = Math.round(delta / 10) * 10;
  let { start, end } = entry;
  if (kind === 'move') {
    const shift = Math.max(-start, Math.min(1440 - end, step));
    start += shift;
    end += shift;
  } else if (kind === 'start') start = Math.max(0, Math.min(end - 10, start + step));
  else if (kind === 'end') end = Math.min(1440, Math.max(start + 10, end + step));
  else throw new Error('Invalid adjustment');
  return {
    start,
    end,
    conflict: others.some(
      (other) => other.id !== entry.id && start < other.end && end > other.start,
    ),
  };
}
