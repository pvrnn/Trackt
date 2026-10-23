import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import { useState } from 'react';
import { IN_PROGRESS_LIMIT, type HomeSummary, type UpNextEntry } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { UpNextCard } from '../components/media/UpNextCard';
import { NewsWidget } from '../components/news/NewsWidget';
import { Avatar } from '../components/ui/Avatar';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { StatCard } from '../components/ui/StatCard';
import { useAuthedPage } from '../lib/auth-client';
import { useLabels } from '../lib/labels';
import {
  relativeTime,
  upNextPartKey,
  useHomeSummary,
  invalidateTracking,
  trackingApi,
} from '@trackt/client';

export const Route = createFileRoute('/home')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.home') }] }),
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { isPending, navUser } = useAuthedPage();
  const queryClient = useQueryClient();
  const { data: summary, isError } = useHomeSummary();
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());

  const progressLine = (entry: UpNextEntry): string => {
    const chapter = entry.partKind === 'chapter';
    return entry.total !== null
      ? t(chapter ? 'home.progress.chapterOf' : 'home.progress.episodeOf', {
          next: entry.next,
          total: entry.total,
        })
      : t(chapter ? 'home.progress.chapter' : 'home.progress.episode', { next: entry.next });
  };

  const inProgressSub = (entry: HomeSummary['inProgress'][number]): string => {
    const kind = labels.kindSingular(entry.kind);
    if (entry.total === null) return kind;
    const progress =
      entry.kind === 'manga' || entry.kind === 'webtoon'
        ? t('home.inProgress.chapter', { watched: entry.watched, total: entry.total })
        : t('home.inProgress.episode', { watched: entry.watched, total: entry.total });
    return t('home.inProgress.caption', { kind, progress });
  };

  const checkInMutation = useMutation({
    mutationFn: (entry: UpNextEntry) => trackingApi.checkIn(entry.id, entry.next),
    // Optimistically mark the card; roll back on failure, re-sync on settle.
    onMutate: (entry) => setCheckedIn((current) => new Set(current).add(upNextPartKey(entry))),
    onError: (_error, entry) =>
      setCheckedIn((current) => {
        const set = new Set(current);
        set.delete(upNextPartKey(entry));
        return set;
      }),
    // Same sweep as the media page: a check-in here also changes that title's
    // detail and the profile activity feed.
    onSettled: () => invalidateTracking(queryClient),
  });

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  const userName = navUser.username;

  const checkIn = (entry: UpNextEntry) => {
    if (!checkedIn.has(upNextPartKey(entry))) checkInMutation.mutate(entry);
  };

  const pending = summary
    ? {
        episodes: summary.upNext.filter((entry) => entry.partKind === 'episode').length,
        chapters: summary.upNext.filter((entry) => entry.partKind === 'chapter').length,
      }
    : null;
  const pendingLine = pending
    ? [
        pending.episodes > 0 ? t('home.pending.episodes', { count: pending.episodes }) : null,
        pending.chapters > 0 ? t('home.pending.chapters', { count: pending.chapters }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto grid max-w-[1360px] grid-cols-1 gap-8 px-10 pt-12 pb-20 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="flex flex-col gap-6">
            {checkInMutation.isError && (
              <p role="alert" className="text-[15px] text-red-400">
                {t('home.errors.save')}
              </p>
            )}
            {isError ? (
              <p role="alert" className="text-[15px] text-red-400">
                {t('home.errors.load')}
              </p>
            ) : !summary ? (
              <div className="h-40" aria-busy />
            ) : summary.upNext.length === 0 && summary.inProgress.length === 0 ? (
              /* Fresh account: nothing tracked yet: point at Discover. */
              <section className="flex flex-col items-start gap-5 pt-8">
                <h1 className="font-heading text-[64px] leading-none uppercase">
                  {t('home.empty.title')}
                </h1>
                <p className="max-w-[560px] text-[15px] text-muted">{t('home.empty.body')}</p>
                <Link to="/search" className={buttonClassName()}>
                  {t('home.empty.cta')}
                </Link>
              </section>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-4">
                  <h1 className="font-heading text-[64px] leading-none uppercase">
                    {t('home.title')}
                  </h1>
                  {pendingLine && (
                    <span className="text-prism font-label text-sm font-bold tracking-btn">
                      {pendingLine}
                    </span>
                  )}
                </div>
                {summary.upNext.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {summary.upNext.map((entry) => (
                      <UpNextCard
                        key={entry.id}
                        slug={entry.slug}
                        kind={entry.kind}
                        title={entry.title}
                        coverUrl={entry.coverUrl}
                        progressLine={progressLine(entry)}
                        checkedIn={checkedIn.has(upNextPartKey(entry))}
                        onCheckIn={() => checkIn(entry)}
                      />
                    ))}
                  </div>
                ) : (
                  <GlassCard className="px-6 py-5 text-[15px] text-muted">
                    {t('home.caughtUp')}
                  </GlassCard>
                )}

                {summary.inProgress.length > 0 && (
                  <>
                    <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="font-heading text-[32px] uppercase">
                        {t('home.inProgress.title')}
                      </h2>
                      {/* The shelf is capped server-side. This was a `VIEW ALL →`
                        that went nowhere, then plain text saying a library page
                        was coming; /history is that page (ADR-0007), so it is a
                        real link again, filtered to what's still open. */}
                      {summary.inProgress.length >= IN_PROGRESS_LIMIT && (
                        <Link
                          to="/history"
                          search={{ year: 'all', status: 'in_progress' }}
                          className="font-label text-[13px] tracking-label text-dim hover:text-pink"
                        >
                          {t('home.inProgress.viewAll', { count: IN_PROGRESS_LIMIT })}
                        </Link>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {summary.inProgress.map((entry) => (
                        <Link key={entry.id} to="/media/$slug" params={{ slug: entry.slug }}>
                          <CoverCard
                            kind={entry.kind}
                            title={entry.title}
                            coverUrl={entry.coverUrl ?? undefined}
                            progress={
                              entry.total !== null && entry.total > 0
                                ? entry.watched / entry.total
                                : undefined
                            }
                            caption={inProgressSub(entry)}
                          />
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {summary && (summary.activity.length > 0 || summary.inProgress.length > 0) && (
              <section className="mt-6 flex flex-col gap-4">
                <h2 className="font-heading text-[32px] uppercase">{t('home.activity.title')}</h2>
                {summary.activity.length > 0 ? (
                  <ul className="flex flex-col gap-2.5">
                    {summary.activity.map((entry, index) => (
                      <GlassCard
                        as="li"
                        key={`${entry.verb}-${entry.slug}-${index}`}
                        className="flex items-center gap-3 rounded-card-sm px-4.5 py-3.5"
                      >
                        <Avatar name={userName} size={32} />
                        <p className="flex-1 text-sm text-muted">
                          <Trans
                            i18nKey="home.activity.line"
                            values={{
                              verb: labels.activity(entry),
                              title: entry.title,
                              detail: entry.detail,
                            }}
                            components={{
                              work: (
                                <Link
                                  to="/media/$slug"
                                  params={{ slug: entry.slug }}
                                  className="font-semibold text-fg hover:text-pink"
                                />
                              ),
                              detail: <span className="font-bold text-pink" />,
                            }}
                          />
                        </p>
                        <span className="font-label text-xs text-dim">
                          {relativeTime(entry.at)}
                        </span>
                      </GlassCard>
                    ))}
                  </ul>
                ) : (
                  <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                    {t('home.activity.empty')}
                  </GlassCard>
                )}
              </section>
            )}
          </div>

          <aside className="flex flex-col gap-8 lg:sticky lg:top-12">
            <NewsWidget />
            {summary && (summary.activity.length > 0 || summary.inProgress.length > 0) && (
              <section className="flex flex-col gap-4">
                <h2 className="font-heading text-[32px] uppercase">{t('home.stats.title')}</h2>
                <div className="flex flex-col gap-2.5">
                  <StatCard
                    value={String(summary.stats.episodesThisYear)}
                    label={t('home.stats.episodes')}
                  />
                  <StatCard
                    value={String(summary.stats.chaptersThisYear)}
                    label={t('home.stats.chapters')}
                  />
                  <StatCard
                    value={String(summary.stats.dayStreak)}
                    label={t('home.stats.dayStreak')}
                  />
                  <StatCard
                    value={String(summary.stats.completedThisYear)}
                    label={t('home.stats.completed')}
                  />
                </div>
              </section>
            )}
          </aside>
        </main>
      </div>
    </div>
  );
}
