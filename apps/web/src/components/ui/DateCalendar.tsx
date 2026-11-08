import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { daysInMonth, isoOf } from '../../lib/date-input';

/**
 * The month grid under both date pickers. It owns only the paint and the
 * bounds; which days are chosen and what a click means belong to the picker,
 * so a single value and a start→stop span share one calendar.
 *
 * `range` tints the days strictly between its endpoints, which is also how the
 * range picker previews a hovered second click.
 */
export interface DateCalendarProps {
  view: { year: number; month: number };
  onShift: (delta: number) => void;
  locale: string;
  today: string;
  min?: string;
  max?: string;
  /** Endpoint days, painted as chosen. */
  selected: readonly string[];
  range?: { start: string; end: string } | null;
  onPick: (iso: string) => void;
  onHoverDay?: (iso: string | null) => void;
}

/** JS days are Sunday-based (0–6); `Intl`'s `firstDay` is Monday-based (1–7). */
function weekStart(locale: string): number {
  try {
    const info = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay?: number } })
      .weekInfo;
    return (info?.firstDay ?? 1) % 7;
  } catch {
    return 1;
  }
}

export function DateCalendar({
  view,
  onShift,
  locale,
  today,
  min,
  max,
  selected,
  range,
  onPick,
  onHoverDay,
}: DateCalendarProps) {
  const { t } = useTranslation();
  const start = weekStart(locale);

  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
          .format(new Date(Date.UTC(2024, 0, 7 + ((start + index) % 7))))
          .toLocaleUpperCase(locale)
          .slice(0, 2),
      ),
    [locale, start],
  );

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.year, view.month, 1)));

  const outOfRange = (iso: string) =>
    (min !== undefined && iso < min) || (max !== undefined && iso > max);

  const offset = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() - start + 7) % 7;
  const total = daysInMonth(view.year, view.month);

  const atMonth = (delta: number) => {
    const date = new Date(Date.UTC(view.year, view.month + delta, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  };
  const lastDayOf = (month: { year: number; month: number }) =>
    isoOf(month.year, month.month, daysInMonth(month.year, month.month));
  // Don't let the steppers wander into a range where every day is inert.
  const canGoBack = min === undefined || lastDayOf(atMonth(-1)) >= min;
  const canGoForward = max === undefined || isoOf(atMonth(1).year, atMonth(1).month, 1) <= max;

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <MonthStep
          label={t('date.picker.previousMonth')}
          onClick={() => onShift(-1)}
          disabled={!canGoBack}
        >
          ‹
        </MonthStep>
        <span className="font-label text-[11px] font-bold tracking-label text-fg uppercase">
          {monthLabel}
        </span>
        <MonthStep
          label={t('date.picker.nextMonth')}
          onClick={() => onShift(1)}
          disabled={!canGoForward}
        >
          ›
        </MonthStep>
      </div>

      <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => onHoverDay?.(null)}>
        {weekdays.map((weekday, index) => (
          <span
            key={`${weekday}-${index}`}
            aria-hidden
            className="pb-1 text-center font-label text-[10px] font-bold tracking-label text-faint"
          >
            {weekday}
          </span>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: total }, (_, index) => {
          const day = index + 1;
          const iso = isoOf(view.year, view.month, day);
          const chosen = selected.includes(iso);
          const disabledDay = outOfRange(iso);
          const inRange =
            range !== null && range !== undefined && iso > range.start && iso < range.end;
          return (
            <button
              key={iso}
              type="button"
              disabled={disabledDay}
              aria-pressed={chosen}
              aria-current={iso === today ? 'date' : undefined}
              aria-label={new Intl.DateTimeFormat(locale, {
                dateStyle: 'full',
                timeZone: 'UTC',
              }).format(new Date(Date.UTC(view.year, view.month, day)))}
              onMouseEnter={() => onHoverDay?.(iso)}
              onFocus={() => onHoverDay?.(iso)}
              onClick={() => onPick(iso)}
              className={clsx(
                'aspect-square cursor-pointer rounded-full border font-label text-xs transition outline-none',
                'focus-visible:ring-1 focus-visible:ring-pink',
                chosen
                  ? 'border-pink bg-pink-selected font-bold text-pink'
                  : inRange
                    ? 'border-transparent bg-pink-row text-pink'
                    : disabledDay
                      ? 'border-transparent text-faint'
                      : iso === today
                        ? 'border-pink/40 text-pink hover:bg-pink-row'
                        : 'border-transparent text-muted hover:bg-pink-row hover:text-pink',
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
}

function MonthStep({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="size-7 cursor-pointer rounded-full border border-transparent font-label text-sm text-dim transition hover:border-glass-border-strong hover:text-pink disabled:cursor-default disabled:border-transparent disabled:text-faint disabled:hover:border-transparent disabled:hover:text-faint"
    >
      {children}
    </button>
  );
}

export function PanelFooter({
  onToday,
  onClear,
  todayDisabled,
  clearDisabled,
}: {
  onToday: () => void;
  onClear: () => void;
  todayDisabled?: boolean;
  clearDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-divider pt-2.5">
      <FooterAction onClick={onToday} disabled={todayDisabled} label={t('date.picker.today')} />
      <FooterAction onClick={onClear} disabled={clearDisabled} label={t('date.picker.clear')} />
    </div>
  );
}

function FooterAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer font-label text-[11px] font-semibold tracking-label text-dim transition hover:text-pink disabled:cursor-default disabled:text-faint"
    >
      {label}
    </button>
  );
}
