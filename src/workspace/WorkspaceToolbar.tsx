import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import './toolbar.css';

export const WorkspaceToolbarContext = createContext<HTMLElement | null>(null);

/** Portals move controls, not the screen that owns their state. Render only for active views. */
export function WorkspaceToolbar({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const target = useContext(WorkspaceToolbarContext);
  const toolbar = (
    <div className="workspace-toolbar" aria-label={`${title} 도구`}>
      <h1>{title}</h1>
      <div className="workspace-toolbar-actions">
        {meta && <span className="toolbar-meta">{meta}</span>}
        {children}
      </div>
    </div>
  );
  return target ? createPortal(toolbar, target) : null;
}

/** The input stays mounted during mobile expansion and viewport changes. */
export function ToolbarSearch({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector('input')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <div ref={root} className={`toolbar-search${open ? ' is-open' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="toolbar-search-trigger"
        aria-label="메모 검색 열기"
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => setOpen(!open)}
      >
        <Search size={17} aria-hidden />
      </button>
      <div className="toolbar-search-field">{children}</div>
    </div>
  );
}
