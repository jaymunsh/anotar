export class JournalValidationError extends Error {}
const fail = () => {
  throw new JournalValidationError('일지의 날짜·내용·시간을 확인해 주세요. 원본은 유지돼요.');
};
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 80;
export function validJournalDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2020-01-01' ||
    value > '2099-12-31'
  )
    return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
// A date always has the same UUID on every device in its workspace. Retaining
// the workspace's first 96 bits and the full date gives a reversible identity.
export function journalId(workspaceId, date) {
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(workspaceId) ||
    !validJournalDate(date)
  )
    fail();
  const hex = workspaceId.replaceAll('-', '').slice(0, 24) + date.replaceAll('-', '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}
export function validateJournalDay(day) {
  if (
    !day ||
    day.schemaVersion !== 1 ||
    !Array.isArray(day.priorities) ||
    day.priorities.length > 20
  )
    fail();
  if (
    !day.priorities.every(
      (p) =>
        p &&
        id(p.id) &&
        typeof p.text === 'string' &&
        p.text.length <= 300 &&
        typeof p.done === 'boolean',
    ) ||
    new Set(day.priorities.map((p) => p.id)).size !== day.priorities.length
  )
    fail();
  if (
    !['brain', 'idea', 'feedback'].every(
      (k) => typeof day[k] === 'string' && day[k].length <= 10000,
    )
  )
    fail();
  for (const key of ['plan', 'actual']) {
    if (!Array.isArray(day[key]) || day[key].length > 100) fail();
    for (const box of day[key]) {
      if (
        !box ||
        !id(box.id) ||
        typeof box.title !== 'string' ||
        box.title.length > 160 ||
        typeof box.note !== 'string' ||
        box.note.length > 2000 ||
        !['focus', 'meeting', 'life', 'interrupt'].includes(box.kind) ||
        !Number.isInteger(box.start) ||
        !Number.isInteger(box.end) ||
        box.start < 0 ||
        box.end > 1440 ||
        box.start >= box.end ||
        box.start % 10 ||
        box.end % 10 ||
        (box.missed !== undefined && typeof box.missed !== 'boolean')
      )
        fail();
      if (
        box.priorityId !== undefined &&
        (!id(box.priorityId) ||
          !validJournalDate(box.priorityDate) ||
          typeof box.priorityTitle !== 'string' ||
          box.priorityTitle.length > 300)
      )
        fail();
      if (
        box.priorityId === undefined &&
        (box.priorityDate !== undefined || box.priorityTitle !== undefined)
      )
        fail();
      if (
        box.sourcePlan !== undefined &&
        (!box.sourcePlan || !validJournalDate(box.sourcePlan.date) || !id(box.sourcePlan.id))
      )
        fail();
    }
    if (new Set(day[key].map((b) => b.id)).size !== day[key].length) fail();
  }
  // Preserve legacy properties and hidden actual records without reinterpretation.
  return structuredClone(day);
}
export function normalizeJournalDay(day, date) {
  if (
    !validJournalDate(date) ||
    !day ||
    (day.schemaVersion !== undefined && day.schemaVersion !== 1) ||
    !Array.isArray(day.priorities)
  )
    fail();
  return validateJournalDay({
    ...structuredClone(day),
    schemaVersion: 1,
    priorities: day.priorities.map((p, i) => ({ ...p, id: p.id ?? `legacy-${date}-${i}` })),
  });
}
export function parseLegacyJournal(raw) {
  const state = JSON.parse(raw);
  if (
    !state ||
    !state.days ||
    Array.isArray(state.days) ||
    !['light', 'dark'].includes(state.theme) ||
    Object.keys(state.days).length > 1000
  )
    fail();
  return Object.fromEntries(
    Object.entries(state.days).map(([date, day]) => [date, normalizeJournalDay(day, date)]),
  );
}
