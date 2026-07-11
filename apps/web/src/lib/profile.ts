import {
  AvatarResponseSchema,
  ProfileSummarySchema,
  type ProfileSummary,
  type UpdateProfileBody,
} from '@trackt/shared';

/** Fetch the authenticated own-profile summary. */
export async function fetchProfileSummary(): Promise<ProfileSummary> {
  const response = await fetch('/api/v1/me/profile');
  if (!response.ok) throw new Error(`profile summary responded ${response.status}`);
  return ProfileSummarySchema.parse(await response.json());
}

/** Update display name / bio. */
export async function updateProfile(body: UpdateProfileBody): Promise<void> {
  const response = await fetch('/api/v1/me/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`profile update responded ${response.status}`);
}

/** Upload a new avatar; returns the public image URL. */
export async function uploadAvatar(file: File): Promise<string | null> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/v1/me/avatar', { method: 'POST', body });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `avatar upload responded ${response.status}`);
  }
  return AvatarResponseSchema.parse(await response.json()).image;
}

/** Remove the uploaded avatar (back to the gradient initial). */
export async function removeAvatar(): Promise<void> {
  const response = await fetch('/api/v1/me/avatar', { method: 'DELETE' });
  if (!response.ok) throw new Error(`avatar removal responded ${response.status}`);
}
