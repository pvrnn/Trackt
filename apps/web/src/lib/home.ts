import { HomeSummarySchema, type HomeSummary } from '@trackt/shared';

/** Fetch the authenticated home dashboard summary. */
export async function fetchHomeSummary(): Promise<HomeSummary> {
  const response = await fetch('/api/v1/me/home');
  if (!response.ok) throw new Error(`home summary responded ${response.status}`);
  return HomeSummarySchema.parse(await response.json());
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
