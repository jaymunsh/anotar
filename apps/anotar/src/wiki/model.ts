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
  /** KST "YYYY-MM-DDTHH:MM" from the session dump; older summaries may lack them. */
  started?: string;
  ended?: string;
  models?: string[] | string;
  tags?: string[] | string;
  next?: string[] | string;
  decisions?: string[] | string;
  candidates?: string[] | string;
  promoted?: string[] | string;
  summarized_by?: string;
  body: string;
};
/** A server AI request's result (apps/memory/import_anotar.py, anotar/*.md): kept apart from Mac sessions. */
export type ServerAi = {
  slug: string;
  title: string;
  tldr: string;
  template: string;
  source?: 'memo' | 'page';
  date: string;
  started?: string;
  ended?: string;
  models?: string[] | string;
  promoted?: string[] | string;
  body: string;
};
/** Weekly review written by apps/memory/summarize.py weekly; `week` is that week's Monday. */
export type Digest = { slug: string; title: string; tldr: string; week: string; body: string };
/** How the wiki is built (apps/memory build.py): docs, projects.json and per-stage counts. */
export type MemorySystem = {
  readme: string;
  guide?: string;
  agents: string;
  projects: { hide?: string[]; alias?: Record<string, string> };
  counts: { raw: number; pending: number; summarized: number; shown: number; hidden: number };
  runs?: MemoryRun[];
  byModel?: [string, number][];
};
/** One summarize.py run (runs.jsonl), newest first. */
export type MemoryRun = {
  at: string;
  mode: 'sessions' | 'weekly';
  seconds: number;
  models: Record<string, { ok: number; fail: number }>;
  down: string[];
  stopped: string | null;
};
export type MemoryData = { wiki: WikiPage[]; sessions: Session[]; anotar?: ServerAi[]; digests?: Digest[]; system?: MemorySystem; builtAt?: string };

export type WikiRoute =
  | { view: 'home' }
  | { view: 'pages'; slug: string | null }
  | { view: 'log'; slug: string | null }
  | { view: 'server'; slug: string | null }
  | { view: 'projects'; name: string | null }
  | { view: 'system' }
  | { view: 'guide' };

export function parseWikiRoute(pathname: string): WikiRoute {
  const [, , kind, ...rest] = pathname.replace(/\/+$/, '').split('/');
  const id = rest.length ? decodeURIComponent(rest.join('/')) : null;
  if (kind === 'pages') return { view: 'pages', slug: id };
  if (kind === 'log') return { view: 'log', slug: id };
  if (kind === 'server') return { view: 'server', slug: id };
  if (kind === 'projects') return { view: 'projects', name: id };
  if (kind === 'system') return { view: 'system' };
  if (kind === 'guide') return { view: 'guide' };
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

/** An ISO time as KST to the second, e.g. '2026-10-21 19:30:05'; null when missing or unreadable. */
export function kstStamp(iso: string | null) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  return new Date(at + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

/** The Mac pushes once a day (runs.jsonl changes every run), so no rebuild for 30 hours means it stopped. */
export const isStale = (iso: string | null, now = Date.now()) => !!iso && now - Date.parse(iso) > 30 * 3600000;

/**
 * First to last message in KST: "2026-10-19 | 03:02 ~ 05:56", full dates when it crosses midnight.
 * Without the date (lists already grouped by day): "03:02 ~ 05:56", the end date only when it differs.
 */
export function sessionTime(s: { started?: string; ended?: string }, withDate = true) {
  if (!s.started) return '';
  const [day, start] = s.started.split('T');
  const from = withDate ? `${day} ${start}` : start;
  if (!s.ended || s.ended <= s.started) return from;
  const [endDay, end] = s.ended.split('T');
  if (endDay !== day) return `${from} ~ ${endDay} ${end}`;
  return withDate ? `${day} | ${start} ~ ${end}` : `${start} ~ ${end}`;
}

/** Sessions without content are hidden; sessions stay newest first. */
export function prepare(data: MemoryData) {
  const sessions = (data.sessions ?? [])
    .filter((s) => s.title !== '(내용 없음)')
    .sort((a, b) => b.date.localeCompare(a.date) || (b.started ?? '').localeCompare(a.started ?? ''));
  const wiki = [...(data.wiki ?? [])].sort((a, b) => b.updated.localeCompare(a.updated));
  const projects = new Map<string, Session[]>();
  for (const s of sessions) projects.set(s.project, [...(projects.get(s.project) ?? []), s]);
  const digests = [...(data.digests ?? [])].sort((a, b) => b.week.localeCompare(a.week));
  const server = [...(data.anotar ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.started ?? '').localeCompare(a.started ?? ''),
  );
  return { wiki, sessions, server, projects, digests, system: data.system ?? null, builtAt: data.builtAt ?? null };
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

/** `count` is Mac sessions plus server AI records; `server` is the server part of it. */
export type ActivityDay = { date: string; count: number; server: number; level: 0 | 1 | 2 | 3 | 4 } | null;
/** Contribution grid: one column per week (Mon–Sun) up to this week; days after today are null. */
export function activityGrid(sessions: Session[], today: string, weeks = 26, server: { date: string }[] = []) {
  const counts = new Map<string, number>();
  const servers = new Map<string, number>();
  for (const s of sessions) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
  for (const s of server) {
    counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
    servers.set(s.date, (servers.get(s.date) ?? 0) + 1);
  }
  const first = addDays(monday(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDays(first, 7 * w);
    const days: ActivityDay[] = Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, d);
      if (date > today) return null;
      const count = counts.get(date) ?? 0;
      return { date, count, server: servers.get(date) ?? 0, level: count >= 5 ? 4 : count >= 3 ? 3 : (count as 0 | 1 | 2) };
    });
    const total = days.reduce((n, day) => n + (day?.count ?? 0), 0);
    return { monday: start, days, total };
  });
}

/** Projects × weeks: sessions per week for each project active in the window, latest first. */
export function projectTimeline(projects: Map<string, Session[]>, today: string, weeks = 26) {
  const first = addDays(monday(today), -7 * (weeks - 1));
  const columns = Array.from({ length: weeks }, (_, w) => addDays(first, 7 * w));
  return [...projects]
    .map(([name, ss]) => {
      const counts = columns.map(() => 0);
      for (const s of ss) {
        const w = Math.floor((new Date(monday(s.date) + 'T00:00').getTime() - new Date(first + 'T00:00').getTime()) / (7 * 864e5));
        if (w >= 0 && w < weeks) counts[w]++;
      }
      return { name, counts, total: counts.reduce((a, b) => a + b, 0), last: ss[0].date };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.last.localeCompare(a.last));
}
export const timelineColumns = (today: string, weeks = 26) =>
  Array.from({ length: weeks }, (_, w) => addDays(addDays(monday(today), -7 * (weeks - 1)), 7 * w));

/** Active = a session within the last 14 days. */
export const isActive = (last: string, today: string) => last >= addDays(today, -14);

/** Home stat tiles. `trend` is sessions per week for the last 12 weeks (oldest first). */
export function homeStats(data: Prepared, today: string) {
  const month = today.slice(0, 7);
  const prev = ymd(new Date(+month.slice(0, 4), +month.slice(5, 7) - 2, 1)).slice(0, 7);
  const thisMonth = data.sessions.filter((s) => s.date.startsWith(month)).length;
  const lastMonth = data.sessions.filter((s) => s.date.startsWith(prev)).length;
  const trend = activityGrid(data.sessions, today, 12).map((w) => w.total);
  const latest = [...data.projects.values()].map((ss) => ss[0]);
  return {
    thisMonth,
    lastMonth,
    trend,
    activeProjects: latest.filter((s) => isActive(s.date, today)).length,
    projects: latest.length,
    openItems: latest.filter((s) => isActive(s.date, today)).reduce((n, s) => n + list(s.next).length, 0),
    wiki: data.wiki.length,
  };
}

/** Where each wiki page came from: `mac` if a session promoted it, `anotar` if a server AI record did. */
export function wikiOrigins(data: Pick<Prepared, 'sessions' | 'server'>) {
  const origins = new Map<string, Set<'mac' | 'anotar'>>();
  const add = (slug: string, origin: 'mac' | 'anotar') => origins.set(slug, (origins.get(slug) ?? new Set()).add(origin));
  for (const s of data.sessions) for (const slug of list(s.promoted)) add(slug, 'mac');
  for (const s of data.server) for (const slug of list(s.promoted)) add(slug, 'anotar');
  return origins;
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
