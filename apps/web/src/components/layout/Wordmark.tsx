import clsx from 'clsx';

/** Gradient Anton TRACKT wordmark — one of the three sanctioned PRISM uses. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('text-prism font-display tracking-[0.02em]', className)}>TRACKT</span>
  );
}
