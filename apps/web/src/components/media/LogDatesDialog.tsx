import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOG_DATE_FLOOR, type LogDates } from '@trackt/shared';
import { todayIso, validateLogDates } from '@trackt/client';
import { Button } from '../ui/Button';
import { Modal, ModalTitle } from '../ui/Modal';

/**
 * Edit the log's start/finish dates (ADR-0007). The dates are stamped
 * automatically by status changes and check-ins; this is the "we recorded a
 * date, fix it if it's wrong" affordance, and the only way to record when you
 * actually watched something you are logging after the fact.
 *
 * The checks are `@trackt/client`'s `validateLogDates`: both clients have a
 * date form now, and the two must not disagree about what the server will
 * take.
 */
export interface LogDatesDialogProps {
  dates: LogDates;
  /** Shown above the fields, so the dialog says which title it is editing. */
  mediaTitle: string;
  /** Saving is the caller's job: it owns the optimistic cache patch. */
  onSave: (dates: LogDates) => Promise<void>;
  onClose: () => void;
}

export function LogDatesDialog({ dates, mediaTitle, onSave, onClose }: LogDatesDialogProps) {
  const { t } = useTranslation();
  const [startedAt, setStartedAt] = useState(dates.startedAt ?? '');
  const [finishedAt, setFinishedAt] = useState(dates.finishedAt ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * `validateLogDates` answers in display copy because mobile renders it as-is;
   * web owns its words, so the three problems map back onto catalog keys. A
   * fourth problem would rather show its English than the wrong translation.
   */
  const problemText = (problem: string) => {
    if (problem.startsWith('Dates start at')) {
      return t('media.dates.floor', { date: LOG_DATE_FLOOR });
    }
    if (problem === 'Dates can’t be in the future.') return t('media.dates.future');
    if (problem === 'The finish date is before the start date.') return t('media.dates.order');
    return problem;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: LogDates = { startedAt: startedAt || null, finishedAt: finishedAt || null };
    const problem = validateLogDates(next, todayIso());
    if (problem) {
      setError(problemText(problem));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch {
      setError(t('media.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <ModalTitle>{t('media.dates.title')}</ModalTitle>
          <p className="text-sm text-muted">{mediaTitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateField label={t('media.dates.started')} value={startedAt} onChange={setStartedAt} />
          <DateField
            label={t('media.dates.finished')}
            value={finishedAt}
            onChange={setFinishedAt}
          />
        </div>
        <p className="text-[13px] text-dim">{t('media.dates.help')}</p>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStartedAt('');
              setFinishedAt('');
              setError(null);
            }}
          >
            {t('media.dates.clear')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A native date input in the news feed's FROM/TO pill treatment.
 * `[color-scheme:dark]` is load-bearing: without it the browser paints a white
 * picker panel on the ink background.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-glass-border-strong bg-glass px-3.5 py-2">
      <span className="font-label text-[10px] font-bold tracking-label text-dim">{label}</span>
      <input
        type="date"
        value={value}
        max={todayIso()}
        min={LOG_DATE_FLOOR}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent font-label text-xs text-fg [color-scheme:dark] outline-none"
      />
    </label>
  );
}
