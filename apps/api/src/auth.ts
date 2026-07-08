import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { accounts, sessions, users, verifications, type Db } from '@trackt/db';
import type { Env } from '@trackt/shared';

/**
 * better-auth (PRD §6): users and sessions live in our Postgres via the Drizzle
 * adapter. IDs are UUIDs to match the shard-friendly rule in PRD §5.
 */
export function createAuth(db: Db, env: Env) {
  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
