import { describe, expect, it, vi } from 'vitest';
import { createWorkerWaker } from '../../src/lib/worker-wake.js';

const silent = { warn: () => undefined };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createWorkerWaker', () => {
  it('POSTs to the wake URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const wake = createWorkerWaker('http://worker.internal:8080/wake', { fetchImpl });
    wake(silent);
    await settle();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]).toMatchObject([
      'http://worker.internal:8080/wake',
      { method: 'POST' },
    ]);
  });

  it('stays quiet right after a successful wake', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const wake = createWorkerWaker('http://w/wake', {
      fetchImpl,
      quietMs: 1_000,
      now: () => clock,
    });
    wake(silent);
    await settle();
    wake(silent);
    await settle();
    expect(fetchImpl).toHaveBeenCalledOnce();
    clock = 1_000;
    wake(silent);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends one wake at a time', async () => {
    let release!: () => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response('{}', { status: 200 }));
        }),
    );
    const wake = createWorkerWaker('http://w/wake', { fetchImpl });
    wake(silent);
    wake(silent);
    release();
    await settle();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a failed wake and logs each failure', async () => {
    const warn = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const wake = createWorkerWaker('http://w/wake', { fetchImpl, backoffMs: 0 });
    wake({ warn });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt and can be tried again', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));
    const wake = createWorkerWaker('http://w/wake', { fetchImpl, attempts: 2, backoffMs: 0 });
    wake(silent);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await settle();
    wake(silent);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
  });
});
