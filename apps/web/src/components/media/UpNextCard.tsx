import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { m } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { MediaKind } from '@trackt/shared';
import { coverGradient } from '@trackt/client';
import { useLabels } from '../../lib/labels';
import { GlassCard } from '../ui/GlassCard';

export interface UpNextCardProps {
  kind: MediaKind;
  title: string;
  /** e.g. 'Episode 18 of 24' or 'S2 E5, "Undertow"' */
  progressLine: string;
  checkedIn: boolean;
  onCheckIn: () => void;
  /** Links the thumb and title to the media page. Omitted by the landing demo. */
  slug?: string;
  /** Real artwork replaces the generated gradient, as on CoverCard. */
  coverUrl?: string | null;
  className?: string;
}

/**
 * Up-next card: 96×136 cover thumb, meta column, one-tap check-in pill.
 *
 * The thumb and title link to the media page; the card as a whole deliberately
 * does not, since the check-in button lives inside it and a button nested in an
 * anchor is invalid markup that would navigate on every check-in.
 */
export function UpNextCard({
  kind,
  title,
  progressLine,
  checkedIn,
  onCheckIn,
  slug,
  coverUrl,
  className,
}: UpNextCardProps) {
  const { t } = useTranslation();
  const labels = useLabels();
  const checkInLabel = t('media.checkInCompact', {
    verb: labels.trackingVerb(kind).toUpperCase(),
  });
  const coverClass = 'flex h-[136px] w-24 shrink-0 items-end bg-cover bg-center p-2';
  const coverStyle = coverUrl
    ? { backgroundImage: `url(${coverUrl})` }
    : { background: coverGradient(kind, title) };
  // The gradient carries the title because it has no other identity; real
  // artwork already shows it, and the meta column repeats it either way.
  const coverTitle = coverUrl ? null : (
    <span className="font-display text-xs leading-[1.15] text-white/92 uppercase">{title}</span>
  );

  return (
    <GlassCard className={clsx('flex overflow-hidden', className)}>
      {slug ? (
        // Same destination as the title link below, so it's kept out of the tab
        // order and the accessible tree rather than announced twice.
        <Link
          to="/media/$slug"
          params={{ slug }}
          aria-hidden
          tabIndex={-1}
          className={coverClass}
          style={coverStyle}
        >
          {coverTitle}
        </Link>
      ) : (
        <div className={coverClass} style={coverStyle}>
          {coverTitle}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-4">
        <span className="font-label text-[11px] font-bold tracking-label text-dim uppercase">
          {labels.kindSingular(kind)}
        </span>
        {slug ? (
          <Link
            to="/media/$slug"
            params={{ slug }}
            className="text-base leading-tight font-bold transition-colors hover:text-pink"
          >
            {title}
          </Link>
        ) : (
          <span className="text-base leading-tight font-bold">{title}</span>
        )}
        <span className="text-[13px] text-muted">{progressLine}</span>
        <span className="flex-1" />
        <div className="flex">
          <m.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={onCheckIn}
            className={clsx(
              // `whitespace-nowrap`: a label that wraps to two lines makes this
              // card taller than its neighbours in the 3-up grid. The progress
              // line above already names the part, so the pill stays generic
              // and short: 'CHECK IN' / 'J’AI VU'. 'MARQUER COMME VU' was wide
              // enough to fill the card's meta column in French.
              'cursor-pointer rounded-full px-4 py-2.25 text-[13px] font-bold tracking-btn whitespace-nowrap transition-colors',
              checkedIn ? 'bg-white/25 text-fg' : 'bg-prism text-on-prism hover:brightness-115',
            )}
          >
            {checkedIn ? `✓ ${labels.trackingVerb(kind).toUpperCase()}` : `✓ ${checkInLabel}`}
          </m.button>
        </div>
      </div>
    </GlassCard>
  );
}
