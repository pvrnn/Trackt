import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  coverGradient,
  useDebounced,
  useImportMatches,
  useImportSources,
  useMediaSearch,
  useResolveImportMatch,
  type ImportMatch,
  type ImportMatchCandidate,
  type ResolveImportMatchInput,
} from '@trackt/client';
import type { LogStatus, MediaKind } from '@trackt/shared';
import { useFormat } from '../../lib/format';
import { useLabels } from '../../lib/labels';
import { BrandTile, sourceBrand } from '../ui/BrandLogo';
import { FilterBar, FilterCell } from '../ui/FilterBar';
import { kindDotClass } from '../ui/KindDot';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

/** How long a pick or a skip waits before it is sent, so UNDO can take it back. */
const UNDO_MS = 5_000;
/** Past this many rows the page grows SOURCE and KIND filters. */
const FILTER_FROM = 20;

type Answer = { action: 'pick'; mediaId: string; title: string } | { action: 'skip' };

type RowState =
  | { phase: 'pending'; answer: Answer }
  | { phase: 'done'; answer: Answer; merged: boolean }
  | { phase: 'error' };

const STATUS_KEYS = new Set<LogStatus>([
  'planned',
  'in_progress',
  'paused',
  'completed',
  'dropped',
]);

/**
 * The titles an import could not decide on (docs/design/Import Matches.dc.html).
 * A pick or a skip folds its row at once and is sent a few seconds later, so
 * UNDO is just not sending it; leaving the page sends whatever is still waiting.
 */
export function ImportMatches() {
  const { t } = useTranslation();
  const matchesQuery = useImportMatches();
  const sourcesQuery = useImportSources();
  const resolve = useResolveImportMatch();
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [sourceFilter, setSourceFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const timers = useRef(new Map<string, { timer: number; input: ResolveImportMatchInput }>());

  const sourceLabel = (id: string) =>
    sourcesQuery.data?.sources.find((source) => source.id === id)?.label ?? id;

  const send = (input: ResolveImportMatchInput) => {
    timers.current.delete(input.id);
    resolve.mutate(input, {
      onSuccess: (result) =>
        setStates((current) => {
          const state = current[input.id];
          if (state?.phase !== 'pending') return current;
          const merged = result.outcome === 'merged' || result.outcome === 'skipped';
          return { ...current, [input.id]: { phase: 'done', answer: state.answer, merged } };
        }),
      onError: () => setStates((current) => ({ ...current, [input.id]: { phase: 'error' } })),
    });
  };

  const answer = (match: ImportMatch, given: Answer) => {
    const input: ResolveImportMatchInput =
      given.action === 'pick'
        ? { id: match.id, action: 'pick', mediaId: given.mediaId }
        : { id: match.id, action: 'skip' };
    const timer = window.setTimeout(() => send(input), UNDO_MS);
    timers.current.set(match.id, { timer, input });
    setStates((current) => ({ ...current, [match.id]: { phase: 'pending', answer: given } }));
  };

  const undo = (id: string) => {
    const waiting = timers.current.get(id);
    if (waiting) window.clearTimeout(waiting.timer);
    timers.current.delete(id);
    setStates(({ [id]: _dropped, ...rest }) => rest);
  };

  // Leaving the page is not an undo: whatever is still waiting goes now.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    for (const { timer, input } of [...timers.current.values()]) {
      window.clearTimeout(timer);
      send(input);
    }
  };
  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const matches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);
  const shown = matches.filter(
    (match) =>
      (sourceFilter === 'all' || match.source === sourceFilter) &&
      (kindFilter === 'all' || match.kind === kindFilter),
  );
  const open = matches.filter((match) => {
    const phase = states[match.id]?.phase;
    return phase === undefined || phase === 'error';
  });
  const openSources = [...new Set(open.map((match) => match.source))];

  const scope =
    openSources.length > 1
      ? t('profile.import.matches.scopeMany', {
          count: open.length,
          sources: openSources.length,
        })
      : openSources.length === 1
        ? t('profile.import.matches.scope', {
            count: open.length,
            source: sourceLabel(openSources[0]!).toUpperCase(),
          })
        : null;

  return (
    <main className="mx-auto flex max-w-[880px] flex-col gap-[22px] px-4 pt-12 pb-24 sm:px-6">
      <Link
        to="/profile"
        className="self-start font-label text-[11px] font-bold tracking-[0.08em] text-muted hover:text-pink"
      >
        {t('profile.import.matches.back')}
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-[18px]">
          <h1 className="m-0 font-display text-[clamp(2.75rem,7vw,4rem)] leading-none font-normal uppercase">
            {t('profile.import.matches.title')}
          </h1>
          {scope && (
            <span
              aria-live="polite"
              className="text-prism font-label text-[13px] font-bold tracking-[0.08em]"
            >
              {scope}
            </span>
          )}
        </div>
        <p className="m-0 max-w-[62ch] text-[15px] leading-[1.55] text-muted">
          {t('profile.import.matches.lede')}
        </p>
      </header>

      {matches.length >= FILTER_FROM && (
        <FilterBar>
          <FilterCell
            label={t('profile.import.matches.filterSource')}
            value={sourceFilter}
            onChange={setSourceFilter}
            items={[
              { value: 'all', label: t('profile.import.matches.allSources') },
              ...[...new Set(matches.map((match) => match.source))].map((id) => ({
                value: id,
                label: sourceLabel(id),
              })),
            ]}
          />
          <KindFilter matches={matches} value={kindFilter} onChange={setKindFilter} />
        </FilterBar>
      )}

      {matchesQuery.isPending ? (
        <SkeletonRegion label={t('profile.import.matches.loading')} className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <Bone key={index} className="h-[260px] rounded-[18px]" />
          ))}
        </SkeletonRegion>
      ) : matchesQuery.isError ? (
        <p className="text-sm text-muted">{t('profile.import.matches.loadError')}</p>
      ) : open.length === 0 && Object.keys(states).length === 0 ? (
        <Settled />
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((match) => {
            const state = states[match.id];
            if (state && state.phase !== 'error') {
              return (
                <DoneRow
                  key={match.id}
                  state={state}
                  onUndo={state.phase === 'pending' ? () => undo(match.id) : undefined}
                />
              );
            }
            return (
              <MatchRow
                key={match.id}
                match={match}
                sourceName={sourceLabel(match.source)}
                failed={state?.phase === 'error'}
                onAnswer={(given) => answer(match, given)}
              />
            );
          })}
          {open.length === 0 && <Settled />}
        </div>
      )}
    </main>
  );
}

function KindFilter({
  matches,
  value,
  onChange,
}: {
  matches: ImportMatch[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const kinds = [...new Set(matches.map((match) => match.kind))];
  return (
    <FilterCell
      label={t('profile.import.matches.filterKind')}
      value={value}
      onChange={onChange}
      items={[
        { value: 'all', label: t('profile.import.matches.allKinds') },
        ...kinds.map((kind) => ({ value: kind, label: labels.kind(kind) })),
      ]}
    />
  );
}

function Settled() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-white/20 bg-white/3 px-8 py-[52px] text-center">
      <div className="font-display text-[40px] leading-none uppercase">
        {t('profile.import.matches.settled')}
      </div>
      <div className="text-[15px] text-muted">{t('profile.import.matches.settledCopy')}</div>
      <Link
        to="/history"
        className="mt-2.5 font-label text-xs font-bold tracking-[0.08em] text-[#e58cc4] hover:text-fg"
      >
        {t('profile.import.matches.openHistory')}
      </Link>
    </div>
  );
}

function DoneRow({
  state,
  onUndo,
}: {
  state: Exclude<RowState, { phase: 'error' }>;
  onUndo: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const skipped = state.answer.action === 'skip';
  const label = skipped
    ? t('profile.import.matches.skipped')
    : state.phase === 'done' && state.merged
      ? t('profile.import.matches.merged')
      : t('profile.import.matches.logged');
  return (
    <div
      aria-live="polite"
      className="flex min-h-14 flex-wrap items-center gap-3 rounded-[14px] bg-white/3 py-2 pr-3 pl-[22px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
    >
      <span
        aria-hidden
        className={clsx(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#14101a]',
          skipped ? 'bg-dim' : 'bg-kind-game',
        )}
      >
        {skipped ? '–' : '✓'}
      </span>
      {state.answer.action === 'pick' && (
        <span className="text-[15px] font-semibold">{state.answer.title}</span>
      )}
      <span className="font-label text-[10px] font-bold tracking-[0.08em] text-dim">
        {state.answer.action === 'pick' ? `· ${label}` : label}
      </span>
      <span className="flex-1" />
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="h-9 px-2.5 font-label text-[11px] font-bold tracking-[0.08em] text-[#e58cc4] hover:text-fg"
        >
          {t('profile.import.matches.undo')}
        </button>
      )}
    </div>
  );
}

function MatchRow({
  match,
  sourceName,
  failed,
  onAnswer,
}: {
  match: ImportMatch;
  sourceName: string;
  failed: boolean;
  onAnswer: (answer: Answer) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const [searching, setSearching] = useState(false);
  const brand = sourceBrand(match.source);

  const extra = [
    match.seasonNumber !== null && match.kind !== 'movie'
      ? t('profile.import.matches.season', { n: match.seasonNumber })
      : null,
    match.year !== null ? String(match.year) : null,
  ].filter(Boolean);

  const parts =
    match.progress > 0 && match.status !== 'completed'
      ? t(
          match.kind === 'manga' || match.kind === 'webtoon'
            ? 'profile.import.matches.chapters'
            : 'profile.import.matches.episodes',
          { count: match.progress },
        )
      : null;
  const would = [
    STATUS_KEYS.has(match.status as LogStatus)
      ? labels.status(match.status as LogStatus).toUpperCase()
      : match.status.toUpperCase(),
    parts,
    datedRange(match.startedAt, match.finishedAt, format.locale),
  ]
    .filter(Boolean)
    .join(' · ');

  const reason =
    match.outcome === 'tie'
      ? t('profile.import.matches.tie', { count: match.candidates.length })
      : t('profile.import.matches.close', { percent: Math.round(match.bestScore * 100) });

  return (
    <article
      aria-label={match.title}
      className="flex flex-wrap gap-x-[26px] gap-y-5 rounded-[18px] bg-white/5 p-[22px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] backdrop-blur-[16px]"
    >
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2.5">
        <div className="flex items-center gap-2">
          {brand && <BrandTile brand={brand} className="size-[22px] rounded-md" />}
          <span className="font-label text-[10px] font-bold tracking-[0.1em] text-dim">
            {t('profile.import.matches.wrote', { source: sourceName.toUpperCase() })}
          </span>
        </div>
        <div className="text-[21px] leading-[1.2] font-bold text-pretty">{match.title}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-label text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
          <span aria-hidden className={clsx('size-[7px] rounded-full', kindDotClass[match.kind])} />
          <span>{labels.kindSingular(match.kind)}</span>
          {extra.length > 0 && (
            <span className="font-semibold text-dim">· {extra.join(' · ')}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-col gap-1">
          <span className="font-label text-[10px] font-bold tracking-[0.1em] text-dim">
            {t('profile.import.matches.wouldLog')}
          </span>
          <span className="font-label text-xs font-bold tracking-[0.06em] uppercase">{would}</span>
        </div>
        <span className="mt-1 inline-flex h-[26px] items-center self-start rounded-[7px] bg-white/6 px-2.5 font-label text-[10px] font-bold tracking-[0.08em] text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]">
          {reason}
        </span>
        {failed && (
          <p role="alert" className="m-0 text-sm text-red-400">
            {t('profile.import.matches.saveError')}
          </p>
        )}
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3.5">
          <button
            type="button"
            aria-expanded={searching}
            onClick={() => setSearching((value) => !value)}
            className={clsx(
              'h-9 px-1 font-label text-[11px] font-bold tracking-[0.08em] hover:text-fg',
              searching ? 'text-[#e58cc4]' : 'text-[#cfc9d8]',
            )}
          >
            {t('profile.import.matches.none')}
          </button>
          <button
            type="button"
            onClick={() => onAnswer({ action: 'skip' })}
            className="h-9 px-1 font-label text-[11px] font-bold tracking-[0.08em] text-dim hover:text-fg"
          >
            {t('profile.import.matches.skip')}
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-3">
        {searching ? (
          <CatalogSearch
            initial={match.title}
            onCancel={() => setSearching(false)}
            onPick={(mediaId, title) => onAnswer({ action: 'pick', mediaId, title })}
          />
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {match.candidates.map((candidate) => (
              <li key={candidate.id}>
                <CandidateTile
                  candidate={candidate}
                  fallbackKind={match.kind}
                  onPick={() =>
                    onAnswer({
                      action: 'pick',
                      mediaId: candidate.id,
                      title: candidateTitle(candidate),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/**
 * `22 DEC 24`, `05 JUN 19 → 02 JUL 19`: unlike History, nothing here groups by
 * year, and an import reaches back years.
 */
function datedRange(startedAt: string | null, finishedAt: string | null, locale: string) {
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\./g, '')
      .toLocaleUpperCase(locale);
  if (!startedAt && !finishedAt) return null;
  if (!startedAt || !finishedAt || startedAt === finishedAt) return day((startedAt ?? finishedAt)!);
  return `${day(startedAt)} → ${day(finishedAt)}`;
}

function candidateTitle(candidate: ImportMatchCandidate): string {
  return candidate.year !== null ? `${candidate.title} (${candidate.year})` : candidate.title;
}

function CandidateTile({
  candidate,
  fallbackKind,
  onPick,
}: {
  candidate: ImportMatchCandidate;
  fallbackKind: MediaKind;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const kind = candidate.kind ?? fallbackKind;
  const percent = Math.round(candidate.score * 100);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={t('profile.import.matches.candidate', {
        title: candidate.title,
        year: candidate.year ?? '—',
        percent,
      })}
      className="group -m-2 flex w-[118px] flex-col gap-[7px] rounded-[14px] p-2 text-left transition-[background,box-shadow] duration-140 hover:bg-pink/10 hover:shadow-[inset_0_0_0_1px_rgb(217_107_176/0.6)] focus-visible:bg-pink/10 focus-visible:shadow-[inset_0_0_0_1px_rgb(217_107_176/0.6)] focus-visible:outline-none motion-reduce:transition-none"
    >
      <span
        className="relative block aspect-[2/3] rounded-[9px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_10px_24px_-14px_rgb(0_0_0/0.9)] transition-transform duration-160 group-hover:-translate-y-[3px] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        style={
          candidate.coverUrl
            ? { backgroundImage: `url(${candidate.coverUrl})` }
            : { background: coverGradient(kind, candidate.title) }
        }
      >
        {candidate.inLog && (
          <span className="absolute inset-x-1.5 top-1.5 flex justify-center rounded-md bg-[#14101a] px-1.5 py-1 font-label text-[8px] font-bold tracking-[0.1em] whitespace-nowrap text-[#6fdcb2] shadow-[inset_0_0_0_1px_rgb(63_191_143/0.6)]">
            ✓ {t('profile.import.matches.inLog')}
          </span>
        )}
      </span>
      <span className="flex items-baseline justify-between gap-1.5">
        <span className="font-display text-xl leading-none">{candidate.year ?? '—'}</span>
        <span
          className={clsx(
            'font-label text-[11px] font-bold',
            percent >= 100 ? 'text-muted' : percent >= 70 ? 'text-[#e58cc4]' : 'text-dim',
          )}
        >
          {percent}%
        </span>
      </span>
      <span className="line-clamp-2 text-[13px] leading-[1.25] font-semibold">
        {candidate.title}
      </span>
      <span className="flex items-center gap-[5px] font-label text-[9px] font-bold tracking-[0.08em] text-muted uppercase">
        <span aria-hidden className={clsx('size-1.5 rounded-full', kindDotClass[kind])} />
        {labels.kindSingular(kind)}
        {candidate.seasonNumber !== null && kind !== 'movie' && ` · S${candidate.seasonNumber}`}
      </span>
      <span aria-hidden className="h-[3px] overflow-hidden rounded-full bg-white/8">
        <span
          className="block h-full rounded-full bg-[linear-gradient(90deg,#d9a441,#d96bb0,#8b5cf6)]"
          style={{ width: `${percent}%` }}
        />
      </span>
    </button>
  );
}

/** "None of these": the instance's own search, right in the row. */
function CatalogSearch({
  initial,
  onCancel,
  onPick,
}: {
  initial: string;
  onCancel: () => void;
  onPick: (mediaId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [query, setQuery] = useState(initial);
  const debounced = useDebounced(query, 300);
  const search = useMediaSearch(debounced);
  const results = search.results.slice(0, 6);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-[46px] items-center gap-2.5 rounded-xl bg-white/6 px-3.5 shadow-[inset_0_0_0_1px_var(--color-pink),0_0_0_4px_rgb(217_107_176/0.14)]">
        <span aria-hidden className="text-[17px] text-dim">
          ⌕
        </span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('profile.import.matches.searchPlaceholder')}
          aria-label={t('profile.import.matches.searchPlaceholder')}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-fg outline-none"
        />
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-1 font-label text-[11px] font-bold tracking-[0.08em] text-[#cfc9d8] hover:text-fg"
        >
          {t('profile.import.matches.cancel')}
        </button>
      </label>
      {search.status === 'success' && results.length === 0 && !search.isPlaceholder && (
        <p className="m-0 px-2.5 text-sm text-muted">
          {t('profile.import.matches.noResult', { query: debounced })}
        </p>
      )}
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          onClick={() =>
            onPick(result.id, result.year ? `${result.title} (${result.year})` : result.title)
          }
          className="flex min-h-14 items-center gap-3 rounded-xl px-2.5 py-1.5 text-left hover:bg-pink/10 hover:shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)]"
        >
          <span
            aria-hidden
            className="h-[54px] w-9 shrink-0 rounded-md bg-cover bg-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]"
            style={
              result.coverUrl
                ? { backgroundImage: `url(${result.coverUrl})` }
                : { background: coverGradient(result.kind, result.title) }
            }
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[15px] font-semibold">{result.title}</span>
            <span className="flex items-center gap-[5px] font-label text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
              <span
                aria-hidden
                className={clsx('size-1.5 rounded-full', kindDotClass[result.kind])}
              />
              {labels.kindSingular(result.kind)}
              {result.year !== null && ` · ${result.year}`}
              {result.seasonNumber !== null &&
                result.kind !== 'movie' &&
                ` · S${result.seasonNumber}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
