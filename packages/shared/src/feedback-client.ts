import { FeedbackReceiptSchema, type FeedbackReceipt, type FeedbackReport } from './feedback.js';

export interface SubmitFeedbackOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Forward one feedback report to the central catalog (the only place reports are
 * stored). Unlike the news clients, a non-2xx response is not degraded to an
 * empty result: the person who wrote the report is waiting, and "saved" when it
 * wasn't is worse than an error they can retry.
 */
export async function submitFeedback(
  catalogUrl: string,
  report: FeedbackReport,
  { timeoutMs, fetchImpl = fetch }: SubmitFeedbackOptions,
): Promise<FeedbackReceipt> {
  const response = await fetchImpl(new URL('/v1/feedback', catalogUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`feedback submit failed: ${response.status} ${response.statusText}`);
  }

  return FeedbackReceiptSchema.parse(await response.json());
}
