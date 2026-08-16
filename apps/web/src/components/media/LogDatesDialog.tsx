import { useState, type FormEvent } from 'react';
import { LOG_DATE_FLOOR, type LogDates } from '@trackt/shared';
import { todayIso } from '@trackt/client';
import { Button } from '../ui/Button';
import { Modal, ModalTitle } from '../ui/Modal';

/**
 * Edit the log's start/finish dates (ADR-0007). The dates are stamped
 * automatically by status changes and check-ins; this is the "we recorded a
 * date, fix it if it's wrong" affordance, and the only way to record when you
 * actually watched something you are logging after the fact.
 *
 * The three checks mirror the server's exactly, so the common typo never
 * round-trips — but the server keeps them too, because a client is not a
 * validator.
 */
export interface LogDatesDialogProps {
  dates: LogDates;
  /** Shown above the fields, so the dialog says which title it is editing. */
  mediaTitle: string;
  /** Saving is the caller's job: it owns the optimistic cache patch. */
  onSave: (dates: LogDates) => Promise<void>;
  onClose: () => void;
}

export function validateLogDates(dates: LogDates, today = todayIso()): string | null {
  const { startedAt, finishedAt } = dates;
  for (const value of [startedAt, finishedAt]) {
    if (value === null) continue;
    if (value < LOG_DATE_FLOOR) return `Dates start at ${LOG_DATE_FLOOR} — check the year.`;
    if (value > today) return 'Dates can’t be in the future.';
  }
  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
    return 'The finish date is before the start date.';
  }
  return null;
}

export function LogDatesDialog({ dates, mediaTitle, onSave, onClose }: LogDatesDialogProps) {
  const [startedAt, setStartedAt] = useState(dates.startedAt ?? '');
  const [finishedAt, setFinishedAt] = useState(dates.finishedAt ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: LogDates = { startedAt: startedAt || null, finishedAt: finishedAt || null };
    const problem = validateLogDates(next);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That didn’t save — try again.');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <ModalTitle>Dates</ModalTitle>
          <p className="text-sm text-muted">{mediaTitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateField label="STARTED" value={startedAt} onChange={setStartedAt} />
          <DateField label="FINISHED" value={finishedAt} onChange={setFinishedAt} />
        </div>
        <p className="text-[13px] text-dim">
          Leave a field empty to clear it. A finish date is what files a title under a year on your
          history; an unfinished one files under its start.
        </p>

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
            CLEAR
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'SAVING…' : 'SAVE'}
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
