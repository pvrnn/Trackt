import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { featureFlagOverrides, featureFlags, users } from '@trackt/db';
import {
  AdminFlagSchema,
  AdminFlagsSchema,
  ApiErrorSchema,
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  FlagOverrideBodySchema,
  PatchFlagBodySchema,
  parseFlagOverrides,
  type AdminFlag,
  type FlagKey,
} from '@trackt/shared';
import { requireAdminRole } from '../../../lib/admin.js';
import {
  clearFlagCache,
  countryFrom,
  evaluateFlagForKey,
  type FlagContext,
} from '../../../lib/flags.js';
import { getSessionUser } from '../../../lib/session.js';

/**
 * `/v1/admin/flags` (ADR-0011) — the operator surface for rollout rules.
 *
 * `GET` deliberately reports `source`, so an operator staring at a rollout
 * slider that does nothing is told why (an env override owns the key) instead
 * of filing a bug. There is no single "signed-in" answer at a partial rollout:
 * the read reports the anonymous answer and, when asked, one named user's.
 */

function isRegistryKey(key: string): key is FlagKey {
  return key in FLAG_DEFINITIONS;
}

function envOwnedKeys(app: FastifyInstance): Set<string> {
  const { overrides } = parseFlagOverrides(app.deps.env.FEATURE_FLAGS);
  return new Set(Object.keys(overrides));
}

function ruleOrDefault(key: FlagKey) {
  return FLAG_DEFINITIONS[key];
}

function toAdminFlag(
  key: FlagKey,
  bit: {
    rule: {
      enabled: boolean;
      rollout: number;
      countries: string[];
      startsAt: Date | null;
      endsAt: Date | null;
      updatedAt: Date;
      updatedBy: string | null;
    } | null;
    source: 'default' | 'db' | 'env';
    anonymous: boolean;
    user: { id: string; enabled: boolean } | null;
    warnings: string[];
  },
): AdminFlag {
  const definition = ruleOrDefault(key);
  return {
    key,
    summary: definition.summary,
    owner: definition.owner,
    default: definition.default,
    removeBy: definition.removeBy,
    source: bit.source,
    rule: bit.rule
      ? {
          enabled: bit.rule.enabled,
          rollout: bit.rule.rollout,
          countries: bit.rule.countries,
          startsAt: bit.rule.startsAt?.toISOString() ?? null,
          endsAt: bit.rule.endsAt?.toISOString() ?? null,
          updatedAt: bit.rule.updatedAt.toISOString(),
          updatedBy: bit.rule.updatedBy,
        }
      : null,
    warnings: bit.warnings,
    anonymous: bit.anonymous,
    user: bit.user,
  };
}

/** A row's warnings — what the UI needs to explain a control that will not move. */
function readWarnings(
  app: FastifyInstance,
  key: FlagKey,
  rule: { countries: string[] } | null,
  envOwned: Set<string>,
): string[] {
  const warnings: string[] = [];
  if (envOwned.has(key)) {
    warnings.push(
      'FEATURE_FLAGS owns this key — the rule below is not consulted until it is removed',
    );
  }
  if (rule && rule.countries.length > 0 && !countrySourceConfigured(app)) {
    warnings.push(
      'This flag has a country allowlist but the instance has no country source — every viewer reads as unknown and fails closed',
    );
  }
  return warnings;
}

function countrySourceConfigured(app: FastifyInstance): boolean {
  return Boolean(app.deps.env.FLAG_COUNTRY_HEADER || app.deps.env.FLAG_COUNTRY);
}

async function readOne(
  app: FastifyInstance,
  key: FlagKey,
  context: FlagContext,
  envOwned: Set<string>,
): Promise<AdminFlag> {
  const db = app.deps.db;
  const row = db
    ? ((await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1))[0] ?? null)
    : null;
  const { anonymous, user } = await evaluateFlagForKey(app, key, context);
  return toAdminFlag(key, {
    rule: row,
    source: envOwned.has(key) ? 'env' : row ? 'db' : 'default',
    anonymous,
    user:
      context.userId !== undefined && user !== null ? { id: context.userId, enabled: user } : null,
    warnings: readWarnings(app, key, row, envOwned),
  });
}

export const adminFlagRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAdminRole);

  app.get(
    '/flags',
    {
      schema: {
        tags: ['admin'],
        querystring: z.object({ userId: z.uuid().optional() }),
        response: { 200: AdminFlagsSchema, 401: ApiErrorSchema, 403: ApiErrorSchema },
      },
    },
    async (request) => {
      const db = app.deps.db;
      if (!db) return { flags: [] };
      const envOwned = envOwnedKeys(app);
      const rows = await db.select().from(featureFlags);
      const byKey = new Map(rows.map((row) => [row.key, row]));
      const context: FlagContext = {
        userId: request.query.userId,
        country: countryFrom(request, app.deps.env),
      };

      const flags: AdminFlag[] = [];
      for (const key of FLAG_KEYS) {
        const row = byKey.get(key) ?? null;
        const { anonymous, user } = await evaluateFlagForKey(app, key, context);
        flags.push(
          toAdminFlag(key, {
            rule: row,
            source: envOwned.has(key) ? 'env' : row ? 'db' : 'default',
            anonymous,
            user:
              context.userId !== undefined && user !== null
                ? { id: context.userId, enabled: user }
                : null,
            warnings: readWarnings(app, key, row, envOwned),
          }),
        );
      }
      return { flags };
    },
  );

  app.patch(
    '/flags/:key',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ key: z.string() }),
        body: PatchFlagBodySchema,
        response: {
          200: AdminFlagSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const actor = await getSessionUser(app, request);
      if (!actor) return reply.status(401).send({ error: 'authentication required' });

      const { key } = request.params;
      if (!isRegistryKey(key)) {
        return reply.status(400).send({ error: `unknown flag '${key}'` });
      }
      const envOwned = envOwnedKeys(app);
      if (envOwned.has(key)) {
        return reply.status(409).send({ error: 'env-locked' });
      }

      const definition = FLAG_DEFINITIONS[key];
      const [existing] = await db
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

      // A first write seeds from the registry default, never the column default:
      // adding a country rule to a dark release flag must not switch it on.
      const seed = { enabled: true, rollout: definition.default ? 100 : 0 };
      const body = request.body;
      const next = {
        enabled: body.enabled ?? existing?.enabled ?? seed.enabled,
        rollout: body.rollout ?? existing?.rollout ?? seed.rollout,
        countries: body.countries ?? existing?.countries ?? [],
        startsAt:
          body.startsAt === undefined
            ? (existing?.startsAt ?? null)
            : body.startsAt === null
              ? null
              : new Date(body.startsAt),
        endsAt:
          body.endsAt === undefined
            ? (existing?.endsAt ?? null)
            : body.endsAt === null
              ? null
              : new Date(body.endsAt),
        updatedAt: new Date(),
        updatedBy: actor.id,
      };

      await db
        .insert(featureFlags)
        .values({ key, ...next })
        .onConflictDoUpdate({ target: featureFlags.key, set: next });
      clearFlagCache();

      request.log.info(
        { flag: key, before: existing ?? null, after: next, actor: actor.id },
        'feature flag updated',
      );

      return readOne(
        app,
        key,
        { userId: undefined, country: countryFrom(request, app.deps.env) },
        envOwned,
      );
    },
  );

  app.delete(
    '/flags/:key',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ key: z.string() }),
        response: {
          204: z.null(),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const actor = await getSessionUser(app, request);
      if (!actor) return reply.status(401).send({ error: 'authentication required' });

      const { key } = request.params;
      if (!isRegistryKey(key)) {
        return reply.status(400).send({ error: `unknown flag '${key}'` });
      }
      if (envOwnedKeys(app).has(key)) return reply.status(409).send({ error: 'env-locked' });

      // `feature_flag_override` cascades from this row.
      const deleted = await db
        .delete(featureFlags)
        .where(eq(featureFlags.key, key))
        .returning({ key: featureFlags.key });
      clearFlagCache();
      if (deleted.length > 0) {
        request.log.info({ flag: key, actor: actor.id }, 'feature flag rule removed');
      }
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/flags/:key/overrides/:userId',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ key: z.string(), userId: z.uuid() }),
        body: FlagOverrideBodySchema,
        response: {
          204: z.null(),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const actor = await getSessionUser(app, request);
      if (!actor) return reply.status(401).send({ error: 'authentication required' });

      const { key, userId } = request.params;
      if (!isRegistryKey(key)) {
        return reply.status(400).send({ error: `unknown flag '${key}'` });
      }
      if (envOwnedKeys(app).has(key)) return reply.status(409).send({ error: 'env-locked' });

      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target) return reply.status(400).send({ error: 'unknown user' });

      // Overrides need a parent row; seeding it here keeps "delete the rule"
      // honest, because that drops the grants with it.
      const definition = FLAG_DEFINITIONS[key];
      await db
        .insert(featureFlags)
        .values({
          key,
          enabled: true,
          rollout: definition.default ? 100 : 0,
          updatedBy: actor.id,
        })
        .onConflictDoNothing();

      await db
        .insert(featureFlagOverrides)
        .values({ key, userId, enabled: request.body.enabled })
        .onConflictDoUpdate({
          target: [featureFlagOverrides.key, featureFlagOverrides.userId],
          set: { enabled: request.body.enabled, updatedAt: new Date() },
        });
      clearFlagCache();

      request.log.info(
        { flag: key, userId, enabled: request.body.enabled, actor: actor.id },
        'feature flag override written',
      );
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/flags/:key/overrides/:userId',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ key: z.string(), userId: z.uuid() }),
        response: {
          204: z.null(),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const actor = await getSessionUser(app, request);
      if (!actor) return reply.status(401).send({ error: 'authentication required' });

      const { key, userId } = request.params;
      if (!isRegistryKey(key)) {
        return reply.status(400).send({ error: `unknown flag '${key}'` });
      }
      if (envOwnedKeys(app).has(key)) return reply.status(409).send({ error: 'env-locked' });

      await db
        .delete(featureFlagOverrides)
        .where(and(eq(featureFlagOverrides.key, key), eq(featureFlagOverrides.userId, userId)));
      request.log.info({ flag: key, userId, actor: actor.id }, 'feature flag override removed');
      return reply.status(204).send(null);
    },
  );
};
