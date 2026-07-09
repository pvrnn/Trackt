import clsx from 'clsx';
import type { ComponentPropsWithRef } from 'react';

export interface ChipProps extends ComponentPropsWithRef<'button'> {
  selected?: boolean;
}

/** Filter/status pill (Space Grotesk 600 12px). Selected = pink on pink-tint. */
export function Chip({ selected = false, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(
        'cursor-pointer rounded-full px-4 py-2 font-label text-xs font-semibold tracking-label transition',
        selected
          ? 'border border-pink bg-pink-selected text-pink'
          : 'border border-glass-border-strong bg-glass text-muted hover:border-pink hover:text-pink',
        className,
      )}
      {...props}
    />
  );
}
