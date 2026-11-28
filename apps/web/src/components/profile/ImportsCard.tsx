import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  importProgressPercent,
  latestRunPerSource,
  useImportMatches,
  useImportRuns,
  useImportSources,
  type ImportRun,
} from '@trackt/client';
import { useFormat } from '../../lib/format';
import { BrandTile, sourceBrand } from '../ui/BrandLogo';
import { GlassCard } from '../ui/GlassCard';
import { PrismProgress } from '../ui/PrismProgress';
import { errorKindKey } from './ImportDialog';
import { profileCardClass, profileCardTitleClass } from './ProfileSections';

const ghostClass =
  'font-label text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-[#e58cc4] hover:text-fg';
const pillClass =
  'inline-flex h-11 cursor-pointer items-center justify-center self-start rounded-full bg-white/6 px-[22px] font-label text-xs font-bold tracking-[0.08em] text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] transition hover:shadow-[inset_0_0_0_1px_var(--color-pink)]';

/**
 * The owner's imports on their profile (docs/design/Profile.dc.html): an
 * invitation before the first one, then the latest run of each source. Titles
 * waiting for an answer are the card's one loud line.
 */
export function ImportsCard({ onImport }: { onImport: (source?: string) => void }) {
  const { t } = useTranslation();
  const runsQuery = useImportRuns();
  const matchesQuery = useImportMatches();
  const sourcesQuery = useImportSources();
  // Previews are throwaway dry runs and never reach `import_run`.
  const runs = latestRunPerSource(runsQuery.data ?? []);
  const waiting = matchesQuery.data?.length ?? 0;
  const sourceLabel = (id: string) =>
    sourcesQuery.data?.sources.find((source) => source.id === id)?.label ?? id;

  if (runsQuery.isPending) return null;

  if (runs.length === 0 && waiting === 0) {
    const brands = (sourcesQuery.data?.sources ?? [])
      .map((source) => ({ id: source.id, label: source.label, brand: sourceBrand(source.id) }))
      .filter((source) => source.brand !== null);
    return (
      <GlassCard
        as="section"
        aria-labelledby="imports-heading"
        className={clsx(profileCardClass, 'gap-4')}
      >
        <h2 id="imports-heading" className={clsx(profileCardTitleClass, 'leading-[1.05]')}>
          {t('profile.import.card.bring')}
        </h2>
        <p className="-mt-1.5 text-sm leading-normal text-pretty text-muted">
          {t('profile.import.card.bringCopy')}
        </p>
        {brands.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {brands.map((source) => (
              <li key={source.id} title={source.label}>
                <BrandTile brand={source.brand!} className="size-7 rounded-lg" />
                <span className="sr-only">{source.label}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => onImport()} className={pillClass}>
          {t('profile.import.card.import')}
        </button>
      </GlassCard>
    );
  }

  return (
    <GlassCard
      as="section"
      aria-labelledby="imports-heading"
      className={clsx(profileCardClass, 'gap-4')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="imports-heading" className={profileCardTitleClass}>
          {t('profile.import.card.title')}
        </h2>
        {runs.length > 0 && (
          <span className="font-label text-[10px] font-bold tracking-[0.1em] text-dim">
            {t('profile.import.card.sources', { count: runs.length })}
          </span>
        )}
      </div>
      {waiting > 0 && (
        <Link
          to="/import/matches"
          className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-pink/50 bg-pink/12 px-4 py-2 font-label text-[11px] font-bold tracking-[0.08em] text-fg transition hover:bg-pink/20"
        >
          <span className="font-display text-[22px] leading-none font-normal tracking-normal">
            {waiting}
          </span>
          <span>{t('profile.import.card.needs', { count: waiting })}</span>
          <span className="ml-auto whitespace-nowrap text-[#e58cc4]">
            {t('profile.import.card.resolve')}
          </span>
        </Link>
      )}
      {runs.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {runs.map((run, index) => (
            <RunRow
              key={run.id}
              run={run}
              first={index === 0}
              name={sourceLabel(run.source)}
              onRetry={() => onImport(run.source)}
            />
          ))}
        </ul>
      )}
      {waiting > 0 ? (
        <button
          type="button"
          onClick={() => onImport()}
          className={clsx(ghostClass, 'self-start py-1')}
        >
          {t('profile.import.card.importMore')}
        </button>
      ) : (
        <button type="button" onClick={() => onImport()} className={pillClass}>
          {t('profile.import.card.import')}
        </button>
      )}
    </GlassCard>
  );
}

function RunRow({
  run,
  first,
  name,
  onRetry,
}: {
  run: ImportRun;
  first: boolean;
  name: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const brand = sourceBrand(run.source);
  const live = run.state === 'queued' || run.state === 'running';
  const percent = importProgressPercent(run.progress);
  const plan = run.result?.plan;

  const result =
    run.state === 'completed' && plan
      ? t('profile.import.card.logged', { matched: plan.matched, total: plan.total })
      : null;
  const progress =
    run.state === 'queued'
      ? t('profile.import.card.queued')
      : percent === null
        ? t('profile.import.card.matching')
        : t('profile.import.card.writing', { done: run.progress.done, total: run.progress.total });

  return (
    <li
      className={clsx(
        'flex flex-col gap-2 py-3',
        !first && 'shadow-[inset_0_1px_0_var(--color-divider)]',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {brand ? (
          <BrandTile brand={brand} className="size-7 rounded-lg" />
        ) : (
          <span aria-hidden className="size-7 shrink-0 rounded-lg bg-white/10" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="truncate font-label text-[11px] font-medium text-dim">
            {run.profile}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-[3px] text-right">
          <span className="font-label text-[10px] font-bold tracking-[0.08em] text-dim uppercase">
            {format.updated(run.finishedAt ?? run.createdAt)}
          </span>
          {result && (
            <span className="font-label text-[10px] font-semibold tracking-[0.06em] text-muted">
              {result}
            </span>
          )}
        </div>
      </div>
      {live && (
        <div className="flex flex-col gap-1.5 pl-10">
          <PrismProgress percent={percent} label={progress} className="h-[3px]" />
          <span className="font-label text-[10px] font-bold tracking-[0.08em] text-[#cfc9d8]">
            {progress}
          </span>
        </div>
      )}
      {run.state === 'failed' && (
        <div className="flex items-center gap-3 pl-10">
          <span className="min-w-0 flex-1 text-xs text-gold">{t(errorKindKey(run.errorKind))}</span>
          <button type="button" onClick={onRetry} className={ghostClass}>
            {t('profile.import.card.retry')}
          </button>
        </div>
      )}
    </li>
  );
}
