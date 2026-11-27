import { Link } from '@tanstack/react-router';
import type { NewsArticleSummary } from '@trackt/shared';
import { coverGradient } from '@trackt/client';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
import { KindDot } from '../ui/KindDot';
import { Bone } from '../ui/Skeleton';

/**
 * One story in the feed (mockup `News.dc.html`).
 *
 * Two deliberate deviations from the mockup. Its per-topic tag colours would
 * need nine new palette entries, and AURA PRISM's token set is final
 * (docs/design/README.md), so the tag takes the existing selected-chip treatment
 * and the colour variety comes from the per-kind dots, which are tokens we
 * already have. And its `＋ PLAN TO WATCH` button is absent: acting on a work
 * needs the viewer's tracking state for it, which a feed summary does not carry,
 * and a button that only looks like it works is worse than no button. The
 * headline links through to the article, which links to the work.
 */
export function NewsCard({
  article,
  coverHeight = 180,
}: {
  article: NewsArticleSummary;
  /** The feed varies it so the masonry has something to pack. */
  coverHeight?: number;
}) {
  const labels = useLabels();
  const format = useFormat();
  const coverKind = article.kinds[0];
  return (
    <article className="overflow-hidden rounded-card border border-glass-border bg-glass backdrop-blur-[16px]">
      {/* The artwork stays clean: real covers carry their own lettering and can
          be any colour, so nothing to read sits on them. */}
      <Link
        to="/news/$slug"
        params={{ slug: article.slug }}
        aria-hidden
        tabIndex={-1}
        className="block bg-cover bg-center"
        style={{
          height: coverHeight,
          ...(article.coverUrl
            ? { backgroundImage: `url(${article.coverUrl})` }
            : // No cover art yet (sourcing is a later phase): the generated
              // gradient placeholder the plan calls for, seeded like every other
              // cover in the app so it is stable across renders.
              { background: coverGradient(coverKind ?? 'movie', article.title) }),
        }}
      />

      <div className="flex flex-col gap-2 px-4.5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-pink-selected px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-pink">
            {labels.topic(article.topic)}
          </span>
          {article.kinds.map((kind) => (
            <KindDot key={kind} kind={kind} showLabel />
          ))}
          <span className="font-label text-[11px] tracking-label text-dim">
            · {format.newsDate(article.publishedAt)}
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

/** A `NewsCard` still loading, at the cover height the feed would give it. */
export function NewsCardSkeleton({ coverHeight = 180 }: { coverHeight?: number }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-card border border-glass-border bg-glass backdrop-blur-[16px]"
    >
      <Bone className="rounded-none" style={{ height: coverHeight }} />
      <div className="flex flex-col gap-2.5 px-4.5 py-4">
        <div className="flex items-center gap-2">
          <Bone className="h-4.5 w-16 rounded-full" />
          <Bone className="h-2.5 w-20" />
        </div>
        <Bone className="h-4 w-11/12" />
        <Bone className="h-4 w-3/5" />
        <Bone className="mt-1 h-3 w-full" />
        <Bone className="h-3 w-4/5" />
      </div>
    </div>
  );
}
