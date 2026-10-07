type Snapshot = { title: string; icon: string; document: { blocks: unknown[] } };
export type RevisionBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown[];
};
type LocatedBlock = {
  key: string;
  parent: string;
  previous: string;
  path: number[];
  block: RevisionBlock;
};
export type RevisionChange = {
  key: string;
  kind: 'added' | 'removed' | 'changed';
  before?: LocatedBlock;
  after?: LocatedBlock;
  moved: boolean;
  contentChanged: boolean;
};
const blockLimit = 2000;
const depthLimit = 8;
const displayLimit = 100;

// Compare the persisted JSON value: editors can add undefined optional fields.
// JSON omits those object keys and turns undefined array entries into null.
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return (
      '[' + Array.from(value, (item) => canonical(item === undefined ? null : item)).join(',') + ']'
    );
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? '';
}
function fingerprint(block: RevisionBlock) {
  const { id: _id, children: _children, ...own } = block;
  return canonical(own);
}
function locate(values: unknown[]) {
  const items: LocatedBlock[] = [];
  const keys = new Set<string>();
  let truncated = false;
  function visit(blocks: unknown[], parent: string, path: number[]) {
    if (path.length > depthLimit) {
      truncated = true;
      return;
    }
    for (let index = 0; index < blocks.length; index++) {
      if (items.length >= blockLimit) {
        truncated = true;
        return;
      }
      const raw = blocks[index];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const block = raw as RevisionBlock;
      const position = [...path, index + 1];
      const candidate =
        typeof block.id === 'string' && block.id ? 'id:' + block.id : 'path:' + position.join('.');
      const key = keys.has(candidate) ? 'duplicate:' + position.join('.') : candidate;
      keys.add(key);
      items.push({ key, parent, previous: '', path: position, block });
      if (Array.isArray(block.children)) visit(block.children, key, position);
    }
  }
  visit(values, '', []);
  return { items, truncated };
}
function setPrevious(items: LocatedBlock[], common: Set<string>) {
  const previous = new Map<string, string>();
  for (const item of items) {
    if (!common.has(item.key)) continue;
    item.previous = previous.get(item.parent) || '';
    previous.set(item.parent, item.key);
  }
}
export function comparePageRevision(before: Snapshot, after: Snapshot) {
  const old = locate(before.document.blocks);
  const current = locate(after.document.blocks);
  const oldByKey = new Map(old.items.map((item) => [item.key, item]));
  const currentByKey = new Map(current.items.map((item) => [item.key, item]));
  const common = new Set(
    current.items
      .filter((item) => oldByKey.get(item.key)?.parent === item.parent)
      .map((item) => item.key),
  );
  setPrevious(old.items, common);
  setPrevious(current.items, common);
  const changes: RevisionChange[] = [];
  for (const item of current.items) {
    const prior = oldByKey.get(item.key);
    if (!prior) {
      changes.push({
        key: item.key,
        kind: 'added',
        after: item,
        moved: false,
        contentChanged: true,
      });
      continue;
    }
    const moved = prior.parent !== item.parent || prior.previous !== item.previous;
    const contentChanged = fingerprint(prior.block) !== fingerprint(item.block);
    if (moved || contentChanged)
      changes.push({
        key: item.key,
        kind: 'changed',
        before: prior,
        after: item,
        moved,
        contentChanged,
      });
  }
  for (const item of old.items) {
    if (!currentByKey.has(item.key))
      changes.push({
        key: item.key,
        kind: 'removed',
        before: item,
        moved: false,
        contentChanged: true,
      });
  }
  return {
    titleChanged: before.title !== after.title,
    iconChanged: before.icon !== after.icon,
    counts: {
      added: changes.filter((item) => item.kind === 'added').length,
      removed: changes.filter((item) => item.kind === 'removed').length,
      changed: changes.filter((item) => item.kind === 'changed').length,
    },
    changes: changes.slice(0, displayLimit),
    hiddenCount: Math.max(0, changes.length - displayLimit),
    truncated: old.truncated || current.truncated,
  };
}
export function revisionBlockLabel(block: RevisionBlock) {
  const labels: Record<string, string> = {
    paragraph: '문단',
    heading: '제목',
    bulletListItem: '목록',
    numberedListItem: '번호 목록',
    checkListItem: '할 일',
    toggleListItem: '접기 목록',
    quote: '인용',
    table: '표',
    codeBlock: '코드',
    diagram: '다이어그램',
    asset: '첨부',
    map: '지도',
    itinerary: '일정',
    page: '페이지 링크',
    tableOfContents: '목차',
    captureRef: '메모 참조',
    divider: '구분선',
    bookmark: '북마크',
  };
  return labels[block.type || ''] || '블록';
}
export function changedBlockFields(before: RevisionBlock, after: RevisionBlock) {
  const fields: string[] = [];
  if (before.type !== after.type) fields.push('블록 종류');
  if (canonical(before.content) !== canonical(after.content)) fields.push('본문·서식');
  const old = before.props || {};
  const current = after.props || {};
  const labels: Record<string, string> = {
    title: '제목',
    description: '설명',
    imageData: '썸네일',
    assetId: '첨부',
    imageAssetId: '이미지',
    pageId: '연결 페이지',
    captureId: '메모 참조',
    data: '일정',
    checked: '완료 상태',
    level: '제목 단계',
    language: '코드 언어',
    textColor: '글자색',
    backgroundColor: '배경색',
    textAlignment: '정렬',
    url: '주소',
    latitude: '위도',
    longitude: '경도',
    label: '장소 이름',
    display: '첨부 표시',
  };
  for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
    if (canonical(old[key]) !== canonical(current[key])) fields.push(labels[key] || '블록 설정');
  }
  return [...new Set(fields)].join(' · ') || '블록 설정';
}
