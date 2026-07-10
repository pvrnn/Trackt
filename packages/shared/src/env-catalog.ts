import { z } from 'zod';
import { EnvValidationError, LOG_LEVELS } from './env.js';

/**
 * Configuration for the central catalog service (apps/catalog, ADR-0001).
 * Same philosophy as {@link loadEnv}: dev defaults so a fresh clone runs with
 * zero configuration, production refuses to boot without the critical variables.
 */

const RawCatalogEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().startsWith('postgres', 'must be a postgres:// URL').optional(),
  CATALOG_ADMIN_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

const DEV_DEFAULTS = {
  DATABASE_URL: 'postgres://trackt:trackt@localhost:5433/trackt_catalog',
} as const;

const HINTS: Record<string, string> = {
  DATABASE_URL:
    'e.g. postgres://trackt:trackt@localhost:5433/trackt_catalog — docker-compose.dev.yml provides this database',
  CATALOG_ADMIN_TOKEN: 'generate one with: openssl rand -base64 32',
};

export interface CatalogEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  CATALOG_ADMIN_TOKEN?: string | undefined;
  LOG_LEVEL: (typeof LOG_LEVELS)[number];
}

/**
 * Parse and validate catalog-service configuration from `source`.
 * Throws {@link EnvValidationError} with an actionable message on failure.
 */
export function loadCatalogEnv(
  source: Record<string, string | undefined> = process.env,
): CatalogEnv {
  const parsed = RawCatalogEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.');
      return `  ✗ ${key}: ${issue.message}${HINTS[key] ? ` (${HINTS[key]})` : ''}`;
    });
    throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  const raw = parsed.data;

  if (raw.NODE_ENV === 'production') {
    const missing = (['DATABASE_URL', 'CATALOG_ADMIN_TOKEN'] as const).filter((key) => !raw[key]);
    if (missing.length > 0) {
      const lines = missing.map((key) => `  ✗ ${key} — ${HINTS[key]}`);
      throw new EnvValidationError(
        `Missing required environment variables in production:\n${lines.join('\n')}`,
      );
    }
  }

  return {
    ...raw,
    DATABASE_URL: raw.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    // Empty string means "unset" (compose files pass optional keys through as '').
    CATALOG_ADMIN_TOKEN: raw.CATALOG_ADMIN_TOKEN || undefined,
  };
}
