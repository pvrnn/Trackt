import { z } from 'zod';
import { MediaKindSchema } from './media.js';

/**
 * Trophies (`GET /api/v1/me/trophies`, `GET /api/v1/me/trophies/leaderboard`).
 * The catalogue is code, not data: every trophy is derived from tracking rows,
 * and the evaluator in `@trackt/db` records the moment each one's target was
 * first reached. Names and descriptions live in each client's i18n by id.
 */

export const TROPHY_TIERS = ['bronze', 'silver', 'gold', 'prism'] as const;
export const TrophyTierSchema = z.enum(TROPHY_TIERS);
export type TrophyTier = z.infer<typeof TrophyTierSchema>;

export const TROPHY_TIER_POINTS: Record<TrophyTier, number> = {
  bronze: 15,
  silver: 30,
  gold: 90,
  prism: 180,
};

/** What a trophy's progress counts — the client picks the unit label from it. */
export const TROPHY_UNITS = [
  'titles',
  'completions',
  'kinds',
  'ratings',
  'lists',
  'friends',
  'favorites',
  'services',
  'checkins',
  'chapters',
  'seasons',
] as const;
export type TrophyUnit = (typeof TROPHY_UNITS)[number];

export interface TrophyDefinition {
  id: string;
  tier: TrophyTier;
  target: number;
  unit: TrophyUnit;
}

/** Ids are stored in `user_trophy`, so renaming one orphans every unlock of it. */
export const TROPHIES = [
  { id: 'first-log', tier: 'bronze', target: 1, unit: 'titles' },
  { id: 'curtain-call', tier: 'bronze', target: 1, unit: 'completions' },
  { id: 'opinionated', tier: 'bronze', target: 10, unit: 'ratings' },
  { id: 'curator', tier: 'bronze', target: 1, unit: 'lists' },
  { id: 'plus-one', tier: 'bronze', target: 1, unit: 'friends' },
  { id: 'heart-on-sleeve', tier: 'bronze', target: 5, unit: 'favorites' },
  { id: 'archivist', tier: 'bronze', target: 2, unit: 'services' },
  { id: 'regular', tier: 'silver', target: 25, unit: 'completions' },
  { id: 'explorer', tier: 'silver', target: 3, unit: 'kinds' },
  { id: 'critic', tier: 'silver', target: 50, unit: 'ratings' },
  { id: 'century', tier: 'silver', target: 100, unit: 'checkins' },
  { id: 'day-one', tier: 'silver', target: 10, unit: 'checkins' },
  { id: 'inner-circle', tier: 'silver', target: 5, unit: 'friends' },
  { id: 'binge-engine', tier: 'gold', target: 1, unit: 'seasons' },
  { id: 'long-haul', tier: 'gold', target: 100, unit: 'chapters' },
  { id: 'completionist', tier: 'gold', target: 100, unit: 'completions' },
  { id: 'thousand-nights', tier: 'gold', target: 1000, unit: 'checkins' },
  { id: 'polyglot', tier: 'prism', target: 6, unit: 'kinds' },
  { id: 'living-archive', tier: 'prism', target: 500, unit: 'completions' },
] as const satisfies readonly TrophyDefinition[];

export type TrophyId = (typeof TROPHIES)[number]['id'];
export const TROPHY_IDS = TROPHIES.map((t) => t.id) as [TrophyId, ...TrophyId[]];
export const TrophyIdSchema = z.enum(TROPHY_IDS);

export function trophyDefinition(id: TrophyId): (typeof TROPHIES)[number] {
  return TROPHIES.find((t) => t.id === id) as (typeof TROPHIES)[number];
}

/** A title that earned (part of) a trophy — Polyglot's one per kind, Long Haul's series. */
export const TrophyEvidenceSchema = z.object({
  mediaId: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type TrophyEvidence = z.infer<typeof TrophyEvidenceSchema>;

export const TrophyFriendSchema = z.object({
  username: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

export const TrophyEntrySchema = z.object({
  id: TrophyIdSchema,
  tier: TrophyTierSchema,
  points: z.number().int(),
  unit: z.enum(TROPHY_UNITS),
  target: z.number().int().positive(),
  /** Capped at `target`; equal to it once unlocked. */
  progress: z.number().int().nonnegative(),
  unlockedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Holders on this instance; `rarity` is their share of all accounts, 0–100. */
  holders: z.number().int().nonnegative(),
  rarity: z.number().nonnegative(),
  /** 1-based order among holders; null while locked. */
  serial: z.number().int().positive().nullable(),
  /** Friends who hold it — the first few by name, plus the total. */
  friends: z.object({ count: z.number().int().nonnegative(), sample: z.array(TrophyFriendSchema) }),
  evidence: z.array(TrophyEvidenceSchema),
});
export type TrophyEntry = z.infer<typeof TrophyEntrySchema>;

export const TrophyTierCountsSchema = z.object({
  bronze: z.number().int().nonnegative(),
  silver: z.number().int().nonnegative(),
  gold: z.number().int().nonnegative(),
  prism: z.number().int().nonnegative(),
});
export type TrophyTierCounts = z.infer<typeof TrophyTierCountsSchema>;

export const TrophyCabinetSchema = z.object({
  owner: z.object({ username: z.string(), name: z.string() }),
  points: z.number().int().nonnegative(),
  unlocked: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  tiers: TrophyTierCountsSchema,
  /** All-time rank among the viewer and their friends; 1 when they have none. */
  friendsRank: z.number().int().positive(),
  /** This month's global rank; null with no points this month. */
  globalMonthRank: z.number().int().positive().nullable(),
  trophies: z.array(TrophyEntrySchema),
});
export type TrophyCabinet = z.infer<typeof TrophyCabinetSchema>;

export const LEADERBOARD_SCOPES = ['friends', 'global'] as const;
export const LeaderboardScopeSchema = z.enum(LEADERBOARD_SCOPES);
export type LeaderboardScope = z.infer<typeof LeaderboardScopeSchema>;

export const LEADERBOARD_PERIODS = ['week', 'month', 'all'] as const;
export const LeaderboardPeriodSchema = z.enum(LEADERBOARD_PERIODS);
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriodSchema>;

export const LeaderboardQuerySchema = z.object({
  scope: LeaderboardScopeSchema.default('friends'),
  period: LeaderboardPeriodSchema.default('month'),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const LeaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  username: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  isViewer: z.boolean(),
  points: z.number().int().nonnegative(),
  /** All-time holdings by tier, whatever the period. */
  tiers: TrophyTierCountsSchema,
  /** Places gained since the previous period; null for all-time or a newcomer. */
  delta: z.number().int().nullable(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export const LeaderboardSchema = z.object({
  scope: LeaderboardScopeSchema,
  period: LeaderboardPeriodSchema,
  /** Accounts the board ranks against: friends + viewer, or every account. */
  population: z.number().int().nonnegative(),
  /** Best first; the global board stops at its top rows. */
  rows: z.array(LeaderboardRowSchema),
  /** The viewer's own row when it isn't among `rows` (global only). */
  viewer: LeaderboardRowSchema.nullable(),
  /** Friends board only: the one place up, and the locked trophy that would take it. */
  chase: z
    .object({
      points: z.number().int().positive(),
      rival: z.string(),
      rank: z.number().int().positive(),
      trophy: TrophyIdSchema.nullable(),
    })
    .nullable(),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;
