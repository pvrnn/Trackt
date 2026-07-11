import { ProfileSummarySchema, type ProfileSummary } from '@trackt/shared';

/** Fetch the authenticated own-profile summary. */
export async function fetchProfileSummary(): Promise<ProfileSummary> {
  const response = await fetch('/api/v1/me/profile');
  if (!response.ok) throw new Error(`profile summary responded ${response.status}`);
  return ProfileSummarySchema.parse(await response.json());
}
