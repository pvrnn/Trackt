/**
 * Per-provider token bucket (PRD §4: respect provider rate limits).
 * `take()` resolves immediately while tokens remain, otherwise waits for refill.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = now;
  }

  /** Acquire one token, waiting for refill if the bucket is empty. */
  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficitMs = ((1 - this.tokens) / this.refillPerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(deficitMs, 5)));
    }
  }
}
