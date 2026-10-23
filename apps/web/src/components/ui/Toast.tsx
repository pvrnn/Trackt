import clsx from 'clsx';
import { AnimatePresence, m } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The web app's toast (`Mobile System.dc.html` §04, in the pill the design
 * already gives us). It exists for outcomes whose surface goes away (a dialog
 * that closes, a row that leaves the list), so the confirmation lands somewhere
 * the reader is still looking.
 *
 * One at a time: a second `show()` replaces the first and restarts the timer,
 * same as mobile. A queue would let a message outlive the thing that caused it.
 */
export interface ToastOptions {
  message: string;
  /** Errors linger a beat longer and take the pink border. */
  tone?: 'neutral' | 'error';
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

const DISMISS_MS = 5_000;
const ERROR_DISMISS_MS = 7_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback<ShowToast>(
    (options) => {
      clearTimer();
      setToast({ ...options, id: nextId.current++ });
      timer.current = setTimeout(
        () => setToast(null),
        options.tone === 'error' ? ERROR_DISMISS_MS : DISMISS_MS,
      );
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-6">
        <AnimatePresence>
          {toast && (
            <m.div
              key={toast.id}
              // status is polite, alert is assertive: a failed write interrupts,
              // a confirmation waits its turn.
              role={toast.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className={clsx(
                'flex max-w-[min(100%,30rem)] items-center gap-3 rounded-full border py-3 pr-5 pl-[18px] text-[13px] font-semibold text-fg shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)]',
                toast.tone === 'error'
                  ? 'border-pink bg-ink/95'
                  : 'border-glass-border-strong bg-[#241f2e]',
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  'flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-on-prism',
                  toast.tone === 'error'
                    ? 'bg-pink'
                    : 'bg-[linear-gradient(135deg,#d9a441,#d96bb0)]',
                )}
              >
                {toast.tone === 'error' ? '!' : '✓'}
              </span>
              <span className="min-w-0">{toast.message}</span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** Throws outside the provider rather than degrading to a no-op: silence here is the bug. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast() outside <ToastProvider>');
  return show;
}
