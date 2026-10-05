import { normalizeJournalDay, parseLegacyJournal } from '../../shared/journal.mjs';
import { adjustPlan } from './dragTime.mjs';
import {
  addDays,
  weekDates,
  monthDates,
  monthWeeks,
  dayStats,
  summarize,
  defaultEnd,
  validDate,
} from '../../docs/design/timeboxing-model.mjs';
export function mountTimeboxing(root, options = {}) {
  const owner = root.ownerDocument || root;
  const cleanup = new AbortController();
  // Keep DOM queries inside this workspace; the app shell owns its own theme and controls.
  const document = {
    getElementById: (id) => root.getElementById(id),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    createElement: (tag) => owner.createElement(tag),
    createDocumentFragment: () => owner.createDocumentFragment(),
    get activeElement() {
      return root.activeElement;
    },
    fonts: owner.fonts,
    documentElement: root.host || owner.documentElement,
  };
  const KEY = options.storageKey || 'anotar:timeboxing-design:v1',
    TODAY = options.today || '2026-10-05';
  const $ = (id) => document.getElementById(id),
    clone = (value) => JSON.parse(JSON.stringify(value));
  const emptyDay = (date = TODAY) => ({
    schemaVersion: 1,
    priorities: [
      { id: `priority-${date}-1`, text: '', done: false },
      { id: `priority-${date}-2`, text: '', done: false },
      { id: `priority-${date}-3`, text: '', done: false },
    ],
    brain: '',
    idea: '',
    feedback: '',
    plan: [],
    actual: [],
  });
  const box = (id, start, end, title, kind = 'focus', note = '') => ({
    id,
    start,
    end,
    title,
    kind,
    note,
  });
  const sample = emptyDay();
  sample.priorities = emptyDay().priorities;
  sample.brain =
    '일지에 하루 여러 짧은 기록을 남기고 싶다.\n시간 계획도 있으면 업무가 덜 흩어질까?\n회의 전에 비교할 화면을 준비하자.';
  sample.idea =
    '계획을 실제 기록으로 자동 복사하지 말기.\n예상 밖 업무가 끼어든 시간도 남길 수 있으면 좋겠다.';
  sample.feedback =
    '오전에는 시안을 보여주면서 이야기하니 결정이 빨랐다.\n문의 처리로 회의가 10분 밀렸다. 내일은 오전에 여유 20분을 잡자.';
  sample.plan = [
    box('p1', 510, 540, '오늘 업무 정리'),
    box('p2', 540, 630, '일지 화면 기획'),
    box('p3', 630, 670, '시안 공유', 'meeting'),
    box('p4', 670, 720, '피드백 반영'),
    box('p5', 720, 780, '점심과 산책', 'life'),
    box('p6', 780, 870, 'AI 읽기 화면 수정'),
    box('p7', 870, 900, '잠깐 쉬기', 'life'),
    box('p8', 900, 960, '모바일 입력 흐름'),
    box('p9', 960, 990, '변경점 확인'),
    box('p10', 1020, 1040, '하루 회고'),
  ];
  sample.actual = [
    box('a1', 520, 550, '우선순위 정리'),
    box(
      'a2',
      550,
      620,
      '일지 시안 2개 작성',
      'focus',
      '연속 일지와 타임박싱 예시를 비교할 수 있게 준비했다.',
    ),
    box(
      'a3',
      620,
      640,
      '급한 문의 처리',
      'interrupt',
      '예정에 없던 확인 요청. 회의를 10분 늦췄다.',
    ),
    box(
      'a4',
      640,
      680,
      '시안 공유',
      'meeting',
      '시간표는 계획과 실제 기록을 나누는 방향으로 검토했다.',
    ),
    box('a5', 680, 720, '모바일 간격 조정'),
    box('a6', 720, 780, '점심과 산책', 'life'),
    box(
      'a7',
      790,
      850,
      'AI 결과 구성 정리',
      'focus',
      '큰 아이콘을 줄이고 본문과 요청 정보를 구분했다.',
    ),
  ];
  const previous = emptyDay();
  previous.priorities = [
    { text: '밀린 메모 정리하기', done: true },
    { text: '월요일 업무 순서 정하기', done: true },
    { text: '저녁 산책', done: true },
  ];
  previous.brain = '짧은 메모를 일지로 남기면 다시 찾기 쉽겠다.';
  previous.idea = '중요한 기록은 기존 페이지와 연결하기.';
  previous.feedback = '긴 계획보다 오늘 꼭 할 일을 적는 방식이 잘 맞았다.';
  previous.plan = [box('pp1', 600, 660, '메모 정리'), box('pp2', 1020, 1080, '다음 주 계획')];
  previous.actual = [
    box('pa1', 610, 670, '메모 8개 정리'),
    box('pa2', 1030, 1070, '월요일 업무 순서 정리'),
  ];
  let state = {
    days: options.storage?.days || (options.empty ? {} : { [TODAY]: sample, '2026-10-04': previous }),
    theme: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light',
  };
  let storageLocked = false,
    selected = TODAY,
    editing = null;
  const validBox = (b) =>
    b &&
    (b.missed === undefined || typeof b.missed === 'boolean') &&
    typeof b.id === 'string' &&
    b.id.length <= 80 &&
    typeof b.title === 'string' &&
    b.title.length <= 160 &&
    typeof b.note === 'string' &&
    b.note.length <= 2000 &&
    ['focus', 'meeting', 'life', 'interrupt'].includes(b.kind) &&
    Number.isInteger(b.start) &&
    Number.isInteger(b.end) &&
    b.start >= 0 &&
    b.end <= 1440 &&
    b.start < b.end &&
    b.start % 10 === 0 &&
    b.end % 10 === 0;
  function validState(s) {
    if (!s || !s.days || !['light', 'dark'].includes(s.theme) || Object.keys(s.days).length > 1000)
      return false;
    return Object.entries(s.days).every(
      ([date, d]) =>
        validDate(date) &&
        d &&
        Array.isArray(d.priorities) &&
        d.priorities.length <= 20 &&
        d.priorities.every(
          (p) => typeof p.text === 'string' && p.text.length <= 300 && typeof p.done === 'boolean',
        ) &&
        ['brain', 'idea', 'feedback'].every(
          (k) => typeof d[k] === 'string' && d[k].length <= 10000,
        ) &&
        ['plan', 'actual'].every(
          (k) =>
            Array.isArray(d[k]) &&
            d[k].length <= 100 &&
            d[k].every(validBox) &&
            new Set(d[k].map((b) => b.id)).size === d[k].length,
        ),
    );
  }
  let storedRaw = null;
  try {
    const raw = options.storage ? null : localStorage.getItem(KEY);
    storedRaw = raw;
    if (raw) {
      const stored = JSON.parse(raw);
      if (!validState(stored)) throw Error('invalid');
      state = { ...stored, days: parseLegacyJournal(raw) };
    }
  } catch {
    storageLocked = true;
    $('storageError').textContent =
      '저장된 기록을 읽지 못했어요. 원래 자료를 덮어쓰지 않도록 저장을 멈췄어요.';
    $('storageError').hidden = false;
  }
  state.days = Object.fromEntries(Object.entries(state.days).map(([date,day]) => [date,normalizeJournalDay(day,date)]));
  let pendingSaves = 0, saveGeneration = 0;
  function persist(next) {
    if (storageLocked) return false;
    if (options.storage) {
      for (const [date,day] of Object.entries(next.days)) {
        if (JSON.stringify(day) === JSON.stringify(state.days[date])) continue;
        const generation = ++saveGeneration;
        pendingSaves++;
        $('saveStatus').textContent = '기기에 저장 중…';
        options.storage.save(date,day).then(() => {
          if (!cleanup.signal.aborted && generation === saveGeneration && !storageLocked)
            $('saveStatus').textContent = '이 기기에 저장됨 · 서버 반영은 상단 동기화 상태에서 확인';
        }).catch(error => {
          storageLocked = true;
          if (cleanup.signal.aborted) return;
          $('saveStatus').textContent = '저장 확인 필요';
          $('storageError').textContent = (error?.message || '기기 저장을 완료하지 못했어요.') + ' 입력을 복사한 뒤 다시 열어 주세요.';
          $('storageError').hidden = false;
        }).finally(() => pendingSaves--);
      }
      return true;
    }
    try {
      if (localStorage.getItem(KEY) !== storedRaw) throw Error('changed elsewhere');
      const serialized = JSON.stringify(next);
      localStorage.setItem(KEY, serialized);
      storedRaw = serialized;
      $('saveStatus').textContent = options.empty
        ? '이 기기에 저장됨 · 서버 동기화 미연결'
        : '이 브라우저에 저장됨';
      $('storageError').hidden = true;
      return true;
    } catch {
      $('saveStatus').textContent = '저장하지 못함';
      $('storageError').textContent =
        '저장하지 못했어요. 다른 창에서 변경했거나 저장 공간이 부족할 수 있어요. 입력을 복사한 뒤 새로고침하거나 다시 시도해 주세요.';
      $('storageError').hidden = false;
      return false;
    }
  }
  function current() {
    return state.days[selected] || emptyDay(selected);
  }
  function updateDate(date, change) {
    const next = clone(state);
    next.days[date] = clone(state.days[date] || emptyDay(date));
    change(next.days[date]);
    if (!persist(next)) return false;
    state = next;
    renderCalendar();
    return true;
  }
  const updateDay = change => updateDate(selected,change);
  function hm(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  function minutes(value) {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  }
  function duration(min) {
    const h = Math.floor(min / 60),
      m = min % 60;
    return `${h ? h + '시간' : ''}${h && m ? ' ' : ''}${m ? m + '분' : ''}` || '0분';
  }
  let view = 'day',
    scheduleView = 'axis',
    calendarMonth = TODAY.slice(0, 7) + '-01';
  const periodDates = () => (view === 'week' ? weekDates(selected) : monthDates(selected));
  const shortDate = (key) =>
    new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(key + 'T12:00:00Z'));
  function visibleDays() {
    return Object.fromEntries(
      Object.entries(state.days).map(([date, day]) => [date, { ...day, actual: [] }]),
    );
  }
  function summary() {
    const total = view === 'day' ? dayStats(current()) : summarize(visibleDays(), periodDates());
    if (view === 'review') {
      $('daySummary').textContent = `미이행 ${missedCount(Object.keys(state.days))}개 · 전체 날짜`;
      return;
    }
    const core = total.filled ? `핵심 ${total.done}/${total.filled} 완료 · ` : '';
    $('daySummary').textContent =
      `${core}계획 ${duration(total.plan)} · 미이행 ${missedCount(view === 'day' ? [selected] : periodDates())}개`;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function openDate(key) {
    if (!flush() || !validDate(key) || key < '2020-01-01' || key > '2099-12-31') return;
    selected = key;
    view = 'day';
    calendarMonth = key.slice(0, 7) + '-01';
    render();
  }
  function renderCalendar() {
    const month = monthDates(calendarMonth),
      first = (new Date(month[0] + 'T12:00:00Z').getUTCDay() + 6) % 7;
    $('calendarTitle').textContent = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(calendarMonth + 'T12:00:00Z'));
    $('calendarPrev').disabled = calendarMonth <= '2020-01-01';
    $('calendarNext').disabled = calendarMonth >= '2099-12-01';
    const fragment = document.createDocumentFragment();
    for (const weekday of ['월', '화', '수', '목', '금', '토', '일'])
      fragment.append(element('span', 'weekday', weekday));
    for (let i = 0; i < first; i++) fragment.append(element('span'));
    for (const key of month) {
      const stats = dayStats(state.days[key]),
        button = element('button', 'calendar-day', String(Number(key.slice(-2))));
      button.dataset.date = key;
      button.dataset.today = String(key === TODAY);
      button.setAttribute('aria-pressed', String(key === selected));
      const written = Boolean(
        state.days[key]?.plan.length ||
        state.days[key]?.priorities.some((p) => p.text.trim()) ||
        ['brain', 'idea', 'feedback'].some((k) => state.days[key]?.[k]?.trim()),
      );
      button.setAttribute(
        'aria-label',
        `${shortDate(key)} · ${written ? '타임박싱 작성함' : '작성하지 않음'}`,
      );
      if (written) {
        const mark = element('i', 'date-mark recorded');
        mark.setAttribute('aria-hidden', 'true');
        button.append(mark);
      }
      button.onclick = () => openDate(key);
      fragment.append(button);
    }
    $('calendar').replaceChildren(fragment);
  }
  function renderLists() {
    for (const mode of ['plan']) {
      const rows = current()
          [mode].slice()
          .sort((a, b) => a.start - b.start),
        list = $(mode + 'List');
      list.replaceChildren();
      $(mode + 'Total').textContent = rows.length
        ? `${rows.length}개 · ${duration(rows.reduce((n, b) => n + b.end - b.start, 0))}`
        : '';
      if (!rows.length)
        list.append(
          element(
            'p',
            'empty-list',
            mode === 'plan'
              ? '아직 계획한 시간이 없어요. +로 추가해요.'
              : '실제로 한 일을 +로 남겨보세요.',
          ),
        );
      for (const entry of rows) {
        const button = element('button', 'entry-row' + (entry.missed ? ' missed' : ''));
        button.dataset.id = entry.id;
        button.setAttribute(
          'aria-label',
          `${mode === 'plan' ? '계획' : '실제 기록'} ${hm(entry.start)}–${hm(entry.end)} ${entry.title} 수정`,
        );
        const time = element('span', 'entry-time', `${hm(entry.start)}–${hm(entry.end)}`);
        button.title = `${hm(entry.start)}–${hm(entry.end)} · ${duration(entry.end - entry.start)}`;
        const copy = element('span', 'entry-copy');
        copy.append(element('span', 'entry-title', entry.title));
        button.append(time, copy);
        button.onclick = () => openEntry(mode, entry);
        list.append(button);
      }
    }
  }
  function renderPeriod() {
    const dates = periodDates(),
      totals = summarize(visibleDays(), dates);
    $('periodHeading').textContent = view === 'week' ? '한 주의 우선순위와 회고' : '이달의 계획과 회고';
    $('periodCount').textContent =
      `내용 있는 날 ${totals.contentDays}일 · 기록·메모 ${totals.recordedDays}일`;
    const table = element('table', 'summary-table');
    table.dataset.period = view;
    const caption = element(
      'caption',
      'sr-only',
      view === 'week' ? '날짜별 계획과 미이행 항목' : '이달의 주별 계획과 미이행 항목',
    );
    table.append(caption);
    const headers =
      view === 'week'
        ? ['날짜', '핵심 할 일', '계획 시간', '미이행', '하루 돌아보기']
        : ['기간', '계획', '미이행', '기록·메모', '내용 있는 날'];
    const head = element('thead'),
      headRow = element('tr');
    headers.forEach((label) => {
      const th = element('th', '', label);
      th.scope = 'col';
      headRow.append(th);
    });
    head.append(headRow);
    table.append(head);
    const body = element('tbody');
    const groups = view === 'week' ? dates.map((d) => [d]) : monthWeeks(selected);
    for (const keys of groups) {
      const total = summarize(visibleDays(), keys),
        row = element('tr', total.contentDays ? '' : 'empty-period');
      const label =
        keys.length === 1
          ? shortDate(keys[0])
          : `${Number(keys[0].slice(-2))}–${Number(keys.at(-1).slice(-2))}일`;
      const td = element('td');
      if (view === 'week') {
        const button = element('button', '', label);
        button.onclick = () => openDate(keys[0]);
        td.append(button);
      } else {
        const button = element('button', '', label);
        button.setAttribute('aria-label', `${label}이 포함된 주 보기`);
        button.onclick = () => {
          if (!flush()) return;
          selected = keys[0];
          view = 'week';
          calendarMonth = selected.slice(0, 7) + '-01';
          render();
        };
        td.append(button);
      }
      row.append(td);
      const d = state.days[keys[0]],
        excerpt =
          d?.feedback.trim() ||
          d?.brain.trim() ||
          d?.idea.trim() ||
          d?.priorities
            .filter((p) => p.text.trim())
            .map((p) => p.text)
            .join(' · ') ||
          (d?.plan.length ? '계획만 작성' : '—');
      const priorities = d?.priorities.filter(p => p.text.trim()).map(p => `${p.done ? '✓' : '○'} ${p.text}`).join('\n') || '—';
      const missed = d?.plan.filter(p => p.missed).map(p => p.title).join(' · ') || '—';
      const values = view === 'week'
        ? [priorities,total.plan ? duration(total.plan) : '—',missed,d?.feedback.trim() || '—']
        : [total.plan ? duration(total.plan) : '—',`${missedCount(keys)}개`,`${total.recordedDays}일`,`${total.contentDays}일 / ${keys.length}일`];
      values.forEach((value, i) => {
        const cell = element('td', total.contentDays ? '' : 'unwritten', value);
        cell.dataset.label = headers[i + 1];
        row.append(cell);
      });
      body.append(row);
    }
    table.append(body);
    const foot = element('tfoot'),
      footRow = element('tr');
    [
      '합계',
      view === 'week' ? `${totals.done}/${totals.filled} 완료` : duration(totals.plan),
      view === 'week' ? duration(totals.plan) : `${missedCount(dates)}개`,
      view === 'week' ? `${missedCount(dates)}개` : `${totals.recordedDays}일`,
      `내용 있는 날 ${totals.contentDays}일`,
    ].forEach((v, i) => {
      const cell = element('td', '', v);
      cell.dataset.label = headers[i];
      footRow.append(cell);
    });
    foot.append(footRow);
    table.append(foot);
    $('periodTable').replaceChildren(table);
    $('periodReflections').replaceChildren();
    let count = 0;
    for (const key of dates) {
      const feedback = state.days[key]?.feedback.trim();
      if (!feedback && view !== 'month') continue;
      count++;
      const article = element('article', 'reflection'),
        button = element('button', '', shortDate(key));
      button.onclick = () => openDate(key);
      article.dataset.date = key;
      const day = state.days[key];
      if (view === 'month' && day?.priorities.some(p => p.text.trim()))
        article.append(element('p','month-priorities',day.priorities.filter(p => p.text.trim()).map(p => `${p.done ? '✓' : '○'} ${p.text}`).join(' · ')));
      article.prepend(button);
      article.append(element('p',feedback ? '' : 'unwritten',feedback || '남긴 회고 없음'));
      if (view === 'month' && day?.plan.some(p => p.missed))
        article.append(element('p','month-missed','미이행 · ' + day.plan.filter(p => p.missed).map(p => p.title).join(' · ')));
      $('periodReflections').append(article);
    }
    if (!count)
      $('periodReflections').append(
        element(
          'p',
          'empty-list',
          '아직 남긴 회고가 없어요. 날짜를 열어 하루 돌아보기를 적어보세요.',
        ),
      );
  }
  function renderSchedule() {
    $('timeLists').hidden = scheduleView !== 'list';
    $('axisView').hidden = scheduleView !== 'axis';
    document
      .querySelectorAll('[data-schedule]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.schedule === scheduleView)));
    renderLists();
    if (scheduleView === 'axis') renderGrid();
  }
  function fitText(element, min = 72) {
    element.style.height = 'auto';
    const style = getComputedStyle(element);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    element.style.height = Math.max(min, Math.min(600, element.scrollHeight + border + 1)) + 'px';
    element.style.overflowY = element.scrollHeight > element.clientHeight ? 'auto' : 'hidden';
  }
  function fitAllText() {
    document.querySelectorAll('.note-section textarea').forEach((e) => fitText(e));
    document
      .querySelectorAll('.priority-row textarea:not([hidden])')
      .forEach((e) => fitText(e, 36));
  }
  let removedPriority = null;
  $('addPriority').onclick = () => {
    if (!flush() || current().priorities.length >= 20) return;
    if (!updateDay((d) => d.priorities.push({ id: crypto.randomUUID(), text: '', done: false }))) return;
    renderPriorities();
    summary();
    $('priorityList').lastElementChild.querySelector('.priority-edit').click();
  };
  $('undoPriority').onclick = () => {
    if (
      !removedPriority ||
      removedPriority.date !== selected ||
      !flush() ||
      current().priorities.length >= 20
    )
      return;
    if (!updateDay((d) => d.priorities.splice(removedPriority.index, 0, removedPriority.item)))
      return;
    removedPriority = null;
    renderPriorities();
    summary();
  };
  function renderPriorities() {
    $('addPriority').disabled = current().priorities.length >= 20;
    $('priorityUndo').hidden = !removedPriority || removedPriority.date !== selected;
    $('undoPriority').disabled = current().priorities.length >= 20;
    $('priorityList').replaceChildren();
    current().priorities.forEach((p, i) => {
      const row = document.createElement('div');
      row.className =
        'priority-row' + (p.done ? ' done' : '') + (!p.text.trim() ? ' is-empty' : '');
      const label = document.createElement('label'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = p.done;
      check.disabled = !p.text.trim();
      check.setAttribute('aria-label', `핵심 할 일 ${i + 1} 완료`);
      label.append(check);
      const number = document.createElement('span');
      number.className = 'priority-number';
      number.textContent = String(i + 1).padStart(2, '0');
      const text = document.createElement('textarea');
      text.rows = 1;
      text.maxLength = 300;
      text.value = p.text;
      text.placeholder = '할 일 입력';
      text.setAttribute('aria-label', `핵심 할 일 ${i + 1}`);
      text.hidden = true;
      const toggle = element('button', 'priority-text', p.text || '할 일 입력');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(p.done));
      toggle.setAttribute(
        'aria-label',
        `핵심 할 일 ${i + 1} ${p.done ? '완료 해제' : '완료 표시'}`,
      );
      const edit = element('button', 'priority-edit', '수정');
      edit.type = 'button';
      edit.setAttribute('aria-label', `핵심 할 일 ${i + 1} 내용 수정`);
      const beginEdit = () => {
        toggle.hidden = true;
        text.hidden = false;
        fitText(text, 36);
        text.focus();
      };
      edit.onclick = beginEdit;
      toggle.onclick = () => {
        if (!text.value.trim()) return beginEdit();
        check.click();
      };
      row.addEventListener('click', (event) => {
        if (event.target === row || event.target === number) check.click();
      });
      text.addEventListener('blur', () => {
        toggle.textContent = text.value || '할 일 입력';
        row.classList.toggle('is-empty', !text.value.trim());
        text.hidden = true;
        toggle.hidden = false;
      });
      text.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          text.blur();
          edit.focus();
        }
      });
      check.addEventListener('change', () => {
        if (!updateDay((d) => (d.priorities[i].done = check.checked))) {
          check.checked = !check.checked;
          return;
        }
        row.classList.toggle('done', check.checked);
        toggle.setAttribute('aria-pressed', String(check.checked));
        toggle.setAttribute(
          'aria-label',
          `핵심 할 일 ${i + 1} ${check.checked ? '완료 해제' : '완료 표시'}`,
        );
        summary();
      });
      text.addEventListener('input', () => {
        fitText(text, 36);
        check.disabled = !text.value.trim();
        plan.disabled = !text.value.trim();
        toggle.draggable = Boolean(text.value.trim());
        row.classList.toggle('is-empty', !text.value.trim());
        if (
          updateDay((d) => {
            d.priorities[i].text = text.value;
            if (!text.value.trim()) d.priorities[i].done = false;
          })
        ) {
          if (!text.value.trim()) {
            check.checked = false;
            row.classList.remove('done');
            toggle.setAttribute('aria-pressed', 'false');
          }
          summary();
        }
      });
      const remove = element('button', 'priority-remove', '삭제');
      remove.type = 'button';
      remove.setAttribute('aria-label', `핵심 할 일 ${i + 1} 삭제`);
      remove.onclick = () => {
        if (!flush()) return;
        const removed = clone(current().priorities[i]);
        if (!updateDay((d) => d.priorities.splice(i, 1))) return;
        removedPriority = { date: selected, index: i, item: removed };
        renderPriorities();
        summary();
        $('undoPriority').focus();
      };
      const plan = element('button','priority-plan','시간 잡기');
      plan.type = 'button';
      plan.disabled = !p.text.trim();
      plan.setAttribute('aria-label',`핵심 할 일 ${i + 1} 시간 계획`);
      plan.onclick = () => openPriorityPlan(current().priorities.find(item => item.id === p.id));
      toggle.draggable = Boolean(p.text.trim());
      toggle.addEventListener('dragstart',event => {
        if (!current().priorities.find(item => item.id === p.id)?.text.trim() || !flush()) return event.preventDefault();
        event.dataTransfer.setData('application/x-anotar-priority',JSON.stringify({ date:selected,id:p.id }));
        event.dataTransfer.effectAllowed = 'copy';
      });
      row.append(label, number, toggle, text, plan, edit, remove);
      $('priorityList').append(row);
    });
  }
  function missedCount(dates) {
    return dates.reduce(
      (sum, date) => sum + (state.days[date]?.plan.filter((e) => e.missed).length || 0),
      0,
    );
  }
  function toggleMissed(id) {
    if (!flush()) return;
    if (
      !updateDay((d) => {
        const entry = d.plan.find((e) => e.id === id);
        if (entry) entry.missed = !entry.missed;
      })
    )
      return;
    renderSchedule();
    summary();
    document.querySelector(`#daySheet .hour-entry[data-id="${CSS.escape(id)}"]`)?.focus();
  }
  function renderReview() {
    const list = $('reviewList');
    list.replaceChildren();
    for (const date of Object.keys(state.days).sort().reverse()) {
      const entries = state.days[date].plan
        .filter((e) => e.missed)
        .sort((a, b) => a.start - b.start);
      if (!entries.length) continue;
      const group = element('section', 'review-day');
      group.append(
        element(
          'h3',
          '',
          new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            timeZone: 'UTC',
          }).format(new Date(date + 'T12:00:00Z')),
        ),
      );
      for (const entry of entries) {
        const button = element('button', 'review-entry');
        button.append(
          element('span', '', `${hm(entry.start)}–${hm(entry.end)}`),
          element('span', '', entry.title),
        );
        button.onclick = () => {
          if (!flush()) return;
          openDate(date);
          openEntry('plan', entry);
        };
        const row = element('div','review-plan');
        const again = element('button','review-again','다시 계획');
        again.setAttribute('aria-label',`${entry.title} 다시 계획`);
        again.onclick = () => openReplan(date,entry);
        row.append(button,again);
        group.append(row);
      }
      list.append(group);
    }
    if (!list.children.length)
      list.append(
        element(
          'p',
          'empty-list',
          '미이행으로 표시한 계획이 없어요. 일정의 × 버튼으로 남길 수 있어요.',
        ),
      );
  }
  let suppressClickUntil = 0;
  root.addEventListener(
    'click',
    (event) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true, signal: cleanup.signal },
  );
  let dragNoticeTimer;
  function showDragNotice(message, duration = 4000) {
    clearTimeout(dragNoticeTimer);
    $('dragStatus').textContent = message;
    if (message && duration) {
      dragNoticeTimer = setTimeout(() => {
        $('dragStatus').textContent = '';
      }, duration);
    }
  }
  cleanup.signal.addEventListener('abort', () => clearTimeout(dragNoticeTimer), { once: true });
  function wireDrag(target, entry, kind) {
    target.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || down.pointerType === 'touch' || !flush()) return;
      showDragNotice('');
      const cells = [...document.querySelectorAll('.hour-cell')];
      const rows = cells.map((cell, hour) => ({ cell, hour, rect: cell.getBoundingClientRect() }));
      const initial = target.closest('.day-hour');
      const initialHour = Number(initial.dataset.hour);
      const initialRect = rows[initialHour].rect;
      const initialTime =
        initialHour * 60 + ((down.clientX - initialRect.left) / initialRect.width) * 60;
      const controller = new AbortController();
      let dragging = false,
        candidate = { ...entry, conflict: false };
      const removeGhosts = () =>
        document.querySelectorAll('.drag-preview').forEach((e) => e.remove());
      const pointTime = (event) => {
        const row =
          rows.find((r) => event.clientY >= r.rect.top && event.clientY < r.rect.bottom) ||
          (event.clientY < rows[0].rect.top ? rows[0] : rows.at(-1));
        return (
          row.hour * 60 +
          Math.max(0, Math.min(60, ((event.clientX - row.rect.left) / row.rect.width) * 60))
        );
      };
      const paint = () => {
        removeGhosts();
        for (const { cell, hour } of rows) {
          const from = hour * 60,
            to = from + 60;
          if (candidate.start >= to || candidate.end <= from) continue;
          const ghost = element(
            'div',
            'drag-preview' + (candidate.conflict ? ' conflict' : ''),
            `${hm(candidate.start)}–${hm(candidate.end)} · ${entry.title}`,
          );
          ghost.style.gridColumn = `${(Math.max(candidate.start, from) - from) / 10 + 1} / ${(Math.min(candidate.end, to) - from) / 10 + 1}`;
          cell.append(ghost);
        }
        showDragNotice(
          candidate.conflict
            ? '다른 계획과 겹쳐요. 빈 시간으로 옮겨주세요.'
            : `${hm(candidate.start)}–${hm(candidate.end)}`,
          0,
        );
      };
      const finish = (commit) => {
        controller.abort();
        cleanup.signal.removeEventListener('abort', cancel);
        if (target.hasPointerCapture?.(down.pointerId))
          target.releasePointerCapture(down.pointerId);
        removeGhosts();
        $('daySheet').classList.remove('is-dragging');
        if (!dragging) return;
        suppressClickUntil = performance.now() + 350;
        if (
          commit &&
          !candidate.conflict &&
          (candidate.start !== entry.start || candidate.end !== entry.end)
        ) {
          const ok = updateDay((d) => {
            const item = d.plan.find((e) => e.id === entry.id);
            if (item) {
              item.start = candidate.start;
              item.end = candidate.end;
            }
          });
          if (ok) {
            renderSchedule();
            summary();
            showDragNotice(`${hm(candidate.start)}–${hm(candidate.end)}로 변경했어요.`);
          } else showDragNotice('저장하지 못해 원래 시간으로 유지했어요.');
        } else
          showDragNotice(commit && candidate.conflict ? '시간이 겹쳐 원래 계획을 유지했어요.' : '');
      };
      const cancel = () => finish(false);
      cleanup.signal.addEventListener('abort', cancel, { once: true });
      window.addEventListener(
        'pointermove',
        (event) => {
          if (event.pointerId !== down.pointerId) return;
          if (
            !dragging &&
            Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < 6
          )
            return;
          if (!dragging) {
            dragging = true;
            target.setPointerCapture(down.pointerId);
            $('daySheet').classList.add('is-dragging');
          }
          event.preventDefault();
          candidate = adjustPlan(entry, kind, pointTime(event) - initialTime, current().plan);
          paint();
        },
        { signal: controller.signal, passive: false },
      );
      window.addEventListener(
        'pointerup',
        (event) => {
          if (event.pointerId === down.pointerId) finish(true);
        },
        { signal: controller.signal },
      );
      window.addEventListener('pointercancel', cancel, { signal: controller.signal });
      window.addEventListener('resize', cancel, { signal: controller.signal });
      window.addEventListener('scroll', cancel, { capture: true, signal: controller.signal });
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        },
        { signal: controller.signal },
      );
    });
  }
  function renderGrid() {
    const sheet = $('daySheet');
    sheet.replaceChildren();
    for (let hour = 0; hour < 24; hour++) {
      const from = hour * 60,
        to = from + 60,
        row = element('div', 'day-hour');
      row.dataset.hour = String(hour);
      if (hour % 6 === 0) row.classList.add('major-hour');
      const label = element('span', 'day-hour-label', hm(from));
      row.append(label);
      for (const mode of ['plan']) {
        const entries = current()
          [mode].filter((b) => b.start < to && b.end > from)
          .sort((a, b) => a.start - b.start);
        const cell = element('div', 'hour-cell');
        cell.dataset.mode = mode;
        cell.addEventListener('dragover',event => {
          if (!event.dataTransfer.types.includes('application/x-anotar-priority')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        });
        cell.addEventListener('drop',event => {
          if (!event.dataTransfer.types.includes('application/x-anotar-priority')) return;
          event.preventDefault();
          if (!flush()) return;
          let source;
          try { source = JSON.parse(event.dataTransfer.getData('application/x-anotar-priority')); } catch { return; }
          if (source.date !== selected) return;
          const priority = current().priorities.find(p => p.id === source.id);
          if (!priority?.text.trim()) return;
          const rect = cell.getBoundingClientRect();
          const start = Math.max(from,Math.min(to - 10,from + Math.floor((event.clientX - rect.left) / rect.width * 6) * 10));
          const end = defaultEnd(start);
          if (current().plan.some(b => start < b.end && end > b.start)) return showDragNotice('다른 계획과 겹쳐요. 빈 시간에 놓아 주세요.');
          if (current().plan.length >= 100) return showDragNotice('하루 계획은 100개까지 남길 수 있어요.');
          const value = { ...box(crypto.randomUUID(),start,end,priority.text.slice(0,160)), priorityId:priority.id,priorityDate:selected,priorityTitle:priority.text };
          if (updateDay(d => d.plan.push(value))) {
            renderSchedule(); summary(); showDragNotice(`${hm(start)}–${hm(end)}에 시간을 잡았어요.`);
          }
        });
        for (let slot = 0; slot < 6; slot++) {
          const time = from + slot * 10;
          if (entries.some((entry) => entry.start < time + 10 && entry.end > time)) continue;
          const empty = element('button', 'empty-hour');
          empty.style.gridColumn = String(slot + 1);
          empty.setAttribute(
            'aria-label',
            `${hm(time)} ${mode === 'plan' ? '계획' : '실제 기록'} 추가`,
          );
          empty.onclick = () => openEntry(mode, null, time);
          cell.append(empty);
        }
        for (const entry of entries) {
          const button = element('button', 'hour-entry');
          button.dataset.id = entry.id;
          button.style.gridColumn = `${(Math.max(entry.start, from) - from) / 10 + 1} / ${(Math.min(entry.end, to) - from) / 10 + 1}`;
          button.classList.toggle('continued', entry.start < from);
          button.append(element('span', 'hour-entry-title', entry.title));
          button.title = `${hm(entry.start)}–${hm(entry.end)} · ${entry.title}`;
          button.setAttribute(
            'aria-label',
            `${mode === 'plan' ? '계획' : '실제 기록'} ${button.title} 수정`,
          );
          button.onclick = () => openEntry(mode, entry);
          const slot = element('div', 'plan-slot' + (entry.missed ? ' missed' : ''));
          slot.style.gridColumn = button.style.gridColumn;
          button.style.gridColumn = '';
          const actions = element('div', 'plan-actions');
          const missed = element('button', 'missed-action', '×');
          missed.setAttribute(
            'aria-label',
            `${entry.title} ${entry.missed ? '미이행 해제' : '미이행 표시'}`,
          );
          missed.title = entry.missed ? '미이행 해제' : '미이행 표시';
          missed.onclick = () => toggleMissed(entry.id);
          missed.setAttribute('aria-pressed', String(Boolean(entry.missed)));
          actions.append(missed);
          slot.append(button, actions);
          wireDrag(button, entry, 'move');
          for (const edge of ['start', 'end']) {
            if (edge === 'start' ? entry.start < from : entry.end > to) continue;
            const handle = element('span', 'resize-handle resize-' + edge);
            handle.title = edge === 'start' ? '드래그로 시작 시간 조정' : '드래그로 종료 시간 조정';
            handle.setAttribute('aria-hidden', 'true');
            wireDrag(handle, entry, edge);
            slot.append(handle);
          }
          cell.append(slot);
        }
        row.append(cell);
      }
      sheet.append(row);
    }
  }
  function hasUnsaved() {
    const d = current();
    return (
      ['brain', 'idea', 'feedback'].some((k) => $(k).value !== d[k]) ||
      [...$('priorityList').querySelectorAll('textarea')].some(
        (t, i) => t.value !== d.priorities[i].text,
      )
    );
  }
  function flush() {
    if (!hasUnsaved()) return true;
    return updateDay((d) => {
      ['brain', 'idea', 'feedback'].forEach((k) => (d[k] = $(k).value));
      [...$('priorityList').querySelectorAll('textarea')].forEach(
        (t, i) => (d.priorities[i].text = t.value),
      );
    });
  }
  function render() {
    $('date').value = selected;
    const dates = view === 'day' ? [selected] : periodDates();
    $('dayTitle').textContent =
      view === 'day'
        ? new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            timeZone: 'UTC',
          }).format(new Date(selected + 'T12:00:00Z'))
        : view === 'week'
          ? `${shortDate(dates[0])} – ${shortDate(dates.at(-1))}`
          : new Intl.DateTimeFormat('ko-KR', {
              year: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(selected + 'T12:00:00Z'));
    $('prev').setAttribute(
      'aria-label',
      view === 'day' ? '이전 날짜' : view === 'week' ? '이전 주' : '이전 달',
    );
    $('next').setAttribute(
      'aria-label',
      view === 'day' ? '다음 날짜' : view === 'week' ? '다음 주' : '다음 달',
    );
    $('prev').disabled =
      view === 'month' ? selected.slice(0, 7) === '2020-01' : dates[0] <= '2020-01-01';
    $('next').disabled =
      view === 'month' ? selected.slice(0, 7) === '2099-12' : dates.at(-1) >= '2099-12-31';
    $('today').disabled = selected === TODAY && view === 'day';
    document
      .querySelectorAll('[data-view]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $('dailyView').hidden = view !== 'day';
    $('periodView').hidden = view === 'day' || view === 'review';
    $('reviewView').hidden = view !== 'review';
    if (view === 'review') {
      $('dayTitle').textContent = '미이행 계획 되짚어보기';
      $('daySummary').textContent = '전체 날짜의 미이행 계획';
    }
    renderPriorities();
    ['brain', 'idea', 'feedback'].forEach((k) => ($(k).value = current()[k]));
    summary();
    renderCalendar();
    if (view === 'day') renderSchedule();
    else if (view === 'review') renderReview();
    else renderPeriod();
    fitAllText();
  }
  function choose(date) {
    if (!validDate(date) || date < '2020-01-01' || date > '2099-12-31' || !flush()) {
      $('date').value = selected;
      return;
    }
    selected = date;
    calendarMonth = date.slice(0, 7) + '-01';
    render();
  }
  function move(delta) {
    if (view === 'month') {
      const d = new Date(selected.slice(0, 7) + '-01T12:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + delta);
      choose(d.toISOString().slice(0, 10));
    } else choose(addDays(selected, delta * (view === 'week' ? 7 : 1)));
  }
  function firstGap(mode) {
    const rows = current()
      [mode].slice()
      .sort((a, b) => a.start - b.start);
    let start = 540;
    for (const b of rows) {
      if (b.end <= start) continue;
      if (b.start >= start + 30) break;
      start = b.end;
    }
    return Math.min(start, 1410);
  }
  function openPriorityPlan(priority) {
    if (!priority?.text.trim()) return;
    openEntry('plan');
    if (!editing) return;
    editing.link = { priorityId:priority.id,priorityDate:selected,priorityTitle:priority.text };
    $('entryTitle').value = priority.text.slice(0,160);
    $('entryLink').textContent = `연결한 할 일 · ${priority.text}`;
    $('entryLink').hidden = false;
  }
  function openReplan(date, entry) {
    if (!flush()) return;
    openEntry('plan');
    if (!editing) return;
    editing.replan = true;
    editing.template = { kind:entry.kind,note:entry.note };
    editing.link = { sourcePlan:{ date,id:entry.id } };
    for (const key of ['priorityId','priorityDate','priorityTitle']) if (entry[key] !== undefined) editing.link[key] = entry[key];
    const target = TODAY;
    $('dialogTitle').textContent = '새 시간에 다시 계획하기';
    $('entryTitle').value = entry.title;
    $('entryDateField').hidden = false;
    $('entryDate').value = target;
    const rows = state.days[target]?.plan || [];
    let start = 540;
    for (const box of rows.slice().sort((a,b) => a.start - b.start)) {
      if (box.end <= start) continue;
      if (box.start >= start + 30) break;
      start = box.end;
    }
    start = Math.min(1410,start);
    $('start').value = hm(start);
    $('end').value = hm(defaultEnd(start) % 1440);
    $('entryMissed').checked = false;
    $('entryLink').textContent = `${shortDate(date)} 계획을 보존하고 새 기록을 만들어요.`;
    $('entryLink').hidden = false;
  }
  function openEntry(mode, entry = null, start = firstGap(mode)) {
    if (!flush()) return;
    editing = {
      date: selected,
      mode,
      id: entry?.id || null,
      length: entry ? entry.end - entry.start : 30,
      manualEnd: false,
      trigger: document.activeElement,
    };
    $('entryForm').reset();
    $('entryDateField').hidden = true;
    $('entryDate').value = selected;
    $('entryLink').hidden = !entry?.priorityId;
    $('entryLink').textContent = entry?.priorityId ? `연결한 할 일 · ${entry.priorityTitle}` : '';
    $('formError').hidden = true;
    $('dialogTitle').textContent =
      (mode === 'plan' ? '계획' : '실제 기록') + (entry ? ' 수정' : ' 추가');
    $('entryTitle').value = entry?.title || '';
    $('entryMissed').checked = Boolean(entry?.missed);
    $('entryTitle').placeholder = mode === 'plan' ? '이 시간에 할 일' : '실제로 한 일';
    $('start').value = hm(entry?.start ?? start);
    $('end').value = hm((entry?.end ?? defaultEnd(start)) % 1440);
    $('remove').hidden = !entry;
    $('entryDialog').showModal();
  }
  function closeEntry() {
    const trigger = editing?.trigger;
    $('entryDialog').close();
    editing = null;
    if (trigger?.isConnected) trigger.focus();
  }
  function formError(message) {
    $('formError').textContent = message;
    $('formError').hidden = false;
  }
  function applyEntry(remove = false) {
    if (!editing || editing.date !== selected) return;
    const start = minutes($('start').value),
      rawEnd = minutes($('end').value),
      end = rawEnd === 0 ? 1440 : rawEnd,
      title = $('entryTitle').value.trim();
    const rows = editing.replan ? (state.days[$('entryDate').value]?.plan || []) : current()[editing.mode];
    if (!remove) {
      if (!title) return formError('내용을 적어주세요.');
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start >= end ||
        start < 0 ||
        end > 1440 ||
        start % 10 ||
        end % 10
      )
        return formError('종료는 시작보다 늦게, 시간은 10분 단위로 정해주세요.');
      if (rows.some((b) => b.id !== editing.id && start < b.end && end > b.start))
        return formError('같은 열에 겹치는 시간이 있어요. 시작·종료 시간을 조정해주세요.');
      if (!editing.id && rows.length >= 100)
        return formError('하루에 100개까지 남길 수 있어요. 기존 기록을 수정해주세요.');
    }
    const mode = editing.mode,
      id = editing.id;
    const targetDate = editing.replan ? $('entryDate').value : selected;
    if (!validDate(targetDate) || targetDate < '2020-01-01' || targetDate > '2099-12-31') return formError('계획할 날짜를 확인해 주세요.');
    if (editing.replan && (state.days[targetDate]?.plan || []).some(b => start < b.end && end > b.start)) return formError('다시 계획할 날짜에 시간이 겹쳐요. 시간을 조정해 주세요.');
    const ok = updateDate(targetDate,(d) => {
      const items = d[mode];
      if (remove) d[mode] = items.filter((b) => b.id !== id);
      else {
        const original = items.find((b) => b.id === id);
        const value = box(
          id || crypto.randomUUID(),
          start,
          end,
          title,
          original?.kind || editing.template?.kind || 'focus',
          original?.note || editing.template?.note || '',
        );
        for (const key of ['priorityId','priorityDate','priorityTitle','sourcePlan'])
          if ((original || editing.link)?.[key] !== undefined) value[key] = (original || editing.link)[key];
        value.missed = $('entryMissed').checked;
        const index = items.findIndex((b) => b.id === id);
        if (index < 0) items.push(value);
        else items[index] = value;
      }
    });
    if (!ok)
      return formError(
        '저장하지 못했어요. 입력한 내용은 그대로 두었어요. 저장을 다시 시도해 주세요.',
      );
    closeEntry();
    if (targetDate !== selected) openDate(targetDate);
    summary();
    renderSchedule();
    const focus = [
      ...document.querySelectorAll(
        scheduleView === 'axis'
          ? `#daySheet [data-mode="${mode}"] .hour-entry`
          : '#' + mode + 'List .entry-row',
      ),
    ].find((b) => b.dataset.id === id);
    (
      focus ||
      $(
        scheduleView === 'axis'
          ? mode === 'plan'
            ? 'axisAddPlan'
            : 'axisAddActual'
          : mode === 'plan'
            ? 'addPlan'
            : 'addActual',
      )
    ).focus();
  }
  ['brain', 'idea', 'feedback'].forEach((k) =>
    $(k).addEventListener('input', () => {
      fitText($(k));
      if (updateDay((d) => (d[k] = $(k).value))) summary();
    }),
  );
  $('prev').onclick = () => move(-1);
  $('next').onclick = () => move(1);
  $('today').onclick = () => openDate(TODAY);
  $('date').onchange = (event) => choose(event.target.value);
  $('addPlan').onclick = () => openEntry('plan');
  $('axisAddPlan').onclick = () => openEntry('plan');
  $('start').addEventListener('input', () => {
    if (!editing || editing.manualEnd || !$('start').value) return;
    $('end').value = hm(defaultEnd(minutes($('start').value), editing.length) % 1440);
  });
  $('end').addEventListener('input', () => {
    if (editing) editing.manualEnd = true;
  });
  document.querySelectorAll('[data-view]').forEach(
    (b) =>
      (b.onclick = () => {
        if (!flush()) return;
        view = b.dataset.view;
        render();
      }),
  );
  document.querySelectorAll('[data-schedule]').forEach(
    (b) =>
      (b.onclick = () => {
        if (!flush()) return;
        scheduleView = b.dataset.schedule;
        renderSchedule();
      }),
  );
  $('calendarToggle').onclick = () => {
    const open = $('calendarRail').classList.toggle('open');
    $('calendarToggle').setAttribute('aria-expanded', String(open));
  };
  function moveCalendar(delta) {
    const date = new Date(calendarMonth + 'T12:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + delta);
    const key = date.toISOString().slice(0, 10);
    if (key < '2020-01-01' || key > '2099-12-01') return;
    calendarMonth = key;
    renderCalendar();
  }
  $('calendarPrev').onclick = () => moveCalendar(-1);
  $('calendarNext').onclick = () => moveCalendar(1);
  $('entryForm').onsubmit = (event) => {
    event.preventDefault();
    applyEntry();
  };
  $('remove').onclick = () => applyEntry(true);
  $('closeDialog').onclick = $('cancel').onclick = closeEntry;
  $('entryDialog').addEventListener('close', () => (editing = null));
  function theme() {
    if (!options.embedded) document.documentElement.dataset.theme = state.theme;
    $('theme').setAttribute(
      'aria-label',
      state.theme === 'light' ? '어두운 화면으로 전환' : '밝은 화면으로 전환',
    );
  }
  $('theme').onclick = () => {
    if (!flush()) return;
    const next = clone(state);
    next.theme = state.theme === 'light' ? 'dark' : 'light';
    if (persist(next)) state = next;
    theme();
  };
  window.addEventListener(
    'beforeunload',
    (event) => {
      if (pendingSaves || hasUnsaved() || ($('entryDialog').open && $('entryTitle').value.trim())) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    { signal: cleanup.signal },
  );
  let mobile = matchMedia('(max-width:620px)');
  mobile.addEventListener(
    'change',
    () => {
      if (scheduleView === 'axis' && view === 'day') renderGrid();
      fitAllText();
    },
    { signal: cleanup.signal },
  );
  window.addEventListener('resize', fitAllText, { signal: cleanup.signal });
  document.fonts.ready.then(() => {
    if (!cleanup.signal.aborted) fitAllText();
  });
  theme();
  render();
  if (options.storage) {
    $('saveStatus').textContent = '이 기기에 저장 · 서버 반영은 상단 동기화 상태에서 확인';
    if (options.storage.notice) {
      $('storageError').textContent = options.storage.notice;
      $('storageError').hidden = false;
    }
    const off = options.storage.subscribe(days => {
      if (cleanup.signal.aborted) return [];
      const accepted = [];
      const changed = JSON.stringify(days[selected]) !== JSON.stringify(state.days[selected]);
      const focused = document.activeElement?.tagName === 'TEXTAREA';
      const keepCurrent = pendingSaves || hasUnsaved() || focused || $('entryDialog').open || storageLocked;
      for (const [date,day] of Object.entries(days)) {
        if (date === selected && keepCurrent && changed) continue;
        state.days[date] = clone(day);
        accepted.push(date);
      }
      if (changed && !keepCurrent) render();
      else { renderCalendar(); summary(); if (view !== 'day') view === 'review' ? renderReview() : renderPeriod(); }
      return accepted;
    });
    cleanup.signal.addEventListener('abort',off,{ once:true });
  } else if (options.empty) $('saveStatus').textContent = '이 기기에 저장 · 서버 동기화 미연결';

  return () => {
    cleanup.abort();
    $('entryDialog').close();
  };
}
