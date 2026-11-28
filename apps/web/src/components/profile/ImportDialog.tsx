import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  importJobPhase,
  importMatchesKey,
  importProgressPercent,
  useImportJob,
  useImportSources,
  useStartImport,
  type ImportFileInput,
  type ImportJobStatus,
  type ImportSourceStatus,
} from '@trackt/client';
import { useLabels } from '../../lib/labels';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';
import { PrismProgress } from '../ui/PrismProgress';
import { Bone, SkeletonRegion } from '../ui/Skeleton';
import { BrandTile, sourceBrand } from '../ui/BrandLogo';
import { kindDotClass } from '../ui/KindDot';

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
  steam: 'profile.import.choose.placeholder.steam',
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

export function errorKindKey(kind: string | null): ErrorKindKey {
  return (kind !== null ? ERROR_KIND_BY_ID[kind] : undefined) ?? 'profile.import.errorKind.other';
}

const STEP_NUMBER: Record<Step, number> = { choose: 1, preview: 2, running: 3 };
const STEP_NAME = {
  choose: 'profile.import.steps.choose',
  preview: 'profile.import.steps.preview',
  running: 'profile.import.steps.import',
} as const satisfies Record<Step, string>;

/** How many unmatched titles a preview names before it stops listing them. */
const UNMATCHED_SHOWN = 10;

type Step = 'choose' | 'preview' | 'running';

export function ImportDialog({
  initialSource = null,
  onClose,
}: {
  /** Opens on this source's input, as RETRY on the profile's import card does. */
  initialSource?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sources = useImportSources();
  const startImport = useStartImport();
  const [step, setStep] = useState<Step>('choose');
  const [sourceId, setSourceId] = useState<string | null>(initialSource);
  const [profile, setProfile] = useState('');
  const [files, setFiles] = useState<ImportFileInput[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const job = useImportJob(jobId, attempt);

  const selected = sources.data?.sources.find((source) => source.id === sourceId) ?? null;
  const trimmed = profile.trim();
  const isFile = selected?.access === 'file';
  const canStart =
    selected !== null && selected.available && (isFile ? files.length > 0 : trimmed.length > 0);

  /** A finished real run wrote logs: every screen that counts them is now stale. */
  const runCompleted = step === 'running' && job.data?.state === 'completed';
  useEffect(() => {
    if (!runCompleted) return;
    for (const queryKey of [['profile'], ['history'], ['home'], importMatchesKey]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [runCompleted, queryClient]);

  const launch = (dryRun: boolean) => {
    if (!canStart) return;
    setStartError(null);
    // A file source re-sends its export for the real run: the preview job kept only its own copy.
    const input = isFile
      ? { source: selected.id, files }
      : { source: selected.id, profile: trimmed };
    startImport.mutate(dryRun ? { ...input, dryRun: true } : { ...input, overwrite: false }, {
      onSuccess: (queued) => {
        // The attempt moves with the new job, never before it: a key change
        // while the old job is still the answer would poll that answer again.
        setAttempt((current) => current + 1);
        setJobId(queued.jobId);
        setStep(dryRun ? 'preview' : 'running');
      },
      onError: (error) => setStartError(error.message),
    });
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
        <div className="flex flex-col gap-1.5">
          <span className="font-label text-[10px] font-bold tracking-[0.1em] text-dim">
            {t('profile.import.steps.of', { n: STEP_NUMBER[step] })} · {t(STEP_NAME[step])}
          </span>
          <ModalTitle>{t('profile.import.title')}</ModalTitle>
        </div>

        {step === 'choose' && (
          <ChooseStep
            sources={sources}
            sourceId={sourceId}
            onSelect={(id) => {
              setSourceId(id);
              setProfile('');
              setFiles([]);
            }}
            profile={profile}
            onProfile={setProfile}
            files={files}
            onFiles={setFiles}
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
            isFile={isFile}
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
            onResolve={onClose}
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
  files,
  onFiles,
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
  files: ImportFileInput[];
  onFiles: (files: ImportFileInput[]) => void;
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
        <SkeletonRegion label={t('profile.import.sources.loading')} className="flex flex-col gap-3">
          <Bone className="h-5 w-40" />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Bone key={index} className="h-[72px] rounded-card-sm" />
            ))}
          </div>
        </SkeletonRegion>
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

          {selected?.access === 'file' ? (
            <FilePicker sourceId={selected.id} files={files} onFiles={onFiles} />
          ) : (
            <>
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

/** Where each file source's export comes from, and what the picker offers. */
const FILE_SOURCES = {
  tvtime: {
    steps: [
      'profile.import.choose.file.steps.tvtime.one',
      'profile.import.choose.file.steps.tvtime.two',
      'profile.import.choose.file.steps.tvtime.three',
    ],
    fileName: 'profile.import.choose.file.fileName.tvtime',
    href: undefined,
    accept: '.json,.html,.htm,application/json,text/html',
  },
  netflix: {
    steps: [
      'profile.import.choose.file.steps.netflix.one',
      'profile.import.choose.file.steps.netflix.two',
      'profile.import.choose.file.steps.netflix.three',
    ],
    fileName: 'profile.import.choose.file.fileName.netflix',
    href: 'https://www.netflix.com/settings/viewed',
    accept: '.csv,text/csv',
  },
} as const;

function fileSource(id: string) {
  return id in FILE_SOURCES ? FILE_SOURCES[id as keyof typeof FILE_SOURCES] : null;
}

/** An export read as text in the browser; the API reduces it to what the import needs. */
function FilePicker({
  sourceId,
  files,
  onFiles,
}: {
  sourceId: string;
  files: ImportFileInput[];
  onFiles: (files: ImportFileInput[]) => void;
}) {
  const definition = fileSource(sourceId);
  const { t } = useTranslation();
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const read = async (chosen: File[]) => {
    setReadError(null);
    const read: ImportFileInput[] = [];
    for (const file of chosen) {
      try {
        read.push({ name: file.name, content: await file.text() });
      } catch {
        setReadError(t('profile.import.choose.file.readError', { name: file.name }));
        onFiles([]);
        return;
      }
    }
    onFiles(read);
  };

  return (
    <div className="flex flex-col gap-3">
      {definition && (
        <div className="flex flex-col gap-2.5">
          <span className="font-label text-[10px] font-bold tracking-[0.1em] text-dim">
            {t('profile.import.choose.file.how')}
          </span>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {definition.steps.map((key, index) => (
              <li key={key} className="flex items-baseline gap-3 text-sm leading-normal text-muted">
                <span
                  aria-hidden
                  className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-white/8 font-label text-[11px] font-bold text-fg"
                >
                  {index + 1}
                </span>
                <span>
                  <Trans
                    i18nKey={key}
                    components={{
                      // Not `link`: Trans parses its tags as HTML, where <link> is void and drops its text.
                      site: (
                        <a
                          href={definition.href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-fg underline underline-offset-3 hover:text-pink"
                        />
                      ),
                      b: <strong className="font-semibold text-fg" />,
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {files.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {files.map((file) => (
            <li
              key={file.name}
              className="flex items-center gap-3 rounded-xl bg-white/6 px-3.5 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{file.name}</span>
              <span className="font-label text-[11px] font-semibold text-dim">
                {formatBytes(file.content.length)}
              </span>
              <button
                type="button"
                aria-label={t('profile.import.choose.file.remove', { name: file.name })}
                onClick={() => onFiles(files.filter((other) => other !== file))}
                className="px-1 text-dim hover:text-fg"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void read([...event.dataTransfer.files]);
          }}
          className={clsx(
            'flex flex-col items-center gap-3 rounded-[14px] border-[1.5px] border-dashed px-5 py-6 text-center transition',
            dragging ? 'border-pink bg-pink/8' : 'border-white/20 bg-white/3',
          )}
        >
          <span className="text-[15px] font-semibold">
            {t('profile.import.choose.file.drop', {
              file: definition ? t(definition.fileName) : '',
            })}
          </span>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-white/6 px-5 font-label text-xs font-bold tracking-[0.08em] text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] transition focus-within:shadow-[inset_0_0_0_1px_var(--color-pink)] hover:shadow-[inset_0_0_0_1px_var(--color-pink)]">
            {t('profile.import.choose.file.choose')}
            <input
              type="file"
              name="importFiles"
              multiple
              accept={definition?.accept}
              className="sr-only"
              onChange={(event) => void read([...(event.target.files ?? [])])}
            />
          </label>
          <span className="text-xs text-dim">{t('profile.import.choose.file.dropOr')}</span>
        </div>
      )}
      {readError && (
        <p role="alert" className="text-sm text-red-400">
          {readError}
        </p>
      )}
    </div>
  );
}

function formatBytes(chars: number): string {
  return chars < 1024 * 1024
    ? `${Math.max(1, Math.round(chars / 1024))} KB`
    : `${(chars / (1024 * 1024)).toFixed(1)} MB`;
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
  const brand = sourceBrand(source.id);

  return (
    <button
      type="button"
      disabled={unavailable}
      aria-pressed={unavailable ? undefined : selected}
      onClick={onSelect}
      className={clsx(
        'flex flex-col gap-2 rounded-card-sm border px-4 py-3 text-left transition',
        unavailable
          ? 'cursor-not-allowed border-white/8 bg-white/3 opacity-55'
          : 'cursor-pointer border-glass-border bg-glass hover:border-pink',
        selected && 'border-pink bg-white/8',
      )}
    >
      <span className="flex items-center gap-2.5">
        {brand && <BrandTile brand={brand} className="size-7 rounded-lg" />}
        <span className="text-[15px] font-bold text-fg">{source.label}</span>
      </span>
      {/* An unavailable source's only line is why: its kinds are moot. */}
      {unavailable ? (
        <span className="text-xs leading-relaxed text-dim">{source.reason}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-label text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
          {source.kinds.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={clsx('size-1.5 rounded-full', kindDotClass[kind])} />
              {labels.kindSingular(kind)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function PreviewStep({
  status,
  loadError,
  sourceLabel,
  isFile,
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
  isFile: boolean;
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
            : isFile
              ? t('profile.import.preview.readingFile', { source: sourceLabel })
              : t('profile.import.preview.reading', { source: sourceLabel })}
        </p>
        <PrismProgress percent={null} label={t('profile.import.steps.preview')} />
        {phase !== 'queued' && (
          <p className="text-xs leading-relaxed text-dim">
            {t('profile.import.preview.readingNote')}
          </p>
        )}
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
        <Count label={t('profile.import.preview.needYou')} value={plan.uncertain} />
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
  onResolve,
  onClose,
}: {
  status: ImportJobStatus | undefined;
  loadError: string | null;
  /** Following the NEED YOU link leaves the dialog behind. */
  onResolve: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phase = status ? importJobPhase(status.state) : 'queued';
  const report = status?.result?.report ?? null;
  const waiting = status?.result?.plan.uncertain ?? 0;
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
              <Count label={t('profile.import.run.merged')} value={report.merged} />
              <Count label={t('profile.import.run.skipped')} value={report.skippedExisting} />
              <Count label={t('profile.import.run.withProgress')} value={report.withProgress} />
              <Count label={t('profile.import.run.ratings')} value={report.ratings} />
            </div>
            {report.warnings.length > 0 && (
              <p className="text-xs text-dim">
                {t('profile.import.run.warnings', { n: report.warnings.length })}
              </p>
            )}
            {waiting > 0 && (
              <Link
                to="/import/matches"
                onClick={onResolve}
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
        <PrismProgress percent={percent} label={t('profile.import.steps.import')} />
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
