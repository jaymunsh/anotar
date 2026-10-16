// Pure helpers for the wiki screen. Data comes from apps/memory/build.py (site/data.json).
export type WikiPage = {
  slug: string;
  title: string;
  tldr: string;
  tags?: string[] | string;
  updated: string;
  body: string;
};
export type Session = {
  slug: string;
  title: string;
  tldr: string;
  tool: string;
  project: string;
  date: string;
  models?: string[] | string;
  tags?: string[] | string;
  next?: string[] | string;
  decisions?: string[] | string;
  candidates?: string[] | string;
  promoted?: string[] | string;
  summarized_by?: string;
  body: string;
};
export type MemoryData = { wiki: WikiPage[]; sessions: Session[] };

export type WikiRoute =
  | { view: 'home' }
  | { view: 'pages'; slug: string | null }
  | { view: 'log'; slug: string | null }
  | { view: 'projects'; name: string | null };

export function parseWikiRoute(pathname: string): WikiRoute {
  const [, , kind, ...rest] = pathname.replace(/\/+$/, '').split('/');
  const id = rest.length ? decodeURIComponent(rest.join('/')) : null;
  if (kind === 'pages') return { view: 'pages', slug: id };
  if (kind === 'log') return { view: 'log', slug: id };
  if (kind === 'projects') return { view: 'projects', name: id };
  return { view: 'home' };
}

export const list = (value: unknown): string[] =>
  ([] as unknown[]).concat(value ?? []).filter((v): v is string => typeof v === 'string' && !!v);

const TOOLS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
};
export const toolName = (tool: string) => TOOLS[tool] ?? tool;

const DAYS = '일월화수목금토';
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const monday = (day: string) =>
  addDays(day, -((new Date(day + 'T00:00').getDay() + 6) % 7));
export const monthDay = (day: string) => `${+day.slice(5, 7)}월 ${+day.slice(8, 10)}일`;
export const weekday = (day: string) => DAYS[new Date(day + 'T00:00').getDay()];
export function relativeDay(day: string, today: string) {
  const n = Math.round(
    (new Date(today + 'T00:00').getTime() - new Date(day + 'T00:00').getTime()) / 864e5,
  );
  return n <= 0 ? '오늘' : n === 1 ? '어제' : n < 31 ? `${n}일 전` : monthDay(day);
}

/** Sessions without content are hidden; sessions stay newest first. */
export function prepare(data: MemoryData) {
  const sessions = (data.sessions ?? [])
    .filter((s) => s.title !== '(내용 없음)')
    .sort((a, b) => b.date.localeCompare(a.date));
  const wiki = [...(data.wiki ?? [])].sort((a, b) => b.updated.localeCompare(a.updated));
  const projects = new Map<string, Session[]>();
  for (const s of sessions) projects.set(s.project, [...(projects.get(s.project) ?? []), s]);
  return { wiki, sessions, projects };
}
export type Prepared = ReturnType<typeof prepare>;

export function matches(fields: unknown[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields
    .map((f) => list(f).join(' '))
    .join(' ')
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function countBy<T>(items: T[], pick: (item: T) => unknown) {
  const counts = new Map<string, number>();
  for (const item of items) for (const v of list(pick(item))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function homeSummary(data: Prepared, today: string) {
  const week = monday(today);
  const thisWeek = data.sessions.filter((s) => s.date >= week);
  const latest = [...data.projects].map(([name, ss]) => ({ name, last: ss[0], count: ss.length }));
  return {
    thisWeek,
    weekProjects: new Set(thisWeek.map((s) => s.project)).size,
    open: latest.filter((p) => list(p.last.next).length).slice(0, 6),
    stale: latest.filter(
      (p) => p.last.date < addDays(today, -14) && list(p.last.next).length,
    ),
    candidates: data.sessions
      .filter((s) => !list(s.promoted).length)
      .flatMap((s) => list(s.candidates).map((text) => ({ text, session: s })))
      .slice(0, 8),
    recentWiki: data.wiki.slice(0, 5),
  };
}

/** `./x.md`, `../wiki/x.md`, `x.md#part` → wiki slug. */
export function wikiLinkSlug(href: string) {
  return href.match(/^(?:\.\.\/wiki\/|\.\/)?([\w-]+)\.md(?:#.*)?$/)?.[1] ?? null;
}

/** "## 결과" first so the outcome is what you see when you come back to a session. */
export function splitResult(body: string) {
  const parts = body.split(/^(?=## )/m);
  const i = parts.findIndex((p) => /^## 결과/.test(p));
  return i < 0
    ? { result: '', rest: body }
    : { result: parts[i], rest: parts.filter((_, j) => j !== i).join('') };
}
