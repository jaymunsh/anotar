import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, Plus, RefreshCw, Search } from 'lucide-react';
import { authenticationRequired, getAuthSnapshot, subscribeAuth } from '../auth/state';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { publishRecordChange, subscribeRecordChanges } from '../trash/events';
import { renderReadMarkdown } from '../ai/markdownReading';
import {
  addDays,
  countBy,
  homeSummary,
  list,
  matches,
  monday,
  monthDay,
  parseWikiRoute,
  prepare,
  relativeDay,
  builtAgo,
  splitResult,
  toolName,
  weekday,
  wikiLinkSlug,
  ymd,
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
    response = await fetch('/memory/data.json', { cache: 'no-store', signal });
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
  ];
  const data = load.state === 'ready' ? load.data : null;
  const today = ymd(new Date());
  const thisWeek = data ? data.sessions.filter((s) => s.date >= monday(today)).length : 0;
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
              이번 주 기록 <b>{thisWeek}</b> · 위키 <b>{data.wiki.length}</b> · AI 기록 <b>{data.sessions.length}</b>
              {data.builtAt && (
                <span title={new Date(data.builtAt).toLocaleString('ko-KR')}> · 갱신 {builtAgo(data.builtAt, Date.now())}</span>
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

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="wiki-block">
      <h2>
        {title}
        {note && <span className="wiki-note">{note}</span>}
      </h2>
      {children}
    </section>
  );
}
const ToolDot = ({ tool }: { tool: string }) => <span className={`wiki-dot is-${tool}`} aria-hidden />;

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
          <Section title="남은 일" note="프로젝트별 최신 기록 기준">
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
function Chips({ label, entries, value, onChange, total, name = (v) => v }: {
  label: string;
  entries: [string, number][];
  value: string;
  onChange: (v: string) => void;
  total: number;
  name?: (v: string) => string;
}) {
  if (entries.length < 2) return null;
  return (
    <div className="wiki-chips" role="group" aria-label={label}>
      <button type="button" aria-pressed={!value} onClick={() => onChange('')}>전체 <span>{total}</span></button>
      {entries.map(([v, n]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? '' : v)}>
          {name(v)} <span>{n}</span>
        </button>
      ))}
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

function SessionEntry({ s, link, project = true }: { s: Session; link: Link; project?: boolean }) {
  const models = list(s.models);
  return (
    <a className="wiki-entry" {...link(logPath(s.slug))}>
      <span className="wiki-entry-row">
        <strong>{s.title}</strong>
        {list(s.promoted).length > 0 && <span className="wiki-badge">위키 반영</span>}
        <span className="wiki-meta">
          <ToolDot tool={s.tool} />
          {toolName(s.tool)}
          {models.length > 0 && ` · ${models[0]}${models.length > 1 ? ` +${models.length - 1}` : ''}`}
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
  const [mode, setMode] = useState<'day' | 'week'>(() => (localStorage.getItem('anotar:wiki-log-mode') === 'week' ? 'week' : 'day'));
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
        <Chips label="프로젝트" entries={countBy(data.sessions, (s) => s.project)} value={project} onChange={setProject} total={data.sessions.length} />
      </div>
      {!hits.length && <Empty total={data.sessions.length} empty="아직 AI 기록이 없어요. 에이전트에게 sessions를 시켜 보세요." />}
      {mode === 'day' ? (
        <div className="wiki-list">
          {hits.map((s) => {
            const heading = s.date !== day && (day = s.date);
            return (
              <div key={s.slug}>
                {heading && <h2 className="wiki-group">{monthDay(s.date)} ({weekday(s.date)})</h2>}
                <SessionEntry s={s} link={link} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wiki-list">
          {[...weeks].map(([wk, projects]) => (
            <section key={wk} className="wiki-week">
              <h2 className="wiki-group">
                {monthDay(wk)} – {monthDay(addDays(wk, 6))}
                <span className="wiki-muted"> {[...projects.values()].flat().length}개 기록</span>
              </h2>
              {[...projects].map(([name, ss]) => (
                <div key={name} className="wiki-project-next">
                  <h3><a {...link(projectPath(name))}>{name}</a></h3>
                  <ul>
                    {ss.map((s) => (
                      <li key={s.slug}>
                        <a {...link(logPath(s.slug))}>{s.title}</a>
                        <span className="wiki-muted"> {monthDay(s.date)} · {toolName(s.tool)}</span>
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
      {!names.length && <Empty total={data.projects.size} empty="아직 기록된 프로젝트가 없어요." />}
      <div className="wiki-list">
        {names.map(([name, ss]) => (
          <a key={name} className="wiki-entry" {...link(projectPath(name))}>
            <span className="wiki-entry-row">
              <strong>{name}</strong>
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
        {list(s.models).join(', ')} · <a {...link(projectPath(s.project))}>{s.project}</a> · {s.date}
        {s.summarized_by && <span> · 요약 {s.summarized_by}</span>}
      </p>
      {promoted.length ? (
        <p className="wiki-linked">
          위키에 반영됨:{' '}
          {promoted.map((w, i) => (
            <span key={w.slug}>{i > 0 && ', '}<a {...link(pagePath(w.slug))}>{w.title}</a></span>
          ))}
        </p>
      ) : (
        <p className="wiki-linked wiki-muted">
          위키로 옮기려면 에이전트에게 <code>/ingest sessions/{s.slug}.md</code>
        </p>
      )}
      <Markdown text={result} navigate={navigate} />
      <Bullets title="남은 일" items={list(s.next)} />
      <Bullets title="정한 것" items={list(s.decisions)} />
      <Bullets title="위키 후보" items={list(s.candidates)} />
      <Markdown text={rest} navigate={navigate} />
    </article>
  );
}

function ProjectReader({ data, name, link }: { data: Prepared; name: string; link: Link }) {
  const ss = data.projects.get(name);
  if (!ss) return <Missing what="프로젝트" back="/wiki/projects" link={link} />;
  const last = ss[0];
  const tools = countBy(ss, (s) => s.tool).map(([t, n]) => `${toolName(t)} ${n}`).join(' · ');
  return (
    <article className="wiki-reader">
      <Back to="/wiki/projects" label="프로젝트" link={link} />
      <h1>{name}</h1>
      <p className="wiki-tldr">{last.tldr}</p>
      <p className="wiki-meta">
        기록 {ss.length}개 · {monthDay(ss[ss.length - 1].date)} ~ {monthDay(last.date)} · {tools}
      </p>
      <Bullets title="남은 일" items={list(last.next)} />
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
