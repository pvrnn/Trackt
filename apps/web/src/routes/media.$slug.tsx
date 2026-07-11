import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { LOG_STATUSES, type LogStatus, type MediaDetail } from '@trackt/shared';
import { AppNav, type AppNavUser } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { KindDot } from '../components/ui/KindDot';
import { authClient } from '../lib/auth-client';
import { coverGradient } from '../lib/cover';
import { fetchMediaDetail, trackingApi } from '../lib/media';

export const Route = createFileRoute('/media/$slug')({
  head: () => ({ meta: [{ title: 'Trackt' }] }),
  component: MediaPage,
});

const STATUS_LABELS: Record<LogStatus, string> = {
  planned: 'PLANNED',
  in_progress: 'IN PROGRESS',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  paused: 'PAUSED',
};

/** 0, 0.5, …, 10 — the half-point scale of PRD §3.2. */
const SCORES = Array.from({ length: 21 }, (_, i) => i / 2);

const CHECKLIST_CHUNK = 100;

function partNoun(detail: MediaDetail): { singular: string; prefix: string } | null {
  if (detail.kind === 'series' || detail.kind === 'anime') {
    return { singular: 'Episode', prefix: 'E' };
  }
  if (detail.kind === 'manga' || detail.kind === 'webtoon') {
    return { singular: 'Chapter', prefix: 'CH' };
  }
  return null;
}

function partTotal(detail: MediaDetail): number | null {
  if (detail.kind === 'series' || detail.kind === 'anime') return detail.episodeCount;
  if (detail.kind === 'manga' || detail.kind === 'webtoon') return detail.chapterCount;
  return null;
}

function MediaPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [visibleParts, setVisibleParts] = useState(CHECKLIST_CHUNK);

  // Same client-side session guard as home/search (see the note in home.tsx).
  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  const refresh = useCallback(async () => {
    const loaded = await fetchMediaDetail(slug);
    if (loaded === null) setMissing(true);
    else setDetail(loaded);
  }, [slug]);

  useEffect(() => {
    setDetail(null);
    setMissing(false);
    setVisibleParts(CHECKLIST_CHUNK);
    if (session) refresh().catch(() => setActionError('Could not load this title.'));
  }, [session, refresh]);

  useEffect(() => {
    if (detail) document.title = `${detail.title} — Trackt`;
  }, [detail]);

  /** Optimistically patch viewer state, run the mutation, re-sync from the API. */
  const applyViewer = useCallback(
    (patch: Partial<NonNullable<MediaDetail['viewer']>>, run: () => Promise<void>) => {
      setActionError(null);
      setDetail((current) =>
        current
          ? {
              ...current,
              viewer: { status: null, score: null, watched: [], ...current.viewer, ...patch },
            }
          : current,
      );
      run()
        .then(refresh)
        .catch(() => {
          setActionError('That didn’t save — try again.');
          refresh().catch(() => undefined);
        });
    },
    [refresh],
  );

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  const navUser = {
    name: session.user.name,
    username: session.user.displayUsername ?? session.user.name,
  };

  if (missing) {
    return (
      <Shell user={navUser}>
        <main className="mx-auto flex max-w-[1360px] flex-col gap-4 px-10 pt-14 pb-20">
          <h1 className="font-display text-[56px] leading-none uppercase">Not found</h1>
          <p className="text-[15px] text-muted">
            Nothing lives at “{slug}” on this instance. It may have been removed from the catalog.
          </p>
          <Link to="/search" className="text-sm font-bold text-pink">
            ← BACK TO DISCOVER
          </Link>
        </main>
      </Shell>
    );
  }

  if (!detail) return <Shell user={navUser} />;

  const viewer = detail.viewer ?? { status: null, score: null, watched: [] };
  const noun = partNoun(detail);
  const total = partTotal(detail);
  const watchedSet = new Set(viewer.watched);
  const listLength = total ?? (viewer.watched.length > 0 ? Math.max(...viewer.watched) : 0);
  const next = noun
    ? (Array.from({ length: listLength + 1 }, (_, i) => i + 1).find((n) => !watchedSet.has(n)) ??
      null)
    : null;
  const checkable = noun !== null && listLength > 0;
  const progressRatio = checkable && total ? watchedSet.size / total : null;

  const countOf = (n: number | null, noun: string) =>
    n !== null ? `${n} ${noun}${n === 1 ? '' : 'S'}` : null;
  const metaParts = [
    detail.year !== null ? String(detail.year) : null,
    detail.status ? detail.status.toUpperCase() : null,
    countOf(detail.seasonCount, 'SEASON'),
    countOf(detail.episodeCount, 'EPISODE'),
    countOf(detail.chapterCount, 'CHAPTER'),
    countOf(detail.volumeCount, 'VOLUME'),
  ].filter(Boolean);

  const detailRows: [string, string][] = [
    ['STATUS', detail.status ? detail.status.toUpperCase() : '—'],
    ['RELEASED', detail.releaseDate ?? (detail.year !== null ? String(detail.year) : '—')],
    ['GENRES', detail.genres.length > 0 ? detail.genres.join(', ') : '—'],
    ...(detail.synonyms.length > 0
      ? ([['ALSO KNOWN AS', detail.synonyms.join(' · ')]] as [string, string][])
      : []),
    [
      'EXTERNAL',
      Object.keys(detail.externalIds).length > 0
        ? Object.keys(detail.externalIds)
            .map((k) => k.toUpperCase())
            .join(' · ')
        : '—',
    ],
    ...(detail.source === 'user'
      ? ([['ENTRY', `Community-created · ${detail.moderation}`]] as [string, string][])
      : []),
  ];

  return (
    <Shell user={navUser}>
      {/* hero */}
      <div className="border-b border-divider">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-8 px-10 pt-14 pb-10 md:flex-row">
          <div
            className="relative flex h-[360px] w-[240px] shrink-0 items-end overflow-hidden rounded-card bg-cover bg-center p-5"
            style={
              detail.coverUrl
                ? { backgroundImage: `url(${detail.coverUrl})` }
                : { background: coverGradient(detail.kind, detail.title) }
            }
          >
            <span className="font-display text-[30px] leading-[1.05] text-white/94 uppercase">
              {detail.title}
            </span>
            {progressRatio !== null && progressRatio > 0 && (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-[5px] bg-prism"
                style={{ width: `${Math.round(progressRatio * 100)}%` }}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <KindDot kind={detail.kind} showLabel />
              {metaParts.length > 0 && (
                <span className="font-label text-xs tracking-label text-dim">
                  {metaParts.join(' · ')}
                </span>
              )}
            </div>
            <h1 className="font-display text-[clamp(40px,6vw,72px)] leading-[0.95] uppercase">
              {detail.title}
            </h1>
            {detail.description && (
              <p className="max-w-[640px] text-[15px] leading-relaxed text-muted">
                {detail.description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              {checkable && next !== null && (
                <Button
                  onClick={() =>
                    applyViewer({ watched: [...viewer.watched, next] }, () =>
                      trackingApi.checkIn(detail.id, next),
                    )
                  }
                >
                  ✓ CHECK IN {noun!.prefix}
                  {next}
                </Button>
              )}
              <PillSelect
                label="status"
                value={viewer.status ?? ''}
                selected={viewer.status !== null}
                onChange={(value) => {
                  if (value === '') {
                    applyViewer({ status: null }, () => trackingApi.clearStatus(detail.id));
                  } else {
                    const status = value as LogStatus;
                    applyViewer({ status }, () => trackingApi.setStatus(detail.id, status));
                  }
                }}
              >
                <option value="">＋ LOG</option>
                {LOG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </PillSelect>
              <PillSelect
                label="your rating"
                value={viewer.score !== null ? String(viewer.score) : ''}
                selected={viewer.score !== null}
                onChange={(value) => {
                  if (value === '') {
                    applyViewer({ score: null }, () => trackingApi.clearScore(detail.id));
                  } else {
                    const score = Number(value);
                    applyViewer({ score }, () => trackingApi.setScore(detail.id, score));
                  }
                }}
              >
                <option value="">RATE</option>
                {SCORES.map((score) => (
                  <option key={score} value={score}>
                    ★ {score.toFixed(1)}
                  </option>
                ))}
              </PillSelect>
              <span
                title="Lists are coming soon"
                className="cursor-not-allowed rounded-full border border-glass-border-strong bg-glass px-5 py-[11px] text-[13px] font-bold tracking-btn text-fg/60"
              >
                ＋ LIST
              </span>
            </div>
            {actionError && (
              <p role="alert" className="text-sm text-red-400">
                {actionError}
              </p>
            )}

            <div className="mt-3 flex gap-8">
              <Stat
                value={
                  detail.community.averageScore !== null
                    ? detail.community.averageScore.toFixed(1)
                    : '—'
                }
                label={`${detail.community.ratingCount} ${detail.community.ratingCount === 1 ? 'RATING' : 'RATINGS'}`}
                prism
              />
              {checkable && total !== null && (
                <Stat value={`${watchedSet.size}/${total}`} label="YOUR PROGRESS" />
              )}
              {viewer.score !== null && <Stat value={viewer.score.toFixed(1)} label="YOUR SCORE" />}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-[1360px] grid-cols-1 gap-12 px-10 pt-10 pb-20 lg:grid-cols-[2fr_1fr]">
        {/* checklist */}
        <section className="flex min-w-0 flex-col gap-5">
          <h2 className="font-display text-[32px] uppercase">
            {noun ? `${noun.singular}s` : 'Tracking'}
          </h2>
          {checkable ? (
            <>
              <ul className="flex flex-col gap-2">
                {Array.from({ length: Math.min(listLength, visibleParts) }, (_, i) => i + 1).map(
                  (number) => {
                    const watched = watchedSet.has(number);
                    const isNext = number === next;
                    return (
                      <li key={number}>
                        <button
                          type="button"
                          onClick={() =>
                            applyViewer(
                              {
                                watched: watched
                                  ? viewer.watched.filter((n) => n !== number)
                                  : [...viewer.watched, number],
                              },
                              () =>
                                watched
                                  ? trackingApi.uncheck(detail.id, number)
                                  : trackingApi.checkIn(detail.id, number),
                            )
                          }
                          aria-pressed={watched}
                          className={clsx(
                            'flex w-full cursor-pointer items-center gap-3.5 rounded-cover border px-4 py-3 text-left backdrop-blur-[16px] transition',
                            isNext
                              ? 'border-pink/50 bg-pink-row'
                              : 'border-glass-border bg-glass hover:border-glass-border-strong',
                          )}
                        >
                          <span
                            aria-hidden
                            className={clsx(
                              'flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[13px] font-bold text-on-prism',
                              watched
                                ? 'border-pink bg-pink'
                                : isNext
                                  ? 'border-pink bg-transparent'
                                  : 'border-white/20 bg-transparent',
                            )}
                          >
                            {watched ? '✓' : ''}
                          </span>
                          <span className="w-14 font-label text-xs text-dim">
                            {noun!.prefix}
                            {number}
                          </span>
                          <span
                            className={clsx(
                              'flex-1 text-sm',
                              watched ? 'text-muted' : 'text-fg',
                              isNext && 'font-semibold',
                            )}
                          >
                            {noun!.singular} {number}
                          </span>
                          <span
                            className={clsx(
                              'font-label text-xs tracking-label',
                              watched ? 'text-pink' : 'text-dim',
                            )}
                          >
                            {watched ? 'WATCHED' : isNext ? 'UP NEXT' : ''}
                          </span>
                        </button>
                      </li>
                    );
                  },
                )}
              </ul>
              {listLength > visibleParts && (
                <Button variant="secondary" onClick={() => setVisibleParts(listLength)}>
                  SHOW ALL {listLength}
                </Button>
              )}
            </>
          ) : (
            <GlassCard className="px-6 py-5 text-[15px] text-muted">
              {detail.kind === 'movie'
                ? 'Movies track in one step — set the status above to Completed when you’ve watched it.'
                : 'This entry has no episode or chapter count yet, so there’s nothing granular to check in. Set a status above to track it.'}
            </GlassCard>
          )}
        </section>

        {/* side column */}
        <aside className="flex flex-col gap-8">
          <section className="flex flex-col gap-3.5">
            <h2 className="font-display text-2xl uppercase">Details</h2>
            <GlassCard className="flex flex-col overflow-hidden rounded-card-sm">
              {detailRows.map(([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between gap-4 border-b border-white/7 px-4.5 py-3 last:border-b-0"
                >
                  <span className="shrink-0 font-label text-xs tracking-label text-dim">{key}</span>
                  <span className="text-right text-[13px] text-muted">{value}</span>
                </div>
              ))}
            </GlassCard>
          </section>

          <section className="flex flex-col gap-3.5">
            <h2 className="font-display text-2xl uppercase">Comments</h2>
            <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
              Comments land with the v1.x social layer — episode threads, spoiler blurring, the
              works.
            </GlassCard>
          </section>

          {detail.related.length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="font-display text-2xl uppercase">Related</h2>
              <div className="grid grid-cols-3 gap-3">
                {detail.related.map((item) => (
                  <Link key={item.id} to="/media/$slug" params={{ slug: item.slug }}>
                    <CoverCard
                      kind={item.kind}
                      title={item.title}
                      coverUrl={item.coverUrl ?? undefined}
                    />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>
    </Shell>
  );
}

function Shell({ user, children }: { user: AppNavUser; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={user} />
        {children}
      </div>
    </div>
  );
}

function Stat({ value, label, prism = false }: { value: string; label: string; prism?: boolean }) {
  return (
    <div>
      <div className={clsx('font-display text-[32px]', prism && 'text-prism')}>{value}</div>
      <div className="font-label text-[11px] tracking-label text-dim">{label}</div>
    </div>
  );
}

/** Mockup's pill dropdowns (status, rate) as styled native selects — accessible for free. */
function PillSelect({
  label,
  value,
  selected,
  onChange,
  children,
}: {
  label: string;
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(
          'cursor-pointer appearance-none rounded-full border py-[11px] pr-9 pl-5 font-label text-xs font-semibold tracking-label transition',
          selected
            ? 'border-pink bg-pink-selected text-pink'
            : 'border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
        )}
      >
        {children}
      </select>
      <span
        aria-hidden
        className={clsx(
          'pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[10px]',
          selected ? 'text-pink' : 'text-dim',
        )}
      >
        ▾
      </span>
    </span>
  );
}
