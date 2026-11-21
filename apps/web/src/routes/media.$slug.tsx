import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LOG_STATUSES,
  type LogDates,
  type LogStatus,
  type MediaDetail,
  type MediaKind,
  type MediaRelationLabel,
} from '@trackt/shared';
import { FeedbackDialog } from '../components/feedback/FeedbackDialog';
import { AppNav, type AppNavUser } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { AddToListDialog } from '../components/media/AddToListDialog';
import { LogCard } from '../components/media/LogCard';
import { LogDatesDialog } from '../components/media/LogDatesDialog';
import { PartBlockRow, PartRow } from '../components/media/PartRows';
import { ProgressCard } from '../components/media/ProgressCard';
import { MediaNews } from '../components/news/MediaNews';
import { Button } from '../components/ui/Button';
import { KindDot } from '../components/ui/KindDot';
import { Select, type SelectItem } from '../components/ui/Select';
import { useAuthedPage } from '../lib/auth-client';
import { useFormat } from '../lib/format';
import { useLabels } from '../lib/labels';
import {
  coverGradient,
  externalProfiles,
  todayIso,
  firstUnwatched,
  invalidateTracking,
  mediaFacts,
  partLayout,
  partWindow,
  partsUpTo,
  progressUpTo,
  stampedDates,
  trackingApi,
  useFlag,
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
  head: ({ params, match }) => ({
    meta: [
      {
        title: match.context.i18n.t('meta.media', {
          title: titleFromSlug(params.slug) || match.context.i18n.t('media.untitled'),
        }),
      },
    ],
  }),
  component: MediaPage,
});

/** Per-card relation label (ADR-0004), in catalog-key form. */
const RELATION_LABELS = {
  prequel: 'media.relation.prequel',
  sequel: 'media.relation.sequel',
  source: 'media.relation.source',
  adaptation: 'media.relation.adaptation',
  spinoff: 'media.relation.spinoff',
  parent: 'media.relation.parent',
  related: 'media.relation.related',
} as const satisfies Record<MediaRelationLabel, string>;

type RelatedItem = {
  id: string;
  slug: string;
  kind: MediaKind;
  title: string;
  coverUrl: string | null;
  seasonNumber: number | null;
  label: string;
};

/** Related works, three across: the artwork stays clean and the words sit under it. */
function RelatedGrid({ items }: { items: RelatedItem[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="related-title" className="flex flex-col gap-3.5">
      <h2 id="related-title" className="font-heading text-2xl uppercase">
        {t('media.relatedTitle')}
      </h2>
      <div className="grid grid-cols-3 gap-3">
        {items.map((item) => (
          <Link
            key={item.id}
            to="/media/$slug"
            params={{ slug: item.slug }}
            className="group flex min-w-0 flex-col gap-[7px]"
          >
            <div
              aria-hidden
              className="relative aspect-2/3 rounded-[9px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_10px_26px_-14px_rgba(0,0,0,0.9)]"
              style={
                item.coverUrl
                  ? { backgroundImage: `url(${item.coverUrl})` }
                  : { background: coverGradient(item.kind, item.title) }
              }
            >
              {item.seasonNumber !== null && (
                <span className="absolute top-2 left-2 rounded-full bg-on-prism px-2 py-0.5 font-label text-[10px] font-bold tracking-label text-pink">
                  S{item.seasonNumber}
                </span>
              )}
            </div>
            <span className="font-label text-[10px] font-bold tracking-label text-pink">
              {item.label}
            </span>
            <span className="text-[13px] leading-tight font-semibold transition-colors group-hover:text-pink">
              {item.title}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Full ISO dates read as '2 Feb 2024'; partial ones ('2024-02') stay as given. */
function factDate(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function partNoun(detail: MediaDetail) {
  if (detail.kind === 'series' || detail.kind === 'anime') {
    return {
      singular: 'media.part.episode',
      plural: 'media.part.episodes',
      prefix: 'E',
    } as const;
  }
  if (detail.kind === 'manga' || detail.kind === 'webtoon') {
    return {
      singular: 'media.part.chapter',
      plural: 'media.part.chapters',
      prefix: 'CH',
    } as const;
  }
  return null;
}

function partTotal(detail: MediaDetail): number | null {
  // Whole-work kinds have no episodes/chapters; all others use partCount (ADR-0003).
  return detail.kind === 'movie' ? null : detail.partCount;
}

type ViewerPatch = Partial<NonNullable<MediaDetail['viewer']>>;

/** What an untracked work looks like: the base every optimistic patch lands on. */
const EMPTY_VIEWER: NonNullable<MediaDetail['viewer']> = {
  status: null,
  score: null,
  watched: [],
  favorited: false,
  startedAt: null,
  finishedAt: null,
};

function MediaPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const { isPending: authPending, navUser } = useAuthedPage();
  const listsOn = useFlag('lists.custom');
  const { data, isError, refetch } = useMediaDetail(slug);
  /** Which block of parts is expanded, or null for "the one you are in". */
  const [openBlock, setOpenBlock] = useState<number | null>(null);
  const [addingToList, setAddingToList] = useState(false);
  const [reportingIssue, setReportingIssue] = useState(false);
  // The dialog's *initial* dates, or null when it's closed. Held here rather
  // than read from `viewer` on open, so the auto-open path can hand it the
  // dates it just stamped without racing the optimistic cache write.
  const [editingDates, setEditingDates] = useState<LogDates | null>(null);

  /** The '' option clears the log; its label doubles as the resting pill text. */
  const logItems: SelectItem[] = [
    { value: '', label: t('media.log') },
    ...LOG_STATUSES.map((status) => ({ value: status, label: labels.status(status) })),
  ];

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
    if (data) document.title = t('meta.media', { title: data.title });
  }, [data, t]);

  if (authPending || !navUser) return <div className="min-h-screen bg-ink" />;

  if (isError) {
    return (
      <Shell user={navUser}>
        <main className="mx-auto flex max-w-[1360px] flex-col items-start gap-4 px-10 pt-14 pb-20">
          <h1 className="font-heading text-[56px] leading-none uppercase">
            {t('media.loadFailed.title')}
          </h1>
          <p className="max-w-[540px] text-[15px] text-muted">{t('media.loadFailed.body')}</p>
          <div className="mt-2 flex items-center gap-5">
            <Button onClick={() => refetch()}>{t('media.retry')}</Button>
            <Link to="/search" className="text-sm font-bold text-pink">
              {t('media.backToDiscover')}
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
          <h1 className="font-heading text-[56px] leading-none uppercase">
            {t('media.notFound.title')}
          </h1>
          <p className="text-[15px] text-muted">{t('media.notFound.body', { slug })}</p>
          <Link to="/search" className="text-sm font-bold text-pink">
            {t('media.backToDiscover')}
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
  const unit = noun ? t(noun.singular) : null;
  const units = noun ? t(noun.plural) : null;
  const total = partTotal(detail);
  const watchedSet = new Set(viewer.watched);
  const listLength = total ?? (viewer.watched.length > 0 ? Math.max(...viewer.watched) : 0);
  // Candidates stop at the known part count, so never offer "CHECK IN E13" on a
  // 12-episode series (the server would reject it). Only an unknown total may
  // extend one past the highest watched part. Scanned rather than materialised:
  // a 900-chapter manga allocated a 900-element array on every render to read
  // one number off the front of it.
  const next = noun ? firstUnwatched(watchedSet, total ?? listLength + 1) : null;
  const checkable = noun !== null && listLength > 0;
  /** 'Watched' or 'Read', per kind: the checklist's done state, in words. */
  const doneLabel = labels.trackingVerb(detail.kind);
  /** The highest part with everything before it seen: what a position means. */
  const position = progressUpTo(watchedSet);
  /** Volumes when the catalog states a count, else blocks of forty — never both. */
  const layout = partLayout(detail, total, position);
  const blocks = layout.blocks;
  /** Whether the blocks are volumes, which is the only thing that may name them so. */
  const volumed = layout.volumes !== null;
  /** Print works count chapters; everything else with parts counts episodes. */
  const print = detail.kind === 'manga' || detail.kind === 'webtoon';
  // The block you are in is the one that opens, until you say otherwise.
  const activeBlock = blocks.find((block) => block.index === openBlock) ??
    blocks.find((block) => position >= block.from && position <= block.to) ??
    blocks[0] ?? { index: 1, from: 1, to: 0, size: 0, done: 0, complete: false, partial: false };
  const insideBlock = position >= activeBlock.from && position <= activeBlock.to;
  const windowRows = partWindow(activeBlock.from, activeBlock.to, position);

  const setPosition = (upTo: number) =>
    applyViewer({ watched: partsUpTo(upTo) }, () => trackingApi.setProgress(detail.id, upTo));

  /** Every part row writes the position; see `PartRows`. */
  const partRow = (number: number) => (
    <PartRow
      key={number}
      label={t('media.part.label', { unit: unit ?? t('media.part.generic'), number })}
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
      ? { label: t('media.upToDate'), done: true, onClick: () => setPosition(position) }
      : {
          label: t('media.checkIn', {
            verb: labels.trackingVerb(detail.kind, 'present').toUpperCase(),
            part: `${noun!.prefix}${position + 1}`,
          }),
          done: false,
          onClick: () => setPosition(position + 1),
        }
    : viewer.status === 'completed'
      ? {
          label: labels.trackingVerb(detail.kind).toUpperCase(),
          done: true,
          onClick: () => setEditingDates({ ...viewer }),
        }
      : {
          label: t('media.mark', { verb: labels.trackingVerb(detail.kind).toUpperCase() }),
          done: false,
          onClick: () => {
            const dates = stampedDates('completed', viewer, todayIso());
            applyViewer({ status: 'completed', ...dates }, () =>
              trackingApi.setStatus(detail.id, 'completed'),
            );
            if (viewer.status === null || viewer.status === 'planned') setEditingDates(dates);
          },
        };

  const relatedItems: RelatedItem[] =
    detail.relations.length > 0
      ? detail.relations.map((item) => ({ ...item, label: t(RELATION_LABELS[item.relation]) }))
      : detail.related.map((item) => ({ ...item, label: t('media.relation.similar') }));
  /** Upstream records for the ALSO ON row: the ids are also the redirect targets. */
  const external = externalProfiles(detail.kind, detail.externalIds, detail.metadata);
  const fromTmdb = external.some(({ provider }) => provider.toLowerCase() === 'tmdb');
  /** '04 JAN → 11 FEB' when the log has dates; null offers to add them. */
  const dateLabel = format.dateRange(viewer.startedAt, viewer.finishedAt);

  const countOf = (n: number | null, label: string) =>
    n !== null ? t('media.partCount', { count: n, unit: label }) : null;
  const displayStatus =
    detail.status?.toUpperCase() ??
    (typeof detail.metadata.igdbStatus === 'string'
      ? detail.metadata.igdbStatus.toUpperCase()
      : null);
  const metaLine = [
    labels.kindSingular(detail.kind).toUpperCase(),
    detail.year !== null ? String(detail.year) : null,
    detail.genres.length > 0 ? detail.genres.slice(0, 2).join(', ').toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');
  /** What the work itself is doing: airing/ended, which season, how many parts. */
  const factsLine = [
    displayStatus,
    detail.seasonNumber !== null ? t('media.season', { number: detail.seasonNumber }) : null,
    noun && unit ? countOf(total, unit.toUpperCase()) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const facts = mediaFacts(detail).map((fact) => {
    switch (fact.key) {
      case 'status':
        return { key: fact.key, value: fact.value, accent: fact.airing };
      case 'released':
      case 'ended':
        return { key: fact.key, value: factDate(fact.value, format.locale) };
      case 'runtime':
        return { key: fact.key, value: t('media.details.runtimeValue', { minutes: fact.value }) };
      case 'volumes':
        return { key: fact.key, value: String(fact.value) };
      case 'alsoKnownAs':
        return { key: fact.key, value: fact.value.join(' · '), wide: true };
      case 'genres':
        return { key: fact.key, value: fact.value.join(', '), wide: fact.value.length > 2 };
      default:
        return { key: fact.key, value: fact.value.join(', ') };
    }
  });

  const setStatus = (value: string) => {
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
    // Same for the dates the server stamps (ADR-0007).
    const dates = stampedDates(status, viewer, todayIso());
    applyViewer({ status, ...sweep, ...dates }, () => trackingApi.setStatus(detail.id, status));
    // The one transition with no evidence behind its date: the user is logging
    // something they watched at some unknown time in the past, and today is
    // almost certainly wrong.
    if (status === 'completed' && (viewer.status === null || viewer.status === 'planned')) {
      setEditingDates(dates);
    }
  };

  return (
    <Shell user={navUser}>
      <header className="relative">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: coverGradient(detail.kind, detail.title) }}
        />
        {detail.bannerUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${detail.bannerUrl})` }}
          />
        )}
        {/* Fallback only: a poster blown up to full bleed is a crop of one
            corner of the art, so where a banner exists the cover is left to
            the poster card below. */}
        {!detail.bannerUrl && detail.coverUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-80"
            style={{ backgroundImage: `url(${detail.coverUrl})` }}
          />
        )}
        {/* We do not choose the artwork, so the page brings its own contrast:
            ≥0.9 under the whole text column, easing off only where there is no
            text, then a fade into Ink (Design System §08). */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(14,12,16,0.95) 0%, rgba(14,12,16,0.9) max(860px, calc(50% + 170px)), rgba(14,12,16,0.24) max(1180px, calc(50% + 490px)), rgba(14,12,16,0.1) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,12,16,0.3)_0%,rgba(14,12,16,0)_22%,rgba(14,12,16,0)_66%,#0e0c10_100%)]"
        />

        <div className="relative mx-auto flex max-w-[1360px] flex-col gap-9 px-4 pt-[60px] pb-9 sm:px-10 md:flex-row md:items-end">
          <div
            className="cover h-[330px] w-[220px] shrink-0 bg-cover bg-center"
            style={
              detail.coverUrl
                ? { backgroundImage: `url(${detail.coverUrl})` }
                : { background: coverGradient(detail.kind, detail.title) }
            }
          />

          <div className="flex max-w-[600px] min-w-0 flex-1 flex-col gap-3.5">
            <div className="flex items-center gap-[9px]">
              <KindDot kind={detail.kind} />
              <span className="font-label text-xs font-bold tracking-[0.12em] text-[#cfc9d8]">
                {metaLine}
              </span>
            </div>

            <h1 className="font-heading text-[clamp(44px,6vw,76px)] leading-[0.94] uppercase [text-shadow:0_2px_30px_rgba(14,12,16,0.7)]">
              {detail.title}
            </h1>

            {detail.description && (
              <p className="line-clamp-3 text-base leading-relaxed text-pretty text-[#cfc9d8]">
                {detail.description}
              </p>
            )}

            {factsLine && (
              <span className="font-label text-xs font-semibold tracking-[0.08em] text-muted">
                {factsLine}
              </span>
            )}

            {/* Three controls, in the order you use them: do the next thing,
                change the state, love it. */}
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={primary.onClick}
                className={clsx(
                  'flex h-[52px] cursor-pointer items-center gap-2.5 rounded-full px-7 transition',
                  primary.done
                    ? 'bg-[#1d1826] text-muted inset-ring inset-ring-white/18 hover:inset-ring-pink'
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

              {/* Named by the hidden label *plus* the trigger, so the pill
                  announces "Status, COMPLETED"; an `aria-label` here would
                  replace the value and leave only "status". */}
              <span id="log-status-label" className="sr-only">
                {t('media.statusLabel')}
              </span>
              <Select
                variant="pill"
                id="log-status-trigger"
                aria-labelledby="log-status-label log-status-trigger"
                items={logItems}
                value={viewer.status ?? ''}
                selected={viewer.status !== null}
                onChange={setStatus}
                className="h-[52px] font-bold"
              />

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
                  'flex h-[52px] cursor-pointer items-center gap-[9px] rounded-full bg-[#1d1826] px-5 inset-ring transition hover:inset-ring-pink',
                  viewer.favorited
                    ? 'text-pink inset-ring-pink/60'
                    : 'text-[#cfc9d8] inset-ring-white/18',
                )}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {viewer.favorited ? '♥' : '♡'}
                </span>
                <span className="font-label text-xs font-bold tracking-[0.08em]">
                  {viewer.favorited ? t('media.favourited') : t('media.favourite')}
                </span>
              </button>
            </div>

            {viewerMutation.isError && (
              <p role="alert" className="text-sm text-red-400">
                {t('media.saveFailed')}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* FACTS: a strip, not a table. */}
      <div className="relative mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-1 sm:px-10">
        {facts.length > 0 && (
          <dl className="m-0 overflow-hidden rounded-card bg-glass inset-ring inset-ring-white/10 backdrop-blur-[16px]">
            {/* Every cell rules its top and left edge; the -1px offset tucks
                the first row's and column's rules under the card's own edge,
                so the strip can wrap without a stray line. */}
            <div className="-mt-px -ml-px flex flex-wrap">
              {facts.map((fact) => (
                <div
                  key={fact.key}
                  className={clsx(
                    'flex min-w-0 flex-col gap-1.5 border-t border-l border-divider px-5 py-4',
                    fact.wide ? 'flex-[2_1_320px]' : 'flex-[1_1_150px]',
                  )}
                >
                  <dt className="font-label text-[10px] font-bold tracking-[0.12em] text-dim">
                    {t(`media.details.${fact.key}`)}
                  </dt>
                  <dd
                    className={clsx(
                      'm-0 text-[15px] leading-snug font-semibold',
                      fact.accent ? 'text-pink' : 'text-fg',
                    )}
                  >
                    {fact.value}
                  </dd>
                </div>
              ))}
            </div>
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-1">
          {external.length > 0 && (
            <>
              <span className="font-label text-[10px] font-bold tracking-[0.12em] text-dim">
                {t('media.details.alsoOn')}
              </span>
              {external.map(({ provider, url }) =>
                url ? (
                  <a
                    key={provider}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label text-[11px] font-bold tracking-[0.08em] text-pink transition hover:brightness-125"
                  >
                    {provider.toUpperCase()} ↗
                  </a>
                ) : (
                  <span
                    key={provider}
                    className="font-label text-[11px] font-bold tracking-[0.08em] text-dim"
                  >
                    {provider.toUpperCase()}
                  </span>
                ),
              )}
            </>
          )}
          <div className="flex-1" />
          {fromTmdb && (
            <span className="font-label text-[11px] text-dim">{t('media.details.tmdbNotice')}</span>
          )}
          <button
            type="button"
            onClick={() => setReportingIssue(true)}
            className="cursor-pointer px-0.5 py-1.5 font-label text-[11px] font-bold tracking-[0.08em] text-muted transition-colors hover:text-pink"
          >
            <span aria-hidden>⚑ </span>
            {t('media.reportIssue')}
          </button>
        </div>
      </div>

      <main className="mx-auto grid max-w-[1360px] grid-cols-1 items-start gap-12 px-4 pt-9 pb-20 sm:px-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* LEFT: the counter, then the parts it scopes. */}
        <section className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-heading text-[32px] uppercase">{units ?? t('media.tracking')}</h2>
            <div className="flex-1" />
            {checkable && total !== null && (
              <button
                type="button"
                onClick={() => setPosition(position >= total ? 0 : total)}
                className="cursor-pointer font-label text-[11px] tracking-label text-pink transition-colors hover:brightness-125"
              >
                {position >= total
                  ? t('media.clearProgress')
                  : t('media.markAll', { verb: doneLabel.toUpperCase() })}
              </button>
            )}
          </div>

          {checkable && total !== null ? (
            <>
              <ProgressCard
                unitLabel={
                  print ? t('media.progressUnit.chapters') : t('media.progressUnit.episodes')
                }
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
                          volumed
                            ? t('media.volume', { number: block.index })
                            : t('media.partsRange', { unit: units, from: block.from, to: block.to })
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
                      {volumed
                        ? t('media.volume', { number: activeBlock.index })
                        : t('media.partsRange', {
                            unit: units,
                            from: activeBlock.from,
                            to: activeBlock.to,
                          })}
                      {insideBlock ? ` · ${t('media.aroundYou')}` : ''}
                    </h3>
                    <span className="h-px flex-1 bg-white/9" />
                  </div>
                  <div className="flex flex-col gap-2">{windowRows.map(partRow)}</div>
                  <p className="font-label text-[11px] leading-relaxed tracking-label text-faint">
                    {volumed ? t('media.browseNote.volume') : t('media.browseNote.block')}
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
              {detail.kind === 'movie' || detail.kind === 'game'
                ? t(`media.empty.${detail.kind}`)
                : t('media.empty.noParts')}
            </p>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-8">
          <LogCard
            score={viewer.score}
            communityScore={detail.community.averageScore}
            ratingCount={detail.community.ratingCount}
            onRate={(score) =>
              score === null
                ? applyViewer({ score: null }, () => trackingApi.clearScore(detail.id))
                : applyViewer({ score }, () => trackingApi.setScore(detail.id, score))
            }
            // Dates live on the log row, so there is nothing to date before one exists.
            datesLabel={viewer.status !== null ? dateLabel : undefined}
            onEditDates={() => setEditingDates({ ...viewer })}
            onAddToList={listsOn ? () => setAddingToList(true) : undefined}
          />

          {/* Central news touching this work (ADR-0005); renders nothing when empty. */}
          <MediaNews mediaId={detail.id} />

          {relatedItems.length > 0 && <RelatedGrid items={relatedItems} />}
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
          // Awaited, so the dialog can report a rejected write rather than
          // closing over it; hence the direct call instead of applyViewer.
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
      {reportingIssue && (
        <FeedbackDialog
          media={{ id: detail.id, title: detail.title }}
          onClose={() => setReportingIssue(false)}
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
