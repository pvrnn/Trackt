import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from '@trackt/shared';
import { coverGradient, volumeCount } from '@trackt/client';
import { kindDotClass } from '../ui/KindDot';
import { useLabels } from '../../lib/labels';

export interface DiscoverPosterProps {
  item: SearchResult;
  /** A line under the caption, e.g. a game's edition or parent title. */
  context?: string | null;
}

/**
 * A Discover grid tile (`Search.dc.html`): the artwork stays clean, and the
 * title, kind · year and span chip sit underneath, so nothing that must be read
 * depends on what the cover looks like.
 */
export function DiscoverPoster({ item, context }: DiscoverPosterProps) {
  const { t } = useTranslation();
  const labels = useLabels();
  const volumes = volumeCount(item.metadata ?? {});
  // S1 on every first season is noise; the chip earns its place from S2 on.
  const span =
    item.seasonNumber && item.seasonNumber > 1
      ? {
          label: t('discover.seasonChip', { number: item.seasonNumber }),
          title: t('discover.seasonTitle', { number: item.seasonNumber }),
        }
      : volumes
        ? {
            label: t('discover.volumeChip', { count: volumes }),
            title: t('discover.volumeTitle', { count: volumes }),
          }
        : null;

  return (
    <Link
      to="/media/$slug"
      params={{ slug: item.slug }}
      className="group flex min-w-0 flex-col gap-2.5"
    >
      <div
        className="aspect-2/3 rounded-[10px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_10px_28px_-14px_rgba(0,0,0,0.9)] transition duration-160 ease-out group-hover:-translate-y-1 group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22),0_18px_36px_-16px_rgba(217,107,176,0.45),0_10px_28px_-14px_rgba(0,0,0,0.9)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        style={
          item.coverUrl
            ? { backgroundImage: `url(${item.coverUrl})` }
            : { background: coverGradient(item.kind, item.title) }
        }
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-2 text-sm leading-[1.3] font-semibold text-pretty">
          {item.title}
        </span>
        <span className="flex flex-wrap items-center gap-[7px]">
          <span
            aria-hidden
            className={`size-[7px] shrink-0 rounded-full ${kindDotClass[item.kind]}`}
          />
          <span className="font-label text-[11px] font-semibold tracking-label whitespace-nowrap text-muted uppercase">
            {labels.kindSingular(item.kind)}
            {item.year !== null && <span className="font-medium text-dim"> · {item.year}</span>}
          </span>
          {span && (
            <span
              title={span.title}
              className="rounded-[5px] bg-white/9 px-[7px] py-0.5 font-label text-[10px] font-bold tracking-label whitespace-nowrap text-fg uppercase shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
            >
              {span.label}
            </span>
          )}
        </span>
        {context && <span className="text-xs text-dim">{context}</span>}
      </div>
    </Link>
  );
}
