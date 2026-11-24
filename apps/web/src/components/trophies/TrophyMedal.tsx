import { useEffect, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MEDAL_RIM_SLICES,
  MEDAL_SPIN,
  medalKindDots,
  medalLook,
  TIER_MATERIAL,
  trophyPercent,
} from '@trackt/client';
import type { TrophyEntry } from '@trackt/shared';
import { gradient, useTrophyCopy } from './copy';

const SHINE = 'radial-gradient(circle at 30% 24%, rgb(255 255 255 / 0.65), transparent 32%)';
/** A pointer held still this long before release lets go without a fling. */
const FLING_WINDOW_MS = 80;

const clamp = (v: number) => Math.max(-MEDAL_SPIN.maxDegPerMs, Math.min(MEDAL_SPIN.maxDegPerMs, v));

interface Spin {
  angle: number;
  velocity: number;
  drag: { x: number; base: number; lastX: number; lastT: number } | null;
}

/**
 * The spotlight's medal: a disc with a 48-slice milled edge. It idles in a slow
 * spin; dragging turns it by hand, and letting go keeps the fling's speed while
 * it eases back to the idle turn. Driven per frame rather than by a CSS
 * animation, so the hand-off never jumps.
 */
export function TrophyMedal({ trophy, owner }: { trophy: TrophyEntry; owner: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const look = medalLook(trophy);
  const disc = useRef<HTMLDivElement>(null);
  const spin = useRef<Spin>({ angle: 0, velocity: MEDAL_SPIN.idleDegPerMs, drag: null });

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const s = spin.current;
      if (!s.drag) {
        const idle = reduced.matches ? 0 : MEDAL_SPIN.idleDegPerMs;
        s.velocity = idle + (s.velocity - idle) * Math.exp(-dt / MEDAL_SPIN.settleMs);
        s.angle += s.velocity * dt;
      }
      if (disc.current) disc.current.style.transform = `rotateY(${s.angle}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = spin.current;
    s.drag = { x: e.clientX, base: s.angle, lastX: e.clientX, lastT: e.timeStamp };
    s.velocity = 0;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = spin.current;
    const d = s.drag;
    if (!d) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) {
      const instant = ((e.clientX - d.lastX) * MEDAL_SPIN.dragDegPerPx) / dt;
      s.velocity = s.velocity * 0.3 + instant * 0.7;
    }
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    s.angle = d.base + (e.clientX - d.x) * MEDAL_SPIN.dragDegPerPx;
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = spin.current;
    if (!s.drag) return;
    s.velocity = e.timeStamp - s.drag.lastT > FLING_WINDOW_MS ? 0 : clamp(s.velocity);
    s.drag = null;
  };

  const face = look.locked
    ? `radial-gradient(circle at 30% 24%, rgb(255 255 255 / 0.25), transparent 32%), ${gradient(look.face)}`
    : `${SHINE}, conic-gradient(from 200deg, ${look.face.join(', ')})`;
  const isPolyglot = trophy.id === 'polyglot' && !look.locked;
  const name = copy.name(trophy);
  const emblemSub = look.locked
    ? t('trophies.medal.there', { pct: trophyPercent(trophy) })
    : isPolyglot
      ? t('trophies.medal.kinds', { count: trophy.evidence.length })
      : copy.tierPoints(trophy);
  const backLine =
    trophy.unlockedAt && trophy.serial
      ? `${copy.date(trophy.unlockedAt)} · ${t('trophies.serial', {
          serial: copy.number(trophy.serial),
          holders: copy.number(trophy.holders),
        })}`
      : t('trophies.medal.notYet');

  return (
    <div
      className="relative"
      style={{
        background: `radial-gradient(260px 220px at 50% 50%, ${look.halo}, transparent 70%)`,
      }}
    >
      <div
        className="mstage"
        role="img"
        aria-label={t('trophies.medal.aria', { name })}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      >
        <div className="mtilt p3">
          <div ref={disc} className="mdrag p3">
            {look.rim.map((color, i) => (
              <div
                key={i}
                className="mrim"
                style={{
                  transform: `rotateZ(${(i * 360) / MEDAL_RIM_SLICES}deg) translateY(-83.5px) rotateX(90deg)`,
                  background: color,
                }}
              />
            ))}
            <div
              className="mface"
              style={{
                transform: 'translateZ(8px)',
                background: face,
                boxShadow:
                  'inset 0 0 0 2px rgb(255 255 255 / 0.4), inset 0 -12px 26px rgb(0 0 0 / 0.3)',
              }}
            >
              <div className="absolute inset-4 rounded-full bg-[radial-gradient(circle_at_40%_30%,#241d2e,#120e17_70%)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22),inset_0_6px_14px_rgb(0_0_0/0.6)]">
                {isPolyglot &&
                  trophy.evidence.map((e, i) => {
                    const dot = medalKindDots(54)[i] ?? { x: 0, y: 0 };
                    return (
                      <span
                        key={e.kind}
                        className="absolute -mt-[5px] -ml-[5px] size-2.5 rounded-full"
                        style={{
                          left: 68 + dot.x,
                          top: 68 + dot.y,
                          background: `var(--color-kind-${e.kind})`,
                          boxShadow: `0 0 10px var(--color-kind-${e.kind})`,
                        }}
                      />
                    );
                  })}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[5px] px-3 text-center">
                  <span
                    className="hx h-[30px] w-[34px]"
                    style={{
                      background: gradient(TIER_MATERIAL[trophy.tier].chip),
                      opacity: look.locked ? 0.45 : 1,
                    }}
                  />
                  <span
                    className="font-display text-sm leading-[1.1] tracking-[0.04em] uppercase"
                    style={{ opacity: look.locked ? 0.45 : 1 }}
                  >
                    {name}
                  </span>
                  <span className="font-label text-[8px] font-bold tracking-[0.12em] text-muted">
                    {emblemSub}
                  </span>
                </div>
              </div>
            </div>
            <div
              className="mface"
              style={{
                transform: 'rotateY(180deg) translateZ(8px)',
                background: face,
                boxShadow: 'inset 0 0 0 2px rgb(255 255 255 / 0.35)',
              }}
            >
              <div className="absolute inset-4 flex flex-col items-center justify-center gap-1.5 rounded-full bg-[#16121c] text-center font-label font-bold tracking-[0.12em] text-dim shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18),inset_0_6px_14px_rgb(0_0_0/0.6)]">
                <span className="text-[8px]">TRACKT</span>
                <span className="font-display text-[15px] tracking-[0.06em] text-[#cfc9d8] uppercase">
                  {owner}
                </span>
                <span className="px-4 text-[8px]">{backLine}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-3.5 flex justify-center">
        <span className="font-label text-[10px] font-bold tracking-label text-dim">
          {t('trophies.medal.drag')}
        </span>
      </div>
    </div>
  );
}
