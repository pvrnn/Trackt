import { describe, expect, it } from 'vitest';
import {
  SWIPE,
  duration,
  staggerDelay,
  swipeStage,
  swipeTranslation,
  trackOpacity,
} from '../../src/lib/motion';

/**
 * `Mobile System.dc.html` §04 and §07 are the specification these numbers come
 * from, and they are the reason this file exists: the components that read them
 * need a renderer to test, but the geometry does not, and the geometry is what
 * a redesign would change.
 */

describe('duration', () => {
  it('carries §07 verbatim', () => {
    expect(duration).toEqual({ micro: 140, commit: 220, navigate: 320, springBack: 180 });
  });
});

describe('swipeStage', () => {
  it('is at rest at zero and for any left drag', () => {
    expect(swipeStage(0)).toBe('rest');
    expect(swipeStage(-40)).toBe('rest');
  });

  it('drags below the 96pt threshold and arms at it', () => {
    expect(swipeStage(1)).toBe('drag');
    expect(swipeStage(SWIPE.armed - 1)).toBe('drag');
    expect(swipeStage(SWIPE.armed)).toBe('armed');
    expect(swipeStage(400)).toBe('armed');
  });
});

describe('trackOpacity', () => {
  it('hides the track at rest', () => {
    expect(trackOpacity(0)).toBe(0);
    expect(trackOpacity(-20)).toBe(0);
  });

  it('ghosts in at 0.35 while the gesture could still be a scroll', () => {
    expect(trackOpacity(1)).toBe(0.35);
    expect(trackOpacity(18)).toBe(0.35);
    expect(trackOpacity(SWIPE.ghost)).toBe(0.35);
  });

  it('ramps to full between the ghost and the armed thresholds', () => {
    const middle = trackOpacity((SWIPE.ghost + SWIPE.armed) / 2);
    expect(middle).toBeGreaterThan(0.35);
    expect(middle).toBeLessThan(1);
    expect(trackOpacity(SWIPE.armed)).toBe(1);
    expect(trackOpacity(400)).toBe(1);
  });

  it('never decreases as the finger travels', () => {
    for (let dx = -20; dx < 200; dx += 1) {
      expect(trackOpacity(dx + 1)).toBeGreaterThanOrEqual(trackOpacity(dx));
    }
  });
});

describe('swipeTranslation', () => {
  it('does not move on a left drag — there is nothing revealed that way', () => {
    expect(swipeTranslation(-80)).toBe(0);
    expect(swipeTranslation(0)).toBe(0);
  });

  it('tracks the finger exactly through the armed threshold', () => {
    expect(swipeTranslation(30)).toBe(30);
    expect(swipeTranslation(SWIPE.armed)).toBe(SWIPE.armed);
  });

  it('resists past the slack, but keeps moving', () => {
    const free = SWIPE.armed + SWIPE.slack;
    expect(swipeTranslation(free)).toBe(free);
    expect(swipeTranslation(free + 100)).toBeGreaterThan(free);
    expect(swipeTranslation(free + 100)).toBeLessThan(free + 100);
  });
});

describe('staggerDelay', () => {
  it('lands the first element immediately', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(-1)).toBe(0);
  });

  it('steps, then caps — a 400-chapter grid must not still be filling in', () => {
    expect(staggerDelay(1, 24, 240)).toBe(24);
    expect(staggerDelay(4, 24, 240)).toBe(96);
    expect(staggerDelay(400, 24, 240)).toBe(240);
  });
});
