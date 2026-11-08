import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { todayIso } from '@trackt/client';
import { useFormat } from '../../lib/format';
import { readIso } from '../../lib/date-input';
import { useTypedDate } from '../../lib/use-typed-date';
import { DateCalendar, PanelFooter } from './DateCalendar';

/**
 * Start → stop in one control: one pill, two typed dates, one calendar.
 *
 * The two fields are the same typed date as `DatePicker` (mask, live commit,
 * revert on blur), and the grid picks a span: the first click sets the start
 * and keeps the panel open, the second sets the stop and closes it, hovering
 * previews the days in between, and a click after a complete span starts a new
 * one. Values are ISO `YYYY-MM-DD` or `''` at both ends.
 */

export interface DateRange {
  startedAt: string;
  finishedAt: string;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  id,
  className,
  align = 'start',
}: DateRangePickerProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const baseId = useId();
  const startId = id ?? `${baseId}-start`;
  const endId = `${baseId}-end`;

  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const lastField = useRef<'start' | 'end'>('start');
  /** Opened from a field: the panel must not take focus away from the caret. */
  const keepFocus = useRef(false);
  const [view, setView] = useState(() => {
    const anchor = readIso(value.finishedAt || value.startedAt) ?? readIso(todayIso());
    return { year: anchor?.year ?? 1970, month: anchor?.month ?? 0 };
  });

  // Typing either end moves the grid with it, to the end edited last.
  useEffect(() => {
    const preferred = lastField.current === 'end' ? value.finishedAt : value.startedAt;
    const anchor = readIso(preferred || value.startedAt || value.finishedAt);
    if (anchor) setView({ year: anchor.year, month: anchor.month });
  }, [value.startedAt, value.finishedAt]);

  const start = useTypedDate({
    value: value.startedAt,
    onChange: (startedAt) => onChange({ ...value, startedAt }),
    locale: format.locale,
    min,
    max,
    panelOpen: open,
    openPanel: () => setOpen(true),
    closePanel: () => setOpen(false),
  });
  const end = useTypedDate({
    value: value.finishedAt,
    onChange: (finishedAt) => onChange({ ...value, finishedAt }),
    locale: format.locale,
    min,
    max,
    panelOpen: open,
    openPanel: () => setOpen(true),
    closePanel: () => setOpen(false),
  });

  const hint = t('date.picker.format');
  const width = (text: string) => ({ width: `${Math.max(text.length, hint.length, 8) + 1}ch` });

  const closeFromPanel = () => {
    setOpen(false);
    if (!keepFocus.current) return;
    (lastField.current === 'end' ? endRef.current : startRef.current)?.focus();
  };

  const pick = (iso: string) => {
    if (!value.startedAt || value.finishedAt) {
      // A new span: the grid stays open for its second click.
      onChange({ startedAt: iso, finishedAt: '' });
      return;
    }
    if (iso < value.startedAt) onChange({ startedAt: iso, finishedAt: value.startedAt });
    else onChange({ startedAt: value.startedAt, finishedAt: iso });
    closeFromPanel();
  };

  const completed = value.startedAt !== '' && value.finishedAt !== '';
  const preview =
    !completed && hovered !== null && value.startedAt !== '' && hovered > value.startedAt
      ? { start: value.startedAt, end: hovered }
      : null;
  const range = preview ?? (completed ? { start: value.startedAt, end: value.finishedAt } : null);

  const fieldProps = (which: 'start' | 'end') => ({
    onPointerUp: (event: PointerEvent<HTMLInputElement>) => {
      lastField.current = which;
      if (event.pointerType === 'touch') return;
      keepFocus.current = true;
      setOpen(true);
    },
  });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        const preferred =
          lastField.current === 'end'
            ? value.finishedAt || value.startedAt
            : value.startedAt || value.finishedAt;
        const anchor = readIso(preferred) ?? readIso(todayIso());
        setView({ year: anchor?.year ?? 1970, month: anchor?.month ?? 0 });
      }}
    >
      <Popover.Anchor asChild>
        <div
          ref={wellRef}
          className={clsx(
            'flex w-fit max-w-full items-center gap-2 rounded-full border px-3.5 py-2 transition',
            start.invalid || end.invalid
              ? 'border-red-400/60'
              : open
                ? 'border-pink'
                : 'border-glass-border-strong bg-glass hover:border-pink',
            disabled && 'pointer-events-none opacity-40',
            className,
          )}
        >
          <input
            {...start.inputProps}
            {...fieldProps('start')}
            onFocus={(event) => {
              lastField.current = 'start';
              start.inputProps.onFocus(event);
            }}
            ref={startRef}
            id={startId}
            type="text"
            placeholder={hint}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('date.picker.start')}
            style={width(start.text)}
            className={clsx(
              'min-w-0 bg-transparent font-label text-xs outline-none placeholder:text-faint',
              start.text ? 'text-fg' : 'text-faint',
            )}
          />
          <span aria-hidden className="font-label text-xs text-dim">
            →
          </span>
          <input
            {...end.inputProps}
            {...fieldProps('end')}
            onFocus={(event) => {
              lastField.current = 'end';
              end.inputProps.onFocus(event);
            }}
            ref={endRef}
            id={endId}
            type="text"
            placeholder={hint}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('date.picker.end')}
            style={width(end.text)}
            className={clsx(
              'min-w-0 bg-transparent font-label text-xs outline-none placeholder:text-faint',
              end.text ? 'text-fg' : 'text-faint',
            )}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('date.picker.open')}
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
            if (wellRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="z-50 w-[268px] rounded-card-sm border border-glass-border bg-ink/95 p-3.5 shadow-2xl shadow-ink/70 backdrop-blur-[16px]"
        >
          <DateCalendar
            view={view}
            onShift={(delta) => {
              const next = new Date(Date.UTC(view.year, view.month + delta, 1));
              setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
            }}
            locale={format.locale}
            today={today}
            min={min}
            max={max}
            selected={
              completed
                ? [value.startedAt, value.finishedAt]
                : value.startedAt
                  ? [value.startedAt]
                  : []
            }
            range={range}
            onPick={pick}
            onHoverDay={setHovered}
          />
          <PanelFooter
            onToday={() => {
              onChange({ startedAt: today, finishedAt: today });
              closeFromPanel();
            }}
            onClear={() => {
              onChange({ startedAt: '', finishedAt: '' });
              closeFromPanel();
            }}
            todayDisabled={(min !== undefined && today < min) || (max !== undefined && today > max)}
            clearDisabled={value.startedAt === '' && value.finishedAt === ''}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
