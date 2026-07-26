import type { Visibility } from '@trackt/shared';
import type { SessionUser } from './session.js';

/**
 * Who may see a list (PRD §3.4): `public` → everyone, `private` → owner only.
 *
 * `followers` currently resolves to owner-only. The follow system is v1.x (see
 * the note in routes/v1/home.ts), so there is no set of followers to admit yet —
 * and the safe direction to be wrong in is closed. The create/edit form says so
 * rather than implying an audience that cannot actually reach the list.
 *
 * Mirrors lib/visibility.ts for media; a list read must satisfy *both*, since a
 * public list can hold titles the viewer isn't allowed to see.
 */
export function canViewList(
  list: { ownerId: string; visibility: Visibility },
  viewer: SessionUser | null,
): boolean {
  if (viewer !== null && list.ownerId === viewer.id) return true;
  return list.visibility === 'public';
}

/**
 * Only the owner may mutate a list. Collaborative editing needs a membership
 * table that doesn't exist yet, so `is_collaborative` stays a display flag.
 */
export function canEditList(list: { ownerId: string }, viewer: SessionUser | null): boolean {
  return viewer !== null && list.ownerId === viewer.id;
}
