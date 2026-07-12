import ky, { HTTPError } from 'ky';

export const api = ky.create({ prefix: '/api/v1/' });

export async function toError(error: unknown, action: string): Promise<Error> {
  if (error instanceof HTTPError) {
    const detail = await error.response.json().catch(() => null);
    const message = (detail as { error?: string } | null)?.error;
    return new Error(message ?? `${action} responded ${error.response.status}`);
  }
  return new Error(`${action} failed`);
}
