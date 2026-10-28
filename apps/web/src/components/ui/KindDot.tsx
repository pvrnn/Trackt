import clsx from 'clsx';
import type { MediaKind } from '@trackt/shared';
import { useLabels } from '../../lib/labels';

/** Static class strings so Tailwind's scanner sees every kind color. */
const dotClasses: Record<MediaKind, string> = {
  movie: 'bg-kind-movie',
  game: 'bg-kind-game',
  series: 'bg-kind-series',
  anime: 'bg-kind-anime',
  manga: 'bg-kind-manga',
  webtoon: 'bg-kind-webtoon',
};

export interface KindDotProps {
  kind: MediaKind;
  showLabel?: boolean;
  className?: string;
}

export function KindDot({ kind, showLabel = false, className }: KindDotProps) {
  const labels = useLabels();
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <span aria-hidden className={clsx('size-2 rounded-full', dotClasses[kind])} />
      {showLabel ? (
        <span className="font-label text-xs font-semibold tracking-label text-muted uppercase">
          {labels.kindSingular(kind)}
        </span>
      ) : (
        <span className="sr-only">{labels.kindSingular(kind)}</span>
      )}
    </span>
  );
}
