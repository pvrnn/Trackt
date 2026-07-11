import { z } from 'zod';

/**
 * All configuration comes from environment variables (PRD §6.1), validated here at startup.
 *
 * Development/test get sensible defaults so a fresh clone runs with zero configuration.
 * Production refuses to boot without the critical variables, with actionable errors.
 */

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.url().optional(),
  DATABASE_URL: z.string().startsWith('postgres', 'must be a postgres:// URL').optional(),
  REDIS_URL: z.string().startsWith('redis', 'must be a redis:// URL').optional(),
  AUTH_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  // Empty string means "unset" (compose files pass optional keys through as '').
  CATALOG_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  TMDB_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Set inside the monolith container: the API proxies non-API routes to the web SSR server. */
  WEB_PROXY_UPSTREAM: z.url().optional(),
});

const DEV_DEFAULTS = {
  DATABASE_URL: 'postgres://trackt:trackt@localhost:5432/trackt',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'trackt-dev-secret-do-not-use-in-production',
  CATALOG_URL: 'http://localhost:3002',
} as const;

/** How to fix each missing/invalid variable — shown in startup errors. */
const HINTS: Record<string, string> = {
  DATABASE_URL:
    'e.g. postgres://trackt:trackt@db:5432/trackt — the bundled docker-compose.yml sets this for you',
  REDIS_URL: 'e.g. redis://redis:6379 — the bundled docker-compose.yml sets this for you',
  AUTH_SECRET: 'generate one with: openssl rand -base64 32',
  CATALOG_URL:
    'base URL of the central slim catalog service (ADR-0001); unset disables catalog sync',
  TMDB_API_KEY:
    'optional — reserved for future per-instance enrichment (ADR-0001); free key at https://www.themoviedb.org/settings/api',
  APP_URL: 'the public URL of this instance, e.g. https://trackt.example.com',
};

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  APP_URL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  AUTH_SECRET: string;
  /** Central slim-catalog base URL; undefined (production only) disables catalog sync. */
  CATALOG_URL?: string | undefined;
  TMDB_API_KEY?: string | undefined;
  LOG_LEVEL: (typeof LOG_LEVELS)[number];
  UPLOADS_DIR: string;
  S3_ENDPOINT?: string | undefined;
  S3_REGION?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  WEB_PROXY_UPSTREAM?: string | undefined;
}

function withHint(key: string): string {
  return HINTS[key] ? `${key} — ${HINTS[key]}` : key;
}

/**
 * Parse and validate configuration from `source` (defaults to process.env).
 * Throws {@link EnvValidationError} with a human-readable, actionable message on failure.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.');
      return `  ✗ ${key}: ${issue.message}${HINTS[key] ? ` (${HINTS[key]})` : ''}`;
    });
    throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';

  if (isProduction) {
    const missing = (['DATABASE_URL', 'REDIS_URL', 'AUTH_SECRET'] as const).filter(
      (key) => !raw[key],
    );
    if (missing.length > 0) {
      const lines = missing.map((key) => `  ✗ ${withHint(key)}`);
      throw new EnvValidationError(
        `Missing required environment variables in production:\n${lines.join('\n')}`,
      );
    }
  }

  // Empty string means "unset" for optional keys (compose files pass them through as '').
  const tmdbApiKey = raw.TMDB_API_KEY || undefined;

  return {
    ...raw,
    APP_URL: raw.APP_URL ?? `http://localhost:${raw.PORT}`,
    DATABASE_URL: raw.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    REDIS_URL: raw.REDIS_URL ?? DEV_DEFAULTS.REDIS_URL,
    AUTH_SECRET: raw.AUTH_SECRET ?? DEV_DEFAULTS.AUTH_SECRET,
    // In production an unset CATALOG_URL stays unset (sync disabled, warned at
    // worker startup) — defaulting to localhost there would just fail opaquely.
    CATALOG_URL: raw.CATALOG_URL ?? (isProduction ? undefined : DEV_DEFAULTS.CATALOG_URL),
    TMDB_API_KEY: tmdbApiKey,
  };
}
