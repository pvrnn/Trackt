import { describe, expect, it } from 'vitest';
import { TROPHIES, TROPHY_TIER_POINTS, type TrophyCabinet, type TrophyEntry } from '@trackt/shared';
import {
  MEDAL_RIM_SLICES,
  formatDelta,
  formatRarity,
  medalLook,
  nextUpTrophies,
  prismLook,
  recentTrophies,
  topPercent,
  trophyPercent,
} from '../src/trophies.js';

function entry(id: TrophyEntry['id'], over: Partial<TrophyEntry> = {}): TrophyEntry {
  const def = TROPHIES.find((t) => t.id === id)!;
  return {
    id,
    tier: def.tier,
    points: TROPHY_TIER_POINTS[def.tier],
    unit: def.unit,
    target: def.target,
    progress: 0,
    unlockedAt: null,
    holders: 0,
    rarity: 0,
    serial: null,
    friends: { count: 0, sample: [] },
    evidence: [],
    ...over,
  };
}

function cabinet(trophies: TrophyEntry[]): TrophyCabinet {
  return {
    owner: { username: 'marav', name: 'Mara' },
    points: 0,
    unlocked: 0,
    total: trophies.length,
    tiers: { bronze: 0, silver: 0, gold: 0, prism: 0 },
    friendsRank: 1,
    globalMonthRank: null,
    trophies,
  };
}

describe('trophy shelves', () => {
  const trophies = [
    entry('first-log', { progress: 1, unlockedAt: '2026-01-02T00:00:00.000Z' }),
    entry('polyglot', { progress: 6, unlockedAt: '2026-03-01T00:00:00.000Z' }),
    entry('completionist', { progress: 41 }),
    entry('long-haul', { progress: 64 }),
    entry('regular', { progress: 16 }),
  ];

  it('puts the newest unlock first', () => {
    expect(recentTrophies(cabinet(trophies), 6).map((t) => t.id)).toEqual([
      'polyglot',
      'first-log',
    ]);
  });

  it('puts the locked trophy closest to done first', () => {
    expect(nextUpTrophies(cabinet(trophies), 2).map((t) => t.id)).toEqual(['long-haul', 'regular']);
  });

  it('reads a locked trophy as a floored percentage and an unlocked one as full', () => {
    expect(trophyPercent(entry('regular', { progress: 16 }))).toBe(64);
    expect(
      trophyPercent(entry('first-log', { progress: 1, unlockedAt: '2026-01-01T00:00:00Z' })),
    ).toBe(100);
  });
});

describe('trophy materials', () => {
  it('fills locked glass to the progress and makes prism-tier faces iridescent', () => {
    const locked = prismLook(entry('long-haul', { progress: 64 }));
    expect(locked.faces).toHaveLength(6);
    expect(locked.faces[0]).toMatchObject({ type: 'glass', fill: 0.64 });
    const prism = prismLook(entry('polyglot', { progress: 6, unlockedAt: '2026-01-01T00:00:00Z' }));
    expect(prism.height).toBeGreaterThan(prismLook(entry('first-log')).height);
    expect(prism.faces.every((f) => f.type === 'solid' && f.sheen)).toBe(true);
  });

  it('mills the medal edge from alternating lit and shadowed slices', () => {
    const look = medalLook(entry('critic', { unlockedAt: '2026-01-01T00:00:00Z' }));
    expect(look.rim).toHaveLength(MEDAL_RIM_SLICES);
    expect(look.rim[0]).not.toBe(look.rim[1]);
    expect(medalLook(entry('critic')).locked).toBe(true);
  });
});

describe('leaderboard formatting', () => {
  it('formats deltas and hides them on the all-time board', () => {
    expect(formatDelta(2)).toEqual({ text: '▲ 2', tone: 'up' });
    expect(formatDelta(-1)).toEqual({ text: '▼ 1', tone: 'down' });
    expect(formatDelta(0)).toEqual({ text: '—', tone: 'flat' });
    expect(formatDelta(null)).toBeNull();
  });

  it('never reports a top 0%', () => {
    expect(topPercent(1, 21950)).toBe(1);
    expect(topPercent(1284, 21950)).toBe(6);
    expect(topPercent(3, 0)).toBe(100);
  });

  it('prints rarity with a decimal only under ten percent', () => {
    expect(formatRarity(2.1)).toBe('2.1%');
    expect(formatRarity(14)).toBe('14%');
  });
});
