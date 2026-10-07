import { comparePageRevision, revisionBlockLabel, type RevisionBlock } from './pageRevisionDiff.ts';

export function conflictText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const inline = value.every(
      (v) => v && typeof v === 'object' && ['text', 'link'].includes(v.type),
    );
    return value
      .map(conflictText)
      .filter(Boolean)
      .join(inline ? '' : '\n');
  }
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  if (v.day) return conflictText(v.day);
  if (v.priorities)
    return [
      `핵심 할 일\n${conflictText(v.priorities)}`,
      `시간 계획\n${conflictText(v.plan)}`,
      `하루 돌아보기\n${conflictText(v.feedback)}`,
      `아이디어\n${conflictText(v.idea)}`,
      `머릿속 생각\n${conflictText(v.brain)}`,
    ].join('\n\n');
  if (v.title) {
    const hm = (minutes: unknown) =>
      `${String(Math.floor(Number(minutes) / 60)).padStart(2, '0')}:${String(Number(minutes) % 60).padStart(2, '0')}`;
    return (
      (typeof v.start === 'number' ? `${hm(v.start)}–${hm(v.end)} ` : '') +
      String(v.title) +
      (v.missed ? ' · 미이행' : '')
    );
  }
  if (typeof v.done === 'boolean' && typeof v.text === 'string')
    return `${v.done ? '✓' : '○'} ${v.text}`;
  if (v.rows) return conflictText(v.rows);
  if (v.cells) return (v.cells as unknown[]).map(conflictText).join(' | ');
  if (v.type === 'diagram' && v.props) {
    const props = v.props as Record<string, unknown>;
    return conflictText(props.source ?? props.code ?? '');
  }
  return [conflictText(v.text ?? v.content ?? v.blocks ?? ''), conflictText(v.children)]
    .filter(Boolean)
    .join('\n');
}

export function compareConflictPages(
  server: Record<string, unknown> | null,
  local: Record<string, unknown> | null,
) {
  const a = server?.document as { blocks: unknown[] } | undefined,
    b = local?.document as { blocks: unknown[] } | undefined;
  if (!Array.isArray(a?.blocks) || !Array.isArray(b?.blocks)) return null;
  const diff = comparePageRevision(
    { title: String(server?.title ?? ''), icon: String(server?.icon ?? ''), document: a! },
    { title: String(local?.title ?? ''), icon: String(local?.icon ?? ''), document: b! },
  );
  const textChanges = diff.changes.filter(
    (change) =>
      change.kind !== 'changed' ||
      conflictText({ ...change.before!.block, children: [] }) !==
        conflictText({ ...change.after!.block, children: [] }),
  );
  const textKeys = new Set(textChanges.map((change) => change.key));
  const otherChanges = diff.changes.filter((change) => !textKeys.has(change.key));
  return {
    diff,
    textChanges,
    otherChanges,
    textChanged: textChanges.filter((change) => change.kind === 'changed').length,
    settingsChanged: otherChanges.filter((change) => change.contentChanged).length,
    moved: diff.changes.filter((c) => c.moved).length,
    contentChanged: diff.changes.filter((c) => c.kind === 'changed' && c.contentChanged).length,
  };
}

export function conflictBlockPosition(snapshot: Record<string, unknown> | null, path: number[]) {
  let siblings = (snapshot?.document as { blocks?: RevisionBlock[] })?.blocks || [];
  const parents: string[] = [];
  const name = (block: RevisionBlock) => {
    const text = conflictText({ ...block, children: [] })
      .split('\n')[0]
      .trim();
    return text
      ? `「${text.length > 48 ? text.slice(0, 48) + '…' : text}」`
      : revisionBlockLabel(block);
  };
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth] - 1;
    if (depth === path.length - 1) {
      const heading = siblings
        .slice(0, index)
        .reverse()
        .find((block) => block?.type === 'heading');
      const context = parents.length
        ? parents.join(' › ')
        : heading
          ? name(heading) + ' 항목'
          : '페이지 본문';
      const previous = siblings[index - 1];
      return context + ' · ' + (previous ? name(previous) + ' 다음' : '첫 번째 항목');
    }
    const parent = siblings[index];
    if (!parent) break;
    parents.push(name(parent) + ' 안');
    siblings = (parent.children || []) as RevisionBlock[];
  }
  return '페이지 본문';
}

// Equal plain text can still have different links, styles or table widths.
// Keep those differences inspectable without displaying the same body twice.
export function conflictBlockSettings(before: RevisionBlock, after: RevisionBlock) {
  const changes: { path: string; before: string; after: string }[] = [];
  let visited = 0,
    truncated = false;
  const labels: Record<string, string> = {
    type: '종류',
    props: '설정',
    content: '본문',
    styles: '서식',
    bold: '굵게',
    italic: '기울임',
    underline: '밑줄',
    strike: '취소선',
    code: '인라인 코드',
    href: '링크 주소',
    url: '주소',
    textColor: '글자색',
    backgroundColor: '배경색',
    textAlignment: '정렬',
    columnWidths: '열 너비',
    rows: '행',
    cells: '셀',
    language: '코드 언어',
    level: '제목 단계',
    checked: '완료 상태',
    headerRows: '제목 행 수',
    headerCols: '제목 열 수',
    maxLevel: '목차의 제목 단계',
    compact: '간결하게 표시',
    icon: '아이콘',
  };
  const display = (value: unknown) => {
    if (value === undefined || value === null) return '없음';
    if (typeof value === 'boolean') return value ? '켜짐' : '꺼짐';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === '' ? '빈 값' : text.length > 200 ? text.slice(0, 200) + '…' : text;
  };
  function visit(a: unknown, b: unknown, path: string[]) {
    if (Object.is(a, b)) return;
    if (++visited > 10000 || changes.length >= 40 || path.length > 16) {
      truncated = true;
      return;
    }
    const objectA = a && typeof a === 'object' ? (a as Record<string, unknown>) : null;
    const objectB = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
    const keys = new Set([...Object.keys(objectA || {}), ...Object.keys(objectB || {})]);
    const sameContainer = !objectA || !objectB || Array.isArray(a) === Array.isArray(b);
    if (
      (objectA || objectB) &&
      (a == null || objectA) &&
      (b == null || objectB) &&
      sameContainer &&
      (keys.size > 0 || (objectA && objectB))
    ) {
      for (const key of keys) {
        const part = /^\d+$/.test(key) ? String(Number(key) + 1) : labels[key] || key;
        visit(objectA?.[key], objectB?.[key], [...path, part]);
        if (truncated) break;
      }
    } else {
      changes.push({ path: path.join(' · '), before: display(a), after: display(b) });
    }
  }
  const { id: _a, children: _ac, ...ownBefore } = before;
  const { id: _b, children: _bc, ...ownAfter } = after;
  // Match pageRevisionDiff's JSON persistence semantics in the detail view too.
  visit(JSON.parse(JSON.stringify(ownBefore)), JSON.parse(JSON.stringify(ownAfter)), []);
  return { changes, truncated };
}
