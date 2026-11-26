import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/env.js';

describe('loadEnv', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('applies development defaults with an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.REDIS_URL).toContain('redis://');
    expect(env.AUTH_SECRET).toBeTruthy();
    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it('warns when development falls back to the built-in AUTH_SECRET', () => {
    loadEnv({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('AUTH_SECRET'));

    warn.mockClear();
    loadEnv({ AUTH_SECRET: 'an-explicit-dev-secret' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults CATALOG_URL to the dev catalog only outside test and production', () => {
    expect(loadEnv({}).CATALOG_URL).toBe('http://localhost:3002');
    // '' is how a compose file or a test suite spells "no central catalog".
    expect(loadEnv({ NODE_ENV: 'test', CATALOG_URL: '' }).CATALOG_URL).toBeUndefined();
    expect(loadEnv({ NODE_ENV: 'test' }).CATALOG_URL).toBeUndefined();
    expect(loadEnv({ NODE_ENV: 'test', CATALOG_URL: 'http://catalog.test' }).CATALOG_URL).toBe(
      'http://catalog.test',
    );
  });

  it('coerces numeric variables', () => {
    const env = loadEnv({ PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('treats empty Discord keys as unset', () => {
    const env = loadEnv({
      DISCORD_BOT_TOKEN: '',
      DISCORD_APPLICATION_ID: '',
      DISCORD_GUILD_ID: '',
    });
    expect(env.DISCORD_BOT_TOKEN).toBeUndefined();
    expect(env.DISCORD_APPLICATION_ID).toBeUndefined();
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
  });

  it('treats empty TMDB_API_KEY as unset', () => {
    const env = loadEnv({ TMDB_API_KEY: '' });
    expect(env.TMDB_API_KEY).toBeUndefined();
  });

  it('rejects invalid values with an actionable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://nope' })).toThrowError(EnvValidationError);
    expect(() => loadEnv({ DATABASE_URL: 'mysql://nope' })).toThrowError(/postgres/);
  });

  it('requires critical variables in production', () => {
    const attempt = () => loadEnv({ NODE_ENV: 'production' });
    expect(attempt).toThrowError(EnvValidationError);
    expect(attempt).toThrowError(/DATABASE_URL/);
    expect(attempt).toThrowError(/AUTH_SECRET/);
    expect(attempt).toThrowError(/APP_URL/);
    expect(attempt).toThrowError(/openssl rand/);
  });

  it('refuses to default APP_URL to localhost in production', () => {
    const attempt = () =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/trackt',
        REDIS_URL: 'redis://redis:6379',
        AUTH_SECRET: 'a-very-long-production-secret',
      });
    expect(attempt).toThrowError(EnvValidationError);
    expect(attempt).toThrowError(/APP_URL/);
  });

  const PRODUCTION = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://u:p@db:5432/trackt',
    REDIS_URL: 'redis://redis:6379',
    AUTH_SECRET: 'a-very-long-production-secret',
    APP_URL: 'https://trackt.example.com',
  };
  const MAIL = { RESEND_API_KEY: 're_test', MAIL_FROM: 'Trackt <no-reply@trackt.example.com>' };

  it('boots in production when critical variables are set', () => {
    const env = loadEnv({ ...PRODUCTION, ...MAIL });
    expect(env.APP_URL).toBe('https://trackt.example.com');
    expect(env.AUTH_EMAIL_VERIFICATION).toBe('on');
  });

  it('refuses production with email verification on and no mail transport', () => {
    const attempt = () => loadEnv(PRODUCTION);
    expect(attempt).toThrowError(EnvValidationError);
    expect(attempt).toThrowError(/RESEND_API_KEY/);
    expect(attempt).toThrowError(/SMTP_URL/);
    expect(attempt).toThrowError(/AUTH_EMAIL_VERIFICATION/);
  });

  it('requires MAIL_FROM in production when verification mail is sent', () => {
    const attempt = () => loadEnv({ ...PRODUCTION, SMTP_URL: 'smtp://mail:25' });
    expect(attempt).toThrowError(/MAIL_FROM/);
  });

  it('boots in production without a mail transport when verification is off', () => {
    const env = loadEnv({ ...PRODUCTION, AUTH_EMAIL_VERIFICATION: 'off' });
    expect(env.AUTH_EMAIL_VERIFICATION).toBe('off');
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it('defaults verification on and MAIL_FROM to localhost in development', () => {
    const env = loadEnv({ AUTH_EMAIL_VERIFICATION: '', SMTP_URL: '' });
    expect(env.AUTH_EMAIL_VERIFICATION).toBe('on');
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.MAIL_FROM).toBe('Trackt <no-reply@localhost>');
  });

  it('rejects an SMTP_URL that is not an smtp URL', () => {
    expect(() => loadEnv({ SMTP_URL: 'https://mail.example.com' })).toThrowError(/SMTP_URL/);
  });

  it('boots a production worker on its database and Redis alone', () => {
    const env = loadEnv(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/trackt',
        REDIS_URL: 'redis://redis:6379',
      },
      { role: 'worker' },
    );
    expect(env.DATABASE_URL).toBe('postgres://u:p@db:5432/trackt');
    expect(() => loadEnv({ NODE_ENV: 'production' }, { role: 'worker' })).toThrowError(
      /DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });

  it('consumes both queues unless WORKER_QUEUES picks some', () => {
    expect(loadEnv({}).WORKER_QUEUES).toEqual(['importer', 'trophies']);
    expect(loadEnv({ WORKER_QUEUES: '' }).WORKER_QUEUES).toEqual(['importer', 'trophies']);
    expect(loadEnv({ WORKER_QUEUES: ' importer ' }).WORKER_QUEUES).toEqual(['importer']);
    expect(() => loadEnv({ WORKER_QUEUES: 'importer,mail' })).toThrowError(/WORKER_QUEUES/);
  });

  it('reads the idle-mode worker settings', () => {
    const env = loadEnv({
      WORKER_IDLE_SECONDS: '120',
      WORKER_WAKE_URL: 'http://worker.railway.internal:8080/wake',
    });
    expect(env.WORKER_IDLE_SECONDS).toBe(120);
    expect(env.WORKER_WAKE_URL).toBe('http://worker.railway.internal:8080/wake');
    expect(loadEnv({ WORKER_IDLE_SECONDS: '', WORKER_WAKE_URL: '' })).toMatchObject({
      WORKER_IDLE_SECONDS: undefined,
      WORKER_WAKE_URL: undefined,
    });
  });
});
