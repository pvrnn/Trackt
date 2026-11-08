import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayIso } from '@trackt/client';
import { useFormat } from '../../lib/format';
import { readIso } from '../../lib/date-input';
import { useTypedDate } from '../../lib/use-typed-date';
import { DateCalendar, PanelFooter } from './DateCalendar';

/**
 * The app's one date picker, on Radix's popover. Replaces `<input type="date">`,
 * whose calendar the OS draws: it ignores the AURA PRISM surface, the Space
 * Grotesk labels and the pink accent, and its `[color-scheme:dark]` fix still
 * paints a white panel in some browsers.
 *
 * The field is typed into OR browsed with the calendar: clicking the text opens
 * the panel without stealing focus, digits gain their separators as you type,
 * and the grid follows a typed date to its month. The value crossing this
 * boundary is always ISO `YYYY-MM-DD` or `''`.
 */

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Pill caption (`STARTED`) or, on `field`, the label above the well. */
  label?: string;
  /** ISO bounds, inclusive. Days outside them render inert and won't commit. */
  min?: string;
  max?: string;
  /** `pill` sits in an action/filter row; `field` sits in a form well. */
  variant?: 'pill' | 'field';
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

function defaultView(): { year: number; month: number } {
  const today = readIso(todayIso());
  return { year: today?.year ?? 1970, month: today?.month ?? 0 };
}

export function DatePicker({
  value,
  onChange,
  label,
  min,
  max,
  variant = 'pill',
  placeholder,
  disabled = false,
  id,
  className,
  align = 'start',
}: DatePickerProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const field = variant === 'field';
  const baseId = useId();
  const inputId = id ?? `${baseId}-input`;
  const captionId = `${baseId}-caption`;

  const today = todayIso();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  /** Opened from the field: the panel must not take focus away from the caret. */
  const keepFocus = useRef(false);
  const [view, setView] = useState(() => {
    const selected = readIso(value);
    return selected ? { year: selected.year, month: selected.month } : defaultView();
  });

  // Typed or picked values move the grid with them, in the same gesture.
  useEffect(() => {
    const selected = readIso(value);
    if (selected) setView({ year: selected.year, month: selected.month });
  }, [value]);

  const typed = useTypedDate({
    value,
    onChange,
    locale: format.locale,
    min,
    max,
    panelOpen: open,
    openPanel: () => setOpen(true),
    closePanel: () => setOpen(false),
  });

  const hint = placeholder ?? t('date.picker.format');

  const closeFromPanel = () => {
    setOpen(false);
    // A panel opened from the field sends focus back there, so the pointer is
    // not stranded on a button that just vanished.
    if (keepFocus.current) inputRef.current?.focus();
  };

  const well = (
    <Popover.Anchor asChild>
      <div
        ref={wellRef}
        className={clsx(
          'flex items-center gap-2 transition',
          field
            ? 'w-full rounded-cover border bg-white/6 px-[18px] py-3.5'
            : 'rounded-full border px-3.5 py-2',
          typed.invalid
            ? 'border-red-400/60'
            : open
              ? 'border-pink'
              : field
                ? 'border-white/12 hover:border-white/20'
                : 'border-glass-border-strong bg-glass hover:border-pink',
          disabled && 'pointer-events-none opacity-40',
          className,
        )}
      >
        {!field && label && (
          <span id={captionId} className="font-label text-[10px] font-bold tracking-label text-dim">
            {label}
          </span>
        )}
        <input
          {...typed.inputProps}
          ref={inputRef}
          id={inputId}
          type="text"
          placeholder={hint}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-labelledby={!field && label ? captionId : undefined}
          aria-label={label ? undefined : t('date.picker.pick')}
          onPointerUp={(event) => {
            // Touch is excluded: the keyboard would cover the grid the tap
            // just opened. The caret is the calendar's door there.
            if (event.pointerType === 'touch') return;
            keepFocus.current = true;
            setOpen(true);
          }}
          style={
            field ? undefined : { width: `${Math.max(typed.text.length, hint.length, 8) + 1}ch` }
          }
          className={clsx(
            'min-w-0 bg-transparent outline-none placeholder:text-faint',
            field ? 'w-full font-sans text-[15px]' : 'font-label text-xs',
            typed.text ? 'text-fg' : 'text-faint',
          )}
        />
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label ? `${label} — ${t('date.picker.open')}` : t('date.picker.open')}
            onClick={() => {
              keepFocus.current = false;
            }}
            className="-my-2 -mr-1 cursor-pointer rounded-full px-1 py-2 text-[10px] text-dim transition outline-none hover:text-pink focus-visible:text-pink"
          >
            ▾
          </button>
        </Popover.Trigger>
      </div>
    </Popover.Anchor>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        const selected = readIso(value);
        setView(selected ? { year: selected.year, month: selected.month } : defaultView());
      }}
    >
      {field ? (
        <div className="flex flex-col gap-1.5">
          {label && (
            <label
              htmlFor={inputId}
              className="font-label text-xs font-semibold tracking-label text-dim uppercase"
            >
              {label}
            </label>
          )}
          {well}
        </div>
      ) : (
        well
      )}

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            // The field is not the trigger, so a caret reposition would read
            // as an outside click and close the panel the click just opened.
            if (wellRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="z-50 w-[268px] rounded-card-sm border border-glass-border bg-ink/95 p-3.5 shadow-2xl shadow-ink/70 backdrop-blur-[16px]"
        >
          <DateCalendar
            view={view}
            onShift={(delta) => setView(shiftMonth(view, delta))}
            locale={format.locale}
            today={today}
            min={min}
            max={max}
            selected={[value]}
            onPick={(iso) => {
              onChange(iso);
              // Picking is the whole point; leaving the panel open would hide the result.
              closeFromPanel();
            }}
          />
          <PanelFooter
            onToday={() => {
              onChange(today);
              closeFromPanel();
            }}
            onClear={() => {
              onChange('');
              closeFromPanel();
            }}
            todayDisabled={(min !== undefined && today < min) || (max !== undefined && today > max)}
            clearDisabled={!value}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function shiftMonth(view: { year: number; month: number }, delta: number) {
  const next = new Date(Date.UTC(view.year, view.month + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}
