import clsx from 'clsx';
import type { PartBlock } from '@trackt/client';

/**
 * The work, as rows (`docs/design/Media Detail.dc.html`).
 *
 * Every row writes the *position*, which is what keeps it a view onto one
 * integer rather than a second source of truth: clicking part 140 marks
 * everything up to it, and clicking a part already done sets the position to
 * one below — how an overshoot is corrected without a dialog.
 *
 * The mockup's row carries a title, an air date and a runtime. Flat numbered
 * parts (ADR-0003) have none of those, so the label is the part itself and the
 * right-hand column says where it stands; the columns are there for metadata to
 * move into when the catalog starts publishing it.
 */
export function PartRow({
  label,
  done,
  isNext,
  onClick,
}: {
  /** 'Episode 4' / 'Chapter 177'. */
  label: string;
  done: boolean;
  isNext: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={done}
      className={clsx(
        'flex w-full cursor-pointer items-center gap-4 rounded-cover px-4.5 py-3.5 text-left transition',
        'inset-ring backdrop-blur-[16px]',
        isNext
          ? 'bg-pink-row inset-ring-pink/50'
          : 'bg-glass inset-ring-white/10 hover:inset-ring-pink/40',
      )}
    >
      <Marker complete={done} outlined={isNext} size={24} />
      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-[15px]',
          done ? 'text-muted' : 'text-fg',
          isNext && 'font-bold',
        )}
      >
        {label}
      </span>
      {(done || isNext) && (
        <span
          className={clsx(
            'font-label text-[11px] tracking-label',
            isNext ? 'text-pink' : 'text-dim',
          )}
        >
          {done ? 'DONE' : 'NEXT'}
        </span>
      )}
    </button>
  );
}

/** One block of forty, with its own bar — a long work's map. */
export function PartBlockRow({
  block,
  label,
  rangeLabel,
  open,
  onClick,
}: {
  block: PartBlock;
  label: string;
  rangeLabel: string;
  open: boolean;
  onClick: () => void;
}) {
  const percent = Math.round((block.done / block.size) * 100);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={clsx(
        'flex w-full cursor-pointer items-center gap-4 rounded-cover px-4.5 py-3.5 text-left transition',
        'inset-ring backdrop-blur-[16px]',
        open
          ? 'bg-pink-row inset-ring-pink/45'
          : 'bg-glass inset-ring-white/10 hover:inset-ring-pink/40',
      )}
    >
      <Marker complete={block.complete} partial={block.partial} size={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-2.5">
          <span className={clsx('text-[15px]', block.complete ? 'text-muted' : 'text-fg')}>
            {label}
          </span>
          <span className="font-label text-[11px] tracking-label text-dim">{rangeLabel}</span>
        </span>
        <span className="h-[3px] overflow-hidden rounded-full bg-white/9">
          <span
            className={clsx('block h-full rounded-full', block.complete ? 'bg-prism' : 'bg-pink')}
            style={{ width: `${percent}%` }}
          />
        </span>
      </span>
      <span
        className={clsx(
          'font-label text-[12px] font-semibold',
          block.done > 0 ? 'text-pink' : 'text-dim',
        )}
      >
        {block.done}/{block.size}
      </span>
    </button>
  );
}

/** The filled / half / empty disc every row wears on its left. */
function Marker({
  complete,
  partial = false,
  outlined = false,
  size,
}: {
  complete: boolean;
  partial?: boolean;
  outlined?: boolean;
  size: number;
}) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid shrink-0 place-items-center rounded-full border-[1.5px]',
        complete
          ? 'border-pink bg-pink text-on-prism'
          : partial || outlined
            ? 'border-pink'
            : 'border-white/20',
      )}
      style={{ width: size, height: size }}
    >
      {complete && (
        <svg width={size - 10} height={size - 10} viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {!complete && partial && <span className="size-1.5 rounded-full bg-pink" />}
    </span>
  );
}
