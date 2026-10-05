import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { EmojiMartData } from '@emoji-mart/data';

type EmojiItem = { emoji: string; name: string; keywords: string[] };
type EmojiGroup = { id: string; label: string; items: EmojiItem[] };

const CATEGORY_LABELS: Record<string, string> = {
  people: '표정 · 사람',
  nature: '자연 · 동식물',
  foods: '음식',
  activity: '활동',
  places: '장소 · 여행',
  objects: '사물',
  symbols: '기호',
  flags: '국기',
};

// BlockNote의 : 이모지 메뉴와 같은 emoji-mart 데이터 — 지연 로드해 첫 진입을 가볍게 유지한다
let groupsPromise: Promise<EmojiGroup[]> | null = null;
function loadEmojiGroups() {
  groupsPromise ??= import('@emoji-mart/data').then((mod) => {
    const data = (mod as { default: EmojiMartData }).default;
    return data.categories
      .map((category) => ({
        id: category.id,
        label: CATEGORY_LABELS[category.id] ?? category.id,
        items: category.emojis
          .map((id) => data.emojis[id])
          .filter((entry) => entry?.skins?.length)
          .map((entry) => ({
            emoji: entry.skins[0].native,
            name: entry.name,
            keywords: entry.keywords ?? [],
          })),
      }))
      .filter((group) => group.items.length > 0);
  });
  return groupsPromise;
}

type Props = {
  current: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
  container: React.RefObject<HTMLDivElement | null>;
};

export default function PageIconPicker({ current, onSelect, onClose, container }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    void loadEmojiGroups().then((loaded) => {
      if (active) setGroups(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointer = (event: globalThis.MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onClose, container]);

  const shown = useMemo(() => {
    if (!groups) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return [
      {
        id: 'search',
        label: '검색 결과',
        items: groups
          .flatMap((group) => group.items)
          .filter(
            (item) =>
              item.name.toLowerCase().includes(needle) ||
              item.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
          ),
      },
    ];
  }, [groups, query]);

  return (
    <div className="page-icon-popover" ref={panelRef}>
      <div className="page-icon-popover-head">
        <span>아이콘</span>
        {current && (
          <button type="button" onClick={() => onSelect('')}>
            <X size={13} /> 제거
          </button>
        )}
      </div>
      <label className="page-icon-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이모지 검색"
          autoFocus
        />
      </label>
      <div className="page-icon-scroll">
        {!groups && <p className="page-icon-note">이모지를 불러오는 중…</p>}
        {groups?.length && !shown[0]?.items.length ? (
          <p className="page-icon-note">검색 결과가 없습니다.</p>
        ) : null}
        {shown.map((group) => (
          <Fragment key={group.id}>
            <div className="page-icon-group">{group.label}</div>
            <div className="page-icon-grid" role="listbox" aria-label={group.label}>
              {group.items.map((item) => (
                <button
                  key={item.emoji + item.name}
                  type="button"
                  role="option"
                  title={item.name}
                  aria-selected={item.emoji === current}
                  className={item.emoji === current ? 'active' : ''}
                  onClick={() => onSelect(item.emoji)}
                >
                  {item.emoji}
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
