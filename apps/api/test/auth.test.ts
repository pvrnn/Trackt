import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';
import { baseAuthOptions, type Auth } from '../src/auth.js';

const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });

/**
 * Exercises the real auth option set (username plugin, trusted origins) and the
 * Fastify↔WHATWG bridge in app.ts, with better-auth's memory adapter standing in
 * for Postgres. The adapter is the only divergence from production wiring.
 */
function buildAuth() {
  return betterAuth({
    ...baseAuthOptions(env),
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  }) as unknown as Auth;
}

const signUp = (body: Record<string, string>) => ({
  method: 'POST' as const,
  url: '/api/auth/sign-up/email',
  headers: { origin: env.APP_URL },
  payload: body,
});

describe('auth routes', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env, auth: buildAuth() });
  });

  afterAll(async () => {
    await app.close();
  });

  it('mounts better-auth under /api/auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/ok' });
    expect(response.statusCode).toBe(200);
  });

  it('signs up with a username and sets a session cookie', async () => {
    const response = await app.inject(
      signUp({
        name: 'Paul',
        email: 'paul@example.com',
        password: 'password123',
        username: 'PaulV',
      }),
    );
    expect(response.statusCode).toBe(200);
    const { user } = response.json();
    expect(user).toMatchObject({
      email: 'paul@example.com',
      username: 'paulv', // normalized to lowercase
      displayUsername: 'PaulV', // raw input preserved
    });
    expect(response.headers['set-cookie']).toMatch(/better-auth\.session_token=/);
  });

  it('rejects a duplicate username', async () => {
    const response = await app.inject(
      signUp({
        name: 'Other',
        email: 'other@example.com',
        password: 'password123',
        username: 'paulv',
      }),
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().code).toBe('USERNAME_IS_ALREADY_TAKEN');
  });

  it('signs in and returns the session for the cookie', async () => {
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.APP_URL },
      payload: { email: 'paul@example.com', password: 'password123' },
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = signIn.headers['set-cookie'];
    expect(cookie).toMatch(/better-auth\.session_token=/);

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie: String(cookie).split(';')[0] },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe('paul@example.com');
  });

  it('ignores a role smuggled into sign-up and defaults to user', async () => {
    const response = await app.inject(
      signUp({
        name: 'Sneaky',
        email: 'sneaky@example.com',
        password: 'password123',
        username: 'sneaky',
        role: 'admin',
      }),
    );
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    expect(session.json().user.role).toBe('user');
  });

  it('rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.APP_URL },
      payload: { email: 'paul@example.com', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('signs in from the mobile app scheme', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'trackt://' },
      payload: { email: 'paul@example.com', password: 'password123' },
    });
    expect(response.statusCode).toBe(200);
  });
});

/**
 * ADR-0008 §3's two server lines, asserted as configuration rather than as
 * behaviour: better-auth only enforces `trustedOrigins` on the redirect and
 * callback paths, so a request-level test passes whether or not the entries are
 * present and proves nothing. What is worth guarding is that nobody deletes
 * them — the failure they cause is a sign-in that dies during the deep-link
 * hand-back, with nothing in the app to point at the cause — and that `exp://*`
 * stays out of production, where it would trust any Metro host on the network.
 */
describe('mobile trusted origins', () => {
  it('trusts the app scheme', () => {
    expect(baseAuthOptions(env).trustedOrigins).toEqual(
      expect.arrayContaining(['trackt://', 'trackt://*']),
    );
  });

  it('trusts Expo Go and dev clients outside production only', () => {
    expect(baseAuthOptions(loadEnv({ NODE_ENV: 'development' })).trustedOrigins).toContain(
      'exp://*',
    );
    expect(
      baseAuthOptions(
        loadEnv({
          NODE_ENV: 'production',
          APP_URL: 'https://trackt.example.com',
          AUTH_SECRET: 'x'.repeat(32),
          DATABASE_URL: 'postgres://trackt:trackt@localhost:5432/trackt',
          REDIS_URL: 'redis://localhost:6379',
        }),
      ).trustedOrigins,
    ).not.toContain('exp://*');
  });
});
