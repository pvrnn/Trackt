import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { MediaKind } from '@trackt/shared';
import { coverGradient } from '@trackt/client';
import { useLabels } from '../../lib/labels';
import { kindDotClass } from '../ui/KindDot';
import { Bone } from '../ui/Skeleton';

export interface UpNextCardProps {
  kind: MediaKind;
  slug: string;
  title: string;
  /** e.g. 'Episode 18 of 24' */
  progressLine: string;
  /** Completion 0..1; omitted when the work has no known total. */
  progress?: number | undefined;
  coverUrl?: string | null;
  checkedIn: boolean;
  onCheckIn: () => void;
}

/**
 * One slot of the up-next rail: 54×81 thumb, kind, title, next part, PRISM bar,
 * and a round one-tap ✓. The card itself is not a link — the button lives inside it.
 */
export function UpNextCard({
  kind,
  slug,
  title,
  progressLine,
  progress,
  coverUrl,
  checkedIn,
  onCheckIn,
}: UpNextCardProps) {
  const { t } = useTranslation();
  const labels = useLabels();

  return (
    <div
      className={clsx(
        'flex min-w-0 items-center gap-3.5 rounded-card-sm border bg-glass py-2.5 pr-3.5 pl-2.5 backdrop-blur-[16px] transition-colors',
        checkedIn ? 'border-pink/45' : 'border-glass-border',
      )}
    >
      <Link
        to="/media/$slug"
        params={{ slug }}
        aria-hidden
        tabIndex={-1}
        className="h-[81px] w-[54px] shrink-0 rounded-[7px] bg-cover bg-center ring-1 ring-white/14 ring-inset"
        style={
          coverUrl
            ? { backgroundImage: `url(${coverUrl})` }
            : { background: coverGradient(kind, title) }
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={clsx('size-1.5 rounded-full', kindDotClass[kind])} />
          <span className="font-label text-[10px] font-bold tracking-label text-dim uppercase">
            {labels.kindSingular(kind)}
          </span>
        </span>
        <Link
          to="/media/$slug"
          params={{ slug }}
          className="truncate text-[15px] leading-tight font-bold hover:text-pink"
        >
          {title}
        </Link>
        <span className="truncate text-[13px] text-muted">
          {checkedIn ? t('home.upNext.checkedIn', { part: progressLine }) : progressLine}
        </span>
        {progress !== undefined && (
          <span aria-hidden className="mt-0.75 h-0.75 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-prism"
              style={{ width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` }}
            />
          </span>
        )}
      </div>
      <m.button
        type="button"
        whileTap={checkedIn ? undefined : { scale: 0.92 }}
        onClick={onCheckIn}
        disabled={checkedIn}
        aria-pressed={checkedIn}
        aria-label={t('home.upNext.checkIn', { title, part: progressLine })}
        className={clsx(
          'flex size-11 shrink-0 items-center justify-center rounded-full text-[17px] font-bold transition',
          checkedIn
            ? 'bg-pink/16 text-[#e58cc4] ring-1 ring-pink/60 ring-inset'
            : 'cursor-pointer bg-prism text-on-prism hover:brightness-115',
        )}
      >
        ✓
      </m.button>
    </div>
  );
}

/** An `UpNextCard` still loading: same frame, bones for its content. */
export function UpNextCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex min-w-0 items-center gap-3.5 rounded-card-sm border border-glass-border bg-glass py-2.5 pr-3.5 pl-2.5 backdrop-blur-[16px]"
    >
      <Bone className="h-[81px] w-[54px] shrink-0 rounded-[7px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Bone className="h-2.5 w-14" />
        <Bone className="h-3.5 w-3/4" />
        <Bone className="h-3 w-1/2" />
      </div>
      <Bone className="size-11 shrink-0 rounded-full" />
    </div>
  );
}
