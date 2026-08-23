import clsx from 'clsx';
import { useEffect, useState, type FormEvent } from 'react';

/**
 * The progress control (`docs/design/Media Detail.dc.html`) — the same block
 * mobile's media screen carries, laid out for a wide column: the unit and the
 * percentage on top, then the editable number, the slider and the steppers on
 * one line.
 *
 * The counter is the source of truth. Progress is one integer, so typing the
 * number, dragging the slider, tapping −/+ and clicking a part row are four
 * ways of making the same write — which is also why this works on a title with
 * no per-part metadata at all.
 *
 * The slider commits on **release**, not on every step: a native range fires
 * `change` per increment, and dragging 0 → 400 would be 400 writes. While the
 * pointer is down the value is local state and the display follows it.
 */
export function ProgressCard({
  unitLabel,
  total,
  position,
  watchedCount,
  onCommit,
}: {
  /** 'EPISODES WATCHED' / 'CHAPTERS READ' — already in caps. */
  unitLabel: string;
  total: number;
  /** The highest part with everything before it done: where the viewer is. */
  position: number;
  /**
   * How many parts are ticked in all. Not printed — with contiguous progress it
   * is the position. It is here for the sparse case, where the note below has
   * to say what a move is about to clear.
   */
  watchedCount: number;
  onCommit: (upTo: number) => void;
}) {
  // Two drafts, because the two controls are edited differently: the slider is
  // continuous and always numeric, the field is a half-typed string until it is
  // submitted. Both re-sync when the position moves under them.
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
    // An unparseable field is a typo, not an instruction to clear the log: it
    // snaps back to where the viewer actually is.
    commit(Number.isNaN(parsed) ? position : parsed);
  };

  const percent = total > 0 ? (slider / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-4 rounded-card bg-glass px-6 py-5 inset-ring inset-ring-pink/40 backdrop-blur-[16px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-label text-[11px] tracking-label text-dim">{unitLabel}</span>
        <span className="font-label text-[11px] tracking-label text-pink">
          {Math.round(percent)}%
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        {/* The number is a bare field with an underline that lights on focus —
            no well, because a box around it made it read as a form rather than
            a readout you can edit. */}
        <form onSubmit={submitField} className="flex min-w-0 shrink-0 items-baseline gap-2.5">
          <input
            value={field}
            onChange={(event) => setField(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onBlur={submitField}
            inputMode="numeric"
            aria-label="Where you are"
            style={{ width: `${Math.max(1, field.length)}ch` }}
            className="border-b-2 border-transparent bg-transparent font-display text-[52px] leading-none text-fg tabular-nums transition-colors outline-none focus:border-pink"
          />
          <span className="font-display text-[26px] text-dim">/ {total}</span>
        </form>

        <div className="group relative flex h-[26px] min-w-[200px] flex-[2] items-center">
          {/* The input comes first so the drawn parts can react to its focus
              and hover (`peer-*` is a following-sibling selector), and
              everything drawn over it is `pointer-events-none`. */}
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
            aria-label={unitLabel.toLowerCase()}
            aria-valuetext={`${slider} of ${total}`}
            className="peer absolute inset-0 z-10 w-full cursor-pointer opacity-0"
          />
          <div className="pointer-events-none h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-prism" style={{ width: `${percent}%` }} />
          </div>
          <div
            aria-hidden
            className={clsx(
              'pointer-events-none absolute size-6 -translate-x-1/2 rounded-full bg-fg',
              'shadow-[0_4px_14px_rgba(0,0,0,0.7)] transition-[scale] duration-150',
              'peer-hover:scale-110 peer-focus-visible:scale-110 peer-active:scale-115',
            )}
            style={{ left: `${percent}%` }}
          />
        </div>

        <div className="flex shrink-0 gap-2">
          <Stepper
            direction="down"
            disabled={slider <= 0}
            label="One fewer"
            onClick={() => commit(slider - 1)}
          />
          <Stepper
            direction="up"
            disabled={slider >= total}
            label="One more"
            onClick={() => commit(slider + 1)}
          />
        </div>
      </div>

      {watchedCount > slider && (
        <p className="text-[13px] text-muted">
          {watchedCount - slider} further ahead {watchedCount - slider === 1 ? 'is' : 'are'} ticked.
          Moving this clears anything past where you are.
        </p>
      )}
    </div>
  );
}

/** −/+ : 46px round, the plus in PRISM because it is the one pressed daily. */
function Stepper({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: 'up' | 'down';
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={clsx(
        'grid size-[46px] cursor-pointer place-items-center rounded-full text-xl transition',
        'disabled:cursor-default disabled:opacity-40',
        direction === 'up'
          ? 'bg-prism text-on-prism hover:brightness-110'
          : 'bg-glass text-muted inset-ring inset-ring-white/15 hover:text-pink hover:inset-ring-pink',
      )}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none">
        <path
          d={direction === 'up' ? 'M12 5v14M5 12h14' : 'M5 12h14'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
