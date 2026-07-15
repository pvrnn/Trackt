import { useEffect, useRef, type ReactNode } from 'react';
import { GlassCard } from './GlassCard';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * The app's one modal: backdrop, glass panel, and the keyboard contract the
 * hand-rolled dialogs lacked — initial focus moves inside, Tab is trapped
 * (the obscured page is unreachable), Escape and backdrop-click close, and
 * focus returns to the opener on unmount.
 */
export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Escape reads the latest close handler without re-running the trap effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof HTMLElement) || !dialog.contains(active);
      if (event.shiftKey ? outside || active === items[0] : outside || active === items.at(-1)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <GlassCard
        as="section"
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto bg-ink/90 p-7"
      >
        {children}
      </GlassCard>
    </div>
  );
}
