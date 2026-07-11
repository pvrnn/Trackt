import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { HomeSummary, UpNextEntry } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { UpNextCard } from '../components/media/UpNextCard';
import { Avatar } from '../components/ui/Avatar';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { StatCard } from '../components/ui/StatCard';
import { authClient } from '../lib/auth-client';
import { fetchHomeSummary, relativeTime } from '../lib/home';
import { trackingApi } from '../lib/media';

export const Route = createFileRoute('/home')({
  head: () => ({ meta: [{ title: 'Home — Trackt' }] }),
  component: HomePage,
});

const VERB_LABELS: Record<HomeSummary['activity'][number]['verb'], string> = {
  checked_in: 'checked in',
  rated: 'rated',
  status: 'marked',
};

function progressLine(entry: UpNextEntry): string {
  const noun = entry.partKind === 'episode' ? 'Episode' : 'Chapter';
  return entry.total !== null ? `${noun} ${entry.next} of ${entry.total}` : `${noun} ${entry.next}`;
}

function inProgressSub(entry: HomeSummary['inProgress'][number]): string {
  const kind = entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1);
  if (entry.total === null) return kind;
  const prefix = entry.kind === 'manga' || entry.kind === 'webtoon' ? 'Ch' : 'Ep';
  return `${kind} · ${prefix} ${entry.watched} of ${entry.total}`;
}

function HomePage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);

  // Same client-side session guard as search/media (SSR cookie note in the
  // original stub applies until app pages move to server functions).
  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  const refresh = useCallback(async () => {
    setSummary(await fetchHomeSummary());
    setCheckedIn(new Set());
  }, []);

  useEffect(() => {
    if (session) refresh().catch(() => setLoadError(true));
  }, [session, refresh]);

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  const userName = session.user.displayUsername ?? session.user.name;

  const checkIn = (entry: UpNextEntry) => {
    if (checkedIn.has(entry.id)) return;
    setCheckedIn((current) => new Set(current).add(entry.id));
    trackingApi
      .checkIn(entry.id, entry.next)
      .then(refresh)
      .catch(() => {
        setCheckedIn((current) => {
          const set = new Set(current);
          set.delete(entry.id);
          return set;
        });
      });
  };

  const pending = summary
    ? {
        episodes: summary.upNext.filter((entry) => entry.partKind === 'episode').length,
        chapters: summary.upNext.filter((entry) => entry.partKind === 'chapter').length,
      }
    : null;
  const pendingLine = pending
    ? [
        pending.episodes > 0
          ? `${pending.episodes} EPISODE${pending.episodes === 1 ? '' : 'S'}`
          : null,
        pending.chapters > 0
          ? `${pending.chapters} CHAPTER${pending.chapters === 1 ? '' : 'S'}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav userName={userName} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-10 pt-12 pb-20">
          {loadError ? (
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load your dashboard — is the instance API reachable?
            </p>
          ) : !summary ? (
            <div className="h-40" aria-busy />
          ) : summary.upNext.length === 0 && summary.inProgress.length === 0 ? (
            /* Fresh account: nothing tracked yet — point at Discover. */
            <section className="flex flex-col items-start gap-5 pt-8">
              <h1 className="font-display text-[64px] leading-none uppercase">Nothing up next</h1>
              <p className="max-w-[560px] text-[15px] text-muted">
                Track your first title and this page becomes your dashboard: what to watch or read
                next, progress across everything, and your year in stats.
              </p>
              <Link to="/search" className={buttonClassName()}>
                ⌕ FIND SOMETHING ON DISCOVER
              </Link>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-4">
                <h1 className="font-display text-[64px] leading-none uppercase">Up next</h1>
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
                      kind={entry.kind}
                      title={entry.title}
                      progressLine={progressLine(entry)}
                      checkedIn={checkedIn.has(entry.id)}
                      onCheckIn={() => checkIn(entry)}
                    />
                  ))}
                </div>
              ) : (
                <GlassCard className="px-6 py-5 text-[15px] text-muted">
                  All caught up — every known episode and chapter is checked in.
                </GlassCard>
              )}

              {summary.inProgress.length > 0 && (
                <>
                  <div className="mt-6 flex items-baseline justify-between">
                    <h2 className="font-display text-[32px] uppercase">In progress</h2>
                    <span
                      title="Lists are coming soon"
                      className="cursor-not-allowed font-label text-[13px] font-bold tracking-label text-pink/50"
                    >
                      VIEW ALL →
                    </span>
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
            <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
              <section className="flex flex-col gap-4">
                <h2 className="font-display text-[32px] uppercase">Recent activity</h2>
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
                          You {VERB_LABELS[entry.verb]}{' '}
                          <Link
                            to="/media/$slug"
                            params={{ slug: entry.slug }}
                            className="font-semibold text-fg hover:text-pink"
                          >
                            {entry.title}
                          </Link>{' '}
                          <span className="font-bold text-pink">{entry.detail}</span>
                        </p>
                        <span className="font-label text-xs text-dim">
                          {relativeTime(entry.at)}
                        </span>
                      </GlassCard>
                    ))}
                  </ul>
                ) : (
                  <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                    Check-ins, ratings, and status changes show up here.
                  </GlassCard>
                )}
              </section>
              <section className="flex flex-col gap-4">
                <h2 className="font-display text-[32px] uppercase">This year</h2>
                <div className="flex flex-col gap-2.5">
                  <StatCard value={String(summary.stats.episodesThisYear)} label="Episodes" />
                  <StatCard value={String(summary.stats.chaptersThisYear)} label="Chapters" />
                  <StatCard value={String(summary.stats.dayStreak)} label="Day streak" />
                  <StatCard value={String(summary.stats.completedThisYear)} label="Completed" />
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
