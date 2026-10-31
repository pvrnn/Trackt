import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  importJobPhase,
  importProgressPercent,
  useImportJob,
  useImportSources,
  useStartImport,
  type ImportJobStatus,
  type ImportSourceStatus,
} from '@trackt/client';
import { useLabels } from '../../lib/labels';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';

/**
 * The import wizard (PRD §6): choose a source, preview what it would write, then
 * let it write. The preview is a real dry-run job on the `importer` queue, so
 * the counts come from the same pipeline the import runs rather than from a
 * second estimate that could disagree with it.
 *
 * Nothing here offers `overwrite`: a wizard should not be able to replace what
 * the viewer already logged, and the CLI remains the advanced path for that.
 */

/** i18n key per source id; the API's ids are strings, so an unknown one falls back. */
const PLACEHOLDER_KEY = {
  mal: 'profile.import.choose.placeholder.mal',
  anilist: 'profile.import.choose.placeholder.anilist',
  letterboxd: 'profile.import.choose.placeholder.letterboxd',
  trakt: 'profile.import.choose.placeholder.trakt',
} as const;
type PlaceholderKey =
  | (typeof PLACEHOLDER_KEY)[keyof typeof PLACEHOLDER_KEY]
  | 'profile.import.choose.placeholder.other';
const PLACEHOLDER_BY_ID: Partial<Record<string, PlaceholderKey>> = PLACEHOLDER_KEY;

function placeholderKey(id: string): PlaceholderKey {
  return PLACEHOLDER_BY_ID[id] ?? 'profile.import.choose.placeholder.other';
}

/** `ImportError.kind` → why it happened, in words a viewer can act on. */
const ERROR_KIND_KEY = {
  credential: 'profile.import.errorKind.credential',
  'not-found': 'profile.import.errorKind.notFound',
  private: 'profile.import.errorKind.private',
  auth: 'profile.import.errorKind.auth',
  http: 'profile.import.errorKind.http',
  malformed: 'profile.import.errorKind.malformed',
  browser: 'profile.import.errorKind.browser',
} as const;
type ErrorKindKey =
  (typeof ERROR_KIND_KEY)[keyof typeof ERROR_KIND_KEY] | 'profile.import.errorKind.other';
const ERROR_KIND_BY_ID: Partial<Record<string, ErrorKindKey>> = ERROR_KIND_KEY;

function errorKindKey(kind: string | null): ErrorKindKey {
  return (kind !== null ? ERROR_KIND_BY_ID[kind] : undefined) ?? 'profile.import.errorKind.other';
}

/** How many unmatched titles a preview names before it stops listing them. */
const UNMATCHED_SHOWN = 10;

type Step = 'choose' | 'preview' | 'running';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sources = useImportSources();
  const startImport = useStartImport();
  const [step, setStep] = useState<Step>('choose');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [profile, setProfile] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const job = useImportJob(jobId, attempt);

  const selected = sources.data?.sources.find((source) => source.id === sourceId) ?? null;
  const trimmed = profile.trim();
  const canStart = selected !== null && selected.available && trimmed.length > 0;

  /** A finished real run wrote logs: every screen that counts them is now stale. */
  const runCompleted = step === 'running' && job.data?.state === 'completed';
  useEffect(() => {
    if (!runCompleted) return;
    for (const queryKey of [['profile'], ['history'], ['home']]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [runCompleted, queryClient]);

  const launch = (dryRun: boolean) => {
    if (!selected || !trimmed) return;
    setStartError(null);
    startImport.mutate(
      dryRun
        ? { source: selected.id, profile: trimmed, dryRun: true }
        : { source: selected.id, profile: trimmed, overwrite: false },
      {
        onSuccess: (queued) => {
          // The attempt moves with the new job, never before it: a key change
          // while the old job is still the answer would poll that answer again.
          setAttempt((current) => current + 1);
          setJobId(queued.jobId);
          setStep(dryRun ? 'preview' : 'running');
        },
        onError: (error) => setStartError(error.message),
      },
    );
  };

  /** Back to the source list. The preview was a dry run, so nothing was written. */
  const back = () => {
    setJobId(null);
    setStartError(null);
    setStep('choose');
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-5">
        <ModalTitle>{t('profile.import.title')}</ModalTitle>

        {step === 'choose' && (
          <ChooseStep
            sources={sources}
            sourceId={sourceId}
            onSelect={(id) => {
              setSourceId(id);
              setProfile('');
            }}
            profile={profile}
            onProfile={setProfile}
            selected={selected}
            canStart={canStart}
            starting={startImport.isPending}
            error={startError}
            onPreview={() => launch(true)}
            onClose={onClose}
          />
        )}

        {step === 'preview' && (
          <PreviewStep
            status={job.data}
            loadError={job.isError ? job.error.message : null}
            sourceLabel={selected?.label ?? t('profile.import.sources.unknown')}
            starting={startImport.isPending}
            error={startError}
            onBack={back}
            onImport={() => launch(false)}
            onRetry={() => launch(true)}
            onClose={onClose}
          />
        )}

        {step === 'running' && (
          <RunningStep
            status={job.data}
            loadError={job.isError ? job.error.message : null}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

function ChooseStep({
  sources,
  sourceId,
  onSelect,
  profile,
  onProfile,
  selected,
  canStart,
  starting,
  error,
  onPreview,
  onClose,
}: {
  sources: ReturnType<typeof useImportSources>;
  sourceId: string | null;
  onSelect: (id: string) => void;
  profile: string;
  onProfile: (value: string) => void;
  selected: ImportSourceStatus | null;
  canStart: boolean;
  starting: boolean;
  error: string | null;
  onPreview: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const listed = sources.data?.sources ?? null;

  return (
    <>
      <p className="text-sm leading-relaxed text-muted">{t('profile.import.intro')}</p>

      {sources.isPending ? (
        <p aria-busy className="text-[15px] text-muted">
          {t('profile.import.sources.loading')}
        </p>
      ) : sources.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-[15px] text-red-400">
            {t('profile.import.sources.error')}
          </p>
          <Button variant="secondary" onClick={() => void sources.refetch()}>
            {t('profile.import.retry')}
          </Button>
        </div>
      ) : listed === null || listed.length === 0 ? (
        <p className="text-[15px] text-muted">{t('profile.import.sources.empty')}</p>
      ) : (
        <>
          <h3 className="font-heading text-[20px] uppercase">{t('profile.import.choose.pick')}</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {listed.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                selected={source.id === sourceId}
                onSelect={() => onSelect(source.id)}
              />
            ))}
          </div>

          <Input
            label={t('profile.import.choose.field')}
            name="importProfile"
            value={profile}
            disabled={!selected}
            autoComplete="off"
            placeholder={
              selected ? t(placeholderKey(selected.id)) : t('profile.import.choose.fieldIdle')
            }
            className="disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => onProfile(event.target.value)}
          />
          <p className="-mt-2 text-xs leading-relaxed text-faint">
            {t('profile.import.choose.fieldHint')}
          </p>
        </>
      )}

      {error && <StartError message={error} />}

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        {listed !== null && listed.length > 0 && (
          <Button disabled={!canStart || starting} onClick={onPreview}>
            {starting ? t('profile.import.choose.starting') : t('profile.import.choose.preview')}
          </Button>
        )}
      </div>
    </>
  );
}

function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: ImportSourceStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const labels = useLabels();
  const unavailable = !source.available;

  return (
    <button
      type="button"
      disabled={unavailable}
      aria-pressed={unavailable ? undefined : selected}
      onClick={onSelect}
      className={clsx(
        'flex flex-col gap-1 rounded-card-sm border px-4 py-3 text-left transition',
        unavailable
          ? 'cursor-not-allowed border-white/8 bg-white/3 opacity-55'
          : 'cursor-pointer border-glass-border bg-glass hover:border-pink',
        selected && 'border-pink bg-white/8',
      )}
    >
      <span className="text-[15px] font-bold text-fg">{source.label}</span>
      <span className="text-xs leading-relaxed text-dim">
        {/* An unavailable source's only line is why: its kinds are moot. */}
        {unavailable
          ? source.reason
          : source.kinds.map((kind) => labels.kindSingular(kind)).join(' · ')}
      </span>
    </button>
  );
}

function PreviewStep({
  status,
  loadError,
  sourceLabel,
  starting,
  error,
  onBack,
  onImport,
  onRetry,
  onClose,
}: {
  status: ImportJobStatus | undefined;
  loadError: string | null;
  sourceLabel: string;
  starting: boolean;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phase = status ? importJobPhase(status.state) : 'queued';
  const result = status?.result ?? null;
  const plan = result?.plan ?? null;

  let body;
  if (loadError) {
    body = <PollError message={loadError} />;
  } else if (phase === 'failed') {
    body = <FailureBlock status={status} />;
  } else if (phase === 'unknown') {
    body = (
      <p role="alert" className="text-[15px] text-muted">
        {t('profile.import.unknownJob')}
      </p>
    );
  } else if (phase === 'done' && !plan) {
    body = (
      <p role="alert" className="text-[15px] text-muted">
        {t('profile.import.preview.unreadable')}
      </p>
    );
  } else if (phase === 'done' && plan && result) {
    body = <PreviewResult plan={plan} unmatched={result.unmatched} sourceLabel={sourceLabel} />;
  } else {
    body = (
      <div className="flex flex-col gap-3" aria-busy>
        <p className="text-[15px] text-muted">
          {phase === 'queued'
            ? t('profile.import.queued')
            : t('profile.import.preview.reading', { source: sourceLabel })}
        </p>
        <ProgressBar percent={null} />
      </div>
    );
  }

  return (
    <>
      {body}

      {error && <StartError message={error} />}

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t('profile.import.back')}
        </Button>
        {phase === 'done' && plan ? (
          <Button disabled={plan.pending === 0 || starting} onClick={onImport}>
            {starting ? t('profile.import.choose.starting') : t('profile.import.preview.importNow')}
          </Button>
        ) : phase === 'failed' ? (
          <Button disabled={starting} onClick={onRetry}>
            {starting ? t('profile.import.choose.starting') : t('profile.import.retry')}
          </Button>
        ) : phase === 'unknown' ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : null}
      </div>
    </>
  );
}

function PreviewResult({
  plan,
  unmatched,
  sourceLabel,
}: {
  plan: NonNullable<ImportJobStatus['result']>['plan'];
  unmatched: NonNullable<ImportJobStatus['result']>['unmatched'];
  sourceLabel: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-heading text-[20px] uppercase">
          {t('profile.import.preview.resultTitle')}
        </h3>
        <p className="text-sm text-muted">
          {t('profile.import.preview.forProfile', {
            source: sourceLabel,
            profile: plan.profile,
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Count label={t('profile.import.preview.total')} value={plan.total} />
        <Count label={t('profile.import.preview.matched')} value={plan.matched} />
        <Count label={t('profile.import.preview.unmatched')} value={plan.unmatched} />
        <Count label={t('profile.import.preview.existing')} value={plan.existing} />
        <Count label={t('profile.import.preview.pending')} value={plan.pending} />
        <Count label={t('profile.import.preview.warnings')} value={plan.warnings} />
      </div>

      {plan.matchedByTitle > 0 && (
        <p className="text-xs text-dim">
          {t('profile.import.preview.matchedByTitle', { n: plan.matchedByTitle })}
        </p>
      )}

      {unmatched.entries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="font-label text-xs tracking-label text-dim uppercase">
            {t('profile.import.preview.unmatchedTitle')}
          </h4>
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {unmatched.entries.slice(0, UNMATCHED_SHOWN).map((entry) => (
              <li key={entry.externalId} className="truncate">
                {entry.title}
              </li>
            ))}
          </ul>
          {plan.unmatched > UNMATCHED_SHOWN && (
            <p className="text-xs text-faint">
              {t('profile.import.preview.more', { n: plan.unmatched - UNMATCHED_SHOWN })}
            </p>
          )}
        </div>
      )}

      {plan.pending === 0 && (
        <p className="text-sm text-muted">{t('profile.import.preview.nothing')}</p>
      )}
    </div>
  );
}

function RunningStep({
  status,
  loadError,
  onClose,
}: {
  status: ImportJobStatus | undefined;
  loadError: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phase = status ? importJobPhase(status.state) : 'queued';
  const report = status?.result?.report ?? null;
  const percent = status ? importProgressPercent(status.progress) : null;
  const finished = phase === 'done' || phase === 'failed' || phase === 'unknown';

  let body;
  if (loadError) {
    body = <PollError message={loadError} />;
  } else if (phase === 'failed') {
    body = <FailureBlock status={status} />;
  } else if (phase === 'unknown') {
    body = (
      <p role="alert" className="text-[15px] text-muted">
        {t('profile.import.unknownJob')}
      </p>
    );
  } else if (phase === 'done') {
    body = (
      <div className="flex flex-col gap-4">
        <h3 className="font-heading text-[20px] uppercase">{t('profile.import.run.doneTitle')}</h3>
        {report ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Count label={t('profile.import.run.created')} value={report.created} />
              <Count label={t('profile.import.run.updated')} value={report.updated} />
              <Count label={t('profile.import.run.skipped')} value={report.skippedExisting} />
              <Count label={t('profile.import.run.withProgress')} value={report.withProgress} />
              <Count label={t('profile.import.run.ratings')} value={report.ratings} />
            </div>
            {report.warnings.length > 0 && (
              <p className="text-xs text-dim">
                {t('profile.import.run.warnings', { n: report.warnings.length })}
              </p>
            )}
          </>
        ) : (
          <p role="alert" className="text-[15px] text-muted">
            {t('profile.import.run.unreadable')}
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3" aria-busy>
        <p className="text-[15px] text-muted">
          {phase === 'queued' ? t('profile.import.queued') : t('profile.import.run.running')}
        </p>
        <ProgressBar percent={percent} />
        {status && percent !== null && (
          <p className="text-xs text-dim">
            {t('profile.import.run.progress', {
              done: status.progress.done,
              total: status.progress.total,
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      {body}
      <div className="flex justify-end gap-3">
        <Button variant={finished ? 'primary' : 'ghost'} onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <GlassCard className="flex flex-col gap-0.5 rounded-card-sm px-3 py-2">
      <span className="font-heading text-2xl leading-none">{value}</span>
      <span className="font-label text-[10px] tracking-label text-dim uppercase">{label}</span>
    </GlassCard>
  );
}

/**
 * Determinate when the job reported a total, a pulsing third when it has not.
 * The bar is never given a number nobody reported: `done / 0` is not 0%.
 */
function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      {...(percent === null
        ? {}
        : {
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent,
          })}
    >
      <div
        className={clsx('h-full rounded-full bg-prism', percent === null && 'w-1/3 animate-pulse')}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

function FailureBlock({ status }: { status: ImportJobStatus | undefined }) {
  const { t } = useTranslation();
  const kind = status?.errorKind ?? null;
  return (
    <div className="flex flex-col gap-2" role="alert">
      <h3 className="font-heading text-[20px] text-red-400 uppercase">
        {t('profile.import.failed.title')}
      </h3>
      <p className="text-[15px] text-fg">{t(errorKindKey(kind))}</p>
      {status?.failedReason && <p className="text-xs text-dim">{status.failedReason}</p>}
    </div>
  );
}

function PollError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1" role="alert">
      <p className="text-[15px] text-red-400">{t('profile.import.errors.poll')}</p>
      <p className="text-xs text-dim">{message}</p>
    </div>
  );
}

function StartError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1" role="alert">
      <p className="text-sm text-red-400">{t('profile.import.errors.start')}</p>
      <p className="text-xs text-dim">{message}</p>
    </div>
  );
}
