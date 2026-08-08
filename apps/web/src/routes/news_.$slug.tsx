import { createFileRoute, Link } from '@tanstack/react-router';
import { HTTPError } from 'ky';
import type { NewsLinkedWork } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { Markdown } from '../components/news/Markdown';
import { TOPIC_LABELS, formatNewsDate } from '../components/news/NewsCard';
import { KindDot } from '../components/ui/KindDot';
import { useOptionalSession } from '../lib/auth-client';
import { coverGradient } from '../lib/cover';
import { useNewsArticle } from '../lib/news';

/**
 * `news_.` opts this route out of nesting under `/news`: the feed is a
 * standalone page with no `<Outlet />`, so as a child this component never
 * rendered — the URL changed and the feed stayed on screen.
 */
export const Route = createFileRoute('/news_/$slug')({
  head: () => ({ meta: [{ title: 'Article — Trackt' }] }),
  component: ArticlePage,
});

function ArticlePage() {
  const { slug } = Route.useParams();
  const { isPending, navUser } = useOptionalSession();
  const { data: article, isPending: articlePending, error } = useNewsArticle(slug);

  if (isPending) return <div className="min-h-screen bg-ink" />;

  const notFound = error instanceof HTTPError && error.response.status === 404;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        <main className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pt-10 pb-20 sm:px-10">
          <Link
            to="/news"
            className="font-label text-xs font-semibold tracking-label text-dim hover:text-pink"
          >
            ← ALL NEWS
          </Link>

          {articlePending ? (
            <p aria-busy className="text-[15px] text-muted">
              Loading…
            </p>
          ) : notFound ? (
            <Missing />
          ) : error || !article ? (
            <p role="alert" className="text-[15px] text-red-400">
              This article couldn&apos;t be loaded — the news service may be briefly unavailable.
              Try again in a moment.
            </p>
          ) : (
            <>
              <div
                className="relative flex h-[220px] items-end overflow-hidden rounded-card p-6"
                style={
                  article.coverUrl
                    ? { backgroundImage: `url(${article.coverUrl})`, backgroundSize: 'cover' }
                    : { background: coverGradient(article.kinds[0] ?? 'movie', article.title) }
                }
              >
                <span
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-b from-transparent to-ink/80"
                />
                <div className="relative flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-pink-selected px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-pink">
                      {TOPIC_LABELS[article.topic]}
                    </span>
                    {article.kinds.map((kind) => (
                      <KindDot key={kind} kind={kind} showLabel />
                    ))}
                    <time
                      dateTime={article.publishedAt}
                      className="font-label text-[11px] tracking-label text-dim"
                    >
                      · {formatNewsDate(article.publishedAt)}
                    </time>
                  </div>
                  <h1 className="font-display text-[40px] leading-[1.05] text-white uppercase">
                    {article.title}
                  </h1>
                </div>
              </div>

              {article.dek && <p className="text-[17px] leading-[1.6] text-fg">{article.dek}</p>}

              <Markdown body={article.body} />

              {article.media.length > 0 && <LinkedWorks works={article.media} />}

              <section className="flex flex-col gap-3 border-t border-divider pt-6">
                <h2 className="font-label text-xs font-semibold tracking-label text-dim">
                  SOURCES
                </h2>
                <ul className="flex flex-col gap-2">
                  {article.sources.map((source) => (
                    <li key={source.url} className="text-sm">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-pink underline underline-offset-2 hover:brightness-115"
                      >
                        {source.title}
                      </a>
                      <span className="text-dim">
                        {' — '}
                        {source.outlet}
                        {source.publishedAt ? `, ${formatNewsDate(source.publishedAt)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Works the story is about. Every chip routes to a real local media page: the
 * API resolved each one against this instance's `media` table on the way out,
 * materializing anything it had never seen (ADR-0005), so there are no chips
 * here that lead nowhere.
 */
function LinkedWorks({ works }: { works: NewsLinkedWork[] }) {
  return (
    <section className="flex flex-col gap-3 border-t border-divider pt-6">
      <h2 className="font-label text-xs font-semibold tracking-label text-dim">IN THIS STORY</h2>
      <ul className="flex flex-wrap gap-2.5">
        {works.map((work) => (
          <li key={`${work.id}-${work.role}`}>
            <Link
              to="/media/$slug"
              params={{ slug: work.slug }}
              className="flex items-center gap-2.5 rounded-full border border-glass-border-strong bg-glass py-2 pr-4 pl-2 transition hover:border-pink"
            >
              <span
                aria-hidden
                className="size-7 shrink-0 rounded-full bg-cover bg-center"
                style={
                  work.coverUrl
                    ? { backgroundImage: `url(${work.coverUrl})` }
                    : { background: coverGradient(work.kind, work.title) }
                }
              />
              <span className="text-sm font-semibold">{work.title}</span>
              {work.year !== null && (
                <span className="font-label text-[11px] tracking-label text-dim">{work.year}</span>
              )}
              <KindDot kind={work.kind} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Missing() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-white/20 bg-glass px-8 py-10 text-center backdrop-blur-[16px]">
      <p className="font-display text-[32px] text-faint uppercase">No such story</p>
      <p className="max-w-[420px] text-sm text-muted">
        This article doesn&apos;t exist, or it was withdrawn.
      </p>
      <Link
        to="/news"
        className="mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
      >
        BACK TO NEWS →
      </Link>
    </div>
  );
}
