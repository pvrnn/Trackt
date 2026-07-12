import {
  AvatarResponseSchema,
  ProfileSummarySchema,
  type ProfileSummary,
  type UpdateProfileBody,
} from '@trackt/shared';
import { api, toError } from './http';

/** Fetch the authenticated own-profile summary. */
export async function fetchProfileSummary(): Promise<ProfileSummary> {
  try {
    return ProfileSummarySchema.parse(await api.get('me/profile').json());
  } catch (error) {
    throw await toError(error, 'profile summary');
  }
}

/** Update display name / bio. */
export async function updateProfile(body: UpdateProfileBody): Promise<void> {
  try {
    await api.patch('me/profile', { json: body });
  } catch (error) {
    throw await toError(error, 'profile update');
  }
}

/** Upload a new avatar; returns the public image URL. */
export async function uploadAvatar(file: File): Promise<string | null> {
  const body = new FormData();
  body.append('file', file);
  try {
    const json = await api.post('me/avatar', { body }).json();
    return AvatarResponseSchema.parse(json).image;
  } catch (error) {
    throw await toError(error, 'avatar upload');
  }
}

/** Remove the uploaded avatar (back to the gradient initial). */
export async function removeAvatar(): Promise<void> {
  try {
    await api.delete('me/avatar');
  } catch (error) {
    throw await toError(error, 'avatar removal');
  }
}
