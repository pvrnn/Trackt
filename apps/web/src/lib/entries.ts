import {
  CoverResponseSchema,
  CreateMediaResponseSchema,
  ModerationQueueResponseSchema,
  type CreateMediaBody,
  type CreateMediaResponse,
  type ModerationPatchBody,
  type ModerationQueueItem,
  type ModerationQueueQuery,
} from '@trackt/shared';
import { api, toError } from './http';

/** User-created entries + moderation queue (PRD §3.5) — API fetch wrappers. */

/** Create an entry; surfaces the server's message (validation, daily 429 cap). */
export async function createEntry(body: CreateMediaBody): Promise<CreateMediaResponse> {
  try {
    return CreateMediaResponseSchema.parse(await api.post('media', { json: body }).json());
  } catch (error) {
    throw await toError(error, 'entry creation');
  }
}

/** Upload a cover for an entry (creator or moderator); returns the public URL. */
export async function uploadCover(mediaId: string, file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  try {
    const json = await api.post(`media/${mediaId}/cover`, { body }).json();
    return CoverResponseSchema.parse(json).coverUrl;
  } catch (error) {
    throw await toError(error, 'cover upload');
  }
}

/** Moderator: list user entries awaiting review (or already rejected). */
export async function fetchModerationQueue(
  status: ModerationQueueQuery['status'],
): Promise<ModerationQueueItem[]> {
  try {
    const json = await api.get('moderation/queue', { searchParams: { status } }).json();
    return ModerationQueueResponseSchema.parse(json).items;
  } catch (error) {
    throw await toError(error, 'moderation queue');
  }
}

/** Moderator: edit fields and/or set the verdict on a user entry. */
export async function moderateEntry(mediaId: string, patch: ModerationPatchBody): Promise<void> {
  try {
    await api.patch(`moderation/media/${mediaId}`, { json: patch });
  } catch (error) {
    throw await toError(error, 'moderation update');
  }
}
