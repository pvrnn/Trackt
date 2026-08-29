import { Link } from '@tanstack/react-router';
import { TOPIC_LABELS, coverGradient, formatNewsDate, useMediaNews } from '@trackt/client';
import { GlassCard } from '../ui/GlassCard';

/**
 * "In the news" — the media detail sidebar's strip of central articles touching
 * this work (`/v1/news/by-media`, ADR-0005).
 *
 * It renders nothing at all when there is nothing to show, which is the same
 * rule the relation sections above it follow: an empty section on a sidebar is
 * a hole, not information. That deliberately collapses three states into one —
 * still loading, no news about this work, and a catalog this instance can't
 * reach (the API degrades that to an empty list rather than an error). None of
 * them is worth a permanent block of chrome on a page whose subject is the work.
 */
export function MediaNews({ mediaId }: { mediaId: string }) {
  const { data: articles } = useMediaNews(mediaId);
  if (!articles || articles.length === 0) return null;

  return (
    <section className="flex flex-col gap-3.5">
      <h2 className="font-heading text-2xl uppercase">In the news</h2>
      <ul className="flex flex-col gap-2.5">
        {articles.map((article) => {
          const coverKind = article.kinds[0];
          return (
            <GlassCard
              as="li"
              key={article.id}
              className="flex items-center gap-3 rounded-card-sm px-3.5 py-3"
            >
              <Link
                to="/news/$slug"
                params={{ slug: article.slug }}
                className="size-11 shrink-0 rounded-md bg-cover bg-center"
                style={
                  article.coverUrl
                    ? { backgroundImage: `url(${article.coverUrl})` }
                    : { background: coverGradient(coverKind ?? 'movie', article.title) }
                }
                aria-hidden
                tabIndex={-1}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  to="/news/$slug"
                  params={{ slug: article.slug }}
                  className="text-[13px] leading-[1.3] font-bold hover:text-pink"
                >
                  {article.title}
                </Link>
                <span className="font-label text-[11px] tracking-label text-dim">
                  {TOPIC_LABELS[article.topic]} · {formatNewsDate(article.publishedAt)}
                </span>
              </div>
            </GlassCard>
          );
        })}
      </ul>
    </section>
  );
}
