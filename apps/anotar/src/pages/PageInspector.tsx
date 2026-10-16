import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function PageInspector({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <aside
      className={`page-inspector ${className}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          close.current();
        }
      }}
    >
      <header className="page-inspector-heading">
        <strong>{title}</strong>
        <button ref={closeButton} type="button" aria-label={`${title} 닫기`} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="page-inspector-body">{children}</div>
    </aside>
  );
}
