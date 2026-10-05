const dateObject = (key) => new Date(key + 'T12:00:00Z');
export function validDate(key) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(key) &&
    Number.isFinite(dateObject(key).valueOf()) &&
    dateObject(key).toISOString().slice(0, 10) === key
  );
}
export function addDays(key, count) {
  const date = dateObject(key);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function weekDates(key) {
  const monday = addDays(key, -(dateObject(key).getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
export function monthDates(key) {
  const prefix = key.slice(0, 7);
  const date = dateObject(prefix + '-01');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return Array.from(
    { length: date.getUTCDate() },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`,
  );
}
export function monthWeeks(key) {
  const groups = [];
  for (const date of monthDates(key)) {
    if (!groups.length || dateObject(date).getUTCDay() === 1) groups.push([]);
    groups.at(-1).push(date);
  }
  return groups;
}
export function dayStats(day) {
  const d = day || {};
  const priorities = (d.priorities || []).filter((p) => p.text.trim());
  const plan = (d.plan || []).reduce((sum, entry) => sum + entry.end - entry.start, 0);
  const actual = (d.actual || []).reduce((sum, entry) => sum + entry.end - entry.start, 0);
  const planned = Boolean((d.plan || []).length || priorities.length);
  const recorded = Boolean(
    (d.actual || []).length || ['brain', 'idea', 'feedback'].some((k) => d[k]?.trim()),
  );
  return {
    plan,
    actual,
    filled: priorities.length,
    done: priorities.filter((p) => p.done).length,
    contentDays: Number(planned || recorded),
    recordedDays: Number(recorded),
    plannedDays: Number(planned),
  };
}
export function summarize(days, dates) {
  return dates.reduce(
    (total, date) => {
      for (const [key, value] of Object.entries(dayStats(days[date]))) total[key] += value;
      return total;
    },
    { plan: 0, actual: 0, filled: 0, done: 0, contentDays: 0, recordedDays: 0, plannedDays: 0 },
  );
}
export const defaultEnd = (start, length = 30) => Math.min(start + length, 1440);
