import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function MemoDetailSurface({
  inline,
  target,
  onBackdrop,
  children,
}: {
  inline: boolean;
  target: HTMLElement | null;
  onBackdrop: () => void;
  children: ReactNode;
}) {
  if (inline && target)
    return createPortal(<div className="memo-detail-frame">{children}</div>, target);
  return (
    <div className="detail-backdrop" onMouseDown={onBackdrop}>
      {children}
    </div>
  );
}
