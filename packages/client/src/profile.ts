import { useQuery } from '@tanstack/react-query';
import {
  AvatarResponseSchema,
  ProfileSummarySchema,
  type ProfileSummary,
  type UpdateProfileBody,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/** Fetch the authenticated own-profile summary. */
export async function fetchProfileSummary(): Promise<ProfileSummary> {
  try {
    return ProfileSummarySchema.parse(await http().get('me/profile').json());
  } catch (error) {
    throw await toError(error, 'profile summary');
  }
}

/** Own-profile query — gated on session. */
export function useProfileSummary() {
  const isAuthed = useIsAuthed();
  return useQuery({ queryKey: ['profile'], queryFn: fetchProfileSummary, enabled: isAuthed });
}

/** Update display name / bio. */
export async function updateProfile(body: UpdateProfileBody): Promise<void> {
  try {
    await http().patch('me/profile', { json: body });
  } catch (error) {
    throw await toError(error, 'profile update');
  }
}

/**
 * What the avatar part is, on each client. Web hands over the `File` an
 * `<input type=file>` produced; React Native has no `File` and hands over the
 * `{ uri, name, type }` shape its `FormData` understands (an
 * `expo-image-picker` asset). The field name and the endpoint stay here — they
 * are the API contract, not a platform detail.
 */
export type AvatarFile = File | { uri: string; name: string; type: string };

/** Upload a new avatar; returns the public image URL. */
export async function uploadAvatar(file: AvatarFile): Promise<string | null> {
  const body = new FormData();
  body.append('file', file as Blob);
  try {
    const json = await http().post('me/avatar', { body }).json();
    return AvatarResponseSchema.parse(json).image;
  } catch (error) {
    throw await toError(error, 'avatar upload');
  }
}

/** Remove the uploaded avatar (back to the gradient initial). */
export async function removeAvatar(): Promise<void> {
  try {
    await http().delete('me/avatar');
  } catch (error) {
    throw await toError(error, 'avatar removal');
  }
}

/**
 * Delete the account and everything it owns (`DELETE /api/v1/me`).
 *
 * Irreversible, and the server says so first: it verifies the password against
 * the credential account before touching anything, so a wrong one comes back as
 * a 400 that `toError` turns into the message the field should show. On success
 * every session is revoked, this one included — the caller is signed out
 * whether it clears its own state or not, and should clear it anyway so the
 * next screen is not one that fetches.
 */
export async function deleteAccount(password: string): Promise<void> {
  try {
    await http().delete('me', { json: { password } });
  } catch (error) {
    throw await toError(error, 'account deletion');
  }
}
