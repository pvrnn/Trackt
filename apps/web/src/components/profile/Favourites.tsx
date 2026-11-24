import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type FavoriteEntry, type MediaKind } from '@trackt/shared';
import { useLabels } from '../../lib/labels';
import { CoverCard } from '../media/CoverCard';
import { GlassCard } from '../ui/GlassCard';
import { kindDotClass } from '../ui/KindDot';
import { Tooltip } from '../ui/Tooltip';

const ROW = 6;
const TOP = 'top';
type Tab = MediaKind | typeof TOP;

/**
 * Ranked per-kind favourites, shared by the own and the public profile
 * (ADR-0006 phase 4). One row at a time: TOP PICKS is every kind's #1, a kind
 * tab is that kind's ranking. `own` gates the trailing "find more" tile: on
 * someone else's profile it would act on *your* favourites.
 */
export function Favourites({
  favorites,
  own,
  emptyMessage,
}: {
  favorites: FavoriteEntry[];
  own: boolean;
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [tab, setTab] = useState<Tab>(TOP);
  const [expanded, setExpanded] = useState(false);

  const blocks = MEDIA_KINDS.map((kind) => ({
    kind,
    items: favorites.filter((entry) => entry.kind === kind),
  })).filter((block) => block.items.length > 0);
  const block = tab === TOP ? undefined : blocks.find((candidate) => candidate.kind === tab);

  const heading = (
    <div className="flex items-baseline gap-3.5">
      <h2 id="favourites-heading" className="font-heading text-[32px] uppercase">
        {t('profile.favourites.title')}
      </h2>
      {favorites.length > 0 && (
        <span className="font-label text-xs font-semibold tracking-[0.08em] text-dim">
          {t('profile.favourites.total', { count: favorites.length })}
        </span>
      )}
    </div>
  );

  if (blocks.length === 0) {
    return (
      <section aria-labelledby="favourites-heading" className="flex flex-col gap-4">
        {heading}
        <GlassCard className="px-6 py-5 text-[15px] text-muted">{emptyMessage}</GlassCard>
      </section>
    );
  }

  const row = block
    ? (expanded ? block.items : block.items.slice(0, ROW)).map((entry) => ({
        entry,
        eyebrow: t('profile.favourites.rank', { rank: entry.rank }),
      }))
    : blocks.map(({ kind, items }) => ({
        entry: items[0] as FavoriteEntry,
        eyebrow: t('profile.favourites.topOf', { kind: labels.kindSingular(kind) }),
      }));
  const hidden = block ? block.items.length - ROW : 0;

  const pick = (next: Tab) => {
    setTab(next);
    setExpanded(false);
  };

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: TOP, label: t('profile.favourites.topPicks'), count: null },
    ...blocks.map(({ kind, items }) => ({
      key: kind,
      label: labels.kind(kind),
      count: items.length,
    })),
  ];

  return (
    <section aria-labelledby="favourites-heading" className="flex flex-col gap-1.5">
      {heading}
      <div className="mb-3.5 flex flex-wrap shadow-[inset_0_-1px_0_var(--color-divider)]">
        {tabs.map((item) => {
          const on = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={on}
              onClick={() => pick(item.key)}
              className={clsx(
                'relative flex cursor-pointer items-center gap-2 px-3.5 py-3.25 font-label text-xs font-bold tracking-[0.08em] uppercase transition hover:text-fg',
                on ? 'text-fg' : 'text-muted',
              )}
            >
              {item.key !== TOP && (
                <span
                  aria-hidden
                  className={clsx('size-1.75 rounded-full', kindDotClass[item.key])}
                />
              )}
              <span>{item.label}</span>
              {item.count !== null && <span className="font-medium text-dim">{item.count}</span>}
              <span
                aria-hidden
                className={clsx(
                  'absolute inset-x-2.5 bottom-0 h-0.5 rounded-full',
                  on ? 'bg-prism' : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-6">
        {row.map(({ entry, eyebrow }) => (
          <li key={entry.id} className="min-w-0">
            <Link to="/media/$slug" params={{ slug: entry.slug }} className="group">
              <CoverCard
                kind={entry.kind}
                title={entry.title}
                coverUrl={entry.coverUrl ?? undefined}
                className="transition-transform duration-150 group-hover:-translate-y-0.75 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                caption={
                  <span className="flex items-center gap-1.5 font-label text-[10px] font-bold tracking-label text-muted uppercase">
                    <span
                      aria-hidden
                      className={clsx('size-1.5 rounded-full', kindDotClass[entry.kind])}
                    />
                    {eyebrow}
                  </span>
                }
              />
            </Link>
          </li>
        ))}
        {own && block && block.items.length < ROW && (
          <li>
            <Tooltip label={t('profile.favourites.findMore')}>
              <Link
                to="/search"
                search={{ kind: block.kind }}
                aria-label={t('profile.favourites.findMore')}
                className="flex aspect-2/3 items-center justify-center rounded-cover border border-dashed border-white/20 text-2xl text-faint transition hover:border-pink hover:text-pink"
              >
                ＋
              </Link>
            </Tooltip>
          </li>
        )}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 cursor-pointer self-start font-label text-xs font-bold tracking-[0.08em] text-pink"
        >
          {expanded
            ? t('profile.favourites.showFewer')
            : t('profile.favourites.seeAll', { count: block?.items.length ?? 0 })}
        </button>
      )}
    </section>
  );
}
