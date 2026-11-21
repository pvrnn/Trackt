import clsx from 'clsx';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { useLabels } from '../../lib/labels';
import { Select, type SelectItem } from './Select';

/**
 * The filter console shared by Discover, News and History
 * (`docs/design/README.md` › Filter console): one glass bar of equal-height
 * cells that wrap as the page narrows. Pills are for actions and status;
 * anything that narrows a list is a cell here.
 */
export function FilterBar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('fbar', className)}>{children}</div>;
}

export interface FilterCellProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: SelectItem[];
  className?: string;
}

/** A label, the current value, and a chevron; the whole cell opens the menu. */
export function FilterCell({ label, value, onChange, items, className }: FilterCellProps) {
  const labelId = useId();
  const triggerId = useId();
  return (
    <div className={clsx('fcell', className)}>
      <span id={labelId} className="fcell-label">
        {label}
      </span>
      <Select
        id={triggerId}
        variant="cell"
        aria-labelledby={`${labelId} ${triggerId}`}
        items={items}
        value={value}
        onChange={onChange}
      />
      <span aria-hidden className="fcell-chev" />
    </div>
  );
}

export interface KindStripProps {
  /** Undefined means every kind. */
  value: MediaKind | undefined;
  onChange: (kind: MediaKind | undefined) => void;
  /**
   * Per-kind counts for whatever the other filters select. Absent while they
   * load or where the source can't say (an older catalog, the browse shelf),
   * and then no chip shows a number rather than one showing a guess.
   */
  counts?: Partial<Record<MediaKind, number>>;
  /** ALL's number when a story can hold several kinds, so the counts overlap. */
  total?: number | undefined;
}

/**
 * ALL, then one colour dot per kind. The picked kind, or the one under the
 * pointer, opens into its name and count. Picking the open one again goes back
 * to ALL, so the strip never needs a separate clear.
 */
export function KindStrip({ value, onChange, counts, total: totalProp }: KindStripProps) {
  const { t } = useTranslation();
  const labels = useLabels();
  const total = counts
    ? (totalProp ?? MEDIA_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0))
    : undefined;
  const chips: { kind: MediaKind | undefined; label: string; count: number | undefined }[] = [
    { kind: undefined, label: t('common.all'), count: total },
    ...MEDIA_KINDS.map((kind) => ({
      kind,
      label: labels.kind(kind).toUpperCase(),
      count: counts ? (counts[kind] ?? 0) : undefined,
    })),
  ];
  return (
    <div role="group" aria-label={t('filters.kind')} className="fcell flex-[1_1_auto] pr-3.5">
      <span aria-hidden className="fcell-label">
        {t('filters.kindLabel')}
      </span>
      <div className="kstrip">
        {chips.map(({ kind, label, count }) => {
          const on = value === kind;
          const dim = kind !== undefined && count === 0 && !on;
          return (
            <button
              key={kind ?? 'all'}
              type="button"
              aria-pressed={on}
              aria-label={count === undefined ? label : `${label} · ${count}`}
              title={count === undefined ? label : `${label} · ${count}`}
              onClick={() => onChange(on ? undefined : kind)}
              className={clsx('kchip', kind === undefined && 'kchip-all', dim && 'opacity-40')}
              style={kind ? ({ '--kc': `var(--color-kind-${kind})` } as CSSProperties) : undefined}
            >
              {kind === undefined ? (
                <span>
                  {label}
                  {count !== undefined && (
                    <span className="ml-1.5 font-medium text-dim">{count}</span>
                  )}
                </span>
              ) : (
                <>
                  <span aria-hidden className="kchip-dot" />
                  <span className="kchip-label">
                    {label}
                    {count !== undefined && <span className="font-medium text-dim">{count}</span>}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
