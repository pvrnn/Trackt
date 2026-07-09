import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { MediaKind } from '@trackt/shared';
import { coverGradient } from '../../lib/cover';

export interface CoverCardProps {
  kind: MediaKind;
  title: string;
  /** Completion 0..1 — renders the 4px PRISM progress bar along the bottom edge. */
  progress?: number;
  /** Real artwork replaces the generated gradient; title/progress treatment stays. */
  coverUrl?: string;
  /** Line under the cover (e.g. kind dot + year). */
  caption?: ReactNode;
  className?: string;
}

/** Generated cover: kind-hued gradient, Anton title bottom-left, PRISM progress bar. */
export function CoverCard({ kind, title, progress, coverUrl, caption, className }: CoverCardProps) {
  return (
    <figure className={clsx('flex flex-col gap-2', className)}>
      <div
        className="relative flex aspect-2/3 items-end overflow-hidden rounded-cover bg-cover bg-center p-3"
        style={
          coverUrl
            ? { backgroundImage: `url(${coverUrl})` }
            : { background: coverGradient(kind, title) }
        }
      >
        <span className="font-display text-[17px] leading-[1.1] text-white/94 uppercase">
          {title}
        </span>
        {progress !== undefined && (
          <span
            aria-hidden
            className="absolute bottom-0 left-0 h-1 bg-prism"
            style={{ width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` }}
          />
        )}
      </div>
      {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
    </figure>
  );
}
