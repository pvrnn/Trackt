import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { accounts, sessions, users, verifications, type Db } from '@trackt/db';
import type { Env } from '@trackt/shared';

/**
 * better-auth (PRD §6): users and sessions live in our Postgres via the Drizzle
 * adapter. IDs are UUIDs to match the shard-friendly rule in PRD §5.
 * The username plugin adds a unique @handle at signup (PRD §3.4 profiles).
 */

/**
 * Auth options minus the database adapter, shared with tests (which swap in the
 * memory adapter). No return-type annotation — better-auth infers plugin types
 * from the literal.
 */
export function baseAuthOptions(env: Env) {
  return {
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    // In dev the browser origin is the Vite server (:3000), which proxies /api
    // to the API (:3001) without rewriting the Origin header.
    trustedOrigins: [
      env.APP_URL,
      ...(env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
    ],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        // Surface the per-instance role (PRD §7) on sessions. `input: false`
        // is load-bearing: sign-up/update-user must never set it — promotion
        // goes through `pnpm db:set-role`.
        role: { type: 'string', input: false, defaultValue: 'user' } as const,
      },
    },
    plugins: [username()],
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  };
}

export function createAuth(db: Db, env: Env) {
  return betterAuth({
    ...baseAuthOptions(env),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
