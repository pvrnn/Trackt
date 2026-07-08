import { ProviderError } from './types.js';
import type { TokenBucket } from './rate-limit.js';

export interface HttpClientOptions {
  provider: string;
  bucket: TokenBucket;
  fetchImpl?: typeof fetch;
}

/** Rate-limited JSON fetch shared by all providers. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  { provider, bucket, fetchImpl = fetch }: HttpClientOptions,
): Promise<T> {
  await bucket.take();
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new ProviderError(provider, `request failed: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new ProviderError(
      provider,
      `${init.method ?? 'GET'} ${url} → ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}
