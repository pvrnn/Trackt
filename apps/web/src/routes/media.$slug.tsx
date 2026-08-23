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
import { PartBlockRow, PartRow } from '../components/media/PartRows';
import { ProgressCard } from '../components/media/ProgressCard';
import { RatingPopover } from '../components/media/RatingPopover';
import { Button } from '../components/ui/Button';
import { KindDot } from '../components/ui/KindDot';
import { Select, type SelectItem } from '../components/ui/Select';
import { useAuthedPage } from '../lib/auth-client';
import {
  LOG_STATUS_LABELS,
  coverGradient,
  dateRangeLabel,
  todayIso,
  KIND_LABELS_SINGULAR,
  firstUnwatched,
  invalidateTracking,
  partBlocks,
  partWindow,
  partsUpTo,
  progressUpTo,
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
  /** Which block of parts is expanded, or null for "the one you are in". */
  const [openBlock, setOpenBlock] = useState<number | null>(null);
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
    setOpenBlock(null);
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
  /** The highest part with everything before it seen — what a position means. */
  const position = progressUpTo(watchedSet);
  /** Blocks of forty, or none when the work is short enough to list part by part. */
  const blocks = total !== null ? partBlocks(total, position) : [];
  const volumes = detail.kind === 'manga' || detail.kind === 'webtoon';
  // The block you are in is the one that opens, until you say otherwise.
  const activeBlock = blocks.find((block) => block.index === openBlock) ??
    blocks.find((block) => position >= block.from && position <= block.to) ??
    blocks[0] ?? { index: 1, from: 1, to: 0, size: 0, done: 0, complete: false, partial: false };
  const insideBlock = position >= activeBlock.from && position <= activeBlock.to;
  const windowRows = partWindow(activeBlock.from, activeBlock.to, position);

  const setPosition = (upTo: number) =>
    applyViewer({ watched: partsUpTo(upTo) }, () => trackingApi.setProgress(detail.id, upTo));

  /** Every part row writes the position — see `PartRows`. */
  const partRow = (number: number) => (
    <PartRow
      key={number}
      label={`${noun?.singular ?? 'Part'} ${number}`}
      done={watchedSet.has(number)}
      isNext={number === next}
      onClick={() => setPosition(watchedSet.has(number) ? number - 1 : number)}
    />
  );

  /**
   * The primary action names the next unit and nothing more. A movie has no
   * next unit, so it gets the one step it does have.
   */
  const primary = checkable
    ? position >= (total ?? position)
      ? { label: 'UP TO DATE', done: true, onClick: () => setPosition(position) }
      : {
          label: `${trackingVerbLabel(detail.kind, 'present').toUpperCase()} ${noun!.prefix}${position + 1}`,
          done: false,
          onClick: () => setPosition(position + 1),
        }
    : viewer.status === 'completed'
      ? { label: 'WATCHED', done: true, onClick: () => setEditingDates({ ...viewer }) }
      : {
          label: 'MARK WATCHED',
          done: false,
          onClick: () => {
            const dates = stampedDates('completed', viewer, todayIso());
            applyViewer({ status: 'completed', ...dates }, () =>
              trackingApi.setStatus(detail.id, 'completed'),
            );
            if (viewer.status === null || viewer.status === 'planned') setEditingDates(dates);
          },
        };

  const relationGroups = groupRelations(detail.relations);
  /** '04 JAN → 11 FEB' when the log has dates; null offers to add them. */
  const dateLabel = dateRangeLabel(viewer.startedAt, viewer.finishedAt);

  const countOf = (n: number | null, unit: string) =>
    n !== null ? `${n} ${unit}${n === 1 ? '' : 'S'}` : null;
  /** Kind · year · genres, one line — which is why there is no GENRES section. */
  const metaLine = [
    KIND_LABELS_SINGULAR[detail.kind].toUpperCase(),
    detail.year !== null ? String(detail.year) : null,
    detail.genres.length > 0 ? detail.genres.slice(0, 3).join(', ').toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');
  /** What the work itself is doing: airing/ended, which season, how many parts. */
  const factsLine = [
    detail.status ? detail.status.toUpperCase() : null,
    detail.seasonNumber !== null ? `SEASON ${detail.seasonNumber}` : null,
    noun ? countOf(total, noun.singular.toUpperCase()) : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
      {/* Hero: full-bleed backdrop, the artwork carries the page. */}
      <div className="relative overflow-hidden border-b border-white/9">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: coverGradient(detail.kind, detail.title) }}
        />
        {detail.coverUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-80"
            style={{ backgroundImage: `url(${detail.coverUrl})` }}
          />
        )}
        {/* The scrim is what makes the panel a header rather than a picture:
            it carries the art down into the page's own ink so there is no seam,
            and gives the title something to sit on whatever the cover is. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,12,16,0.35)_0%,rgba(14,12,16,0.55)_45%,rgba(14,12,16,0.92)_100%)]"
        />

        <div className="relative mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-16 pb-11 md:flex-row md:items-end">
          <div
            className="cover h-[360px] w-[240px] shrink-0 bg-cover bg-center"
            style={
              detail.coverUrl
                ? { backgroundImage: `url(${detail.coverUrl})` }
                : { background: coverGradient(detail.kind, detail.title) }
            }
          />

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* Kind, year and genres on one line — which is why there is no
                separate GENRES section any more. */}
            <div className="flex flex-wrap items-center gap-2.5">
              <KindDot kind={detail.kind} />
              <span className="font-label text-xs tracking-label text-muted">{metaLine}</span>
            </div>

            <h1 className="font-heading text-[clamp(44px,6vw,78px)] leading-[0.94] uppercase">
              {detail.title}
            </h1>

            {detail.description && (
              <p className="max-w-[620px] text-[16px] leading-relaxed text-muted">
                {detail.description}
              </p>
            )}

            {/* Status and dates are facts, not buttons — the chip changes the
                one, the date segment opens the editor for the other. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Named by the hidden label *plus* the trigger, so the chip
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
                  // optimistically so the rows don't lag a refetch behind.
                  const sweep: ViewerPatch =
                    !checkable || listLength === 0
                      ? {}
                      : status === 'completed'
                        ? { watched: partsUpTo(listLength) }
                        : status === 'planned'
                          ? { watched: [] }
                          : {};
                  // Same for the dates the server stamps (ADR-0007), so the
                  // date segment fills in as the status chip changes.
                  const dates = stampedDates(status, viewer, todayIso());
                  applyViewer({ status, ...sweep, ...dates }, () =>
                    trackingApi.setStatus(detail.id, status),
                  );
                  // The one transition with no evidence behind its date: the
                  // user is logging something they watched at some unknown time
                  // in the past, and today is almost certainly wrong.
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
                  className="cursor-pointer font-label text-xs font-semibold tracking-label text-muted transition-colors hover:text-pink"
                >
                  {dateLabel ?? '＋ ADD DATES'}
                </button>
              )}
              {factsLine && (
                <>
                  <span className="font-label text-xs text-dim">·</span>
                  <span className="font-label text-xs font-semibold tracking-label text-muted">
                    {factsLine}
                  </span>
                </>
              )}
            </div>

            {/* One primary, two secondaries. Nothing else competes. */}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={primary.onClick}
                className={clsx(
                  'flex h-[52px] cursor-pointer items-center gap-2.5 rounded-full px-7 transition',
                  primary.done
                    ? 'bg-glass text-muted inset-ring inset-ring-white/15 hover:inset-ring-pink'
                    : 'bg-prism text-on-prism hover:brightness-110',
                )}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {primary.done ? '★' : '✓'}
                </span>
                <span className="font-label text-[13px] font-bold tracking-label whitespace-nowrap">
                  {primary.label}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={viewer.favorited}
                onClick={() =>
                  applyViewer({ favorited: !viewer.favorited }, () =>
                    viewer.favorited
                      ? trackingApi.unfavorite(detail.id)
                      : trackingApi.favorite(detail.id),
                  )
                }
                className={clsx(
                  'flex h-[52px] cursor-pointer items-center gap-2.5 rounded-full px-5 inset-ring transition',
                  viewer.favorited
                    ? 'bg-pink-selected text-pink inset-ring-pink/50'
                    : 'bg-glass text-muted inset-ring-white/15 hover:text-pink hover:inset-ring-pink',
                )}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {viewer.favorited ? '♥' : '♡'}
                </span>
                <span className="font-label text-xs font-bold tracking-label">FAVOURITE</span>
              </button>

              <button
                type="button"
                onClick={() => setAddingToList(true)}
                className="flex h-[52px] cursor-pointer items-center gap-2.5 rounded-full bg-glass px-5 text-muted inset-ring inset-ring-white/15 transition hover:text-pink hover:inset-ring-pink"
              >
                <span aria-hidden className="text-[15px] leading-none">
                  ＋
                </span>
                <span className="font-label text-xs font-bold tracking-label">LIST</span>
              </button>
            </div>

            {viewerMutation.isError && (
              <p role="alert" className="text-sm text-red-400">
                That didn’t save — try again.
              </p>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-[1360px] grid-cols-1 gap-12 px-10 pt-10 pb-20 lg:grid-cols-[2fr_1fr]">
        {/* LEFT: the counter, then the parts it scopes. */}
        <section className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-heading text-[32px] uppercase">
              {noun ? `${noun.singular}s` : 'Tracking'}
            </h2>
            <div className="flex-1" />
            {checkable && total !== null && (
              <button
                type="button"
                onClick={() => setPosition(position >= total ? 0 : total)}
                className="cursor-pointer font-label text-[11px] tracking-label text-pink transition-colors hover:brightness-125"
              >
                {position >= total ? 'CLEAR PROGRESS' : `MARK ALL ${doneLabel.toUpperCase()}`}
              </button>
            )}
          </div>

          {checkable && total !== null ? (
            <>
              <ProgressCard
                unitLabel={`${noun!.singular.toUpperCase()}S ${doneLabel.toUpperCase()}`}
                total={total}
                position={position}
                watchedCount={watchedSet.size}
                onCommit={setPosition}
              />

              {blocks.length > 0 ? (
                <>
                  <div className="flex flex-col gap-2">
                    {blocks.map((block) => (
                      <PartBlockRow
                        key={block.index}
                        block={block}
                        label={
                          volumes
                            ? `Volume ${block.index}`
                            : `${noun!.singular}s ${block.from}–${block.to}`
                        }
                        rangeLabel={`${noun!.prefix} ${block.from}–${block.to}`}
                        open={block.index === activeBlock.index}
                        onClick={() =>
                          setOpenBlock((current) => (current === block.index ? null : block.index))
                        }
                      />
                    ))}
                  </div>

                  <div className="mt-2 flex items-center gap-4">
                    <h3 className="font-heading text-xl uppercase">
                      {volumes
                        ? `Volume ${activeBlock.index}`
                        : `${noun!.singular}s ${activeBlock.from}–${activeBlock.to}`}
                      {insideBlock ? ' · around you' : ''}
                    </h3>
                    <span className="h-px flex-1 bg-white/9" />
                  </div>
                  <div className="flex flex-col gap-2">{windowRows.map(partRow)}</div>
                  <p className="font-label text-[11px] leading-relaxed tracking-label text-faint">
                    OPEN A {volumes ? 'VOLUME' : 'BLOCK'} TO JUMP THERE · THE SLIDER TRAVELS FURTHER
                  </p>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: total }, (_, i) => i + 1).map(partRow)}
                </div>
              )}
            </>
          ) : (
            <p className="rounded-card bg-glass px-6 py-5 text-[15px] text-muted inset-ring inset-ring-white/10">
              {detail.kind === 'movie'
                ? 'Movies track in one step — the button above is the whole log.'
                : 'This entry has no episode or chapter count yet, so there’s nothing granular to tick off. Set a status above to track it.'}
            </p>
          )}
        </section>

        {/* RIGHT */}
        <aside className="flex flex-col gap-8">
          {/* The rating: your score against the instance's, which is the only
              comparison that makes either number mean anything. */}
          <div className="flex gap-2.5">
            <div className="flex flex-1 items-center gap-3.5 rounded-card-sm bg-glass px-4.5 py-4 inset-ring inset-ring-white/10 backdrop-blur-[16px]">
              {viewer.score !== null ? (
                <span className="text-prism font-display text-[38px] leading-none">
                  {viewer.score.toFixed(1)}
                </span>
              ) : (
                <span className="font-display text-[38px] leading-none text-faint">–</span>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="font-label text-[11px] tracking-label text-muted">
                  {viewer.score !== null ? 'YOUR RATING' : 'RATE THIS'}
                </span>
                <span className="font-label text-[11px] tracking-label text-dim">
                  {detail.community.averageScore !== null
                    ? `${detail.community.averageScore.toFixed(1)} FROM ${detail.community.ratingCount} HERE`
                    : 'NO RATINGS HERE YET'}
                </span>
              </div>
            </div>
            <RatingPopover
              score={viewer.score}
              onChange={(score) => {
                if (score === null) {
                  applyViewer({ score: null }, () => trackingApi.clearScore(detail.id));
                } else {
                  applyViewer({ score }, () => trackingApi.setScore(detail.id, score));
                }
              }}
              trigger={<span aria-hidden>✎</span>}
              triggerClassName="grid w-14 shrink-0 cursor-pointer place-items-center rounded-card-sm bg-glass text-base text-pink transition inset-ring inset-ring-white/10 outline-none hover:inset-ring-pink"
            />
          </div>

          <section className="flex flex-col gap-3.5">
            <h2 className="font-heading text-2xl uppercase">Details</h2>
            <div className="flex flex-col">
              {detailRows.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-4 py-3 inset-ring-0 [box-shadow:inset_0_-1px_0_rgba(255,255,255,0.07)]"
                >
                  <span className="shrink-0 font-label text-[11px] tracking-label text-dim">
                    {key}
                  </span>
                  <span className="text-right text-[13px]">{value}</span>
                </div>
              ))}
            </div>
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
