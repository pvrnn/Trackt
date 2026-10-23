import { describe, expect, it } from 'vitest';
import { submitFeedback } from '../src/feedback-client.js';

/**
 * Wire-contract tests for the feedback forwarder, mirroring news-client.test.ts.
 * The difference is the failure posture: news degrades to an empty feed, but a
 * report is a write someone is waiting on, so every non-2xx has to surface.
 */

const receipt = {
  id: '0f9c1b2a-3d4e-5f6a-8b9c-0d1e2f3a4b5c',
  createdAt: '2026-10-23T10:00:00.000Z',
};

const report = { category: 'bug' as const, message: 'The check-in button stayed grey.' };

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const OPTIONS = { timeoutMs: 1000 };

describe('submitFeedback', () => {
  it('POSTs the report to /v1/feedback and returns the receipt', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      seen = { url: String(input), init };
      return new Response(JSON.stringify(receipt), { status: 201 });
    };

    await expect(
      submitFeedback('http://catalog.test', report, { ...OPTIONS, fetchImpl }),
    ).resolves.toEqual(receipt);

    expect(seen?.url).toBe('http://catalog.test/v1/feedback');
    expect(seen?.init?.method).toBe('POST');
    expect(JSON.parse(String(seen?.init?.body))).toMatchObject(report);
  });

  it('throws on a non-2xx catalog response', async () => {
    await expect(
      submitFeedback('http://catalog.test', report, {
        ...OPTIONS,
        fetchImpl: fetchReturning({ error: 'database unavailable' }, 503),
      }),
    ).rejects.toThrow(/503/);
  });

  it('throws on a malformed receipt', async () => {
    await expect(
      submitFeedback('http://catalog.test', report, {
        ...OPTIONS,
        fetchImpl: fetchReturning({ id: 'not-a-uuid' }, 201),
      }),
    ).rejects.toThrow();
  });
});
