import { z } from 'zod';

/**
 * Feature gating (ADR-0011, docs/feature-gating-plan.md).
 *
 * The registry is code, not data: it is the source of truth for which keys
 * exist and what a client renders before the instance's rule is known. The
 * database holds only deviations (apps/api/src/lib/flags.ts), so an empty
 * `feature_flag` table is a fully working instance and a key deleted here dies
 * with the feature it described.
 *
 * Only two kinds are allowed in:
 *
 * - **release flag** — `default: false`, rolled out, deleted after GA;
 * - **kill switch** — `default: true`, so an absent row, an unreachable
 *   `/v1/flags` and an old mobile binary all keep the shipped feature.
 */
export interface FlagDefinition {
  summary: string;
  /** Who is on the hook to delete it. */
  owner: string;
  /** What a client renders before the snapshot resolves — the shipped state. */
  default: boolean;
  /** YYYY-MM-DD. Audit input, never a runtime error. */
  removeBy: string;
}

export const FLAG_DEFINITIONS = {
  'lists.custom': {
    summary: 'Custom lists: reading, creating and editing them, on both clients (PRD §3.4).',
    owner: 'paul',
    default: true,
    removeBy: '2027-06-30',
  },
} satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_DEFINITIONS;

/** Every registry key, in registry order — what `/v1/flags` answers with. */
export const FLAG_KEYS = Object.keys(FLAG_DEFINITIONS) as FlagKey[];

export const FlagsSnapshotSchema = z.object({ flags: z.record(z.string(), z.boolean()) });
export type FlagsSnapshot = z.infer<typeof FlagsSnapshotSchema>;

/** ISO 3166-1 alpha-2, as the operator writes it in an allowlist. */
export const FlagCountrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code, uppercase');

const FlagWindowSchema = z.iso.datetime({ offset: true }).nullable();

export const PatchFlagBodySchema = z
  .object({
    enabled: z.boolean(),
    rollout: z.number().int().min(0).max(100),
    countries: z.array(FlagCountrySchema),
    startsAt: FlagWindowSchema,
    endsAt: FlagWindowSchema,
  })
  .partial();
export type PatchFlagBody = z.infer<typeof PatchFlagBodySchema>;

export const FlagOverrideBodySchema = z.object({ enabled: z.boolean() });
export type FlagOverrideBody = z.infer<typeof FlagOverrideBodySchema>;

export const FlagRuleSchema = z.object({
  enabled: z.boolean(),
  rollout: z.number().int(),
  countries: z.array(z.string()),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});
export type FlagRule = z.infer<typeof FlagRuleSchema>;

export const AdminFlagSchema = z.object({
  key: z.string(),
  summary: z.string(),
  owner: z.string(),
  default: z.boolean(),
  removeBy: z.string(),
  /** `env` means FEATURE_FLAGS owns the key: the UI must lock it, not hide it. */
  source: z.enum(['default', 'db', 'env']),
  rule: FlagRuleSchema.nullable(),
  warnings: z.array(z.string()),
  /** What a signed-out visitor gets. A partial rollout has no single "signed-in" answer. */
  anonymous: z.boolean(),
  /** The named viewer's answer, only when the operator asked for one. */
  user: z.object({ id: z.string(), enabled: z.boolean() }).nullable(),
});
export type AdminFlag = z.infer<typeof AdminFlagSchema>;

export const AdminFlagsSchema = z.object({ flags: z.array(AdminFlagSchema) });
export type AdminFlags = z.infer<typeof AdminFlagsSchema>;

/** `on` | `off` | a whole percent — the grammar of `FEATURE_FLAGS`. */
export type FlagEnvValue = boolean | number;

export interface ParsedFlagOverrides {
  overrides: Partial<Record<FlagKey, FlagEnvValue>>;
  warnings: string[];
}

/**
 * Parse `FEATURE_FLAGS="lists.custom=off,news.media-strip=25"`.
 *
 * Returns its complaints rather than logging them, so `loadEnv` can print them
 * once at boot and a unit test can assert them without a server. An unknown key
 * or a malformed value is warned and ignored: a stale `.env` must never brick
 * an upgrade, and a key removed from the registry is a normal event.
 */
export function parseFlagOverrides(input: string | undefined | null): ParsedFlagOverrides {
  const overrides: Partial<Record<FlagKey, FlagEnvValue>> = {};
  const warnings: string[] = [];
  if (!input || input.trim() === '') return { overrides, warnings };

  for (const raw of input.split(',')) {
    const entry = raw.trim();
    if (entry === '') {
      warnings.push('FEATURE_FLAGS has an empty entry — ignored');
      continue;
    }
    const separator = entry.indexOf('=');
    const key = separator === -1 ? entry : entry.slice(0, separator).trim();
    const value = separator === -1 ? '' : entry.slice(separator + 1).trim();

    if (!(key in FLAG_DEFINITIONS)) {
      warnings.push(`FEATURE_FLAGS names unknown flag '${key}' — ignored`);
      continue;
    }
    const typed = key as FlagKey;

    if (overrides[typed] !== undefined) {
      warnings.push(`FEATURE_FLAGS sets '${typed}' twice — the last value wins`);
    }

    if (value === 'on') {
      overrides[typed] = true;
    } else if (value === 'off') {
      overrides[typed] = false;
    } else if (/^\d{1,3}$/.test(value) && Number(value) <= 100) {
      overrides[typed] = Number(value);
    } else {
      warnings.push(
        `FEATURE_FLAGS value '${value}' for '${typed}' is not on, off or 0-100 — ignored`,
      );
    }
  }

  return { overrides, warnings };
}
