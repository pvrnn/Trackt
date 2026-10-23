import { z } from 'zod';

/**
 * The categories the feedback dialog offers. Three, not a taxonomy: a report is
 * either something broken, something missing, or neither — anything finer
 * helps the operator triage less than it helps people guess which box to pick.
 */
export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'other'] as const;
export const FeedbackCategorySchema = z.enum(FEEDBACK_CATEGORIES);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

/**
 * What the reporter writes. `route` is the page they were on, captured by the
 * client at submit time — a bug report that doesn't say where it happened is
 * usually a round trip, and the browser already knows.
 */
export const FeedbackSubmissionSchema = z.object({
  category: FeedbackCategorySchema,
  message: z.string().trim().min(10).max(4000),
  route: z.string().max(300).optional(),
});
export type FeedbackSubmission = z.infer<typeof FeedbackSubmissionSchema>;

/**
 * What the instance API forwards to the catalog. The instance adds its own URL
 * and version rather than trusting the browser for them: they are the operator's
 * facts about which deployment the report came from, not the reporter's.
 */
export const FeedbackReportSchema = FeedbackSubmissionSchema.extend({
  instanceUrl: z.string().max(300).optional(),
  appVersion: z.string().max(40).optional(),
});
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>;

/** What the reporter's instance gets back, and shows them. */
export const FeedbackReceiptSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
});
export type FeedbackReceipt = z.infer<typeof FeedbackReceiptSchema>;

/** One stored report, as the operator's admin list returns it. */
export const FeedbackEntrySchema = z.object({
  id: z.uuid(),
  category: FeedbackCategorySchema,
  message: z.string(),
  route: z.string().nullable(),
  instanceUrl: z.string().nullable(),
  appVersion: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

export const FeedbackListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type FeedbackListQuery = z.infer<typeof FeedbackListQuerySchema>;

export const FeedbackListResponseSchema = z.object({
  /** Newest first. */
  entries: FeedbackEntrySchema.array(),
});
export type FeedbackListResponse = z.infer<typeof FeedbackListResponseSchema>;
