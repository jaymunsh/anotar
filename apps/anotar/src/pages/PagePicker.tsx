import { useId, useMemo, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { PageSummary } from './types';
import { pagePath, searchPages } from './pageSearch';
import './pagePicker.css';

type Props = {
  pages: PageSummary[];
  value: string;
  onChange: (pageId: string) => void;
  label: string;
  disabled?: boolean;
};

/** Searchable single-page combobox: recent pages when empty, title/path search when typing. */
export default function PagePicker({ pages, value, onChange, label, disabled }: Props) {
  const id = useId();
  const [query, setQuery] = useState<string | null>(null); // null = closed, showing the selection
  const [active, setActive] = useState(0);
  const byId = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const selected = value ? byId.get(value) : undefined;
  const results = useMemo(() => (query === null ? [] : searchPages(pages, query)), [pages, query]);
  const open = query !== null;
  const shown = selected
    ? [pagePath(selected, byId), selected.title || '제목 없음'].filter(Boolean).join(' / ')
    : value
      ? '연결된 페이지 · 목록에서 확인할 수 없어요'
      : '';
  const choose = (pageId: string) => {
    onChange(pageId);
    setQuery(null);
  };
  return (
    <div className="page-picker">
      <div className="page-picker-field">
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
          placeholder="페이지 제목으로 찾기"
          value={open ? query : shown}
          disabled={disabled}
          onFocus={() => {
            setQuery('');
            setActive(0);
          }}
          onBlur={() => setQuery(null)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current) => (current + step + results.length) % Math.max(results.length, 1));
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (results[active]) choose(results[active].page.id);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setQuery(null);
              event.currentTarget.blur();
            }
          }}
        />
        {value && !open && (
          <button type="button" aria-label={`${label} 연결 해제`} disabled={disabled} onClick={() => onChange('')}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <ul id={id} role="listbox" aria-label={label} className="page-picker-list">
          {!results.length && <li className="page-picker-empty">맞는 페이지가 없어요</li>}
          {results.map(({ page, path }, index) => (
            <li
              key={page.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(page.id)}
            >
              <span className="page-picker-icon" aria-hidden>
                {page.icon || <FileText size={14} />}
              </span>
              <span className="page-picker-text">
                <strong>{page.title || '제목 없음'}</strong>
                {path && <small>{path}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
