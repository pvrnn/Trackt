import { createFileRoute } from '@tanstack/react-router';
import { safeRedirect } from '@trackt/client';

export interface VerifySearch {
  email?: string;
  code?: string;
  redirect?: string;
}

/** The form lives in the `_auth` shell, like sign-in and sign-up. */
export const Route = createFileRoute('/_auth/verify-email')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.verifyEmail') }] }),
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    ...(typeof search.email === 'string' && search.email ? { email: search.email } : {}),
    // The router JSON-parses search values, so a code without a leading zero arrives as a number.
    ...(typeof search.code === 'string' || typeof search.code === 'number'
      ? { code: String(search.code) }
      : {}),
    ...(safeRedirect(search.redirect) ? { redirect: safeRedirect(search.redirect) } : {}),
  }),
  component: () => null,
});
