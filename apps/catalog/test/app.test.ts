import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalogEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

const env = loadCatalogEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CATALOG_ADMIN_TOKEN: 'test-admin-token-16chars',
});

const slimMediaBody = {
  id: '2e1c929b-ab13-5b76-9706-c68e438b6a03',
  kind: 'movie',
  title: 'The Matrix',
  synonyms: ['Matrix'],
  year: 1999,
  status: 'ended',
  genres: ['action'],
  partCount: null,
  seasonNumber: null,
  externalIds: { tmdb: 603 },
  description: null,
  coverUrl: null,
};

describe('catalog app', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz responds ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /readyz reports a skipped database check without deps', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', checks: { database: 'skipped' } });
  });

  it('GET /v1/catalog/version responds 503 without a database', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/version' });
    expect(response.statusCode).toBe(503);
  });

  it('GET /v1/catalog/search responds 503 without a database', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/search?q=matrix' });
    expect(response.statusCode).toBe(503);
  });

  it('GET /v1/catalog/search validates the query', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/search' });
    expect(response.statusCode).toBe(400);
    // Validation failures use the documented {error} shape, not FST_ERR_VALIDATION.
    const body = response.json();
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toMatch(/validation failed/);
  });

  it('returns an opaque {error} 500 for unexpected errors (no internals leaked)', async () => {
    const failing = await buildApp({ env });
    failing.get('/boom', async () => {
      throw new Error('password authentication failed for user "trackt"');
    });
    const response = await failing.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error' });
    expect(response.body).not.toContain('password');
    await failing.close();
  });

  it('applies rate limiting outside the health endpoints', async () => {
    const limited = await app.inject({ method: 'GET', url: '/v1/catalog/version' });
    expect(limited.headers['x-ratelimit-limit']).toBeDefined();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('POST /v1/admin/media rejects a missing or wrong token', async () => {
    const noToken = await app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      payload: slimMediaBody,
    });
    expect(noToken.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      payload: slimMediaBody,
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it('POST /v1/admin/media validates the body against the slim contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      payload: { ...slimMediaBody, kind: 'mixtape' },
      headers: { authorization: 'Bearer test-admin-token-16chars' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /v1/admin/media responds 501 with a valid token (publishing not built)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      payload: slimMediaBody,
      headers: { authorization: 'Bearer test-admin-token-16chars' },
    });
    expect(response.statusCode).toBe(501);
  });

  it('serves the generated OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const doc = response.json();
    expect(doc.info.title).toBe('Trackt Catalog API');
    expect(doc.paths['/v1/catalog/search']).toBeDefined();
  });
});
