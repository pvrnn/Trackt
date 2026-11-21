import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../lib/format';

/** 0–10 in half steps — exactly what `RatingScoreSchema` admits. */
const STEP = 0.5;
const MAX = 10;
const BARS = 10;
const PRISM = ['#d9a441', '#d96bb0', '#8b5cf6'] as const;
const BAR_EMPTY = 'rgba(255,255,255,0.12)';

function channels(hex: string): number[] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The PRISM gradient sampled at `t` in [0, 1], so each bar wears its own slice. */
function prismAt(t: number): string {
  const segment = t < 0.5 ? 0 : 1;
  const u = segment === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = channels(PRISM[segment]);
  const b = channels(PRISM[segment + 1]!);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * u)).join(',')})`;
}

const BAR_COLORS = Array.from({ length: BARS }, (_, i) => prismAt(i / (BARS - 1)));

/**
 * YOUR LOG (`docs/design/Media Detail.dc.html`): the rating meter, then one
 * row per log fact, each ending in its one action.
 */
export function LogCard({
  score,
  communityScore,
  ratingCount,
  onRate,
  datesLabel,
  onEditDates,
  onAddToList,
}: {
  score: number | null;
  communityScore: number | null;
  ratingCount: number;
  /** `null` clears the rating. */
  onRate: (score: number | null) => void;
  /** '12 JUL → 03 AUG', null for a log with no dates, undefined when nothing is logged. */
  datesLabel?: string | null | undefined;
  onEditDates: () => void;
  onAddToList?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();

  return (
    <section
      aria-labelledby="log-card-title"
      className="flex flex-col rounded-card bg-glass px-[22px] pt-[22px] pb-2 inset-ring inset-ring-white/10 backdrop-blur-[16px]"
    >
      <h2 id="log-card-title" className="mb-[18px] font-heading text-2xl uppercase">
        {t('media.logCard.title')}
      </h2>

      <div className="flex flex-col gap-3 pb-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-label text-[10px] font-bold tracking-label text-dim">
            {t('media.rating.yours')}
          </span>
          {score !== null && (
            <button
              type="button"
              onClick={() => onRate(null)}
              className="cursor-pointer p-0.5 font-label text-[11px] font-bold tracking-btn text-dim transition-colors hover:text-pink"
            >
              {t('media.rating.clear')}
            </button>
          )}
        </div>
        {/* Keyed so a score that moves underneath (a rollback, a refetch)
            resets the draft. */}
        <RatingMeter key={score ?? -1} score={score} onCommit={onRate} />
        <span className="font-label text-[11px] font-medium tracking-btn text-muted">
          {communityScore !== null
            ? t('media.rating.community', {
                score: format.score(communityScore),
                count: ratingCount,
              })
            : t('media.rating.none')}
        </span>
      </div>

      {datesLabel !== undefined && (
        <LogRow
          label={t('media.logCard.dates')}
          value={datesLabel ?? t('media.logCard.noDates')}
          muted={datesLabel === null}
          action={datesLabel === null ? t('media.logCard.add') : t('media.logCard.edit')}
          actionLabel={t('media.dates.edit')}
          onClick={onEditDates}
        />
      )}

      {onAddToList && (
        <LogRow
          label={t('media.logCard.lists')}
          value={t('media.logCard.listsValue')}
          muted
          action={t('media.logCard.add')}
          actionLabel={t('media.addToList.title')}
          onClick={onAddToList}
        />
      )}
    </section>
  );
}

/**
 * Ten rising bars over a transparent native range: drag or click, half
 * points. Written once on release, like `ProgressCard`; sliding to zero is how
 * a rating comes back off.
 */
function RatingMeter({
  score,
  onCommit,
}: {
  score: number | null;
  onCommit: (score: number | null) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [value, setValue] = useState(score ?? 0);

  const commit = () => {
    if (value === 0) {
      if (score !== null && score !== 0) onCommit(null);
      return;
    }
    if (value !== score) onCommit(value);
  };

  const shown = value > 0 || score === 0;

  return (
    <div className="flex items-end gap-[18px]">
      <span
        className={clsx(
          'w-[72px] shrink-0 font-display text-[48px] leading-[0.9]',
          shown ? 'text-prism' : 'text-dim',
        )}
      >
        {shown ? format.score(value) : '–'}
      </span>
      <div className="relative h-11 min-w-0 flex-1 rounded-md has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[6px] has-[input:focus-visible]:outline-pink">
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-end gap-1">
          {BAR_COLORS.map((fill, i) => (
            <div
              key={fill}
              className="flex-1 rounded-[3px]"
              style={{
                height: `${46 + i * 6}%`,
                background:
                  value >= i + 1
                    ? fill
                    : value >= i + STEP
                      ? `linear-gradient(90deg, ${fill} 50%, ${BAR_EMPTY} 50%)`
                      : BAR_EMPTY,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label={t('media.rating.scrub')}
          aria-valuetext={format.score(value)}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

function LogRow({
  label,
  value,
  muted,
  action,
  actionLabel,
  onClick,
}: {
  label: string;
  value: string;
  muted: boolean;
  action: string;
  /** What the action does, for a screen reader that hears only "EDIT". */
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <span className="w-[58px] shrink-0 font-label text-[10px] font-bold tracking-label text-dim">
        {label}
      </span>
      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-sm',
          muted ? 'text-muted' : 'font-semibold text-fg',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-label={actionLabel}
        className="cursor-pointer px-0.5 py-2 font-label text-[11px] font-bold tracking-btn text-pink transition hover:brightness-125"
      >
        {action}
      </button>
    </div>
  );
}
