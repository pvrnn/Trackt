import { z } from 'zod';
import { SearchResultSchema } from './api.js';
import { MediaKindSchema, VisibilitySchema } from './media.js';

/**
 * Custom lists, ranked or unranked (PRD §3.4). The `list`/`list_item` tables
 * predate this contract, so every field here maps to a column that already
 * exists — no migration.
 *
 * Two scopes the Lists mockup draws are not served yet: FRIENDS needs a
 * friends-scoped lists endpoint (out of scope for ADR-0006 phase 2 — see
 * `docs/friends-plan.md`) and COLLABORATIVE needs a membership table, so
 * `ListsQuerySchema.scope` deliberately admits only `mine` rather than
 * pretending. The UI renders those tabs visibly inert.
 */

/** One of the fanned cover panels on a list card; the gradient is derived client-side. */
export const ListCoverSchema = z.object({
  kind: MediaKindSchema,
  title: z.string(),
  coverUrl: z.string().nullable(),
});
export type ListCover = z.infer<typeof ListCoverSchema>;

/** A list as it appears on a card — counts and cover seeds, no items. */
export const ListSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  isRanked: z.boolean(),
  isCollaborative: z.boolean(),
  visibility: VisibilitySchema,
  itemCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
  /** First four entries in list order, for the fanned cover panels. */
  covers: z.array(ListCoverSchema),
  /** Only set when the request named a media id (the add-to-list dialog). */
  containsMedia: z.boolean().optional(),
});
export type ListSummary = z.infer<typeof ListSummarySchema>;

/** A row in an opened list. */
export const ListEntrySchema = SearchResultSchema.extend({
  position: z.number().int(),
  /**
   * The list *owner's* rating of this title, which is what makes a ranked list
   * legible to any visitor — not the viewer's own score. Null if unrated.
   */
  ownerScore: z.number().nullable(),
});
export type ListEntry = z.infer<typeof ListEntrySchema>;

export const ListDetailSchema = ListSummarySchema.extend({
  owner: z.object({ name: z.string(), username: z.string() }),
  /** Drives whether the page shows edit/reorder/remove controls at all. */
  isOwner: z.boolean(),
  entries: z.array(ListEntrySchema),
});
export type ListDetail = z.infer<typeof ListDetailSchema>;

export const LIST_TITLE_MAX = 120;
export const LIST_DESCRIPTION_MAX = 500;

export const CreateListBodySchema = z.object({
  title: z.string().trim().min(1).max(LIST_TITLE_MAX),
  description: z.string().trim().max(LIST_DESCRIPTION_MAX).nullish(),
  isRanked: z.boolean().default(false),
  visibility: VisibilitySchema.default('public'),
});
export type CreateListBody = z.infer<typeof CreateListBodySchema>;

/**
 * Partial update; omitted fields are left alone. Spelled out rather than
 * `CreateListBodySchema.partial()`, because `.partial()` keeps the inner
 * `.default()`s — an omitted key would still arrive as `false`/`'public'`, so a
 * title-only rename would quietly un-rank the list and, worse, turn a private
 * one public.
 */
export const UpdateListBodySchema = z.object({
  title: z.string().trim().min(1).max(LIST_TITLE_MAX).optional(),
  description: z.string().trim().max(LIST_DESCRIPTION_MAX).nullish(),
  isRanked: z.boolean().optional(),
  visibility: VisibilitySchema.optional(),
});
export type UpdateListBody = z.infer<typeof UpdateListBodySchema>;

export const AddListItemBodySchema = z.object({ mediaId: z.uuid() });
export type AddListItemBody = z.infer<typeof AddListItemBodySchema>;

/**
 * Reordering is a neighbour swap rather than a full ordering payload: it is what
 * the move up/down controls need, and it can't be raced into an inconsistent
 * order the way a client-computed list of positions can.
 */
export const MoveListItemBodySchema = z.object({ direction: z.enum(['up', 'down']) });
export type MoveListItemBody = z.infer<typeof MoveListItemBodySchema>;

export const ListsQuerySchema = z.object({
  scope: z.enum(['mine']).default('mine'),
  /** Marks which of the viewer's lists already hold this media. */
  containsMedia: z.uuid().optional(),
});
export type ListsQuery = z.infer<typeof ListsQuerySchema>;
