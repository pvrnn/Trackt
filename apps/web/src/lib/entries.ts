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

/** User-created entries + moderation queue (PRD §3.5) — API fetch wrappers. */

async function toError(response: Response, fallback: string): Promise<Error> {
  const detail = await response.json().catch(() => null);
  return new Error((detail as { error?: string } | null)?.error ?? fallback);
}

/** Create an entry; surfaces the server's message (validation, daily 429 cap). */
export async function createEntry(body: CreateMediaBody): Promise<CreateMediaResponse> {
  const response = await fetch('/api/v1/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toError(response, `entry creation responded ${response.status}`);
  return CreateMediaResponseSchema.parse(await response.json());
}

/** Upload a cover for an entry (creator or moderator); returns the public URL. */
export async function uploadCover(mediaId: string, file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`/api/v1/media/${mediaId}/cover`, { method: 'POST', body });
  if (!response.ok) throw await toError(response, `cover upload responded ${response.status}`);
  return CoverResponseSchema.parse(await response.json()).coverUrl;
}

/** Moderator: list user entries awaiting review (or already rejected). */
export async function fetchModerationQueue(
  status: ModerationQueueQuery['status'],
): Promise<ModerationQueueItem[]> {
  const response = await fetch(`/api/v1/moderation/queue?status=${status}`);
  if (!response.ok) throw await toError(response, `moderation queue responded ${response.status}`);
  return ModerationQueueResponseSchema.parse(await response.json()).items;
}

/** Moderator: edit fields and/or set the verdict on a user entry. */
export async function moderateEntry(mediaId: string, patch: ModerationPatchBody): Promise<void> {
  const response = await fetch(`/api/v1/moderation/media/${mediaId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await toError(response, `moderation update responded ${response.status}`);
}
