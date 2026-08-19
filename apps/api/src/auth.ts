import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { expo } from '@better-auth/expo';
import { username } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { accounts, sessions, users, verifications, type Db } from '@trackt/db';
import type { Env } from '@trackt/shared';
import { removeStoredUpload } from './lib/uploads.js';

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
    //
    // `trackt://` is apps/mobile's scheme (ADR-0008 §2/§3): the Expo client
    // sends it as the Origin, so without these two entries sign-in from the app
    // is rejected before it reaches the handler. `exp://*` covers Expo Go and
    // dev-client sessions, which carry the LAN origin of the Metro host and so
    // cannot be enumerated — dev only, like the localhost exception above.
    trustedOrigins: [
      env.APP_URL,
      'trackt://',
      'trackt://*',
      ...(env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'exp://*'] : []),
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
      /**
       * Account deletion (mobile plan, phase 5). Required for App Store
       * submission, and the missing half of the portability principle: an
       * instance you can export from but never leave is not self-hosting.
       *
       * The public surface is `DELETE /api/v1/me`, which delegates here rather
       * than deleting the row itself — password verification against the
       * credential account, and revoking every live session, are better-auth's
       * to do and would be re-implemented wrongly on the other side.
       *
       * Everything the account owns goes with it: `users.id` is an
       * `onDelete: 'cascade'` foreign key from logs, progress, ratings,
       * favourites, lists, friendships and sessions alike (`packages/db`).
       * The two exceptions are deliberate `set null`s — a catalog entry's
       * `created_by` and a list item's `added_by` — so removing an account
       * cannot take a shared catalog row with it.
       */
      deleteUser: {
        enabled: true,
        // The one thing the cascade cannot reach: the avatar is a file on
        // disk, and a foreign key knows nothing about it.
        beforeDelete: async (user: { image?: string | null }) => {
          await removeStoredUpload(env.UPLOADS_DIR, 'avatars', user.image ?? null);
        },
      },
    },
    // `expo()` only adds the redirect/deep-link handling the native client
    // needs; sessions stay ordinary better-auth sessions in our Postgres, so
    // `getSessionUser()` and every route guard are untouched (ADR-0008 §3).
    //
    // Widened to `BetterAuthPlugin` deliberately. Left inferred, the plugin's
    // endpoint types pull `better-call` and `@better-auth/core` into the
    // exported `Auth` type by their peer-suffixed pnpm paths, which TypeScript
    // cannot name from here (TS2742). Nothing on this side calls an expo
    // endpoint by name — the app's types come from `@better-auth/expo/client`,
    // which infers them independently — so the inference buys nothing.
    plugins: [username(), expo() as BetterAuthPlugin],
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
