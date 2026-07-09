import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { loadEnv } from '@trackt/shared';
import { buildApp, type App } from './app.js';
import { baseAuthOptions, type Auth } from './auth.js';

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
      signUp({ name: 'Paul', email: 'paul@example.com', password: 'password123', username: 'PaulV' }),
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
      signUp({ name: 'Other', email: 'other@example.com', password: 'password123', username: 'paulv' }),
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

  it('rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.APP_URL },
      payload: { email: 'paul@example.com', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
  });
});
