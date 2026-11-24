import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import { useState } from 'react';
import { IN_PROGRESS_LIMIT, type UpNextEntry } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { UpNextCard } from '../components/media/UpNextCard';
import { NewsWidget } from '../components/news/NewsWidget';
import { OnboardingDialog } from '../components/onboarding/OnboardingDialog';
import { Avatar } from '../components/ui/Avatar';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
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
  /** Set by the register form: the first-run setup opens over this page. */
  validateSearch: (search: Record<string, unknown>): { onboarding?: true } =>
    search.onboarding === true || search.onboarding === 'true' ? { onboarding: true } : {},
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { isPending, navUser } = useAuthedPage();
  const queryClient = useQueryClient();
  const { data: summary, isError } = useHomeSummary();
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());
  const { onboarding } = Route.useSearch();
  const navigate = useNavigate();

  const progressLine = (entry: UpNextEntry): string => {
    const chapter = entry.partKind === 'chapter';
    return entry.total !== null
      ? t(chapter ? 'home.progress.chapterOf' : 'home.progress.episodeOf', {
          next: entry.next,
          total: entry.total,
        })
      : t(chapter ? 'home.progress.chapter' : 'home.progress.episode', { next: entry.next });
  };

  /** The shelf row carries the exact count; `next - 1` is the floor when it is absent. */
  const progressOf = (entry: UpNextEntry): number | undefined => {
    if (entry.total === null || entry.total <= 0) return undefined;
    const shelf = summary?.inProgress.find((row) => row.id === entry.id);
    return (shelf?.watched ?? entry.next - 1) / entry.total;
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

  const open = summary?.upNext.filter((entry) => !checkedIn.has(upNextPartKey(entry))) ?? [];
  const openEpisodes = open.filter((entry) => entry.partKind === 'episode').length;
  const openChapters = open.length - openEpisodes;
  const queueLabel = [
    openEpisodes > 0 ? t('home.pending.episodes', { count: openEpisodes }) : null,
    openChapters > 0 ? t('home.pending.chapters', { count: openChapters }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        {onboarding && (
          <OnboardingDialog
            username={userName}
            onClose={() => void navigate({ to: '/home', search: {}, replace: true })}
          />
        )}
        <main className="mx-auto flex max-w-[1360px] flex-col gap-11 px-4 pt-9 pb-20 sm:px-10">
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
              <section aria-labelledby="home-up-next" className="flex flex-col gap-3.5">
                <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                  <h1 id="home-up-next" className="font-heading text-[32px] leading-none uppercase">
                    {t('home.title')}
                  </h1>
                  {summary.upNext.length > 0 && (
                    <span className="text-prism font-label text-[13px] font-bold tracking-btn">
                      {queueLabel || t('home.upNext.allCaughtUp')}
                    </span>
                  )}
                  <span className="flex-1" />
                  {summary.inProgress.length > 0 && (
                    <Link
                      to="/users/$username/history"
                      params={{ username: navUser.username }}
                      search={{ year: 'all', status: 'in_progress' }}
                      className="tap-area font-label text-xs font-bold tracking-label text-pink hover:brightness-115"
                    >
                      {summary.inProgress.length >= IN_PROGRESS_LIMIT
                        ? t('home.upNext.allInProgressMore')
                        : t('home.upNext.allInProgress', { count: summary.inProgress.length })}
                    </Link>
                  )}
                </div>
                {summary.upNext.length > 0 ? (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
                    {summary.upNext.map((entry) => (
                      <UpNextCard
                        key={entry.id}
                        slug={entry.slug}
                        kind={entry.kind}
                        title={entry.title}
                        coverUrl={entry.coverUrl}
                        progressLine={progressLine(entry)}
                        progress={progressOf(entry)}
                        checkedIn={checkedIn.has(upNextPartKey(entry))}
                        onCheckIn={() => checkIn(entry)}
                      />
                    ))}
                  </div>
                ) : (
                  <GlassCard className="rounded-card-sm px-6 py-5 text-[15px] text-muted">
                    {t('home.caughtUp')}
                  </GlassCard>
                )}
              </section>

              <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <NewsWidget mediaIds={summary.inProgress.map((entry) => entry.id)} />

                <section aria-labelledby="home-activity" className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                    <h2
                      id="home-activity"
                      className="font-heading text-[48px] leading-none uppercase"
                    >
                      {t('home.activity.title')}
                    </h2>
                    <span className="flex-1" />
                    <Link
                      to="/users/$username/history"
                      params={{ username: navUser.username }}
                      className="tap-area font-label text-xs font-bold tracking-label text-pink hover:brightness-115"
                    >
                      {t('home.activity.all')}
                    </Link>
                  </div>
                  {summary.activity.length > 0 ? (
                    <ul className="flex flex-col gap-2.5">
                      {summary.activity.map((entry, index) => (
                        <GlassCard
                          as="li"
                          key={`${entry.verb}-${entry.slug}-${index}`}
                          className="flex items-start gap-3.5 rounded-card-sm py-3.5 pr-3.5 pl-4"
                        >
                          <Avatar name={userName} src={navUser.image} size={32} />
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <p className="text-[15px] leading-[1.45] text-muted">
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
                            <span className="font-label text-[11px] font-semibold tracking-label text-dim">
                              {relativeTime(entry.at)}
                            </span>
                          </div>
                        </GlassCard>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-card-sm border border-dashed border-white/20 px-5 py-4 text-sm text-muted">
                      {t('home.activity.empty')}
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
