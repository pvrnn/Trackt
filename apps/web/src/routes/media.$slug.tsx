import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  LOG_STATUSES,
  MEDIA_RELATION_LABELS,
  trackingVerbLabel,
  type LogDates,
  type LogStatus,
  type MediaDetail,
  type MediaRelationLabel,
} from '@trackt/shared';
import { AppNav, type AppNavUser } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { AddToListDialog } from '../components/media/AddToListDialog';
import { CoverCard } from '../components/media/CoverCard';
import { LogDatesDialog } from '../components/media/LogDatesDialog';
import { ProgressPosition } from '../components/media/ProgressPosition';
import { RatingPopover } from '../components/media/RatingPopover';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { KindDot } from '../components/ui/KindDot';
import { Select, type SelectItem } from '../components/ui/Select';
import { useAuthedPage } from '../lib/auth-client';
import {
  LOG_STATUS_LABELS,
  coverGradient,
  dateRangeLabel,
  todayIso,
  firstUnwatched,
  invalidateTracking,
  partsUpTo,
  progressUpTo,
  usesProgressSlider,
  stampedDates,
  trackingApi,
  useMediaDetail,
} from '@trackt/client';

/** "attack-on-titan" → "Attack On Titan": a serviceable SSR title until the query resolves. */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const Route = createFileRoute('/media/$slug')({
  // The detail loads client-side (session-gated query), so the server-rendered
  // title is derived from the slug; the effect below refines it once data lands.
  head: ({ params }) => ({
    meta: [{ title: `${titleFromSlug(params.slug) || 'Media'} — Trackt` }],
  }),
  component: MediaPage,
});

/** The '' option clears the log; its label doubles as the resting pill text. */
const LOG_ITEMS: SelectItem[] = [
  { value: '', label: '＋ LOG' },
  ...LOG_STATUSES.map((status) => ({ value: status, label: LOG_STATUS_LABELS[status] })),
];

/** Sidebar heading per relation label (ADR-0004). Display copy, so it lives here. */
const RELATION_HEADINGS: Record<MediaRelationLabel, string> = {
  prequel: 'PREQUEL',
  sequel: 'SEQUEL',
  source: 'SOURCE MATERIAL',
  adaptation: 'ADAPTATIONS',
  spinoff: 'SPIN-OFFS',
  parent: 'PARENT WORK',
  related: 'RELATED',
};

/**
 * Group relations into sidebar sections, in MEDIA_RELATION_LABELS order — the
 * same order the API sorts by, so headings never reshuffle between renders.
 */
function groupRelations(relations: MediaDetail['relations']) {
  return MEDIA_RELATION_LABELS.map(
    (label) => [label, relations.filter((item) => item.relation === label)] as const,
  ).filter(([, items]) => items.length > 0);
}

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
  // Movies have no episodes/chapters; every other kind counts in partCount (ADR-0003).
  return detail.kind === 'movie' ? null : detail.partCount;
}

type ViewerPatch = Partial<NonNullable<MediaDetail['viewer']>>;

/** What an untracked work looks like — the base every optimistic patch lands on. */
const EMPTY_VIEWER: NonNullable<MediaDetail['viewer']> = {
  status: null,
  score: null,
  watched: [],
  favorited: false,
  startedAt: null,
  finishedAt: null,
};

function MediaPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const { isPending: authPending, navUser } = useAuthedPage();
  const { data, isError, refetch } = useMediaDetail(slug);
  const [visibleParts, setVisibleParts] = useState(CHECKLIST_CHUNK);
  const [addingToList, setAddingToList] = useState(false);
  // The dialog's *initial* dates, or null when it's closed. Held here rather
  // than read from `viewer` on open, so the auto-open path can hand it the
  // dates it just stamped without racing the optimistic cache write.
  const [editingDates, setEditingDates] = useState<LogDates | null>(null);

  const queryKey = ['media', slug] as const;

  /**
   * One optimistic mutation for every viewer action: patch the cached viewer,
   * run the tracking call, roll back on error, and re-sync by invalidating.
   * React Query serialises and cancels, so rapid check-ins can't clobber each
   * other (the race the hand-rolled version had).
   */
  const viewerMutation = useMutation({
    mutationFn: ({ run }: { patch: ViewerPatch; run: () => Promise<void> }) => run(),
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MediaDetail | null>(queryKey);
      queryClient.setQueryData<MediaDetail | null>(queryKey, (current) =>
        current
          ? {
              ...current,
              viewer: {
                ...EMPTY_VIEWER,
                ...current.viewer,
                ...patch,
              },
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    // Not just this page: a check-in also moves the home dashboard and the
    // profile activity feed, which would otherwise stay stale until reload.
    onSettled: () => invalidateTracking(queryClient),
  });

  const applyViewer = (patch: ViewerPatch, run: () => Promise<void>) =>
    viewerMutation.mutate({ patch, run });

  useEffect(() => {
    setVisibleParts(CHECKLIST_CHUNK);
  }, [slug]);

  useEffect(() => {
    if (data) document.title = `${data.title} — Trackt`;
  }, [data]);

  if (authPending || !navUser) return <div className="min-h-screen bg-ink" />;

  if (isError) {
    return (
      <Shell user={navUser}>
        <main className="mx-auto flex max-w-[1360px] flex-col items-start gap-4 px-10 pt-14 pb-20">
          <h1 className="font-heading text-[56px] leading-none uppercase">Couldn’t load</h1>
          <p className="max-w-[540px] text-[15px] text-muted">
            Something went wrong fetching this title — the instance API may be unreachable, or its
            response wasn’t what we expected.
          </p>
          <div className="mt-2 flex items-center gap-5">
            <Button onClick={() => refetch()}>RETRY</Button>
            <Link to="/search" className="text-sm font-bold text-pink">
              ← BACK TO DISCOVER
            </Link>
          </div>
        </main>
      </Shell>
    );
  }

  if (data === null) {
    return (
      <Shell user={navUser}>
        <main className="mx-auto flex max-w-[1360px] flex-col gap-4 px-10 pt-14 pb-20">
          <h1 className="font-heading text-[56px] leading-none uppercase">Not found</h1>
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

  if (!data) {
    return (
      <Shell user={navUser}>
        <main className="mx-auto max-w-[1360px] px-10 pt-14 pb-20">
          <div className="h-40" aria-busy />
        </main>
      </Shell>
    );
  }

  const detail = data;
  const viewer = detail.viewer ?? EMPTY_VIEWER;
  const noun = partNoun(detail);
  const total = partTotal(detail);
  const watchedSet = new Set(viewer.watched);
  const listLength = total ?? (viewer.watched.length > 0 ? Math.max(...viewer.watched) : 0);
  // Candidates stop at the known part count — never offer "CHECK IN E13" on a
  // 12-episode series (the server would reject it). Only an unknown total may
  // extend one past the highest watched part. Scanned rather than materialised:
  // a 900-chapter manga allocated a 900-element array on every render to read
  // one number off the front of it.
  const next = noun ? firstUnwatched(watchedSet, total ?? listLength + 1) : null;
  const checkable = noun !== null && listLength > 0;
  /** 'Watched' or 'Read', per kind — the checklist's done state, in words. */
  const doneLabel = trackingVerbLabel(detail.kind);
  const progressRatio = checkable && total ? watchedSet.size / total : null;
  /** Past 30 parts the checklist is a wall, so the position leads instead. */
  const longWork = checkable && usesProgressSlider(total);
  /** The highest part with everything before it seen — what a position means. */
  const position = progressUpTo(watchedSet);
  // A long work gets the position and nothing else: hundreds of tiles is the
  // wall this replaced, and offering it anyway just moves the wall down a fold.
  const showGrid = !longWork;

  const setPosition = (upTo: number) =>
    applyViewer({ watched: partsUpTo(upTo) }, () => trackingApi.setProgress(detail.id, upTo));

  const relationGroups = groupRelations(detail.relations);
  /** '04 JAN → 11 FEB' when the log has dates; null puts '＋ DATES' on the pill. */
  const dateLabel = dateRangeLabel(viewer.startedAt, viewer.finishedAt);

  const countOf = (n: number | null, noun: string) =>
    n !== null ? `${n} ${noun}${n === 1 ? '' : 'S'}` : null;
  const metaParts = [
    detail.year !== null ? String(detail.year) : null,
    detail.status ? detail.status.toUpperCase() : null,
    detail.seasonNumber !== null ? `SEASON ${detail.seasonNumber}` : null,
    // One count, labelled by kind's part (EPISODE/CHAPTER); movies have none (ADR-0003).
    noun ? countOf(total, noun.singular.toUpperCase()) : null,
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
  ];

  return (
    <Shell user={navUser}>
      {/* hero */}
      <div>
        <div className="mx-auto flex max-w-[1360px] flex-col gap-8 px-10 pt-14 pb-10 md:flex-row">
          <div
            className="cover relative flex h-[360px] w-[240px] shrink-0 items-end bg-cover bg-center p-5"
            style={
              detail.coverUrl
                ? { backgroundImage: `url(${detail.coverUrl})` }
                : { background: coverGradient(detail.kind, detail.title) }
            }
          >
            {progressRatio !== null && progressRatio > 0 && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/10"
              >
                <span
                  className="block h-full bg-prism"
                  style={{ width: `${Math.round(progressRatio * 100)}%` }}
                />
              </span>
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
            <h1 className="font-heading text-[clamp(40px,6vw,72px)] leading-[0.95] uppercase">
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
                  ✓ {trackingVerbLabel(detail.kind, 'present').toUpperCase()} {noun!.prefix}
                  {next}
                </Button>
              )}
              {/* Named by the hidden label *plus* the trigger, so the pill
                  announces "Status, COMPLETED" — an `aria-label` here would
                  replace the value and leave only "status". */}
              <span id="log-status-label" className="sr-only">
                Status
              </span>
              <Select
                variant="pill"
                id="log-status-trigger"
                aria-labelledby="log-status-label log-status-trigger"
                items={LOG_ITEMS}
                value={viewer.status ?? ''}
                selected={viewer.status !== null}
                onChange={(value) => {
                  if (value === '') {
                    applyViewer({ status: null, startedAt: null, finishedAt: null }, () =>
                      trackingApi.clearStatus(detail.id),
                    );
                    return;
                  }
                  const status = value as LogStatus;
                  // The API sweeps progress for these two (PRD §3.1); mirror it
                  // optimistically so the grid doesn't lag a refetch behind.
                  const sweep: ViewerPatch =
                    !checkable || listLength === 0
                      ? {}
                      : status === 'completed'
                        ? { watched: Array.from({ length: listLength }, (_, i) => i + 1) }
                        : status === 'planned'
                          ? { watched: [] }
                          : {};
                  // Same for the dates the server stamps (ADR-0007), so the
                  // DATES pill fills in as the status pill changes.
                  const dates = stampedDates(status, viewer, todayIso());
                  applyViewer({ status, ...sweep, ...dates }, () =>
                    trackingApi.setStatus(detail.id, status),
                  );
                  // The one transition with no evidence behind its date: the
                  // user is logging something they watched at some unknown time
                  // in the past, and today is almost certainly wrong. Every
                  // other transition has a check-in or a prior date backing it,
                  // and must not interrupt.
                  if (
                    status === 'completed' &&
                    (viewer.status === null || viewer.status === 'planned')
                  ) {
                    setEditingDates(dates);
                  }
                }}
              />
              {/* Only with a log to date — the dates live on the log row, so
                  there is nothing to edit before one exists. */}
              {viewer.status !== null && (
                <button
                  type="button"
                  onClick={() => setEditingDates({ ...viewer })}
                  title="Edit the dates you started and finished this"
                  className={clsx(
                    'cursor-pointer rounded-full border px-5 py-[11px] text-[13px] font-bold tracking-btn transition',
                    dateLabel
                      ? 'border-pink bg-pink-selected text-pink'
                      : 'border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
                  )}
                >
                  {dateLabel ?? '＋ DATES'}
                </button>
              )}
              <RatingPopover
                score={viewer.score}
                onChange={(score) => {
                  if (score === null) {
                    applyViewer({ score: null }, () => trackingApi.clearScore(detail.id));
                  } else {
                    applyViewer({ score }, () => trackingApi.setScore(detail.id, score));
                  }
                }}
              />
              <button
                type="button"
                aria-pressed={viewer.favorited}
                title={viewer.favorited ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() =>
                  applyViewer({ favorited: !viewer.favorited }, () =>
                    viewer.favorited
                      ? trackingApi.unfavorite(detail.id)
                      : trackingApi.favorite(detail.id),
                  )
                }
                className={clsx(
                  'cursor-pointer rounded-full border px-5 py-[11px] text-[13px] font-bold tracking-btn transition',
                  viewer.favorited
                    ? 'border-pink bg-pink-selected text-pink'
                    : 'border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
                )}
              >
                {viewer.favorited ? '♥ FAVOURITE' : '♡ FAVOURITE'}
              </button>
              <button
                type="button"
                onClick={() => setAddingToList(true)}
                className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-5 py-[11px] text-[13px] font-bold tracking-btn text-fg transition hover:border-pink hover:text-pink"
              >
                ＋ LIST
              </button>
            </div>
            {viewerMutation.isError && (
              <p role="alert" className="text-sm text-red-400">
                That didn’t save — try again.
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
          <h2 className="font-heading text-[32px] uppercase">
            {noun ? `${noun.singular}s` : 'Tracking'}
          </h2>
          {checkable ? (
            <>
              {longWork && total !== null && (
                <ProgressPosition
                  noun={noun!.singular}
                  total={total}
                  position={position}
                  watchedCount={watchedSet.size}
                  doneLabel={doneLabel}
                  onCommit={setPosition}
                />
              )}
              {showGrid ? (
                <>
                  <div className="flex flex-wrap items-center gap-4 font-label text-[11px] tracking-label text-dim">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-3 rounded-[4px] border border-pink bg-pink"
                      />
                      {doneLabel.toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-3 rounded-[4px] border border-pink bg-pink-row"
                      />
                      UP NEXT
                    </span>
                    <span>
                      {watchedSet.size} / {listLength} {noun!.singular.toUpperCase()}S
                    </span>
                  </div>
                  {/* A tile grid rather than the mockup's full-width rows: at ~56px
                  each, a 24-episode season ran past a full viewport, and manga
                  routinely carry hundreds of chapters. */}
                  <ul className="flex flex-wrap gap-2">
                    {Array.from(
                      { length: Math.min(listLength, visibleParts) },
                      (_, i) => i + 1,
                    ).map((number) => {
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
                            // The tile shows a bare number; the label carries what
                            // the row's WATCHED / UP NEXT text used to say.
                            aria-label={`${noun!.singular} ${number}${
                              watched ? ` — ${doneLabel.toLowerCase()}` : isNext ? ' — up next' : ''
                            }`}
                            title={`${noun!.singular} ${number}`}
                            className={clsx(
                              'flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-cover border px-2',
                              'font-label text-[13px] font-semibold tabular-nums transition',
                              watched
                                ? 'border-pink bg-pink text-on-prism'
                                : isNext
                                  ? 'border-pink bg-pink-row font-bold text-pink'
                                  : 'border-glass-border bg-glass text-muted hover:border-pink hover:text-pink',
                            )}
                          >
                            {number}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {listLength > visibleParts && (
                    <Button variant="secondary" onClick={() => setVisibleParts(listLength)}>
                      SHOW ALL {listLength}
                    </Button>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <GlassCard className="px-6 py-5 text-[15px] text-muted">
              {detail.kind === 'movie'
                ? 'Movies track in one step — set the status above to Completed when you’ve watched it.'
                : 'This entry has no episode or chapter count yet, so there’s nothing granular to tick off. Set a status above to track it.'}
            </GlassCard>
          )}
        </section>

        {/* side column */}
        <aside className="flex flex-col gap-8">
          <section className="flex flex-col gap-3.5">
            <h2 className="font-heading text-2xl uppercase">Details</h2>
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
            <h2 className="font-heading text-2xl uppercase">Comments</h2>
            <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
              Comments land with the v1.x social layer — episode threads, spoiler blurring, the
              works.
            </GlassCard>
          </section>

          {relationGroups.map(([label, items]) => (
            <section key={label} className="flex flex-col gap-3.5">
              <h2 className="font-heading text-2xl uppercase">{RELATION_HEADINGS[label]}</h2>
              <div className="grid grid-cols-3 gap-3">
                {items.map((item) => (
                  <Link key={item.id} to="/media/$slug" params={{ slug: item.slug }}>
                    <div className="relative">
                      <CoverCard
                        kind={item.kind}
                        title={item.title}
                        coverUrl={item.coverUrl ?? undefined}
                        // Only when the kind differs — that's the cross-kind case
                        // (a manga under SOURCE MATERIAL) that needs disambiguating.
                        caption={
                          item.kind === detail.kind ? undefined : (
                            <KindDot kind={item.kind} showLabel />
                          )
                        }
                      />
                      {item.seasonNumber !== null && (
                        <span className="absolute top-2.5 left-2.5 rounded-full bg-ink/80 px-2.5 py-0.5 font-display text-sm text-pink">
                          S{item.seasonNumber}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          {/* Genre-overlap suggestions — only when there's nothing typed to show (ADR-0004). */}
          {detail.relations.length === 0 && detail.related.length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="font-heading text-2xl uppercase">You might also like</h2>
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
      {addingToList && (
        <AddToListDialog
          mediaId={detail.id}
          mediaTitle={detail.title}
          onClose={() => setAddingToList(false)}
        />
      )}
      {editingDates && (
        <LogDatesDialog
          dates={editingDates}
          mediaTitle={detail.title}
          onClose={() => setEditingDates(null)}
          // Awaited, so the dialog can show the server's 400 rather than closing
          // over a rejected write — hence the direct call instead of applyViewer.
          onSave={async (next) => {
            const saved = await trackingApi.setDates(detail.id, next);
            queryClient.setQueryData<MediaDetail | null>(queryKey, (current) =>
              current
                ? { ...current, viewer: { ...EMPTY_VIEWER, ...current.viewer, ...saved } }
                : current,
            );
            await invalidateTracking(queryClient);
          }}
        />
      )}
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
