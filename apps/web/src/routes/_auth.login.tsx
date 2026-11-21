import { createFileRoute } from '@tanstack/react-router';
import { safeRedirect } from '@trackt/client';

/** The form itself lives in the `_auth` shell, which slides between both modes. */
export const Route = createFileRoute('/_auth/login')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.login') }] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  component: () => null,
});
