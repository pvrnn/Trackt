import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import clsx from 'clsx';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../lib/format';
import { Button } from '../ui/Button';

/** Ten stars at half-star precision cover 0.5–10; `0` keeps its own pill (PRD §3.2). */
const STARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Score picker for the media action row. The 0–10 half-point scale is 21 values,
 * which made a dropdown unusable; as stars it reads at a glance and takes one
 * click. Clicking the current score again clears it, as does CLEAR RATING.
 */
export function RatingPopover({
  score,
  onChange,
  trigger,
  triggerClassName,
}: {
  score: number | null;
  onChange: (score: number | null) => void;
  /** Replaces the default pill; the media page anchors it to a pencil. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const labelId = useId();
  const triggerId = useId();
  const rated = score !== null;
  // Hover previews the score it would set, without committing it.
  const shown = hovered ?? score ?? 0;

  const pick = (next: number | null) => {
    onChange(next);
    setHovered(null);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Labelled by the hidden text *and* the trigger itself: an `aria-label`
          replaces the contents, so a rated pill announced "your rating" and
          never the score it was showing. */}
      <span id={labelId} className="sr-only">
        {t('media.rating.label')}
      </span>
      <Popover.Trigger
        id={triggerId}
        aria-labelledby={`${labelId} ${triggerId}`}
        className={
          trigger
            ? triggerClassName
            : clsx(
                'inline-flex cursor-pointer items-center gap-2 rounded-full border py-[11px] pr-4 pl-5',
                'font-label text-xs font-semibold tracking-label transition outline-none',
                rated
                  ? 'border-pink bg-pink-selected text-pink'
                  : 'border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
              )
        }
      >
        {trigger ?? (
          <>
            {rated ? `★ ${format.score(score)}` : t('media.rating.rateTrigger')}
            <span aria-hidden className={clsx('text-[10px]', rated ? 'text-pink' : 'text-dim')}>
              ▾
            </span>
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          className="z-40 flex flex-col gap-3 rounded-card-sm border border-glass-border bg-ink/95 p-4 shadow-2xl shadow-ink/70 backdrop-blur-[16px]"
        >
          <div className="flex items-center gap-3">
            <ToggleGroup.Root
              type="single"
              aria-label={t('media.rating.group')}
              value={score === null ? '' : String(score)}
              onValueChange={(value) => pick(value === '' ? null : Number(value))}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center gap-2"
            >
              <ToggleGroup.Item
                value="0"
                aria-label={t('media.rating.rateValue', { value: format.score(0) })}
                onMouseEnter={() => setHovered(0)}
                onFocus={() => setHovered(0)}
                className={clsx(
                  'cursor-pointer rounded-full border px-2.5 py-1 font-label text-[11px] font-semibold transition',
                  score === 0
                    ? 'border-pink bg-pink-selected text-pink'
                    : 'border-glass-border text-dim hover:border-pink hover:text-pink',
                )}
              >
                0
              </ToggleGroup.Item>
              {STARS.map((star) => (
                <Star key={star} star={star} shown={shown} onHover={setHovered} />
              ))}
            </ToggleGroup.Root>
            <span
              className={clsx(
                'w-9 shrink-0 text-right font-label text-sm font-bold tabular-nums',
                shown > 0 || hovered === 0 ? 'text-pink' : 'text-faint',
              )}
            >
              {format.score(hovered ?? score ?? 0)}
            </span>
          </div>
          <Button variant="ghost" disabled={!rated} onClick={() => pick(null)} className="text-xs">
            {t('media.rating.clear')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One star: an outline glyph with a pink glyph clipped over it, so a half score
 * shows as a half-filled star. The two halves are separate hit targets.
 */
function Star({
  star,
  shown,
  onHover,
}: {
  star: number;
  shown: number;
  onHover: (score: number) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const fill = Math.min(Math.max(shown - (star - 1), 0), 1);
  return (
    <span className="relative block size-6 text-[22px] leading-6">
      <span aria-hidden className="absolute inset-0 text-faint">
        ☆
      </span>
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0 overflow-hidden text-pink"
        style={{ width: `${fill * 100}%` }}
      >
        ★
      </span>
      <ToggleGroup.Item
        value={String(star - 0.5)}
        aria-label={t('media.rating.rateValue', { value: format.score(star - 0.5) })}
        onMouseEnter={() => onHover(star - 0.5)}
        onFocus={() => onHover(star - 0.5)}
        className="absolute top-0 bottom-0 left-0 w-1/2 cursor-pointer rounded-l outline-none focus-visible:bg-pink/25"
      />
      <ToggleGroup.Item
        value={String(star)}
        aria-label={t('media.rating.rateValue', { value: format.score(star) })}
        onMouseEnter={() => onHover(star)}
        onFocus={() => onHover(star)}
        className="absolute top-0 right-0 bottom-0 w-1/2 cursor-pointer rounded-r outline-none focus-visible:bg-pink/25"
      />
    </span>
  );
}
