import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { NewsArticleSummary } from '@trackt/shared';
import { coverGradient, useTrackedNews } from '@trackt/client';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

/** In-progress titles asked for news: one rate-limited by-media read each. */
const NEWS_SOURCES = 4;
const NEWS_SHOWN = 5;

function coverStyle(article: NewsArticleSummary) {
  return article.coverUrl
    ? { backgroundImage: `url(${article.coverUrl})` }
    : { background: coverGradient(article.kinds[0] ?? 'series', article.title) };
}

function useMeta() {
  const labels = useLabels();
  const format = useFormat();
  return (article: NewsArticleSummary) => {
    const date = format.newsDate(article.publishedAt);
    const kind = article.kinds[0];
    return kind ? `${labels.kindSingular(kind).toUpperCase()} · ${date}` : date;
  };
}

function TopicTag({ article }: { article: NewsArticleSummary }) {
  const labels = useLabels();
  return (
    <span className="rounded-full bg-pink-selected px-2.5 py-0.75 font-label text-[10px] font-bold tracking-label text-[#e58cc4] uppercase">
      {labels.topic(article.topic)}
    </span>
  );
}

/** Home's "News · from what you track": a lead story, then briefs as rows. */
export function NewsWidget({ mediaIds }: { mediaIds: readonly string[] }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const { articles, isPending } = useTrackedNews(mediaIds.slice(0, NEWS_SOURCES), NEWS_SHOWN);
  const [lead, ...briefs] = articles;

  return (
    <section aria-labelledby="home-news" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h2 id="home-news" className="font-heading text-[48px] leading-none uppercase">
          {t('home.news.title')}
        </h2>
        <span className="font-label text-xs font-semibold tracking-label text-dim">
          {t('home.news.caption')}
        </span>
        <span className="flex-1" />
        <Link
          to="/news"
          className="tap-area font-label text-xs font-bold tracking-label text-pink hover:brightness-115"
        >
          {t('home.news.all')}
        </Link>
      </div>

      {!lead ? (
        isPending && mediaIds.length > 0 ? (
          <NewsWidgetSkeleton />
        ) : (
          <p className="rounded-card-sm border border-dashed border-white/20 px-5 py-4 text-sm text-muted">
            {t('home.news.empty')}
          </p>
        )
      ) : (
        <>
          <article className="overflow-hidden rounded-card border border-glass-border bg-glass backdrop-blur-[16px]">
            <Link
              to="/news/$slug"
              params={{ slug: lead.slug }}
              aria-hidden
              tabIndex={-1}
              className="relative block h-[250px] bg-cover bg-center"
              style={coverStyle(lead)}
            >
              <span className="absolute top-3.5 left-3.5 flex items-center gap-1.5 rounded-full bg-on-prism px-2.75 py-1.25 ring-1 ring-pink/60 ring-inset">
                <span className="size-1.25 rounded-full bg-pink" />
                <span className="font-label text-[10px] font-bold tracking-label text-[#e58cc4]">
                  {t('home.news.tracking')}
                </span>
              </span>
            </Link>
            <div className="flex flex-col gap-2.5 px-6 pt-5 pb-5.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <TopicTag article={lead} />
                <span className="font-label text-[11px] font-medium tracking-label text-dim">
                  {meta(lead)}
                </span>
              </div>
              <Link
                to="/news/$slug"
                params={{ slug: lead.slug }}
                className="text-[26px] leading-[1.2] font-bold text-balance hover:text-pink"
              >
                {lead.title}
              </Link>
              {lead.dek && (
                <p className="text-[15px] leading-[1.6] text-pretty text-muted">{lead.dek}</p>
              )}
            </div>
          </article>

          {briefs.length > 0 && (
            <ul className="flex flex-col">
              {briefs.map((article) => (
                <li key={article.id}>
                  <Link
                    to="/news/$slug"
                    params={{ slug: article.slug }}
                    className="group flex items-center gap-4 py-3.5 shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"
                  >
                    <span
                      aria-hidden
                      className="h-[69px] w-[46px] shrink-0 rounded-thumb bg-cover bg-center ring-1 ring-white/14 ring-inset"
                      style={coverStyle(article)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.75">
                      <span className="flex flex-wrap items-center gap-2.5">
                        <TopicTag article={article} />
                        <span className="font-label text-[11px] font-medium tracking-label text-dim">
                          {meta(article)}
                        </span>
                      </span>
                      <span className="text-base leading-[1.3] font-semibold group-hover:text-pink">
                        {article.title}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** The lead story and its briefs, still loading. */
export function NewsWidgetSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col">
      <div className="overflow-hidden rounded-card border border-glass-border bg-glass backdrop-blur-[16px]">
        <Bone className="h-[250px] rounded-none" />
        <div className="flex flex-col gap-3 px-6 pt-5 pb-5.5">
          <div className="flex items-center gap-2.5">
            <Bone className="h-5 w-20 rounded-full" />
            <Bone className="h-2.5 w-28" />
          </div>
          <Bone className="h-6 w-11/12" />
          <Bone className="h-6 w-2/3" />
          <Bone className="mt-1 h-3.5 w-full" />
          <Bone className="h-3.5 w-4/5" />
        </div>
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 py-3.5 shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"
        >
          <Bone className="h-[69px] w-[46px] shrink-0 rounded-thumb" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <Bone className="h-5 w-20 rounded-full" />
              <Bone className="h-2.5 w-24" />
            </div>
            <Bone className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
