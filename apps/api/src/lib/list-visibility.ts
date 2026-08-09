import type { Visibility } from '@trackt/shared';
import type { SessionUser } from './session.js';

/**
 * Who may see a list (PRD §3.4): `public` → everyone, `private` → owner only,
 * `followers` → accepted friends (ADR-0006; the enum value keeps its original
 * name, relabelled "FRIENDS" in the UI only).
 *
 * `isFriend` is precomputed by the caller so the common `public`/`private`/owner
 * paths never pay for a friendship lookup — see the call site in routes/v1/lists.ts.
 *
 * Mirrors lib/visibility.ts for media; a list read must satisfy *both*, since a
 * public list can hold titles the viewer isn't allowed to see.
 */
export function canViewList(
  list: { ownerId: string; visibility: Visibility },
  viewer: SessionUser | null,
  isFriend = false,
): boolean {
  if (viewer !== null && list.ownerId === viewer.id) return true;
  if (list.visibility === 'public') return true;
  return list.visibility === 'followers' && isFriend;
}

/**
 * Only the owner may mutate a list. Collaborative editing needs a membership
 * table that doesn't exist yet, so `is_collaborative` stays a display flag.
 */
export function canEditList(list: { ownerId: string }, viewer: SessionUser | null): boolean {
  return viewer !== null && list.ownerId === viewer.id;
}
