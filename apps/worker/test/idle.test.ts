import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleController, type IdleControllerOptions } from '../src/idle.js';

function harness(overrides: Partial<IdleControllerOptions> = {}) {
  let clock = 0;
  let busy = false;
  const calls: string[] = [];
  const controller = createIdleController({
    idleMs: 1_000,
    // Long enough that the timer never fires on its own: tests drive check().
    checkEveryMs: 60_000,
    start: async () => {
      calls.push('start');
    },
    stop: async () => {
      calls.push('stop');
    },
    hasWork: async () => busy,
    now: () => clock,
    ...overrides,
  });
  return {
    controller,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

describe('idle controller', () => {
  afterEach(() => vi.useRealTimers());

  it('starts on wake and only once while running', async () => {
    const { controller, calls } = harness();
    expect(controller.state).toBe('stopped');
    await controller.wake();
    await controller.wake();
    expect(controller.state).toBe('running');
    expect(calls).toEqual(['start']);
    await controller.close();
  });

  it('stops after the idle window with nothing queued', async () => {
    const { controller, calls, advance } = harness();
    await controller.wake();
    await controller.check(); // first idle sighting
    advance(999);
    await controller.check();
    expect(controller.state).toBe('running');
    advance(1);
    await controller.check();
    expect(controller.state).toBe('stopped');
    expect(calls).toEqual(['start', 'stop']);
  });

  it('restarts the idle window whenever there is work', async () => {
    const { controller, advance, setBusy } = harness();
    await controller.wake();
    await controller.check();
    advance(900);
    setBusy(true);
    await controller.check();
    setBusy(false);
    advance(900);
    await controller.check();
    advance(900);
    await controller.check();
    expect(controller.state).toBe('running');
    await controller.close();
  });

  it('wakes again after going idle', async () => {
    const { controller, calls, advance } = harness();
    await controller.wake();
    await controller.check();
    advance(1_000);
    await controller.check();
    await controller.wake();
    expect(controller.state).toBe('running');
    expect(calls).toEqual(['start', 'stop', 'start']);
    await controller.close();
  });

  it('treats a failed check as busy rather than idle', async () => {
    const errors: unknown[] = [];
    const { controller, advance } = harness({
      hasWork: async () => {
        throw new Error('redis gone');
      },
      onCheckError: (error) => errors.push(error),
    });
    await controller.wake();
    await controller.check();
    advance(5_000);
    await controller.check();
    expect(controller.state).toBe('running');
    expect(errors).toHaveLength(2);
    await controller.close();
  });

  it('stays stopped when start fails, and a later wake retries', async () => {
    let fail = true;
    const { controller } = harness({
      start: async () => {
        if (fail) throw new Error('redis unreachable');
      },
    });
    await expect(controller.wake()).rejects.toThrow('redis unreachable');
    expect(controller.state).toBe('stopped');
    fail = false;
    await controller.wake();
    expect(controller.state).toBe('running');
    await controller.close();
  });

  it('checks on its own timer while running', async () => {
    vi.useFakeTimers();
    let clock = 0;
    const stop = vi.fn(async () => undefined);
    const controller = createIdleController({
      idleMs: 1_000,
      checkEveryMs: 500,
      start: async () => undefined,
      stop,
      hasWork: async () => false,
      now: () => clock,
    });
    await controller.wake();
    for (let i = 0; i < 4; i++) {
      clock += 500;
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(stop).toHaveBeenCalledOnce();
    expect(controller.state).toBe('stopped');
  });

  it('does not start again once closed', async () => {
    const { controller, calls } = harness();
    await controller.close();
    await controller.wake();
    expect(controller.state).toBe('stopped');
    expect(calls).toEqual([]);
  });
});
