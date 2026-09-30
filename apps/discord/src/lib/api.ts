import type { Env } from '@trackt/shared';
import type { z } from 'zod';

/** The instance API over loopback: the bot runs beside it, in the same container or dev shell. */
export function apiUrl(env: Env, path: string): URL {
  return new URL(`/api/v1/${path}`, `http://127.0.0.1:${env.PORT}`);
}

const API_TIMEOUT_MS = 5_000;

/** GET and validate; null on a 404, throws on anything else that is not 2xx. */
export async function getJson<T>(env: Env, path: string, schema: z.ZodType<T>): Promise<T | null> {
  const response = await fetch(apiUrl(env, path), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${path} responded ${response.status}`);
  return schema.parse(await response.json());
}
