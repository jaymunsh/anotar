import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './captureComposer.css';

export default function CaptureComposerSurface({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!open) return;
    return () => {
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]') || document.activeElement !== document.body) return;
        const trigger = document.querySelector<HTMLButtonElement>('.mobile-create-button:not([hidden])');
        trigger?.focus({ preventScroll: true });
      });
    };
  }, [open]);
  if (!open) return <>{children}</>;
  return createPortal(
    <dialog ref={dialog} className="capture-composer-dialog" aria-label="빠른 기록"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {children}
    </dialog>,
    document.body,
  );
}
