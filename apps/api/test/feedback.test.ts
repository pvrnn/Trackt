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

  it('accepts the work a media-page report names, and only as a uuid', async () => {
    const scoped = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: {
        ...valid,
        // Canonical media ids are UUIDv5, and the version nibble is checked.
        mediaId: '6f9619ff-8b86-5011-a42d-00cf4fc964ff',
        mediaTitle: 'Ashfall Chronicle',
      },
    });
    // Past validation, stopped by the session gate — the body itself is fine.
    expect(scoped.statusCode).toBe(401);

    const slugAsId = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: { ...valid, mediaId: 'ashfall-chronicle-2025' },
    });
    expect(slugAsId.statusCode).toBe(400);
  });
});
