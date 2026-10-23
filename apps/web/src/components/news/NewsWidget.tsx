import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { coverGradient, useNewsFeed } from '@trackt/client';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
import { GlassCard } from '../ui/GlassCard';

const WIDGET_LIMIT = 4;

/** Compact "latest news" sidebar block, a slice of the /news feed, not the full card. */
export function NewsWidget() {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const { articles, isLoading, isError } = useNewsFeed({});
  const latest = articles.slice(0, WIDGET_LIMIT);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-[32px] uppercase">{t('news.widget.heading')}</h2>
        <Link
          to="/news"
          className="text-prism font-label text-xs font-bold tracking-btn hover:text-pink"
        >
          {t('news.widget.viewAll')}
        </Link>
      </div>

      {isError ? (
        <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
          {t('news.widget.error')}
        </GlassCard>
      ) : isLoading ? (
        <div className="h-24" aria-busy />
      ) : latest.length === 0 ? (
        <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
          {t('news.widget.empty')}
        </GlassCard>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {latest.map((article) => {
            const coverKind = article.kinds[0];
            return (
              <GlassCard
                as="li"
                key={article.slug}
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
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    to="/news/$slug"
                    params={{ slug: article.slug }}
                    className="truncate text-[13px] leading-[1.3] font-bold hover:text-pink"
                  >
                    {article.title}
                  </Link>
                  <span className="font-label text-[11px] tracking-label text-dim">
                    {labels.topic(article.topic)} · {format.newsDate(article.publishedAt)}
                  </span>
                </div>
              </GlassCard>
            );
          })}
        </ul>
      )}
    </section>
  );
}
