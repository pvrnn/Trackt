/**
 * The motion constants and the pure geometry behind them (mobile plan, phase 4).
 *
 * `Mobile System.dc.html` §07 fixes four durations and nothing else, so they
 * live here by name rather than as numbers sprinkled through the components —
 * the same reason `haptics.ts` names its three events instead of exposing
 * waveforms. §04 fixes the swipe's thresholds; those are geometry, and the
 * functions that read them are pure so `test/lib/motion.test.ts` can hold them
 * to the spec without a renderer.
 *
 * Nothing here imports Reanimated. The spring configs are plain objects that
 * happen to satisfy `WithSpringConfig`, which keeps this file loadable in the
 * node-environment vitest project the mobile app tests in.
 */

/** §07's four durations, in milliseconds. */
export const duration = {
  /** Press states, chip selection, a tile taking its fill. */
  micro: 140,
  /** Check-in exit, sheet present and dismiss, toast in. */
  commit: 220,
  /** Push and pop between screens. */
  navigate: 320,
  /** An abandoned swipe returning to rest. */
  springBack: 180,
} as const;

/**
 * A spring that settles in about `duration.springBack` and does not overshoot —
 * an abandoned swipe should look like the row was let go of, not like it
 * bounced back at the user. `withSpring`'s duration/dampingRatio form is used
 * rather than damping/stiffness so the number in the code is the number in the
 * spec.
 */
export const springBack = { duration: duration.springBack, dampingRatio: 1 } as const;

/**
 * The press spring: fast, and just under critically damped so the release has a
 * little life in it. 0.96 is the smallest scale that still reads as a press at
 * 44pt without making a 56pt tile look like it moved.
 */
export const springPress = { duration: duration.micro, dampingRatio: 0.9 } as const;
export const PRESS_SCALE = 0.96;

/** §04's swipe thresholds, in points. */
export const SWIPE = {
  /**
   * Under this the gesture may still resolve as a scroll, so the track only
   * ghosts in — nothing has been decided yet.
   */
  ghost: 32,
  /** Past this the row is armed: the label changes and releasing commits. */
  armed: 96,
  /** How far past `armed` the row still tracks the finger 1:1 before damping. */
  slack: 48,
  /** Beyond `armed + slack` the row keeps moving, but at a third of the finger. */
  resistance: 0.34,
} as const;

/** The three states a swiping row can be in, in §04's words. */
export type SwipeStage = 'rest' | 'drag' | 'armed';

export function swipeStage(dx: number): SwipeStage {
  'worklet';
  if (dx <= 0) return 'rest';
  return dx >= SWIPE.armed ? 'armed' : 'drag';
}

/**
 * The track's opacity for a given displacement. §04: hidden at rest, 0.35 while
 * the gesture is still ambiguous, full once armed — and a ramp between the two
 * so crossing the threshold is something you can see coming rather than a jump.
 */
export function trackOpacity(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  if (dx <= SWIPE.ghost) return 0.35;
  if (dx >= SWIPE.armed) return 1;
  return 0.35 + ((dx - SWIPE.ghost) / (SWIPE.armed - SWIPE.ghost)) * 0.65;
}

/**
 * Where the row actually sits for a given finger displacement. Left drags do
 * not move it — the left swipe's secondary actions are not built, and a row
 * that slides to reveal nothing is a broken affordance, not an unfinished one.
 * Past `armed + slack` the row resists, which is what tells a finger that has
 * already won that it can stop pulling.
 */
export function swipeTranslation(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  const free = SWIPE.armed + SWIPE.slack;
  return dx <= free ? dx : free + (dx - free) * SWIPE.resistance;
}

/**
 * The delay for the `index`th element of a staggered entrance. Capped, because
 * a manga's part grid runs to hundreds of tiles and an uncapped stagger would
 * still be filling in a minute later; past the cap everything remaining lands
 * together, which at that point reads as one sweep rather than a queue.
 */
export function staggerDelay(index: number, step = 24, max = 240): number {
  'worklet';
  if (index <= 0) return 0;
  return Math.min(index * step, max);
}
