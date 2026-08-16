import { HTTPError } from 'ky';

/**
 * Turn whatever a failed request threw into an `Error` a screen can show. The
 * API's error bodies are `{ error }`; anything else degrades to the action name
 * plus the status, and a non-HTTP failure (offline, DNS) to "<action> failed".
 */
export async function toError(error: unknown, action: string): Promise<Error> {
  if (error instanceof HTTPError) {
    const detail = await error.response.json().catch(() => null);
    const message = (detail as { error?: string } | null)?.error;
    return new Error(message ?? `${action} responded ${error.response.status}`);
  }
  return new Error(`${action} failed`);
}

/** The status of a failed request, or null when the failure never reached the server. */
export function errorStatus(error: unknown): number | null {
  return error instanceof HTTPError ? error.response.status : null;
}
