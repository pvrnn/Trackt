import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  caretAfterDigits,
  formatIsoDate,
  isoOf,
  maskDateInput,
  parseDateInput,
} from './date-input';

/**
 * The typing half of a date field, shared by the single and range pickers.
 *
 * The field commits the moment its text is a complete, in-range date: clicking
 * a button does not blur an input in every browser (Safari), so a typed date
 * must already be in the parent before submit runs. An impossible date (13 as
 * a month, 31 February) never parses and is dropped on blur; a date that is
 * parseable but wrong (future, finish before start) is committed and left to
 * the form's save-time validation to refuse.
 */
export interface TypedDateOptions {
  value: string;
  onChange: (iso: string) => void;
  locale: string;
  /** ISO bounds, inclusive. Days outside them never commit. */
  min?: string;
  max?: string;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
}

export interface TypedDate {
  text: string;
  invalid: boolean;
  inputProps: {
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onFocus: (event: FocusEvent<HTMLInputElement>) => void;
    onPointerDown: (event: PointerEvent<HTMLInputElement>) => void;
    onMouseUp: (event: MouseEvent<HTMLInputElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    'aria-invalid': true | undefined;
  };
}

export function useTypedDate({
  value,
  onChange,
  locale,
  min,
  max,
  panelOpen,
  openPanel,
  closePanel,
}: TypedDateOptions): TypedDate {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const touched = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  /** The value before this edit, so a refused draft restores it, not a half-typed one. */
  const started = useRef<string | null>(null);

  const display = useMemo(() => (value ? formatIsoDate(value, locale) : null), [value, locale]);
  const text = draft ?? display ?? '';

  const rejected = (iso: string) =>
    (min !== undefined && iso < min) || (max !== undefined && iso > max);

  const reset = () => {
    touched.current = false;
    started.current = null;
    setDraft(null);
    setInvalid(false);
  };

  /** Answers whether the draft became the value; an unparseable one doesn't. */
  const commit = (): boolean => {
    if (!touched.current) return true;
    const typed = (draft ?? '').trim();
    if (typed === '') {
      onChange('');
      return true;
    }
    const parsed = parseDateInput(typed, locale);
    if (!parsed) return false;
    const iso = isoOf(parsed.year, parsed.month, parsed.day);
    if (rejected(iso)) return false;
    onChange(iso);
    return true;
  };

  return {
    text,
    invalid,
    inputProps: {
      value: text,
      onChange: (event) => {
        const input = event.currentTarget;
        const raw = input.value;
        const caret = input.selectionStart ?? raw.length;
        const atEnd = caret === raw.length;
        const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
        const masked = maskDateInput(raw);

        touched.current = true;
        started.current ??= value;
        setDraft(masked);
        setInvalid(false);
        if (masked !== raw) {
          const position = atEnd ? masked.length : caretAfterDigits(masked, digitsBefore);
          // After React writes the value, or the browser puts the caret at the end.
          requestAnimationFrame(() => input.setSelectionRange(position, position));
        }

        const parsed = parseDateInput(masked, locale);
        if (!parsed) return;
        const iso = isoOf(parsed.year, parsed.month, parsed.day);
        if (!rejected(iso)) onChange(iso);
      },
      onBlur: () => {
        if (!commit() && started.current !== null) onChange(started.current);
        reset();
      },
      onFocus: (event) => {
        if (draft === null) setDraft(display ?? '');
        // A date is edited as a whole: selecting all is what makes typing
        // "12012024" over an existing date work instead of appending to it.
        requestAnimationFrame(() => event.target.select());
      },
      onPointerDown: (event) => {
        down.current = { x: event.clientX, y: event.clientY };
      },
      onMouseUp: (event) => {
        const input = event.currentTarget;
        const from = down.current;
        // A drag is the user selecting part of the text; a click is a request
        // to retype the date. Runs after the default caret placement, which
        // would otherwise collapse a selection made during the event.
        if (from && (Math.abs(event.clientX - from.x) > 3 || Math.abs(event.clientY - from.y) > 3))
          return;
        requestAnimationFrame(() => input.select());
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!commit()) {
            setInvalid(true);
            return;
          }
          reset();
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Escape') {
          if (panelOpen) {
            event.preventDefault();
            closePanel();
          } else if (draft !== null) {
            event.preventDefault();
            if (started.current !== null) onChange(started.current);
            reset();
          }
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openPanel();
        }
      },
      'aria-invalid': invalid || undefined,
    },
  };
}
