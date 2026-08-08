import { Link } from '@tanstack/react-router';
import type { NewsArticleSummary } from '@trackt/shared';
import { coverGradient } from '../../lib/cover';
import { KindDot } from '../ui/KindDot';

/** Topic labels as the design writes them: short, uppercase, on a tag pill. */
export const TOPIC_LABELS: Record<NewsArticleSummary['topic'], string> = {
  announcement: 'ANNOUNCED',
  renewal: 'NEW SEASON',
  cancellation: 'CANCELLED',
  release_date: 'RELEASE DATE',
  trailer: 'TRAILER',
  casting: 'CASTING',
  adaptation: 'ADAPTATION',
  award: 'AWARD',
  general: 'NEWS',
};

export function formatNewsDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

/**
 * One story in the feed (mockup `News.dc.html`).
 *
 * Two deliberate deviations from the mockup. Its per-topic tag colours would
 * need nine new palette entries, and AURA PRISM's token set is final
 * (docs/design/README.md) — the tag takes the existing selected-chip treatment
 * and the colour variety comes from the per-kind dots, which are tokens we
 * already have. And its `＋ PLAN TO WATCH` button is absent: acting on a work
 * needs the viewer's tracking state for it, which a feed summary does not carry,
 * and a button that only looks like it works is worse than no button. The
 * headline links through to the article, which links to the work.
 */
export function NewsCard({ article }: { article: NewsArticleSummary }) {
  const coverKind = article.kinds[0];
  return (
    <article className="overflow-hidden rounded-card border border-glass-border bg-glass backdrop-blur-[16px]">
      <Link
        to="/news/$slug"
        params={{ slug: article.slug }}
        className="relative flex h-[150px] items-end p-4"
        style={
          article.coverUrl
            ? { backgroundImage: `url(${article.coverUrl})`, backgroundSize: 'cover' }
            : // No cover art yet (sourcing is a later phase) — the generated
              // gradient placeholder the plan calls for, seeded like every other
              // cover in the app so it is stable across renders.
              { background: coverGradient(coverKind ?? 'movie', article.title) }
        }
      >
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ink/75"
        />
        <span className="relative font-display text-[20px] leading-[1.08] text-white uppercase">
          {article.title}
        </span>
      </Link>

      <div className="flex flex-col gap-2 px-4.5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-pink-selected px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-pink">
            {TOPIC_LABELS[article.topic]}
          </span>
          {article.kinds.map((kind) => (
            <KindDot key={kind} kind={kind} showLabel />
          ))}
          <span className="font-label text-[11px] tracking-label text-dim">
            · {formatNewsDate(article.publishedAt)}
          </span>
        </div>

        <Link
          to="/news/$slug"
          params={{ slug: article.slug }}
          className="text-[15px] leading-[1.3] font-bold hover:text-pink"
        >
          {article.title}
        </Link>

        {article.dek && <p className="text-[13px] leading-[1.55] text-muted">{article.dek}</p>}
      </div>
    </article>
  );
}
