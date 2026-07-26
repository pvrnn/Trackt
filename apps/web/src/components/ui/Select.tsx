import * as SelectPrimitive from '@radix-ui/react-select';
import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * Radix reserves the empty string for its own "nothing selected" state, so an
 * option that genuinely means none (＋ LOG, RATE, UNKNOWN) needs a stand-in.
 * Call sites keep passing '' — the swap lives at this boundary only.
 */
const NONE = '__none__';

const toRadix = (value: string) => (value === '' ? NONE : value);
const fromRadix = (value: string) => (value === NONE ? '' : value);

export interface SelectItem {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  items: SelectItem[];
  /** `pill` sits in an action row (media detail); `field` sits in a form well. */
  variant?: 'pill' | 'field';
  /** `pill` only: paints the trigger pink to signal an active choice. */
  selected?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

/**
 * The app's one dropdown, on Radix's listbox. Replaces the native `<select>`s,
 * whose popup the OS draws — ignoring the AURA PRISM font, glass surface and
 * pink accent no matter how the closed trigger is styled.
 */
export function Select({
  value,
  onChange,
  items,
  variant = 'field',
  selected = false,
  id,
  className,
  ...props
}: SelectProps) {
  const pill = variant === 'pill';
  return (
    <SelectPrimitive.Root
      value={toRadix(value)}
      onValueChange={(next) => onChange(fromRadix(next))}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={props['aria-label']}
        className={clsx(
          'cursor-pointer transition outline-none',
          pill
            ? [
                'inline-flex items-center gap-2 rounded-full border py-[11px] pr-4 pl-5',
                'font-label text-xs font-semibold tracking-label',
                selected
                  ? 'border-pink bg-pink-selected text-pink'
                  : 'border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
              ]
            : [
                'flex w-full items-center justify-between gap-2 rounded-cover border border-white/12',
                'bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg',
                'focus:border-pink/60 data-[state=open]:border-pink/60',
              ],
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon
          className={clsx('text-[10px]', pill ? (selected ? 'text-pink' : 'text-dim') : 'text-dim')}
        >
          ▾
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          // Above Modal's z-30, so the form dialog's own selects still open over it.
          className={clsx(
            'z-50 overflow-hidden rounded-card-sm border border-glass-border bg-ink/90',
            'shadow-2xl shadow-ink/70 backdrop-blur-[16px]',
            'max-h-[var(--radix-select-content-available-height)]',
            'min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex justify-center py-1 text-[10px] text-dim">
            ▴
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {items.map((item) => (
              <SelectPrimitive.Item
                key={item.value}
                value={toRadix(item.value)}
                className={clsx(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2',
                  'font-label text-xs font-semibold tracking-label text-muted outline-none select-none',
                  'data-[highlighted]:bg-pink-row data-[highlighted]:text-pink',
                  'data-[state=checked]:text-pink',
                )}
              >
                <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="text-[10px]">
                  ✓
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex justify-center py-1 text-[10px] text-dim">
            ▾
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Labeled glass select well — the `Input` treatment, for form rows. */
export function SelectField({
  label,
  id,
  ...props
}: Omit<SelectProps, 'variant' | 'selected'> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-label text-xs font-semibold tracking-label text-dim uppercase"
      >
        {label}
      </label>
      <Select {...props} id={id} variant="field" />
    </div>
  );
}
