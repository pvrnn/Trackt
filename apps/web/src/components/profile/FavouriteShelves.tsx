import { Link } from '@tanstack/react-router';
import { MEDIA_KINDS, type FavoriteEntry, type MediaKind } from '@trackt/shared';
import { CoverCard } from '../media/CoverCard';
import { GlassCard } from '../ui/GlassCard';
import { KindDot } from '../ui/KindDot';
import { Tooltip } from '../ui/Tooltip';

const KIND_BLOCK_TITLES: Record<MediaKind, string> = {
  movie: 'Favourite movies',
  series: 'Favourite series',
  anime: 'Favourite anime',
  manga: 'Favourite manga',
  webtoon: 'Favourite webtoons',
};

/**
 * Ranked per-kind favourite shelves, shared by `/profile` and
 * `/users/$username` (ADR-0006 phase 4). `own` gates the trailing "find more"
 * tile: on someone else's profile it would be a control that acts on *your*
 * favourites from a page that shows theirs.
 */
export function FavouriteShelves({
  favorites,
  own,
  emptyMessage,
}: {
  favorites: FavoriteEntry[];
  own: boolean;
  emptyMessage: string;
}) {
  const blocks = MEDIA_KINDS.map((kind) => ({
    kind,
    items: favorites.filter((entry) => entry.kind === kind),
  })).filter((block) => block.items.length > 0);

  if (blocks.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-[32px] uppercase">Favourites</h2>
        <GlassCard className="px-6 py-5 text-[15px] text-muted">{emptyMessage}</GlassCard>
      </section>
    );
  }

  return (
    <>
      {blocks.map((block) => (
        <section key={block.kind} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 className="font-heading text-[32px] uppercase">{KIND_BLOCK_TITLES[block.kind]}</h2>
            <KindDot kind={block.kind} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {block.items.map((entry) => (
              <Link key={entry.id} to="/media/$slug" params={{ slug: entry.slug }}>
                <div className="relative">
                  <CoverCard
                    kind={entry.kind}
                    title={entry.title}
                    coverUrl={entry.coverUrl ?? undefined}
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-ink/80 px-2.5 py-0.5 font-display text-sm text-pink">
                    {String(entry.rank).padStart(2, '0')}
                  </span>
                </div>
              </Link>
            ))}
            {own && (
              <Tooltip label="Find more to favourite">
                <Link
                  to="/search"
                  search={{ kind: block.kind }}
                  className="flex aspect-2/3 items-center justify-center rounded-cover border border-dashed border-white/20 text-2xl text-faint transition hover:border-pink hover:text-pink"
                >
                  ＋
                </Link>
              </Tooltip>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
