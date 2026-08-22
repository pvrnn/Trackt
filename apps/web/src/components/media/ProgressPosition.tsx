import clsx from 'clsx';
import { useEffect, useState, type FormEvent } from 'react';
import { GlassCard } from '../ui/GlassCard';

/**
 * "I'm on chapter 120 of 900" — the media page's control for long works.
 *
 * Past ~30 parts a checklist stops being a checklist: catching a 900-chapter
 * manga up one tile at a time is not a UI, it's a chore, and the thing people
 * actually know is a *position*. So this offers the two ways of stating one:
 * type the number, or drag to it. Both send a single `PUT …/progress`.
 *
 * The number is an input rather than a label with a pencil next to it — the
 * readout and the field are the same element, so the edit costs a click and
 * nothing has to be revealed first.
 *
 * The slider commits on **release**, not on every step: a native range fires
 * `change` per increment, and dragging from 0 to 400 would be 400 writes.
 * While the finger is down the value is local state and the display follows it,
 * which is also what makes the drag feel live.
 */
export function ProgressPosition({
  noun,
  total,
  position,
  watchedCount,
  doneLabel,
  onCommit,
}: {
  /** 'Episode' / 'Chapter', per kind. */
  noun: string;
  total: number;
  /** The highest N with every part up to it checked in. */
  position: number;
  /**
   * How many parts are ticked in all. Not printed — "175 of 380" already says
   * it whenever progress is contiguous. It is here for the one case where the
   * two disagree: a sparse log, where the note below has to warn what a drag is
   * about to clear.
   */
  watchedCount: number;
  /** 'Watched' or 'Read'. */
  doneLabel: string;
  onCommit: (upTo: number) => void;
}) {
  // Two drafts, because the two controls are edited differently: the slider is
  // continuous and always numeric, the field is a half-typed string until it
  // is submitted. Both re-sync when the server (or another control) moves the
  // position under them.
  const [slider, setSlider] = useState(position);
  const [field, setField] = useState(String(position));

  useEffect(() => {
    setSlider(position);
    setField(String(position));
  }, [position]);

  const clamp = (value: number) => Math.min(Math.max(Math.round(value), 0), total);

  const commit = (value: number) => {
    const next = clamp(value);
    setSlider(next);
    setField(String(next));
    if (next !== position) onCommit(next);
  };

  const submitField = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number.parseInt(field, 10);
    // An unparseable field is a typo, not an instruction to clear the log:
    // it snaps back to where the viewer actually is.
    if (Number.isNaN(parsed)) return commit(position);
    commit(parsed);
  };

  const percent = total > 0 ? (slider / total) * 100 : 0;
  const plural = `${noun.toUpperCase()}S`;

  return (
    <GlassCard className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* The field and its unit read as one phrase: the number leads, but
            only by a step — a 32px display number in a 48px well beside 11px
            caps was two different scales sharing a line. */}
        <form onSubmit={submitField} className="flex h-10 items-center gap-2.5">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={field}
            onChange={(event) => setField(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={submitField}
            aria-label={`${noun} you're on`}
            className="h-12 w-[4.5ch] rounded-cover border border-white/12 bg-white/6 text-prism text-center font-display text-[32px] leading-none tabular-nums transition-colors outline-none focus:border-pink/60"
          />
          <span className="font-label text-xs tracking-label text-dim">
            OF {total} {plural}
          </span>
        </form>
        {/* The one-more button — dragging a 900-part slider by a single step
            is a fiddle, and "I read one more" is the commonest thing anyone
            comes to this card to say. A plus and nothing else: at this size a
            glyph reads faster than "+1", and the step is always one. */}
        <button
          type="button"
          onClick={() => commit(slider + 1)}
          disabled={slider >= total}
          title={`${doneLabel} one more ${noun.toLowerCase()}`}
          aria-label={`${doneLabel} one more ${noun.toLowerCase()}`}
          className="ml-auto grid size-9 cursor-pointer place-items-center rounded-full border border-pink/60 text-pink transition hover:bg-pink-row disabled:cursor-default disabled:border-white/8 disabled:text-faint disabled:hover:bg-transparent"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* A bare `<input type="range">` under a drawn track: the native control
          keeps the keyboard, touch and screen-reader behaviour, the drawn one
          gets the PRISM fill the design asks for. */}
      <div className="group relative flex h-7 items-center">
        {/* The input comes first so the drawn parts can react to its focus
              and hover (`peer-*` is a following-sibling selector), and
              everything drawn over it is `pointer-events-none` so the
              transparent range keeps every pointer. */}
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={slider}
          onChange={(event) => setSlider(Number(event.target.value))}
          onPointerUp={() => commit(slider)}
          onKeyUp={() => commit(slider)}
          onBlur={() => commit(slider)}
          aria-label={`${noun}s ${doneLabel.toLowerCase()}`}
          aria-valuetext={`${slider} of ${total}`}
          className="peer absolute inset-0 z-10 w-full cursor-pointer opacity-0"
        />
        <div className="pointer-events-none h-2.5 w-full overflow-hidden rounded-full bg-white/8 inset-ring inset-ring-white/10">
          <div
            className="h-full rounded-full bg-prism transition-[width] duration-75"
            style={{ width: `${percent}%` }}
          />
        </div>
        {/* The knob grows and lights up on hover, focus and drag — the only
              thing that says a track this quiet is draggable at all. */}
        <div
          aria-hidden
          className={clsx(
            'pointer-events-none absolute size-5 -translate-x-1/2 rounded-full border-2 border-pink bg-ink',
            'shadow-[0_0_0_0_var(--color-pink)] transition-[box-shadow,scale] duration-150',
            'peer-hover:scale-110 peer-hover:shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-pink)_18%,transparent)]',
            'peer-focus-visible:scale-110 peer-focus-visible:shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-pink)_28%,transparent)]',
            'peer-active:scale-125',
          )}
          style={{ left: `${percent}%` }}
        />
      </div>

      {watchedCount > slider && (
        <p className="text-[13px] text-muted">
          {watchedCount - slider} {noun.toLowerCase()}
          {watchedCount - slider === 1 ? ' is' : 's are'} ticked further ahead. Moving the slider
          clears anything past where you are.
        </p>
      )}
    </GlassCard>
  );
}
