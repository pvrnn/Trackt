import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { featureFlagOverrides, featureFlags, type Db } from '@trackt/db';
import {
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  parseFlagOverrides,
  type Env,
  type FlagDefinition,
  type FlagEnvValue,
  type FlagKey,
} from '@trackt/shared';
import { getSessionUser } from './session.js';

/**
 * Feature-flag evaluation (ADR-0011). This module is the only place that reads
 * the `feature_flag` tables, so the precedence below is implemented once:
 *
 *   env override > kill switch / schedule > per-user override > country > rollout
 *
 * Two orderings are load-bearing: the kill switch outranks an override (an
 * emergency must not be defeated by a QA grant), and an override outranks the
 * country allowlist (support sometimes has to show a French user a
 * France-gated feature while they debug it).
 */

/** Buckets per flag: 1% is one bucket in a hundred. */
const BUCKETS = 10_000;

/** How long a rules snapshot may be reused across requests. */
const RULE_TTL_MS = 5_000;

/** Cloudflare's unknown marker and its Tor marker are "no country", not a country. */
const UNKNOWN_COUNTRIES = new Set(['XX', 'T1']);

export interface FlagContext {
  userId?: string | undefined;
  /** ISO alpha-2, already resolved and validated by `countryFrom()`. */
  country?: string | undefined;
}

export interface FlagRuleRow {
  key: string;
  enabled: boolean;
  rollout: number;
  countries: string[];
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Stable-for-life percentage bucket. The input is the immutable user id, so a
 * bucket never moves across sessions or devices; the flag key is in the hash,
 * so the same unlucky 10% is not excluded from every feature; and
 * `bucket < rollout * 100` is monotonic, so widening a rollout only ever adds
 * users.
 */
export function bucket(flag: string, userId: string): number {
  return createHash('sha256').update(`${flag}:${userId}`).digest().readUInt32BE(0) % BUCKETS;
}

function normalizeCountry(value: string | undefined): string | undefined {
  const country = value?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country) || UNKNOWN_COUNTRIES.has(country)) return undefined;
  return country;
}

/**
 * Country of the viewer: the trusted proxy header first, then the fixed
 * `FLAG_COUNTRY` for a single-region deployment. Unknown fails closed for any
 * flag with a non-empty allowlist ("not released here" is the safe read).
 *
 * Only name a header your own edge sets. An API exposed directly makes this an
 * honour system — acceptable for release gating, not for anything legal.
 */
export function countryFrom(
  request: Pick<FastifyRequest, 'headers'>,
  env: Pick<Env, 'FLAG_COUNTRY_HEADER' | 'FLAG_COUNTRY'>,
): string | undefined {
  const header = env.FLAG_COUNTRY_HEADER?.trim().toLowerCase();
  if (header) {
    const raw = request.headers[header];
    const fromHeader = normalizeCountry(Array.isArray(raw) ? raw[0] : raw);
    if (fromHeader) return fromHeader;
  }
  return normalizeCountry(env.FLAG_COUNTRY);
}

function rolloutAllows(key: FlagKey, percent: number, userId: string | undefined): boolean {
  // 100% excludes nobody and pays no hash; anonymous is eligible only there.
  if (percent >= 100) return true;
  if (percent <= 0 || !userId) return false;
  return bucket(key, userId) < percent * 100;
}

export interface EvaluateInput {
  key: FlagKey;
  definition: FlagDefinition;
  rule?: FlagRuleRow | null | undefined;
  override?: boolean | undefined;
  context: FlagContext;
  /** The parsed `FEATURE_FLAGS` value for this key, if the operator set one. */
  envOverride?: FlagEnvValue | undefined;
  now?: Date;
}

/**
 * The pure decision, in the plan's precedence order. Kept free of the database-
 * and request-shaped inputs so the whole matrix is unit-testable.
 */
export function evaluate({
  key,
  definition,
  rule,
  override,
  context,
  envOverride,
  now = new Date(),
}: EvaluateInput): boolean {
  // The operator's emergency knob wins over everything, in both directions.
  if (envOverride !== undefined) {
    return typeof envOverride === 'boolean'
      ? envOverride
      : rolloutAllows(key, envOverride, context.userId);
  }

  // No row is the compiled default, not "off": an instance that never touched
  // the flag keeps whatever the code ships.
  if (!rule) return definition.default;

  if (!rule.enabled) return false;
  if (rule.startsAt && now < rule.startsAt) return false;
  if (rule.endsAt && now >= rule.endsAt) return false;

  if (override !== undefined) return override;

  if (rule.countries.length > 0) {
    if (!context.country || !rule.countries.includes(context.country)) return false;
  }

  return rolloutAllows(key, rule.rollout, context.userId);
}

// ── rules cache ──────────────────────────────────────────────────────────────

let ruleCache: { rows: Map<string, FlagRuleRow>; expiresAt: number } | null = null;

/** Every admin write calls this; other processes converge within the TTL. */
export function clearFlagCache(): void {
  ruleCache = null;
}

/**
 * Rules memoized for 5s per process. A database failure answers the compiled
 * defaults and logs a warning — `/v1/flags` must not be able to break a page
 * that would otherwise render.
 */
export async function loadFlagRows(
  db: Db | undefined,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<Map<string, FlagRuleRow>> {
  if (!db) return new Map();
  const now = Date.now();
  if (ruleCache && ruleCache.expiresAt > now) return ruleCache.rows;

  try {
    const rows = await db.select().from(featureFlags);
    const map = new Map<string, FlagRuleRow>(
      rows.map((row) => [
        row.key,
        {
          key: row.key,
          enabled: row.enabled,
          rollout: row.rollout,
          countries: row.countries,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        },
      ]),
    );
    ruleCache = { rows: map, expiresAt: now + RULE_TTL_MS };
    return map;
  } catch (error) {
    log?.warn({ err: error }, 'feature flag rules unreadable — answering compiled defaults');
    return new Map();
  }
}

/** Overrides are never cached: a QA grant works on the next request. */
async function loadOverrides(
  db: Db | undefined,
  userId: string | undefined,
  keys: FlagKey[],
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!db || !userId || keys.length === 0) return result;
  try {
    const rows = await db
      .select({ key: featureFlagOverrides.key, enabled: featureFlagOverrides.enabled })
      .from(featureFlagOverrides)
      .where(and(eq(featureFlagOverrides.userId, userId), inArray(featureFlagOverrides.key, keys)));
    for (const row of rows) result.set(row.key, row.enabled);
  } catch (error) {
    log?.warn({ err: error }, 'feature flag overrides unreadable — ignoring them');
  }
  return result;
}

// ── request-scoped evaluation ───────────────────────────────────────────────

const countryWarned = new Set<FlagKey>();

function warnOnceAboutCountry(key: FlagKey, env: Env, log: Pick<FastifyBaseLogger, 'warn'>): void {
  if (env.FLAG_COUNTRY_HEADER || env.FLAG_COUNTRY || countryWarned.has(key)) return;
  countryWarned.add(key);
  log.warn(
    { flag: key },
    'a feature flag has a country allowlist but neither FLAG_COUNTRY_HEADER nor FLAG_COUNTRY is set — every viewer reads as unknown and fails closed',
  );
}

function envOverrides(env: Env): Partial<Record<FlagKey, FlagEnvValue>> {
  return parseFlagOverrides(env.FEATURE_FLAGS).overrides;
}

export interface FlagEvaluation {
  key: FlagKey;
  definition: FlagDefinition;
  rule: FlagRuleRow | null;
  anonymous: boolean;
  user: boolean | null;
}

/**
 * Resolve every flag for one request context. The rules are one query (cached),
 * the overrides one primary-key query for the viewer, and the session is
 * already memoized on the request.
 */
export async function evaluateSnapshot(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<Record<FlagKey, boolean>> {
  const user = await getSessionUser(app, request);
  const context: FlagContext = {
    userId: user?.id,
    country: countryFrom(request, app.deps.env),
  };
  const rows = await loadFlagRows(app.deps.db, app.log);
  const overrides = await loadOverrides(app.deps.db, user?.id, FLAG_KEYS, app.log);
  const env = envOverrides(app.deps.env);

  const flags = {} as Record<FlagKey, boolean>;
  for (const key of FLAG_KEYS) {
    const rule = rows.get(key) ?? null;
    if (rule?.countries.length) warnOnceAboutCountry(key, app.deps.env, app.log);
    flags[key] = evaluate({
      key,
      definition: FLAG_DEFINITIONS[key],
      rule,
      override: overrides.get(key),
      context,
      envOverride: env[key],
    });
  }
  return flags;
}

/**
 * One flag for the requesting viewer — what a `requireFlag` guard and any
 * handler-side branch reads. Everything that reads a flag goes through this.
 */
export async function isFlagOn(
  app: FastifyInstance,
  request: FastifyRequest,
  key: FlagKey,
): Promise<boolean> {
  const flags = await evaluateSnapshot(app, request);
  return flags[key];
}

/**
 * The admin read's per-key answer for an explicit context. Separate from
 * `evaluateSnapshot` because the operator may ask about a user who is not the
 * caller, and a partial rollout has no single "signed-in" answer to report.
 */
export async function evaluateFlagForKey(
  app: FastifyInstance,
  key: FlagKey,
  context: FlagContext,
  env: Env = app.deps.env,
): Promise<{ anonymous: boolean; user: boolean | null }> {
  const rows = await loadFlagRows(app.deps.db, app.log);
  const rule = rows.get(key) ?? null;
  const definition = FLAG_DEFINITIONS[key];
  const envValue = envOverrides(env)[key];
  if (rule?.countries.length) warnOnceAboutCountry(key, env, app.log);

  const anonymous = evaluate({ key, definition, rule, context: {}, envOverride: envValue });
  const user =
    context.userId === undefined
      ? null
      : evaluate({
          key,
          definition,
          rule,
          override: await loadOverride(app.deps.db, key, context.userId, app.log),
          context,
          envOverride: envValue,
        });
  return { anonymous, user };
}

async function loadOverride(
  db: Db | undefined,
  key: FlagKey,
  userId: string,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<boolean | undefined> {
  if (!db) return undefined;
  try {
    const [row] = await db
      .select({ enabled: featureFlagOverrides.enabled })
      .from(featureFlagOverrides)
      .where(and(eq(featureFlagOverrides.key, key), eq(featureFlagOverrides.userId, userId)))
      .limit(1);
    return row?.enabled;
  } catch (error) {
    log?.warn({ err: error, flag: key }, 'feature flag override unreadable — ignoring it');
    return undefined;
  }
}

/**
 * `preHandler` factory, wired like the catalog's `requireAdmin`: a route cannot
 * forget to check a boolean return. A closed gate answers `404`, never `403` —
 * don't advertise unreleased endpoints (the same posture as an unpublished news
 * slug, ADR-0005).
 */
export function requireFlag(key: FlagKey) {
  return async function flagGate(request: FastifyRequest, reply: FastifyReply) {
    if (!(await isFlagOn(request.server, request, key))) {
      return reply.status(404).send({ error: 'not found' });
    }
  };
}
