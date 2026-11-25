import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';
import { baseAuthOptions, type Auth } from '../src/auth.js';
import type { Mailer, MailMessage } from '../src/lib/mail/mailer.js';
import type { Env } from '@trackt/shared';

/** Most suites predate verification and want a session straight from sign-up. */
const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', AUTH_EMAIL_VERIFICATION: 'off' });

function capturingMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    kind: 'console',
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/**
 * Exercises the real auth option set (username plugin, trusted origins) and the
 * Fastify↔WHATWG bridge in app.ts, with better-auth's memory adapter standing in
 * for Postgres. The adapter is the only divergence from production wiring.
 */
function buildAuth(authEnv: Env = env, mailer: Mailer = capturingMailer()) {
  return betterAuth({
    ...baseAuthOptions(authEnv, mailer),
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

  it('refuses a disposable or relay address before creating anything', async () => {
    for (const [email, username] of [
      ['x9k2@mozmail.com', 'relayed'],
      ['someone@mailinator.com', 'throwaway'],
    ] as const) {
      const response = await app.inject(
        signUp({ name: 'Ghost', email, password: 'password123', username }),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('DISPOSABLE_EMAIL');
    }
    const retry = await app.inject(
      signUp({
        name: 'Ghost',
        email: 'ghost@example.com',
        password: 'password123',
        username: 'relayed',
      }),
    );
    expect(retry.statusCode).toBe(200);
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

describe('email verification', () => {
  const verifyEnv = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const mailer = capturingMailer();
  const account = {
    name: 'Vera',
    email: 'vera@example.com',
    password: 'password123',
    username: 'vera',
  };
  let app: App;

  const signIn = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: verifyEnv.APP_URL },
      payload: { email: account.email, password: account.password },
    });
  const verify = (otp: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/email-otp/verify-email',
      headers: { origin: verifyEnv.APP_URL },
      payload: { email: account.email, otp },
    });
  const codeIn = (message: MailMessage | undefined) => /\b(\d{6})\b/.exec(message?.text ?? '')?.[1];

  beforeAll(async () => {
    app = await buildApp({ env: verifyEnv, auth: buildAuth(verifyEnv, mailer) });
  });

  afterAll(async () => {
    await app.close();
  });

  it('is on unless switched off', () => {
    expect(verifyEnv.AUTH_EMAIL_VERIFICATION).toBe('on');
  });

  it('signs up without a session and mails a code with a link to the web page', async () => {
    const response = await app.inject(signUp(account));
    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeNull();
    expect(String(response.headers['set-cookie'] ?? '')).not.toMatch(/session_token=/);

    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message?.to).toBe(account.email);
    const code = codeIn(message);
    expect(code).toMatch(/^\d{6}$/);
    expect(message?.subject).toContain(code);
    expect(message?.text).toContain(
      `${verifyEnv.APP_URL}/verify-email?email=vera%40example.com&code=${code}`,
    );
  });

  it('refuses sign-in before verification and mails a fresh code', async () => {
    const response = await signIn();
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EMAIL_NOT_VERIFIED');
    expect(mailer.sent).toHaveLength(2);
  });

  it('rejects a wrong code, then verifies with the right one and signs in', async () => {
    const code = codeIn(mailer.sent.at(-1)) as string;
    const wrong = await verify(code === '000000' ? '111111' : '000000');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('INVALID_OTP');

    const right = await verify(code);
    expect(right.statusCode).toBe(200);
    expect(right.json().user.emailVerified).toBe(true);
    expect(String(right.headers['set-cookie'])).toMatch(/better-auth\.session_token=/);
  });

  it('signs in once verified', async () => {
    const response = await signIn();
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toMatch(/better-auth\.session_token=/);
  });

  it('mails in French when the web locale cookie says so', async () => {
    const response = await app.inject({
      ...signUp({ ...account, email: 'fr@example.com', username: 'frances' }),
      headers: { origin: verifyEnv.APP_URL, cookie: 'trackt_locale=fr' },
    });
    expect(response.statusCode).toBe(200);
    expect(mailer.sent.at(-1)?.subject).toMatch(/est votre code Trackt$/);
  });

  it('answers a taken address like a new one and mails its owner instead', async () => {
    const before = mailer.sent.length;
    const response = await app.inject(signUp({ ...account, username: 'impostor' }));
    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeNull();

    expect(mailer.sent).toHaveLength(before + 1);
    const message = mailer.sent.at(-1);
    expect(message?.to).toBe(account.email);
    expect(message?.subject).toBe('You already have a Trackt account');
    expect(message?.text).toContain('nothing was created');
    expect(message?.text).toContain(`${verifyEnv.APP_URL}/login`);
    expect(codeIn(message)).toBeUndefined();
  });

  it('tells an unverified owner to sign in for a new code', async () => {
    await app.inject(signUp({ ...account, email: 'pending@example.com', username: 'pending' }));
    await app.inject(signUp({ ...account, email: 'pending@example.com', username: 'pending2' }));
    expect(mailer.sent.at(-1)?.text).toContain('sign in and we will send you a new code');
  });

  it('does not offer passwordless sign-in by code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      headers: { origin: verifyEnv.APP_URL },
      payload: { email: account.email, otp: '123456' },
    });
    expect(response.statusCode).toBe(404);
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
          AUTH_EMAIL_VERIFICATION: 'off',
          APP_URL: 'https://trackt.example.com',
          AUTH_SECRET: 'x'.repeat(32),
          DATABASE_URL: 'postgres://trackt:trackt@localhost:5432/trackt',
          REDIS_URL: 'redis://localhost:6379',
        }),
      ).trustedOrigins,
    ).not.toContain('exp://*');
  });
});

/**
 * Account deletion (`DELETE /api/v1/me`, mobile plan phase 5).
 *
 * Here rather than only in the Postgres suite because the interesting half is
 * the auth wiring, not the cascade: the route delegates to better-auth, which
 * refuses unless `user.deleteUser.enabled` is set and the password checks out.
 * Both of those are options on `baseAuthOptions`, and the memory adapter
 * exercises them exactly. `profile.integration.test.ts` covers what the
 * foreign keys then do.
 */
describe('account deletion', () => {
  let app: App;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp({ env, auth: buildAuth() });
    const response = await app.inject(
      signUp({
        name: 'Doomed',
        email: 'doomed@example.com',
        password: 'password123',
        username: 'doomed',
      }),
    );
    expect(response.statusCode).toBe(200);
    cookie = (response.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a session', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      payload: { password: 'password123' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('requires a password', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects the wrong password without deleting anything', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { password: 'not-the-password' },
    });
    expect(response.statusCode).toBe(400);
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    expect(session.json()).not.toBeNull();
  });

  it('deletes the account and the session with it', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { password: 'password123' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    expect(session.json()).toBeNull();
  });
});
