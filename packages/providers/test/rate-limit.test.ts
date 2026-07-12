import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/rate-limit.js';

describe('TokenBucket', () => {
  it('serves requests immediately while tokens remain', async () => {
    const bucket = new TokenBucket(3, 1);
    const start = Date.now();
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('waits for refill once the bucket is empty', async () => {
    const bucket = new TokenBucket(1, 20); // refills a token every 50ms
    await bucket.take();
    const start = Date.now();
    await bucket.take();
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });
});
