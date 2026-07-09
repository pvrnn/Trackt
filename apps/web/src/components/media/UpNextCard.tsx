import clsx from 'clsx';
import { m } from 'motion/react';
import type { MediaKind } from '@trackt/shared';
import { coverGradient } from '../../lib/cover';
import { GlassCard } from '../ui/GlassCard';

export interface UpNextCardProps {
  kind: MediaKind;
  title: string;
  /** e.g. 'Episode 18 of 24' or 'S2 E5 — "Undertow"' */
  progressLine: string;
  checkedIn: boolean;
  onCheckIn: () => void;
  className?: string;
}

/** Up-next card: 96×136 generated-cover thumb, meta column, one-tap check-in pill. */
export function UpNextCard({
  kind,
  title,
  progressLine,
  checkedIn,
  onCheckIn,
  className,
}: UpNextCardProps) {
  return (
    <GlassCard className={clsx('flex overflow-hidden', className)}>
      <div
        className="flex h-[136px] w-24 shrink-0 items-end p-2"
        style={{ background: coverGradient(kind, title) }}
      >
        <span className="font-display text-xs leading-[1.15] text-white/92 uppercase">{title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-4.5 py-4">
        <span className="font-label text-[11px] font-bold tracking-label text-dim uppercase">
          {kind}
        </span>
        <span className="text-base leading-tight font-bold">{title}</span>
        <span className="text-[13px] text-muted">{progressLine}</span>
        <span className="flex-1" />
        <div className="flex">
          <m.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={onCheckIn}
            className={clsx(
              'cursor-pointer rounded-full px-4.5 py-2.25 text-[13px] font-bold tracking-btn transition-colors',
              checkedIn ? 'bg-white/25 text-fg' : 'bg-prism text-on-prism hover:brightness-115',
            )}
          >
            {checkedIn ? '✓ CHECKED IN' : '✓ CHECK IN'}
          </m.button>
        </div>
      </div>
    </GlassCard>
  );
}
