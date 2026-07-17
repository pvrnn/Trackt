import { useQuery } from '@tanstack/react-query';
import { HomeSummarySchema, type HomeSummary } from '@trackt/shared';
import { authClient } from './auth-client';
import { api, toError } from './http';

/** Fetch the authenticated home dashboard summary. */
export async function fetchHomeSummary(): Promise<HomeSummary> {
  try {
    return HomeSummarySchema.parse(await api.get('me/home').json());
  } catch (error) {
    throw await toError(error, 'home summary');
  }
}

/** Home dashboard query — gated on an active session so it never fires signed-out. */
export function useHomeSummary() {
  const { data: session } = authClient.useSession();
  return useQuery({ queryKey: ['home'], queryFn: fetchHomeSummary, enabled: !!session });
}

/** Compact relative timestamp for activity rows: 2H, 1D, 3W. */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}D`;
  return `${Math.round(days / 7)}W`;
}
