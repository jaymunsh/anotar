// Find a due date in a Korean sentence, by rule (instant, offline). Dates are 'YYYY-MM-DD' in KST.
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const toDate = (day: string) => new Date(day + 'T00:00:00Z');
const ymd = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => ymd(new Date(toDate(day).getTime() + n * 864e5));

/** First date phrase in the text: 오늘·내일·모레, (이번 주|다음 주) X요일, M/D, M월 D일, YYYY-MM-DD. */
export function parseDueDate(text: string, today: string): string | null {
  const found: { at: number; day: string }[] = [];
  const add = (at: number, day: string | null) => day && found.push({ at, day });
  for (const m of text.matchAll(/오늘|내일|모레/g))
    add(m.index!, addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m[0] as '오늘']));
  for (const m of text.matchAll(/(이번\s?주|다음\s?주)?\s*([월화수목금토일])요일/g)) {
    const target = DAYS.indexOf(m[2]);
    const weekday = toDate(today).getUTCDay();
    if (m[1]?.startsWith('다음')) {
      const nextMonday = addDays(today, ((8 - weekday) % 7) || 7);
      add(m.index!, addDays(nextMonday, (target + 6) % 7));
    } else add(m.index!, addDays(today, (target - weekday + 7) % 7));
  }
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) add(m.index!, valid(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/(?<![\d-])(\d{1,2})\s*(?:\/|월\s*)(\d{1,2})일?(?![\d/])/g)) {
    const year = Number(today.slice(0, 4));
    const day = valid(year, +m[1], +m[2]);
    add(m.index!, day && day < today ? valid(year + 1, +m[1], +m[2]) : day);
  }
  return found.sort((a, b) => a.at - b.at)[0]?.day ?? null;
}

function valid(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ymd(date) : null;
}

/** 10/23(금) */
export function shortDue(day: string) {
  const date = toDate(day);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${DAYS[date.getUTCDay()]})`;
}

/** Today in Korea as YYYY-MM-DD. */
export function kstToday(at = Date.now()) {
  return ymd(new Date(at + 9 * 3600e3));
}
