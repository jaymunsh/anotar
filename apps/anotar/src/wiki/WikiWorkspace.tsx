import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, Plus, RefreshCw, Search } from 'lucide-react';
import { authenticationRequired, getAuthSnapshot, subscribeAuth } from '../auth/state';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { publishRecordChange, subscribeRecordChanges } from '../trash/events';
import { renderReadMarkdown } from '../ai/markdownReading';
import {
  activityGrid,
  addDays,
  countBy,
  homeStats,
  homeSummary,
  isActive,
  projectTimeline,
  timelineColumns,
  list,
  matches,
  monday,
  monthDay,
  parseWikiRoute,
  prepare,
  relativeDay,
  builtAgo,
  sessionTime,
  splitResult,
  toolName,
  weekday,
  wikiLinkSlug,
  ymd,
  type Digest,
  type MemoryData,
  type Prepared,
  type Session,
  type WikiPage,
} from './model';
import './wiki.css';

type Navigate = (path: string) => void;
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: Prepared };

async function loadMemory(signal: AbortSignal): Promise<Prepared> {
  let response: Response;
  try {
    response = await fetch('/memory/data.json', { cache: 'no-cache', signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw Error('위키 서버에 연결하지 못했어요. 잠시 뒤 다시 불러와 주세요.');
  }
  if (response.status === 503) throw Error('아직 위키가 빌드되지 않았어요. memory의 build.py를 실행해 주세요.');
  // The edge redirects a signed-out request to the app shell, which is HTML.
  // Same as a sync 401: show the app's login banner instead of a dead-end message.
  if (response.redirected || response.headers.get('content-type')?.includes('text/html')) {
    authenticationRequired();
    throw Error('로그인 시간이 지났어요. 아래 로그인 버튼으로 다시 로그인해 주세요.');
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw Error('위키를 불러오지 못했어요. 다시 불러와 주세요.');
  return prepare((await response.json()) as MemoryData);
}

/** In-app link: plain clicks route inside anotar, modified clicks keep browser behavior. */
function useLink(navigate: Navigate) {
  return (path: string) => ({
    href: path,
    onClick: (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      navigate(path);
    },
  });
}
const pagePath = (slug: string) => '/wiki/pages/' + encodeURIComponent(slug);
const logPath = (slug: string) => '/wiki/log/' + encodeURIComponent(slug);
const projectPath = (name: string) => '/wiki/projects/' + encodeURIComponent(name);

export default function WikiWorkspace({ navigate, pathname }: { navigate: Navigate; pathname: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Reload once the login banner signs the user back in.
  const authState = useSyncExternalStore(subscribeAuth, () => getAuthSnapshot().state);
  const route = parseWikiRoute(pathname);
  const link = useLink(navigate);
  useEffect(() => {
    const controller = new AbortController();
    setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    loadMemory(controller.signal).then(
      (data) => setLoad({ state: 'ready', data }),
      (error) => !controller.signal.aborted && setLoad({ state: 'error', message: error.message }),
    );
    return () => controller.abort();
  }, [attempt, authState]);

  const tabs: { path: string; label: string; active: boolean }[] = [
    { path: '/wiki', label: '홈', active: route.view === 'home' },
    { path: '/wiki/pages', label: '위키', active: route.view === 'pages' },
    { path: '/wiki/log', label: 'AI 기록', active: route.view === 'log' },
    { path: '/wiki/projects', label: '프로젝트', active: route.view === 'projects' },
    { path: '/wiki/system', label: '구조', active: route.view === 'system' },
    { path: '/wiki/guide', label: '가이드', active: route.view === 'guide' },
  ];
  const data = load.state === 'ready' ? load.data : null;
  const reload = (
    <button type="button" className="toolbar-icon-mobile" onClick={() => setAttempt((n) => n + 1)} aria-label="위키 다시 불러오기" title="다시 불러오기">
      <RefreshCw size={15} aria-hidden />
    </button>
  );
  let body: ReactNode;
  if (load.state === 'loading') body = <p className="wiki-status" role="status">위키를 불러오는 중…</p>;
  else if (load.state === 'error')
    body = (
      <div className="wiki-status" role="alert">
        <p>{load.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>다시 불러오기</button>
      </div>
    );
  else if (route.view === 'home') body = <WikiHome data={load.data} link={link} />;
  else if (route.view === 'pages')
    body = route.slug ? <WikiReader data={load.data} slug={route.slug} link={link} navigate={navigate} /> : <WikiList data={load.data} link={link} />;
  else if (route.view === 'log')
    body = route.slug ? <SessionReader data={load.data} slug={route.slug} link={link} navigate={navigate} /> : <SessionList data={load.data} link={link} />;
  else if (route.view === 'system') body = <SystemView data={load.data} />;
  else if (route.view === 'guide')
    body = load.data.system?.guide ? (
      <article className="wiki-reader wiki-system-doc wiki-guide">
        <h1>가이드</h1>
        <p className="wiki-tldr">무엇을 해야 하고, 로컬에서 어떻게 돌리고, 안에서 무엇이 일어나는지.</p>
        <Markdown text={load.data.system.guide} navigate={navigate} />
      </article>
    ) : (
      <p className="wiki-status">가이드가 없어요. apps/memory의 build.py를 새 버전으로 다시 실행해 주세요.</p>
    );
  else body = route.name ? <ProjectReader data={load.data} name={route.name} link={link} /> : <ProjectList data={load.data} link={link} />;

  return (
    <main className="wiki-workspace">
      <WorkspaceToolbar
        title="위키"
        lead={
          <nav className="wiki-tabs" aria-label="위키 보기">
            {tabs.map((tab) => (
              <a key={tab.path} {...link(tab.path)} aria-current={tab.active ? 'page' : undefined}>
                {tab.label}
              </a>
            ))}
          </nav>
        }
        meta={
          data ? (
            <span className="wiki-toolbar-stats">
              {data.builtAt && (
                <span title={new Date(data.builtAt).toLocaleString('ko-KR')}>갱신 {builtAgo(data.builtAt, Date.now())}</span>
              )}
            </span>
          ) : undefined
        }
      >
        {reload}
      </WorkspaceToolbar>
      {body}
    </main>
  );
}

type Link = ReturnType<typeof useLink>;

function Section({ id, title, note, wide, children }: { id?: string; title: string; note?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={wide ? 'wiki-block is-wide' : 'wiki-block'}>
      <h2>
        {title}
        {note && <span className="wiki-note">{note}</span>}
      </h2>
      {children}
    </section>
  );
}
const ToolDot = ({ tool }: { tool: string }) => <span className={`wiki-dot is-${tool}`} aria-hidden />;
/** "- 정함:" / "- 막힘:" lines in a weekly review: the word becomes a badge (bold, then styled by class). */
const DIGEST_MARKS: Record<string, string> = { 정함: 'is-decided', 막힘: 'is-blocked' };
function DigestCard({ digest, heading, open }: { digest: Digest; heading?: ReactNode; open?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useMemo(() => digest.body.replace(/^- (정함|막힘):\s*/gm, '- **$1** '), [digest.body]);
  useEffect(() => {
    ref.current?.querySelectorAll('li > strong:first-child').forEach((label) => {
      const mark = DIGEST_MARKS[label.textContent ?? ''];
      if (mark) label.parentElement?.classList.add('wiki-mark', mark);
    });
  }, [body]);
  return (
    <div className="wiki-digest" ref={ref}>
      {heading}
      <strong>{digest.title}</strong>
      <p>{digest.tldr}</p>
      <details open={open}>
        <summary>회고 전체</summary>
        <Markdown text={body} />
      </details>
    </div>
  );
}

const LEVEL_TEXT = ['없음', '1개', '2개', '3–4개', '5개 이상'];
const level = (count: number) => (count >= 5 ? 4 : count >= 3 ? 3 : count);

/** 12-week sparkline: de-emphasised line, current week as an accent dot. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values), w = 96, h = 28;
  const points = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 6)]);
  const [x, y] = points[points.length - 1];
  return (
    <svg className="wiki-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={points.map((p) => p.join(',')).join(' ')} />
      <circle cx={x} cy={y} r="3" />
    </svg>
  );
}

function StatTiles({ data, today }: { data: Prepared; today: string }) {
  const s = useMemo(() => homeStats(data, today), [data, today]);
  const tiles: { label: string; value: number; sub: ReactNode; href?: string }[] = [
    {
      label: '이번 달 AI 기록',
      value: s.thisMonth,
      sub: (
        <>
          <span>지난달 {s.lastMonth}</span>
          <Sparkline values={s.trend} label={`최근 12주 주별 기록: ${s.trend.join(', ')}`} />
        </>
      ),
    },
    { label: '진행 중 프로젝트', value: s.activeProjects, sub: <span>전체 {s.projects} · 2주 안에 기록</span> },
    { label: '남은 일', value: s.openItems, sub: <span>프로젝트별 목록 보기</span>, href: s.openItems ? '#wiki-open' : undefined },
    { label: '위키 페이지', value: s.wiki, sub: <span>정리해 둔 지식</span> },
  ];
  return (
    <div className="wiki-tiles">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="wiki-tile-label">{t.label}</span>
            <strong className="wiki-tile-value">{t.value}</strong>
            <span className="wiki-tile-sub">{t.sub}</span>
          </>
        );
        return t.href ? (
          <a className="wiki-tile is-link" key={t.label} href={t.href}>{body}</a>
        ) : (
          <div className="wiki-tile" key={t.label}>{body}</div>
        );
      })}
    </div>
  );
}

/** Projects × weeks. The name labels each row, so identity never rests on color. */
function ProjectTimeline({ data, today, link }: { data: Prepared; today: string; link: Link }) {
  const rows = useMemo(() => projectTimeline(data.projects, today), [data, today]);
  const columns = timelineColumns(today);
  // On a narrow screen the grid scrolls; start at the latest weeks.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [rows.length]);
  if (!rows.length) return null;
  return (
    <section className="wiki-timeline" aria-label="프로젝트 타임라인, 최근 6개월">
      <div className="wiki-timeline-scroll" ref={scroll}>
        <div className="wiki-timeline-row is-head" aria-hidden>
          <span />
          <div className="wiki-timeline-cells">
            {columns.map((c, i) => (
              <span key={c} className="wiki-timeline-month">
                {(i === 0 ? +c.slice(8, 10) <= 17 : c.slice(5, 7) !== columns[i - 1].slice(5, 7)) ? `${+c.slice(5, 7)}월` : ''}
              </span>
            ))}
          </div>
          <span />
        </div>
        {rows.map((row) => (
          <div className="wiki-timeline-row" key={row.name}>
            <a className="wiki-timeline-name" {...link(projectPath(row.name))} title={row.name}>
              {isActive(row.last, today) && <span className="wiki-live" aria-label="진행 중" />}
              {row.name}
            </a>
            <div className="wiki-timeline-cells">
              {row.counts.map((n, i) => (
                <span
                  key={columns[i]}
                  className={`wiki-heatmap-cell is-${level(n)}`}
                  title={`${row.name} · ${monthDay(columns[i])} 주 · 기록 ${n}개`}
                />
              ))}
            </div>
            <span className="wiki-timeline-last">{relativeDay(row.last, today)}</span>
          </div>
        ))}
      </div>
      <p className="wiki-timeline-legend"><span className="wiki-live" aria-hidden /> 2주 안에 기록이 있는 프로젝트</p>
    </section>
  );
}
/** Sessions per day, one column per week. A column links to that week in the weekly log. */
function ActivityHeatmap({ sessions, today, link, weeks }: { sessions: Session[]; today: string; link: Link; weeks?: number }) {
  const grid = useMemo(() => activityGrid(sessions, today, weeks), [sessions, today, weeks]);
  // On a narrow screen the grid scrolls; start at the latest weeks.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [grid.length]);
  return (
    <div className="wiki-heatmap" style={{ '--weeks': grid.length } as CSSProperties}>
      <div className="wiki-heatmap-scroll" ref={scroll}>
        <div className="wiki-heatmap-days" aria-hidden>
          {['월', '', '수', '', '금', '', ''].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="wiki-heatmap-grid">
          {grid.map((week, i) => {
            const month = +week.monday.slice(5, 7);
            // The first column is labelled only if its month has room (else it collides with the next label).
            const newMonth = i === 0 ? +week.monday.slice(8, 10) <= 17 : month !== +grid[i - 1].monday.slice(5, 7);
            const label = `${monthDay(week.monday)} 주 · 기록 ${week.total}개`;
            return (
              <a key={week.monday} className="wiki-heatmap-week" {...link('/wiki/log#week-' + week.monday)} aria-label={label} title={label}>
                <span className="wiki-heatmap-month" aria-hidden>{newMonth ? `${month}월` : ''}</span>
                {week.days.map((day, d) =>
                  day ? (
                    <span key={d} className={`wiki-heatmap-cell is-${day.level}`} title={`${monthDay(day.date)} (${weekday(day.date)}) · 기록 ${day.count}개`} />
                  ) : (
                    <span key={d} className="wiki-heatmap-cell is-empty" />
                  ),
                )}
              </a>
            );
          })}
        </div>
      </div>
      <p className="wiki-heatmap-legend" aria-hidden>
        적음 {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`wiki-heatmap-cell is-${l}`} title={LEVEL_TEXT[l]} />)} 많음
        <span className="wiki-muted"> · 하루 AI 기록 수, 주를 누르면 그 주 기록으로</span>
      </p>
    </div>
  );
}

type WikiTask = { id: string; status: 'open' | 'done'; source: string };
/** A 남은 일 line's task key. anotar's task is the source of truth for whether it is done. */
const nextSource = (project: string, item: string) => `wiki:${project}:${item}`;

function useWikiTasks() {
  const [tasks, setTasks] = useState(new Map<string, WikiTask>());
  const load = () =>
    fetch('/api/tasks?source=wiki:')
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((data: { items: WikiTask[] }) => setTasks(new Map(data.items.map((task) => [task.source, task]))))
      .catch(() => {});
  useEffect(() => {
    void load();
    return subscribeRecordChanges(() => void load());
  }, []);
  async function add(project: string, item: string) {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: item.slice(0, 500), source: nextSource(project, item), requestId: crypto.randomUUID() }),
    });
    if (response.ok) publishRecordChange('tasks');
    await load();
  }
  return { tasks, add };
}

function WikiHome({ data, link }: { data: Prepared; link: Link }) {
  const today = ymd(new Date());
  const home = useMemo(() => homeSummary(data, today), [data, today]);
  const wikiTasks = useWikiTasks();
  const [adding, setAdding] = useState('');
  // Lines whose task is done drop out; the session summary itself is history and stays as written.
  const open = home.open
    .map((p) => ({ p, items: list(p.last.next).filter((n) => wikiTasks.tasks.get(nextSource(p.name, n))?.status !== 'done') }))
    .filter(({ items }) => items.length);
  return (
    <div className="wiki-home">
      <div className="wiki-home-grid">
        <div className="wiki-home-top is-wide">
          <StatTiles data={data} today={today} />
          <Section title="최근 6개월" note={`AI 기록 ${data.sessions.length}개`}>
            <ActivityHeatmap sessions={data.sessions} today={today} link={link} />
          </Section>
        </div>
        {data.digests[0] && (
          <Section wide title="주간 회고" note={<a {...link('/wiki/log')}>주별로 보기</a>}>
            <DigestCard
              digest={data.digests[0]}
              open
              heading={<span className="wiki-muted">{monthDay(data.digests[0].week)} – {monthDay(addDays(data.digests[0].week, 6))}</span>}
            />
          </Section>
        )}
        <Section title="이번 주" note={<a {...link('/wiki/log')}>전체 기록</a>}>
          {home.thisWeek.length ? (
            <ul className="wiki-items">
              {home.thisWeek.map((s) => (
                <li key={s.slug}>
                  <ToolDot tool={s.tool} />
                  <a {...link(logPath(s.slug))}>{s.title}</a>
                  <span className="wiki-muted"> {relativeDay(s.date, today)} · {s.project}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wiki-muted">이번 주 기록이 아직 없어요.</p>
          )}
        </Section>
        {open.length > 0 && (
          <Section id="wiki-open" title="남은 일" note="프로젝트별 최신 기록 기준">
            {open.map(({ p, items }) => (
              <div className="wiki-project-next" key={p.name}>
                <h3>
                  <a {...link(projectPath(p.name))}>{p.name}</a>
                  <span className="wiki-muted"> {relativeDay(p.last.date, today)}</span>
                </h3>
                <ul>
                  {items.map((n) => {
                    const task = wikiTasks.tasks.get(nextSource(p.name, n));
                    const key = nextSource(p.name, n);
                    return (
                      <li key={n}>
                        <span>{n}</span>
                        {task ? (
                          <a className="wiki-next-task is-added" {...link('/tasks?taskId=' + task.id)}>
                            <Check size={12} aria-hidden /> 할 일에 있음
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="wiki-next-task"
                            disabled={adding === key}
                            aria-label={`${n} 할 일로 추가`}
                            onClick={() => {
                              setAdding(key);
                              void wikiTasks.add(p.name, n).finally(() => setAdding(''));
                            }}
                          >
                            <Plus size={12} aria-hidden /> 할 일
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </Section>
        )}
        {home.stale.length > 0 && (
          <Section title="멈춘 프로젝트" note="2주 넘게 기록 없음">
            <ul className="wiki-items">
              {home.stale.map((p) => (
                <li key={p.name}>
                  <a {...link(projectPath(p.name))}>{p.name}</a>
                  <span className="wiki-muted"> 남은 일 {list(p.last.next).length}개 · {monthDay(p.last.date)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {home.candidates.length > 0 && (
          <Section title="위키로 옮길 후보" note="아직 정리하지 않은 것">
            <ul className="wiki-items">
              {home.candidates.map(({ text, session }) => (
                <li key={session.slug + text}>
                  {text}
                  <span className="wiki-muted"> ← <a {...link(logPath(session.slug))}>{session.title}</a></span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {home.recentWiki.length > 0 && (
          <Section title="최근 위키" note={<a {...link('/wiki/pages')}>전체 위키</a>}>
            <ul className="wiki-items">
              {home.recentWiki.map((p) => (
                <li key={p.slug}>
                  <a {...link(pagePath(p.slug))}>{p.title}</a>
                  <span className="wiki-muted"> {relativeDay(p.updated, today)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="wiki-search">
      <Search size={15} aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} />
    </label>
  );
}
function Chips({ label, entries, value, onChange, total, name = (v) => v, limit }: {
  label: string;
  entries: [string, number][];
  value: string;
  onChange: (v: string) => void;
  total: number;
  name?: (v: string) => string;
  /** Show only the busiest few (plus the selected one) until 더보기. */
  limit?: number;
}) {
  const [more, setMore] = useState(false);
  if (entries.length < 2) return null;
  const hidden = limit && !more ? entries.length - limit : 0;
  const shown = hidden > 0 ? entries.filter(([v], i) => i < limit! || v === value) : entries;
  return (
    <div className="wiki-chips" role="group" aria-label={label}>
      <button type="button" aria-pressed={!value} onClick={() => onChange('')}>전체 <span>{total}</span></button>
      {shown.map(([v, n]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? '' : v)}>
          {name(v)} <span>{n}</span>
        </button>
      ))}
      {limit && entries.length > limit && (
        <button type="button" className="wiki-chips-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? '접기' : `더보기 +${hidden}`}
        </button>
      )}
    </div>
  );
}
const Empty = ({ total, empty }: { total: number; empty: string }) => (
  <p className="wiki-status">{total ? '검색 결과가 없어요. 검색어나 필터를 바꿔 보세요.' : empty}</p>
);

function WikiList({ data, link }: { data: Prepared; link: Link }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(() => new URLSearchParams(window.location.search).get('tag') ?? '');
  const hits = data.wiki.filter(
    (p) => (!tag || list(p.tags).includes(tag)) && matches([p.title, p.tldr, p.tags, p.body], query),
  );
  let month = '';
  return (
    <div className="wiki-list-view">
      <div className="wiki-filters">
        <SearchField value={query} onChange={setQuery} label="제목, 요약, 본문 검색" />
        <Chips label="태그" entries={countBy(data.wiki, (p) => p.tags)} value={tag} onChange={setTag} total={data.wiki.length} name={(v) => '#' + v} />
      </div>
      {!hits.length && <Empty total={data.wiki.length} empty="아직 위키 페이지가 없어요. 에이전트에게 ingest를 시켜 보세요." />}
      <div className="wiki-list">
        {hits.map((p) => {
          const group = p.updated.slice(0, 7);
          const heading = group !== month && (month = group);
          return (
            <div key={p.slug}>
              {heading && <h2 className="wiki-group">{+group.slice(0, 4)}년 {+group.slice(5, 7)}월</h2>}
              <a className="wiki-entry" {...link(pagePath(p.slug))}>
                <span className="wiki-entry-row">
                  <strong>{p.title}</strong>
                  <span className="wiki-tags">{list(p.tags).map((t) => '#' + t).join(' ')}</span>
                  <time>{p.updated.slice(5).replace('-', '.')}</time>
                </span>
                <span className="wiki-entry-sum">{p.tldr}</span>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionEntry({ s, link, project = true, dated = true }: { s: Session; link: Link; project?: boolean; dated?: boolean }) {
  const time = sessionTime(s, dated);
  return (
    <a className="wiki-entry" {...link(logPath(s.slug))}>
      <span className="wiki-entry-row">
        <strong>{s.title}</strong>
        {list(s.promoted).length > 0 && <span className="wiki-badge">위키 반영</span>}
        <span className="wiki-meta">
          {time && <time className="wiki-entry-time">{time}</time>}
          <ToolDot tool={s.tool} />
          {toolName(s.tool)}
          {project && ` · ${s.project}`}
        </span>
      </span>
      <span className="wiki-entry-sum">{s.tldr}</span>
    </a>
  );
}

function SessionList({ data, link }: { data: Prepared; link: Link }) {
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState('');
  const [project, setProject] = useState('');
  const [mode, setMode] = useState<'day' | 'week'>(() =>
    location.hash.startsWith('#week-') || localStorage.getItem('anotar:wiki-log-mode') === 'week' ? 'week' : 'day',
  );
  // Heatmap links land on #week-<monday>; scroll there once the weeks render.
  useEffect(() => {
    if (location.hash.startsWith('#week-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, []);
  const hits = data.sessions.filter(
    (s) =>
      (!tool || s.tool === tool) &&
      (!project || s.project === project) &&
      matches([s.title, s.tldr, s.tags, s.project, s.models, s.next, s.decisions, s.body], query),
  );
  const setView = (next: 'day' | 'week') => {
    setMode(next);
    localStorage.setItem('anotar:wiki-log-mode', next);
  };
  const weeks = new Map<string, Map<string, Session[]>>();
  if (mode === 'week')
    for (const s of hits) {
      const wk = weeks.get(monday(s.date)) ?? new Map<string, Session[]>();
      wk.set(s.project, [...(wk.get(s.project) ?? []), s]);
      weeks.set(monday(s.date), wk);
    }
  let day = '';
  return (
    <div className="wiki-list-view">
      <div className="wiki-filters">
        <div className="wiki-filter-row">
          <SearchField value={query} onChange={setQuery} label="무엇을 했는지 검색" />
          <div className="wiki-segment" role="group" aria-label="묶어 보기">
            <button type="button" aria-pressed={mode === 'day'} onClick={() => setView('day')}>날짜별</button>
            <button type="button" aria-pressed={mode === 'week'} onClick={() => setView('week')}>주별</button>
          </div>
        </div>
        <Chips label="도구" entries={countBy(data.sessions, (s) => s.tool)} value={tool} onChange={setTool} total={data.sessions.length} name={toolName} />
        <Chips label="프로젝트" entries={countBy(data.sessions, (s) => s.project)} value={project} onChange={setProject} total={data.sessions.length} limit={6} />
      </div>
      {!hits.length && <Empty total={data.sessions.length} empty="아직 AI 기록이 없어요. 에이전트에게 sessions를 시켜 보세요." />}
      {mode === 'day' ? (
        <div className="wiki-list">
          {hits.map((s) => {
            const heading = s.date !== day && (day = s.date);
            return (
              <div key={s.slug}>
                {heading && <h2 className="wiki-group">{monthDay(s.date)} ({weekday(s.date)})</h2>}
                <SessionEntry s={s} link={link} dated={false} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wiki-list">
          {[...weeks].map(([wk, projects]) => (
            <section key={wk} id={'week-' + wk} className="wiki-week">
              <h2 className="wiki-group">
                {monthDay(wk)} – {monthDay(addDays(wk, 6))}
                <span className="wiki-muted"> {[...projects.values()].flat().length}개 기록</span>
              </h2>
              {!query && !tool && !project && data.digests.find((d) => d.week === wk) && (
                <DigestCard digest={data.digests.find((d) => d.week === wk)!} />
              )}
              {[...projects].map(([name, ss]) => (
                <div key={name} className="wiki-project-next">
                  <h3><a {...link(projectPath(name))}>{name}</a></h3>
                  <ul>
                    {ss.map((s) => (
                      <li key={s.slug}>
                        <a {...link(logPath(s.slug))}>{s.title}</a>
                        <span className="wiki-muted"> {sessionTime(s) || monthDay(s.date)} · {toolName(s.tool)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectList({ data, link }: { data: Prepared; link: Link }) {
  const [query, setQuery] = useState('');
  const names = [...data.projects].filter(([name, ss]) => matches([name, ss.map((s) => s.title + ' ' + s.tldr)], query));
  return (
    <div className="wiki-list-view">
      <div className="wiki-filters">
        <SearchField value={query} onChange={setQuery} label="프로젝트 검색" />
      </div>
      {!query && <ProjectTimeline data={data} today={ymd(new Date())} link={link} />}
      {!names.length && <Empty total={data.projects.size} empty="아직 기록된 프로젝트가 없어요." />}
      <div className="wiki-list">
        {names.map(([name, ss]) => (
          <a key={name} className="wiki-entry" {...link(projectPath(name))}>
            <span className="wiki-entry-row">
              <strong>{name}</strong>
              <span className={isActive(ss[0].date, ymd(new Date())) ? 'wiki-pill is-live' : 'wiki-pill'}>
                {isActive(ss[0].date, ymd(new Date())) ? '진행 중' : '멈춤'}
              </span>
              <span className="wiki-tags">
                기록 {ss.length}개{list(ss[0].next).length ? ` · 남은 일 ${list(ss[0].next).length}` : ''}
              </span>
              <time>{ss[0].date.slice(5).replace('-', '.')}</time>
            </span>
            <span className="wiki-entry-sum">{ss[0].tldr}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Markdown({ text, navigate }: { text: string; navigate?: Navigate }) {
  const nodes = useMemo(
    () =>
      renderReadMarkdown(text, {
        link: (href) => {
          const slug = wikiLinkSlug(href);
          if (!slug) return undefined;
          const path = pagePath(slug);
          return {
            href: path,
            onClick: (event) => {
              if (!navigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              navigate(path);
            },
          };
        },
      }),
    [text, navigate],
  );
  return text.trim() ? <div className="wiki-prose">{nodes}</div> : null;
}
function Bullets({ title, items }: { title: string; items: ReactNode[] }) {
  if (!items.length) return null;
  return (
    <div className="wiki-prose">
      <h2>{title}</h2>
      <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div>
  );
}
function Missing({ what, back, link }: { what: string; back: string; link: Link }) {
  return (
    <div className="wiki-status" role="alert">
      <p>{what}을(를) 찾을 수 없어요. 이름이 바뀌었거나 아직 빌드되지 않았을 수 있어요.</p>
      <a {...link(back)}>목록으로</a>
    </div>
  );
}
function Back({ to, label, link }: { to: string; label: string; link: Link }) {
  return (
    <a className="wiki-back" {...link(to)}>
      <ArrowLeft size={14} aria-hidden /> {label}
    </a>
  );
}

function WikiReader({ data, slug, link, navigate }: { data: Prepared; slug: string; link: Link; navigate: Navigate }) {
  const page = data.wiki.find((p) => p.slug === slug);
  if (!page) return <Missing what="위키 페이지" back="/wiki/pages" link={link} />;
  const refs = data.wiki.filter((q: WikiPage) => q !== page && new RegExp(`\\]\\((?:\\./)?${slug}\\.md`).test(q.body));
  const from = data.sessions.filter((s) => list(s.promoted).includes(slug));
  return (
    <article className="wiki-reader">
      <Back to="/wiki/pages" label="위키" link={link} />
      <h1>{page.title}</h1>
      <p className="wiki-tldr">{page.tldr}</p>
      <p className="wiki-meta">
        {page.updated} 업데이트
        {list(page.tags).map((t) => (
          <a key={t} {...link('/wiki/pages?tag=' + encodeURIComponent(t))}>#{t}</a>
        ))}
      </p>
      <Markdown text={page.body} navigate={navigate} />
      <Bullets title="이 글을 참조하는 페이지" items={refs.map((q) => <a {...link(pagePath(q.slug))}>{q.title}</a>)} />
      <Bullets title="이 글의 출처가 된 AI 기록" items={from.map((s) => <a {...link(logPath(s.slug))}>{s.title}</a>)} />
    </article>
  );
}

function SessionReader({ data, slug, link, navigate }: { data: Prepared; slug: string; link: Link; navigate: Navigate }) {
  const s = data.sessions.find((x) => x.slug === slug);
  if (!s) return <Missing what="AI 기록" back="/wiki/log" link={link} />;
  const { result, rest } = splitResult(s.body);
  const promoted = list(s.promoted).map((p) => data.wiki.find((w) => w.slug === p)).filter((w): w is WikiPage => !!w);
  return (
    <article className="wiki-reader">
      <Back to="/wiki/log" label="AI 기록" link={link} />
      <h1>{s.title}</h1>
      <p className="wiki-tldr">{s.tldr}</p>
      <p className="wiki-meta">
        <span className="wiki-badge"><ToolDot tool={s.tool} />{toolName(s.tool)}</span>
        {list(s.models).join(', ')} · <a {...link(projectPath(s.project))}>{s.project}</a> · {sessionTime(s) || s.date}
        {s.summarized_by && <span> · 요약 {s.summarized_by}</span>}
      </p>
      {promoted.length ? (
        <p className="wiki-linked">
          위키에 반영됨:{' '}
          {promoted.map((w, i) => (
            <span key={w.slug}>{i > 0 && ', '}<a {...link(pagePath(w.slug))}>{w.title}</a></span>
          ))}
        </p>
      ) : null}
      <Markdown text={result} navigate={navigate} />
      <Bullets title="남은 일" items={list(s.next)} />
      <Bullets title="정한 것" items={list(s.decisions)} />
      <Bullets title="위키 후보" items={list(s.candidates)} />
      <Markdown text={rest} navigate={navigate} />
      {!promoted.length && <IngestHint slug={s.slug} />}
    </article>
  );
}

/** The agent command that promotes this session into the wiki, copyable. */
function IngestHint({ slug }: { slug: string }) {
  const command = `/ingest sessions/${slug}.md`;
  const [copied, setCopied] = useState(false);
  return (
    <p className="wiki-linked wiki-ingest">
      <span className="wiki-muted">위키로 옮기려면 에이전트에게</span> <code>{command}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </p>
  );
}

function ProjectReader({ data, name, link }: { data: Prepared; name: string; link: Link }) {
  const ss = data.projects.get(name);
  if (!ss) return <Missing what="프로젝트" back="/wiki/projects" link={link} />;
  const last = ss[0];
  const wikiTasks = useWikiTasks();
  const tools = countBy(ss, (s) => s.tool).map(([t, n]) => `${toolName(t)} ${n}`).join(' · ');
  return (
    <article className="wiki-reader">
      <Back to="/wiki/projects" label="프로젝트" link={link} />
      <h1>{name}</h1>
      <p className="wiki-tldr">{last.tldr}</p>
      <p className="wiki-meta">
        기록 {ss.length}개 · {monthDay(ss[ss.length - 1].date)} ~ {monthDay(last.date)} · {tools}
      </p>
      <Bullets
        title="남은 일"
        items={list(last.next).map((n) =>
          wikiTasks.tasks.get(nextSource(name, n))?.status === 'done' ? (
            <><s className="wiki-muted">{n}</s> <span className="wiki-muted">완료</span></>
          ) : (
            n
          ),
        )}
      />
      <Bullets
        title="정한 것"
        items={ss.flatMap((s) => list(s.decisions).map((d) => <>{d} <span className="wiki-muted">{monthDay(s.date)}</span></>))}
      />
      <Bullets title="위키 후보" items={ss.filter((s) => !list(s.promoted).length).flatMap((s) => list(s.candidates))} />
      <div className="wiki-prose"><h2>타임라인</h2></div>
      <div className="wiki-list">
        {ss.map((s) => <SessionEntry key={s.slug} s={s} link={link} project={false} />)}
      </div>
    </article>
  );
}

/** 구조 tab: how the wiki is made, so the pipeline and its rules can be read and improved. */
function SystemView({ data }: { data: Prepared }) {
  const sys = data.system;
  if (!sys)
    return <p className="wiki-status">구조 정보가 없어요. apps/memory의 build.py를 새 버전으로 다시 실행해 주세요.</p>;
  const c = sys.counts;
  const stages: [string, number, string][] = [
    ['① 가져온 대화', c.raw, 'raw/sessions · 이 Mac에만'],
    ['② 요약 대기', c.pending, '다음 summarize.py sessions에서'],
    ['② AI 기록', c.shown, `sessions · 숨김 ${c.hidden}`],
    ['③ 주간 회고', data.digests.length, 'digests'],
    ['④ 위키 페이지', data.wiki.length, 'wiki'],
  ];
  const alias = Object.entries(sys.projects.alias ?? {});
  return (
    <div className="wiki-system">
      <div className="wiki-tiles is-five">
        {stages.map(([label, value, sub]) => (
          <div className="wiki-tile" key={label}>
            <span className="wiki-tile-label">{label}</span>
            <strong className="wiki-tile-value">{value}</strong>
            <span className="wiki-tile-sub"><span>{sub}</span></span>
          </div>
        ))}
      </div>
      <section className="wiki-block">
        <h2>최근 실행<span className="wiki-note">summarize.py · 모델은 deepseek → glm → mimo → space-bunny 순서로, 답하지 않으면 다음으로</span></h2>
        {sys.runs?.length ? (
          <div className="wiki-runs">
            <table>
              <thead>
                <tr><th>언제</th><th>무엇</th><th>모델별 성공/실패</th><th>걸린 시간</th><th>결과</th></tr>
              </thead>
              <tbody>
                {sys.runs.map((run) => {
                  const ok = Object.values(run.models).reduce((n, m) => n + m.ok, 0);
                  const fail = Object.values(run.models).reduce((n, m) => n + m.fail, 0);
                  return (
                    <tr key={run.at + run.mode}>
                      <td>{run.at.slice(5, 16).replace('T', ' ')}</td>
                      <td>{run.mode === 'sessions' ? '세션 요약' : '주간 회고'}</td>
                      <td>
                        {Object.entries(run.models).map(([model, m]) => (
                          <span key={model} className="wiki-run-model">{model.split('/').pop()?.replace('-free', '')} <b>{m.ok}</b>{m.fail > 0 && <em> / {m.fail}</em>}</span>
                        ))}
                        {run.down.length > 0 && <span className="wiki-muted"> 답 없음: {run.down.map((m) => m.split('/').pop()?.replace('-free', '')).join(', ')}</span>}
                      </td>
                      <td>{run.seconds >= 60 ? `${Math.round(run.seconds / 60)}분` : `${run.seconds}초`}</td>
                      <td>
                        {run.stopped ? (
                          <span className="wiki-pill is-bad" title={run.stopped}>멈춤</span>
                        ) : fail ? (
                          <span className="wiki-pill is-warn">{ok}개 성공 · {fail}개 실패</span>
                        ) : (
                          <span className="wiki-pill is-live">{ok}개 성공</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wiki-muted">아직 기록이 없어요. summarize.py를 한 번 돌리면 여기에 남아요.</p>
        )}
        {sys.byModel && sys.byModel.length > 0 && (
          <p className="wiki-run-total">
            요약을 쓴 모델: {sys.byModel.map(([model, n]) => <span key={model}><code>{model}</code> {n}</span>)}
          </p>
        )}
      </section>
      <section className="wiki-block">
        <h2>projects.json<span className="wiki-note">데이터 repo · 화면과 회고에만 적용, 요약 파일은 그대로</span></h2>
        <div className="wiki-system-config">
          <div>
            <h3>숨김</h3>
            <p>{(sys.projects.hide ?? []).map((h) => <code key={h}>{h}</code>)}{!(sys.projects.hide ?? []).length && <span className="wiki-muted">없음</span>}</p>
          </div>
          <div>
            <h3>이름 합치기</h3>
            {alias.length ? (
              <ul className="wiki-items">{alias.map(([from, to]) => <li key={from}><code>{from}</code> → <b>{to}</b></li>)}</ul>
            ) : (
              <p className="wiki-muted">없음</p>
            )}
          </div>
        </div>
      </section>
      <article className="wiki-reader wiki-system-doc">
        <Markdown text={sys.readme} />
      </article>
      <details className="wiki-system-rules">
        <summary>데이터 repo 규칙 AGENTS.md (요약·회고·위키 형식)</summary>
        <article className="wiki-reader"><Markdown text={sys.agents} /></article>
      </details>
    </div>
  );
}
