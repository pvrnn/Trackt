/**
 * Idle mode, for a host that sleeps a service once it stops sending traffic
 * (Railway serverless). A BullMQ consumer polls Redis forever, so it never
 * looks idle: after `idleMs` with nothing waiting or running, this stops the
 * consumers and drops every connection, and `wake()` brings them back.
 *
 * Every transition goes through one promise chain, so a wake that arrives while
 * the consumers are stopping restarts them once the stop has finished.
 */

export type IdleState = 'stopped' | 'running';

export interface IdleControllerOptions {
  idleMs: number;
  /** How often a running worker checks for work. */
  checkEveryMs: number;
  /** Connects and starts consuming; rejects when a dependency is unreachable. */
  start(): Promise<void>;
  /** Stops consuming and closes every connection. */
  stop(): Promise<void>;
  /** True while a job is waiting, running or scheduled. Only called while running. */
  hasWork(): Promise<boolean>;
  onIdle?(): void;
  onWake?(): void;
  onCheckError?(error: unknown): void;
  now?(): number;
}

export interface IdleController {
  readonly state: IdleState;
  /** Starts the consumers if they are stopped; resolves once they are running. */
  wake(): Promise<void>;
  /** One idle check; exposed for tests, run on a timer otherwise. */
  check(): Promise<void>;
  /** Stops for good: no timer, no consumers. */
  close(): Promise<void>;
}

export function createIdleController(options: IdleControllerOptions): IdleController {
  const now = options.now ?? Date.now;
  let state: IdleState = 'stopped';
  let idleSince: number | null = null;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const serial = (step: () => Promise<void>): Promise<void> => {
    const next = chain.then(step);
    // A failed step must not wedge every later one.
    chain = next.catch(() => undefined);
    return next;
  };

  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };

  const check = () =>
    serial(async () => {
      if (state !== 'running') return;
      let busy: boolean;
      try {
        busy = await options.hasWork();
      } catch (error) {
        // Unknown is not idle: keep running and look again next time.
        options.onCheckError?.(error);
        idleSince = null;
        return;
      }
      if (busy) {
        idleSince = null;
        return;
      }
      idleSince ??= now();
      if (now() - idleSince < options.idleMs) return;
      stopTimer();
      await options.stop();
      state = 'stopped';
      idleSince = null;
      options.onIdle?.();
    });

  const wake = () =>
    serial(async () => {
      if (closed || state === 'running') {
        idleSince = null;
        return;
      }
      await options.start();
      state = 'running';
      idleSince = null;
      timer = setInterval(() => void check(), options.checkEveryMs);
      options.onWake?.();
    });

  const close = () =>
    serial(async () => {
      closed = true;
      stopTimer();
      if (state === 'running') {
        await options.stop();
        state = 'stopped';
      }
    });

  return {
    get state() {
      return state;
    },
    wake,
    check,
    close,
  };
}
