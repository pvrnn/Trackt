/**
 * Wakes an import worker running in idle mode (`WORKER_IDLE_SECONDS`), which
 * consumes nothing until it is asked to. Fire-and-forget: the job is safe in
 * Redis either way, and the status route wakes again while it still waits, so a
 * lost wake only delays the import.
 */

export interface WakeLogger {
  warn(object: object, message: string): void;
}

export type WakeWorker = (log: WakeLogger) => void;

export interface WorkerWakerOptions {
  fetchImpl?: typeof fetch;
  /** Attempts per wake; a cold start can outlast the first. */
  attempts?: number;
  /** Per-attempt timeout; a host waking a sleeping service holds the request meanwhile. */
  timeoutMs?: number;
  backoffMs?: number;
  /** A worker woken this recently is assumed awake; spares it the status route's polling. */
  quietMs?: number;
  now?: () => number;
}

export function createWorkerWaker(url: string, options: WorkerWakerOptions = {}): WakeWorker {
  const {
    fetchImpl = fetch,
    attempts = 3,
    timeoutMs = 60_000,
    backoffMs = 2_000,
    quietMs = 15_000,
    now = Date.now,
  } = options;
  let inFlight = false;
  let lastWokenAt = Number.NEGATIVE_INFINITY;

  const attempt = async (): Promise<void> => {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`worker answered ${response.status}`);
  };

  return (log) => {
    if (inFlight || now() - lastWokenAt < quietMs) return;
    inFlight = true;
    void (async () => {
      for (let n = 1; n <= attempts; n++) {
        try {
          await attempt();
          lastWokenAt = now();
          return;
        } catch (error) {
          log.warn({ err: error, attempt: n }, 'could not wake the import worker');
          if (n < attempts) await new Promise((resolve) => setTimeout(resolve, backoffMs * n));
        }
      }
    })().finally(() => {
      inFlight = false;
    });
  };
}
