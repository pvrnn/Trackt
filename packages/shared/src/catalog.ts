import { z } from 'zod';
import {
  ExternalIdsSchema,
  MediaKindSchema,
  MediaRelationTypeSchema,
  MediaStatusSchema,
  RelationDirectionSchema,
} from './media.js';

/** Free-form lowercase genre tags — deliberately not an enum, sources disagree too much. */
export const GenreSchema = z.string().min(1).max(64);

/**
 * The slim media contract shared by the central catalog service and every instance
 * (ADR-0001): only redistributable facts. `description`/`coverUrl` are enrichment
 * fields and stay nullable in the catalog.
 */
export const SlimMediaSchema = z.object({
  /** Canonical uuidv5 for provider-identified works; random for user-created ones. */
  id: z.uuid(),
  kind: MediaKindSchema,
  title: z.string().min(1),
  /** Alternative titles (original language, romanizations, common aliases). */
  synonyms: z.array(z.string()),
  year: z.number().int().nullable(),
  status: MediaStatusSchema.nullable(),
  genres: z.array(GenreSchema),
  /**
   * Episodes (series/anime season) or chapters (manga/webtoon); null for movies.
   * The part kind is derived from `kind` (PART_KIND_BY_MEDIA) — one count, not four (ADR-0003).
   */
  partCount: z.number().int().nullable(),
  /** Which season this row is, for series/anime split per season (ADR-0003); null otherwise. */
  seasonNumber: z.number().int().nullable(),
  externalIds: ExternalIdsSchema,
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export type SlimMedia = z.infer<typeof SlimMediaSchema>;

export const CatalogVersionSchema = z.object({
  /** Monotonic change cursor (max seq); 0 for an empty catalog. */
  version: z.number().int().nonnegative(),
  mediaCount: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});
export type CatalogVersion = z.infer<typeof CatalogVersionSchema>;

/**
 * Query for `GET /v1/catalog/search` — the live federated-search surface
 * (ADR-0002). Deliberately mirrors `SearchQuerySchema` in api.ts; kept as a
 * separate schema because it's a distinct service's contract.
 */
export const CatalogSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  kind: MediaKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

/** A central-catalog search hit; `rank` lets callers merge-sort against local results. */
export const CatalogSearchHitSchema = SlimMediaSchema.extend({
  rank: z.number(),
});
export type CatalogSearchHit = z.infer<typeof CatalogSearchHitSchema>;

export const CatalogSearchResponseSchema = z.object({
  results: z.array(CatalogSearchHitSchema),
});
export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;

/** Query for `GET /v1/catalog/relations` — edges touching one work (ADR-0004). */
export const CatalogRelationsQuerySchema = z.object({
  id: z.uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type CatalogRelationsQuery = z.infer<typeof CatalogRelationsQuerySchema>;

/**
 * One edge as served: the *target* work in slim form, plus the stored type and
 * which way the edge was traversed to reach it. Deliberately not a display
 * label — turning `{sequel, reverse}` into "prequel" is the consumer's job
 * (`relationLabel` in media.ts), so the display vocabulary lives in one place
 * and this service stays a data service. Extending SlimMediaSchema is also what
 * lets `buildProviderMediaRow` materialize a target with no adapter.
 */
export const CatalogRelationEdgeSchema = SlimMediaSchema.extend({
  type: MediaRelationTypeSchema,
  direction: RelationDirectionSchema,
});
export type CatalogRelationEdge = z.infer<typeof CatalogRelationEdgeSchema>;

export const CatalogRelationsResponseSchema = z.object({
  relations: z.array(CatalogRelationEdgeSchema),
});
export type CatalogRelationsResponse = z.infer<typeof CatalogRelationsResponseSchema>;

/**
 * Result of `POST /v1/admin/media`. Publishing is an upsert keyed on the
 * canonical id, so a re-send is a success with `created: false` rather than a
 * conflict — importers can replay a batch without special-casing what they
 * already sent. `seq` is the cursor the write landed at, echoed back so a
 * publisher can confirm the row actually changed.
 */
export const CatalogPublishMediaResponseSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  created: z.boolean(),
});
export type CatalogPublishMediaResponse = z.infer<typeof CatalogPublishMediaResponseSchema>;

/**
 * Body for `POST /v1/admin/relations`. Always the FORWARD direction (ADR-0004):
 * `{fromId: manga, toId: anime, type: 'adaptation'}` means the anime adapts the
 * manga. There is no way to publish a `prequel`/`source`/`parent` edge because
 * those are read-time labels, never rows — publish the forward edge instead.
 */
export const CatalogPublishRelationSchema = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  type: MediaRelationTypeSchema,
});
export type CatalogPublishRelation = z.infer<typeof CatalogPublishRelationSchema>;

/** `created: false` means the edge was already published, not that it failed. */
export const CatalogPublishRelationResponseSchema = z.object({
  created: z.boolean(),
});
export type CatalogPublishRelationResponse = z.infer<typeof CatalogPublishRelationResponseSchema>;
