import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { prismLook, prismSpin, TIER_MATERIAL, type PrismFace } from '@trackt/client';
import type { TrophyEntry } from '@trackt/shared';
import { gradient, useTrophyCopy } from './copy';

function faceBackground(face: PrismFace): string {
  if (face.type === 'glass') {
    const pct = Math.round(face.fill * 100);
    return `linear-gradient(0deg, ${face.tint} ${pct}%, ${face.empty} ${pct}%)`;
  }
  const body = `linear-gradient(180deg, ${face.top}, ${face.bottom})`;
  if (face.sheen)
    return `linear-gradient(180deg, rgb(255 255 255 / 0.45), transparent 45%), ${body}`;
  const shade = `rgb(0 0 0 / ${face.shade})`;
  return `linear-gradient(${shade}, ${shade}), ${body}`;
}

/** One hexagonal crystal, spinning on its own clock. Height and material come from the tier. */
export function TrophyPrism({ trophy, index }: { trophy: TrophyEntry; index: number }) {
  const look = prismLook(trophy);
  const spin = prismSpin(index);
  const style: CSSProperties = {
    height: look.height,
    animationDuration: `${spin.durationMs}ms`,
    animationDelay: `${-spin.phase * spin.durationMs}ms`,
  };
  return (
    <div className="tp p3" style={style}>
      <div
        className="tglow"
        style={{
          top: look.height - 50,
          background: `radial-gradient(closest-side, ${look.glow}, transparent)`,
        }}
      />
      {look.faces.map((face, i) => (
        <div
          key={i}
          className="tface"
          style={{
            height: look.height,
            transform: `rotateY(${i * 60}deg) translateZ(17.32px)`,
            background: faceBackground(face),
          }}
        />
      ))}
      <div className="tcap" style={{ background: gradient(look.cap) }} />
    </div>
  );
}

export interface TrophyShelfProps {
  trophies: TrophyEntry[];
  columns: number;
  selectedId?: string;
  onSelect?: (trophy: TrophyEntry) => void;
  /** Shelf index offset, so two shelves never spin in step. */
  offset?: number;
  compact?: boolean;
}

/** A plank of prisms, each with its name, tier and one line under it. */
export function TrophyShelf({
  trophies,
  columns,
  selectedId,
  onSelect,
  offset = 0,
  compact = false,
}: TrophyShelfProps) {
  const copy = useTrophyCopy();
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  return (
    <div>
      <div className={clsx('tstage', compact ? 'pt-3' : 'pt-[18px]')}>
        <div className={clsx('p3 grid items-end', compact ? 'h-[84px]' : 'h-24')} style={grid}>
          {trophies.map((trophy, i) => (
            <div key={trophy.id} className="p3 flex h-full items-end justify-center">
              {onSelect ? (
                <button
                  type="button"
                  className="tpw p3 block cursor-pointer rounded-lg focus-visible:outline-offset-8"
                  aria-pressed={selectedId === trophy.id}
                  aria-label={copy.name(trophy)}
                  onClick={() => onSelect(trophy)}
                >
                  <TrophyPrism trophy={trophy} index={offset + i} />
                </button>
              ) : (
                <div className="tpw p3">
                  <TrophyPrism trophy={trophy} index={offset + i} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className={clsx('tplank p3', compact ? 'mx-1.5' : 'mx-[18px]')}>
          <div className="pt" />
          <div className="pf" />
        </div>
      </div>
      <div className={clsx('grid', compact ? 'mt-2 gap-1.5' : 'mt-0.5 gap-2.5')} style={grid}>
        {trophies.map((trophy) => {
          const selected = selectedId === trophy.id;
          const body = (
            <>
              <span
                className={clsx(
                  'leading-[1.2] font-semibold',
                  compact ? 'text-[13px]' : 'text-sm',
                  selected ? 'text-pink-ink' : 'text-fg',
                )}
              >
                {copy.name(trophy)}
              </span>
              <span
                className={clsx(
                  'font-label font-bold tracking-[0.08em]',
                  compact ? 'text-[9px]' : 'text-[10px]',
                )}
                style={{ color: TIER_MATERIAL[trophy.tier].fg }}
              >
                {copy.tierPoints(trophy)}
              </span>
              {!compact && (
                <span className="font-label text-[10px] font-semibold tracking-[0.06em] text-dim">
                  {copy.sub(trophy)}
                </span>
              )}
            </>
          );
          const cell =
            'flex min-w-0 flex-col items-center gap-1 rounded-[10px] px-0.5 py-1.5 text-center';
          return onSelect ? (
            <button
              key={trophy.id}
              type="button"
              onClick={() => onSelect(trophy)}
              className={clsx(cell, 'cursor-pointer', selected && 'bg-pink-row')}
            >
              {body}
            </button>
          ) : (
            <div key={trophy.id} className={cell}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
