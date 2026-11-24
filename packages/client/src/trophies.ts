import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  LeaderboardSchema,
  TrophyCabinetSchema,
  type Leaderboard,
  type LeaderboardPeriod,
  type LeaderboardScope,
  type TrophyCabinet,
  type TrophyEntry,
  type TrophyTier,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/**
 * Trophies data layer, plus the materials both clients draw them with. The
 * web builds its prisms and medal from CSS 3D; React Native has no
 * `preserve-3d` and projects them by hand. Either way the tiers, the faces'
 * colours, the medal's milled edge and the podium come from here, so the two
 * cabinets cannot drift apart.
 */

export const trophiesKey = ['trophies'] as const;

export function useTrophyCabinet() {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: trophiesKey,
    enabled: isAuthed,
    queryFn: async (): Promise<TrophyCabinet> => {
      try {
        return TrophyCabinetSchema.parse(await http().get('me/trophies').json());
      } catch (error) {
        throw await toError(error, 'trophy cabinet');
      }
    },
  });
}

export function useLeaderboard(scope: LeaderboardScope, period: LeaderboardPeriod) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: [...trophiesKey, 'leaderboard', scope, period],
    enabled: isAuthed,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Leaderboard> => {
      try {
        const json = await http()
          .get('me/trophies/leaderboard', { searchParams: { scope, period } })
          .json();
        return LeaderboardSchema.parse(json);
      } catch (error) {
        throw await toError(error, 'leaderboard');
      }
    },
  });
}

// ── shelves ────────────────────────────────────────────────────────────────

export const trophyIsUnlocked = (t: TrophyEntry): boolean => t.unlockedAt !== null;

/** 0–100, whole numbers: how full a locked prism's glass is. */
export function trophyPercent(t: TrophyEntry): number {
  if (t.unlockedAt) return 100;
  return Math.min(100, Math.floor((t.progress / t.target) * 100));
}

/** Newest unlock first. */
export function recentTrophies(cabinet: TrophyCabinet, limit: number): TrophyEntry[] {
  return cabinet.trophies
    .filter(trophyIsUnlocked)
    .sort((a, b) => (b.unlockedAt as string).localeCompare(a.unlockedAt as string))
    .slice(0, limit);
}

/** Closest to done first; among equals, the one worth more. */
export function nextUpTrophies(cabinet: TrophyCabinet, limit: number): TrophyEntry[] {
  return cabinet.trophies
    .filter((t) => !trophyIsUnlocked(t))
    .sort((a, b) => trophyPercent(b) - trophyPercent(a) || b.points - a.points)
    .slice(0, limit);
}

/** Holder share as the design prints it: one decimal under 10%, whole above. */
export function formatRarity(rarity: number): string {
  if (rarity >= 10) return `${Math.round(rarity)}%`;
  return `${rarity.toFixed(1)}%`;
}

// ── materials ──────────────────────────────────────────────────────────────

export const PRISM_STOPS = ['#d9a441', '#d96bb0', '#8b5cf6'] as const;

export interface TierMaterial {
  /** The metal's lit top and its shadowed foot; the prism tier uses `PRISM_FACES` instead. */
  light: string;
  base: string;
  glow: string;
  /** Text colour for the tier's label. */
  fg: string;
  /** Gradient stops for the little hexagon chip, 135°. */
  chip: readonly string[];
  /** What a locked prism's glass fills with. */
  tint: string;
  /** Prism height in px; rarer is taller. */
  height: number;
}

export const TIER_MATERIAL: Record<TrophyTier, TierMaterial> = {
  bronze: {
    light: '#f3c49a',
    base: '#8a4f2a',
    glow: 'rgba(222,150,96,0.5)',
    fg: '#e8a97a',
    chip: ['#f3c49a', '#8a4f2a'],
    tint: 'rgba(222,150,96,0.55)',
    height: 40,
  },
  silver: {
    light: '#f6f7fb',
    base: '#7b8196',
    glow: 'rgba(220,226,242,0.42)',
    fg: '#d5d9e6',
    chip: ['#f6f7fb', '#7b8196'],
    tint: 'rgba(220,226,242,0.5)',
    height: 48,
  },
  gold: {
    light: '#ffe39a',
    base: '#a8741c',
    glow: 'rgba(244,196,84,0.55)',
    fg: '#f0c766',
    chip: ['#ffe39a', '#a8741c'],
    tint: 'rgba(244,196,84,0.55)',
    height: 56,
  },
  prism: {
    light: '#ffe1a6',
    base: '#8b5cf6',
    glow: 'rgba(217,107,176,0.6)',
    fg: '#e58cc4',
    chip: PRISM_STOPS,
    tint: 'rgba(217,107,176,0.55)',
    height: 64,
  },
};

/** Tiers in the order the summary strip and the rows list them, rarest first. */
export const TIERS_RAREST_FIRST: readonly TrophyTier[] = ['prism', 'gold', 'silver', 'bronze'];

const FACE_SHADE = [0, 0.16, 0.3, 0.38, 0.3, 0.12] as const;
const PRISM_FACES = ['#d9a441', '#e58a7c', '#d96bb0', '#a866d6', '#8b5cf6', '#b86fc2'] as const;
const GLASS_EMPTY = 'rgba(255,255,255,0.05)';

/** A hexagonal prism: six faces 20px wide, 17.32px out from the axis, each 60° apart. */
export const PRISM_GEOMETRY = { faces: 6, faceWidth: 20, apothem: 17.32, width: 40 } as const;

export type PrismFace =
  | { type: 'solid'; top: string; bottom: string; shade: number; sheen: boolean }
  /** Locked: empty glass, filled from the bottom to `fill` (0–1). */
  | { type: 'glass'; fill: number; tint: string; empty: string };

export interface PrismLook {
  height: number;
  faces: PrismFace[];
  /** The top cap's gradient stops (a single stop is a flat colour). */
  cap: readonly string[];
  glow: string;
}

export function prismLook(
  t: Pick<TrophyEntry, 'tier' | 'unlockedAt' | 'progress' | 'target'>,
): PrismLook {
  const m = TIER_MATERIAL[t.tier];
  const locked = t.unlockedAt === null;
  const fill = Math.min(1, t.progress / t.target);
  const faces = FACE_SHADE.map((shade, i): PrismFace => {
    if (locked) return { type: 'glass', fill, tint: m.tint, empty: GLASS_EMPTY };
    if (t.tier === 'prism')
      return {
        type: 'solid',
        top: PRISM_FACES[i] as string,
        bottom: PRISM_FACES[(i + 2) % 6] as string,
        shade: 0,
        sheen: true,
      };
    return { type: 'solid', top: m.light, bottom: m.base, shade, sheen: false };
  });
  const cap = locked
    ? [fill >= 1 ? m.tint : 'rgba(255,255,255,0.1)']
    : t.tier === 'prism'
      ? ['#ffe1a6', '#ffc2e4', '#cdb8ff']
      : [m.light];
  return { height: m.height, faces, cap, glow: locked ? 'rgba(255,255,255,0.08)' : m.glow };
}

/** Idle spin: each prism on a shelf turns at its own speed and phase, so the shelf never marches. */
export function prismSpin(index: number): { durationMs: number; phase: number } {
  const n = index + 1;
  return { durationMs: (8 + (n % 4) * 1.5) * 1000, phase: ((n * 1.7) % 9) / 9 };
}

// ── the medal ──────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

interface MedalMetal {
  /** Conic stops for the face, from 200°. */
  face: readonly string[];
  /** The milled edge runs through these. */
  rim: readonly Rgb[];
  halo: string;
}

const MEDAL_METAL: Record<TrophyTier | 'glass', MedalMetal> = {
  prism: {
    face: ['#d9a441', '#d96bb0', '#8b5cf6', '#d96bb0', '#d9a441'],
    rim: [
      [217, 164, 65],
      [217, 107, 176],
      [139, 92, 246],
      [217, 107, 176],
      [217, 164, 65],
    ],
    halo: 'rgba(217,107,176,0.35)',
  },
  gold: {
    face: ['#ffe39a', '#c8902a', '#ffe39a', '#a8741c', '#ffe39a'],
    rim: [
      [255, 227, 154],
      [200, 144, 42],
      [255, 227, 154],
      [168, 116, 28],
      [255, 227, 154],
    ],
    halo: 'rgba(244,196,84,0.3)',
  },
  silver: {
    face: ['#f6f7fb', '#9aa0b4', '#f6f7fb', '#7b8196', '#f6f7fb'],
    rim: [
      [246, 247, 251],
      [154, 160, 180],
      [246, 247, 251],
      [123, 129, 150],
      [246, 247, 251],
    ],
    halo: 'rgba(220,226,242,0.22)',
  },
  bronze: {
    face: ['#f3c49a', '#a8643a', '#f3c49a', '#8a4f2a', '#f3c49a'],
    rim: [
      [243, 196, 154],
      [168, 100, 58],
      [243, 196, 154],
      [138, 79, 42],
      [243, 196, 154],
    ],
    halo: 'rgba(222,150,96,0.28)',
  },
  glass: {
    face: ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.04)'],
    rim: [
      [120, 112, 132],
      [70, 64, 80],
      [120, 112, 132],
      [70, 64, 80],
      [120, 112, 132],
    ],
    halo: 'rgba(255,255,255,0.06)',
  },
};

export const MEDAL_RIM_SLICES = 48;

/**
 * How the medal turns. A release keeps the drag's speed (capped), and that
 * speed relaxes back to the idle turn: v = idle + (v - idle)·e^(-dt/settleMs).
 */
export const MEDAL_SPIN = {
  idleDegPerMs: 360 / 14_000,
  dragDegPerPx: 0.9,
  maxDegPerMs: 1.6,
  settleMs: 1_400,
} as const;

export interface MedalLook {
  face: readonly string[];
  halo: string;
  /** One colour per slice of the milled edge, alternating lit and shadowed. */
  rim: string[];
  locked: boolean;
}

export function medalLook(t: Pick<TrophyEntry, 'tier' | 'unlockedAt'>): MedalLook {
  const locked = t.unlockedAt === null;
  const metal = MEDAL_METAL[locked ? 'glass' : t.tier];
  const rim = Array.from({ length: MEDAL_RIM_SLICES }, (_, i) => {
    const x = (i / MEDAL_RIM_SLICES) * 4;
    const s = Math.min(3, Math.floor(x));
    const f = x - s;
    const from = metal.rim[s] as Rgb;
    const to = metal.rim[s + 1] as Rgb;
    const dim = i % 2 === 1 ? 0.62 : 0.92;
    const c = from.map((v, k) => Math.round((v + ((to[k] as number) - v) * f) * dim));
    return `rgb(${c.join(',')})`;
  });
  return { face: metal.face, halo: metal.halo, rim, locked };
}

/** Polyglot's six kind dots, as offsets from the medal's centre at `radius`. */
export function medalKindDots(radius: number): { x: number; y: number }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

// ── the podium ─────────────────────────────────────────────────────────────

/** Board ranks in the order the blocks stand: 2 · 1 · 3. Indexes into `rows`. */
export const PODIUM_ORDER = [1, 0, 2] as const;
/** Block height by rank (1st, 2nd, 3rd). */
export const PODIUM_HEIGHTS = [118, 88, 66] as const;

export interface PodiumBlock {
  front: readonly string[];
  top: readonly string[];
  side: readonly string[];
}

export const PODIUM_BLOCKS: readonly PodiumBlock[] = [
  {
    front: ['#f0c26a', '#e58cc4', '#9a72f8'],
    top: ['#ffd995', '#ffb6de', '#c8b2ff'],
    side: ['#9a5fc0', '#4a2a78'],
  },
  { front: ['#eef0f6', '#8e93a8'], top: ['#f8f9fc'], side: ['#8a8fa4', '#4a4f60'] },
  { front: ['#efbc93', '#8a4f2a'], top: ['#f6cda6'], side: ['#8f5530', '#4e2a14'] },
];

export type DeltaTone = 'up' | 'down' | 'flat';

/** "▲ 2", "▼ 1", "—"; null on the all-time board, where there is no last period. */
export function formatDelta(delta: number | null): { text: string; tone: DeltaTone } | null {
  if (delta === null) return null;
  if (delta > 0) return { text: `▲ ${delta}`, tone: 'up' };
  if (delta < 0) return { text: `▼ ${-delta}`, tone: 'down' };
  return { text: '—', tone: 'flat' };
}

export const DELTA_COLOR: Record<DeltaTone, string> = {
  up: '#3fbf8f',
  down: '#e58cc4',
  flat: '#948da1',
};

/** "TOP 6%" for the viewer's place in a population; never "TOP 0%". */
export function topPercent(rank: number, population: number): number {
  if (population <= 0) return 100;
  return Math.max(1, Math.ceil((rank / population) * 100));
}
