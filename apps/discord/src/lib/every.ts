import type { Logger } from 'pino';

/**
 * Run `task` every `ms`, never two at once: a tick that finds the previous
 * run still going is skipped, not queued. Failures are logged and swallowed so
 * one bad tick cannot stop the schedule. Returns the function that stops it.
 */
export function every(
  ms: number,
  name: string,
  task: () => Promise<void>,
  logger: Logger,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      logger.error({ err: error, task: name }, 'scheduled task failed');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), ms);
  return () => clearInterval(timer);
}
