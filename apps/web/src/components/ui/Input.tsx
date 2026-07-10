import clsx from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label: string;
  error?: string;
  /** Rendered right-aligned on the label row (e.g. a "forgot?" link). */
  labelEnd?: ReactNode;
}

/** Labeled glass input well, per the AURA PRISM form spec (docs/design/Login.dc.html). */
export function Input({ label, error, labelEnd, id, className, ...props }: InputProps) {
  const inputId = id ?? props.name;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={inputId}
          className="font-label text-xs font-semibold tracking-label text-dim uppercase"
        >
          {label}
        </label>
        {labelEnd}
      </div>
      <input
        id={inputId}
        className={clsx(
          'rounded-cover border bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg',
          'transition-colors outline-none placeholder:text-faint focus:border-pink/60',
          error ? 'border-red-400/60' : 'border-white/12',
          className,
        )}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
