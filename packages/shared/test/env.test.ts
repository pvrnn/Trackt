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
    expect(env.APP_URL).toBe('http://localhost:3001');
  });

  it('warns when development falls back to the built-in AUTH_SECRET', () => {
    loadEnv({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('AUTH_SECRET'));

    warn.mockClear();
    loadEnv({ AUTH_SECRET: 'an-explicit-dev-secret' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('coerces numeric variables', () => {
    const env = loadEnv({ PORT: '8080' });
    expect(env.PORT).toBe(8080);
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
    expect(attempt).toThrowError(/openssl rand/);
  });

  it('boots in production when critical variables are set', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db:5432/trackt',
      REDIS_URL: 'redis://redis:6379',
      AUTH_SECRET: 'a-very-long-production-secret',
      APP_URL: 'https://trackt.example.com',
    });
    expect(env.APP_URL).toBe('https://trackt.example.com');
  });
});
