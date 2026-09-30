import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { every } from '../../src/lib/every.js';

const logger = pino({ level: 'silent' });

describe('every', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at once, then on every interval until stopped', async () => {
    const task = vi.fn(async () => {});
    const stop = every(1000, 'test', task, logger);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still going', async () => {
    let release = () => {};
    const task = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const stop = every(1000, 'test', task, logger);
    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps the schedule going after a failure', async () => {
    const task = vi.fn(async () => {
      throw new Error('boom');
    });
    const stop = every(1000, 'test', task, logger);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });
});
