import clsx from 'clsx';
import type { MediaKind } from '@trackt/shared';

/** Static class strings so Tailwind's scanner sees every kind color. */
const dotClasses: Record<MediaKind, string> = {
  movie: 'bg-kind-movie',
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
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <span aria-hidden className={clsx('size-2 rounded-full', dotClasses[kind])} />
      {showLabel ? (
        <span className="font-label text-xs font-semibold tracking-label text-muted uppercase">
          {kind}
        </span>
      ) : (
        <span className="sr-only">{kind}</span>
      )}
    </span>
  );
}
