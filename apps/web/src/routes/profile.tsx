import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { MEDIA_KINDS, type MediaKind, type ProfileSummary } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { Avatar } from '../components/ui/Avatar';
import { GlassCard } from '../components/ui/GlassCard';
import { KindDot } from '../components/ui/KindDot';
import { StatCard } from '../components/ui/StatCard';
import { authClient } from '../lib/auth-client';
import { relativeTime } from '../lib/home';
import { fetchProfileSummary } from '../lib/profile';

export const Route = createFileRoute('/profile')({
  head: () => ({ meta: [{ title: 'Profile — Trackt' }] }),
  component: ProfilePage,
});

const VERB_LABELS: Record<ProfileSummary['activity'][number]['verb'], string> = {
  checked_in: 'Checked in',
  rated: 'Rated',
  status: 'Marked',
};

const KIND_BLOCK_TITLES: Record<MediaKind, string> = {
  movie: 'Favourite movies',
  series: 'Favourite series',
  anime: 'Favourite anime',
  manga: 'Favourite manga',
  webtoon: 'Favourite webtoons',
};

function ProfilePage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Same client-side session guard as the other app pages.
  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  useEffect(() => {
    if (session) fetchProfileSummary().then(setSummary, () => setLoadError(true));
  }, [session]);

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  const navUser = {
    name: session.user.name,
    username: session.user.displayUsername ?? session.user.name,
  };

  const favoriteBlocks = summary
    ? MEDIA_KINDS.map((kind) => ({
        kind,
        items: summary.favorites.filter((entry) => entry.kind === kind),
      })).filter((block) => block.items.length > 0)
    : [];

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        {loadError ? (
          <main className="mx-auto max-w-[1360px] px-10 pt-12">
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load your profile — is the instance API reachable?
            </p>
          </main>
        ) : !summary ? (
          <main className="h-40" aria-busy />
        ) : (
          <>
            {/* header */}
            <div className="border-b border-divider">
              <div className="mx-auto flex max-w-[1360px] items-end gap-8 px-10 pt-14 pb-10">
                <Avatar name={summary.user.username} size={120} />
                <div className="flex flex-1 flex-col gap-2">
                  <h1 className="font-display text-[56px] leading-none uppercase">
                    {summary.user.name}
                  </h1>
                  <p className="text-[15px] text-muted">
                    @{summary.user.username} · member since{' '}
                    {new Date(summary.user.joinedAt).toLocaleDateString('en-GB', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  <div className="flex gap-5 font-label text-[13px] text-dim">
                    <span>
                      <span className="font-semibold text-fg">{summary.stats.titlesTracked}</span>{' '}
                      TITLES TRACKED
                    </span>
                    {summary.stats.dayStreak > 0 && (
                      <span className="text-pink">● {summary.stats.dayStreak}-DAY STREAK</span>
                    )}
                  </div>
                </div>
                <span
                  title="Coming soon"
                  className="cursor-not-allowed rounded-full border border-glass-border-strong bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-fg/60"
                >
                  EDIT PROFILE
                </span>
              </div>
              <div className="mx-auto grid max-w-[1360px] grid-cols-2 gap-3 px-10 pb-10 md:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  value={String(summary.stats.episodesThisYear)}
                  label="Episodes this year"
                />
                <StatCard
                  value={String(summary.stats.chaptersThisYear)}
                  label="Chapters this year"
                />
                <StatCard value={String(summary.stats.completed)} label="Completed" />
                <StatCard value={String(summary.stats.titlesTracked)} label="Titles tracked" />
                <StatCard
                  value={
                    summary.stats.meanRating !== null ? summary.stats.meanRating.toFixed(1) : '—'
                  }
                  label="Mean rating"
                />
              </div>
            </div>

            <main className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-10 pb-20">
              {favoriteBlocks.length > 0 ? (
                favoriteBlocks.map((block) => (
                  <section key={block.kind} className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-[32px] uppercase">
                        {KIND_BLOCK_TITLES[block.kind]}
                      </h2>
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
                      <Link
                        to="/search"
                        search={{ kind: block.kind }}
                        title="Find more to favourite"
                        className="flex aspect-2/3 items-center justify-center rounded-cover border border-dashed border-white/20 text-2xl text-faint transition hover:border-pink hover:text-pink"
                      >
                        ＋
                      </Link>
                    </div>
                  </section>
                ))
              ) : (
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Favourites</h2>
                  <GlassCard className="px-6 py-5 text-[15px] text-muted">
                    Nothing favourited yet — hit ♡ FAVOURITE on any title’s page and it shows up
                    here, ranked per shelf.
                  </GlassCard>
                </section>
              )}

              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Recent</h2>
                  {summary.activity.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {summary.activity.map((entry, index) => (
                        <GlassCard
                          as="li"
                          key={`${entry.verb}-${entry.slug}-${index}`}
                          className="flex items-center gap-3.5 rounded-card-sm px-4.5 py-3.5"
                        >
                          <p className="flex-1 text-sm text-muted">
                            {VERB_LABELS[entry.verb]}{' '}
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
                      Your check-ins, ratings, and status changes show up here.
                    </GlassCard>
                  )}
                </section>
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Badges</h2>
                  <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                    Badges land with the v1.x social layer — streaks, importer feats, cataloguer
                    credits.
                  </GlassCard>
                  <GlassCard className="flex items-center justify-between rounded-card-sm px-5 py-4">
                    <span className="font-label text-xs tracking-label text-dim">
                      PROFILE VISIBILITY
                    </span>
                    <span
                      title="Coming soon — profiles are private until the social layer"
                      className="cursor-not-allowed font-label text-xs font-semibold text-dim/60"
                    >
                      PRIVATE
                    </span>
                  </GlassCard>
                </section>
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}
