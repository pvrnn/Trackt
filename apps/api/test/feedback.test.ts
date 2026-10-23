import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

/**
 * The instance's feedback route, without a database or a live catalog: what is
 * testable here is the gate in front of the forward. A session is required even
 * though the catalog's own endpoint is public, and the body is validated before
 * anything is sent — the 502 path is the shared client's contract, covered by
 * feedback-client.test.ts.
 */

const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: 'http://catalog.test' });

const valid = {
  category: 'bug',
  message: 'The check-in button stayed grey after tapping it.',
  route: '/media/ashfall-chronicle-2025',
};

describe('feedback route', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an anonymous report', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/feedback', payload: valid });
    expect(response.statusCode).toBe(401);
  });

  it('validates the body before the session gate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: { ...valid, message: 'broken' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown category', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: { ...valid, category: 'rant' },
    });
    expect(response.statusCode).toBe(400);
  });
});
