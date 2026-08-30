/**
 * `Mobile System.dc.html`'s durations (§07) and swipe geometry (§04).
 *
 * Nothing here imports Reanimated — the spring configs are plain objects that
 * satisfy `WithSpringConfig` — so `test/lib/motion.test.ts` can hold the
 * geometry to the spec in the node vitest project.
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

/** Settles in `duration.springBack` without overshoot: let go of, not bounced back. */
export const springBack = { duration: duration.springBack, dampingRatio: 1 } as const;

/** 0.96 is the smallest scale that reads as a press at 44pt without moving a 56pt tile. */
export const springPress = { duration: duration.micro, dampingRatio: 0.9 } as const;
export const PRESS_SCALE = 0.96;

/** §04's swipe thresholds, in points. */
export const SWIPE = {
  /** Under this the gesture may still resolve as a scroll, so the track only ghosts in. */
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

/** Hidden at rest, 0.35 while ambiguous, ramping to full once armed (§04). */
export function trackOpacity(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  if (dx <= SWIPE.ghost) return 0.35;
  if (dx >= SWIPE.armed) return 1;
  return 0.35 + ((dx - SWIPE.ghost) / (SWIPE.armed - SWIPE.ghost)) * 0.65;
}

/**
 * Where the row sits for a given displacement. Left drags do not move it: the
 * left swipe's secondary actions are not built, and a row that slides to reveal
 * nothing is a broken affordance rather than an unfinished one.
 */
export function swipeTranslation(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  const free = SWIPE.armed + SWIPE.slack;
  return dx <= free ? dx : free + (dx - free) * SWIPE.resistance;
}

/** Staggered entrance delay, capped — hundreds of tiles would otherwise still be arriving a minute later. */
export function staggerDelay(index: number, step = 24, max = 240): number {
  'worklet';
  if (index <= 0) return 0;
  return Math.min(index * step, max);
}
