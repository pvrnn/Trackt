import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });

describe('api app', () => {
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

  it('GET /readyz reports skipped checks when no dependencies are wired', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'skipped', redis: 'skipped' },
    });
  });

  it('GET /readyz responds 503 when a dependency check fails', async () => {
    const failing = await buildApp({
      env,
      dbPing: async () => {
        throw new Error('connection refused');
      },
    });
    const response = await failing.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database).toBe('error');
    await failing.close();
  });

  it('GET /api/v1/search responds 503 without a database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=cowboy&kind=anime',
    });
    expect(response.statusCode).toBe(503);
  });

  it('GET /api/v1/search validates the query', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/search?kind=anime' });
    expect(response.statusCode).toBe(400);
  });

  it('GET /api/v1/media/:id responds 503 without a database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/media/6f1c1cba-2f42-4a8b-b1d2-2f6b1e01a111',
    });
    expect(response.statusCode).toBe(503);
  });

  it('serves the generated OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const doc = response.json();
    expect(doc.info.title).toBe('Trackt API');
    expect(doc.paths['/api/v1/search']).toBeDefined();
  });
});
