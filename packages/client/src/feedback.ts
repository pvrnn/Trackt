import { useMutation } from '@tanstack/react-query';
import {
  FeedbackReceiptSchema,
  type FeedbackReceipt,
  type FeedbackSubmission,
} from '@trackt/shared';
import { toError } from './http.js';
import { http } from './runtime.js';

/**
 * Feedback intake (profile page). No cache to invalidate and no query key: a
 * report is write-only from the client's point of view, and the only thing the
 * reporter sees afterwards is the receipt the mutation returns.
 *
 * `route` is filled in by the caller rather than here, because only the screen
 * knows which page the report is about — and a module in `@trackt/client` has no
 * business reading `window.location`.
 */
export function useSubmitFeedback() {
  return useMutation({
    mutationFn: async (submission: FeedbackSubmission): Promise<FeedbackReceipt> => {
      try {
        return FeedbackReceiptSchema.parse(
          await http().post('feedback', { json: submission }).json(),
        );
      } catch (error) {
        throw await toError(error, 'sending feedback');
      }
    },
  });
}
