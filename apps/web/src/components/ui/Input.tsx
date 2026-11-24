import clsx from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label: string;
  error?: string;
  /** Rendered right-aligned on the label row (e.g. a "forgot?" link). */
  labelEnd?: ReactNode;
  /** Rendered inside the well after the text (e.g. a show/hide toggle). */
  trailing?: ReactNode;
}

/** Labeled glass input well, per the AURA PRISM form spec (docs/design/Login.dc.html). */
export function Input({ label, error, labelEnd, trailing, id, className, ...props }: InputProps) {
  const inputId = id ?? props.name;
  const well = clsx(
    'rounded-cover border bg-white/6 transition-colors',
    error ? 'border-red-400/60' : 'border-white/12',
  );
  const field =
    'px-[18px] py-3.5 font-sans text-base text-fg sm:text-[15px] outline-none placeholder:text-faint';
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
      {trailing ? (
        <span className={clsx(well, 'flex items-center focus-within:border-pink/60')}>
          <input
            id={inputId}
            className={clsx(field, 'min-w-0 flex-1 bg-transparent', className)}
            aria-invalid={error ? true : undefined}
            {...props}
          />
          {trailing}
        </span>
      ) : (
        <input
          id={inputId}
          className={clsx(well, field, 'focus:border-pink/60', className)}
          aria-invalid={error ? true : undefined}
          {...props}
        />
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
